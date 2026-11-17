import { HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Afip from '@afipsdk/afip.js';
import { esCuitValido, normalizarCuit } from '../../shared/util/cuit';
import { mapearPadron, normalizarPem } from './afip-sdk.gateway';
import { esPersonaInexistente } from './arca-errores';
import type { DatosPadron } from './arca.types';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Tope diario de consultas reales a ARCA por tenant (los aciertos de caché no cuentan). */
const MAX_CONSULTAS_DIARIAS_POR_TENANT = 100;

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** ARCA devuelve algunos textos con entidades HTML ("PE&#209;A" en vez de "PEÑA"). */
function decodificarEntidades(texto: string): string {
  if (!texto.includes('&')) return texto;
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTIDADES[ent.toLowerCase()] ?? match;
  });
}

/**
 * Padrón de ARCA (ws_sr_constancia_inscripcion) con el certificado de plataforma (`PADRON_*`),
 * no con el de cada empresa: así validan todas, aunque estén en homologación (cuyo padrón es
 * ficticio). Igual que Vialto (core/padron): cuenta de AfipSDK propia para no gastar la cuota de
 * facturación, caché de 7 días por CUIT, tope diario por tenant, y nunca bloquea la carga
 * (sin configurar o caído → 503 y se completa a mano).
 */
@Injectable()
export class PadronService {
  private readonly logger = new Logger(PadronService.name);
  // En memoria a propósito: una sola instancia. Si se escala a varias, pasar a la base.
  private readonly cache = new Map<string, { datos: DatosPadron | null; vence: number }>();
  private readonly consultasPorTenant = new Map<string, { dia: string; cantidad: number }>();
  private afip: Afip | null = null;

  constructor(private readonly config: ConfigService) {}

  configurado(): boolean {
    return ['PADRON_AFIP_SDK_API_KEY', 'PADRON_CUIT', 'PADRON_CERT', 'PADRON_KEY'].every((n) => Boolean(this.config.get<string>(n)));
  }

  /** null = el CUIT no está en el padrón. 503 si no está configurado o ARCA no responde; 429 por el tope diario. */
  async consultar(cuitCrudo: string, tenantId: string): Promise<DatosPadron | null> {
    const cuit = normalizarCuit(cuitCrudo);
    if (!esCuitValido(cuit)) throw new HttpException('El CUIT no es válido (revisá el dígito verificador).', HttpStatus.BAD_REQUEST);

    const enCache = this.cache.get(cuit);
    if (enCache && enCache.vence > Date.now()) return enCache.datos;

    const afip = this.cliente();
    this.registrarConsulta(tenantId);

    let datos: DatosPadron | null;
    try {
      const r = (await afip.RegisterInscriptionProof.getTaxpayerDetails(Number(cuit))) as Record<string, unknown> | null;
      datos = r ? mapearPadron(cuit, r) : null;
    } catch (err) {
      if (esPersonaInexistente(err)) {
        datos = null;
      } else {
        const detalle = (err as { data?: unknown })?.data ?? (err as Error)?.message ?? err;
        this.logger.error(`Padrón ARCA falló para CUIT ${cuit}: ${typeof detalle === 'string' ? detalle : JSON.stringify(detalle)}`);
        throw new ServiceUnavailableException('No se pudo consultar ARCA en este momento. Podés completar los datos a mano.');
      }
    }
    if (datos) {
      datos = {
        ...datos,
        razonSocial: decodificarEntidades(datos.razonSocial),
        domicilio: datos.domicilio ? decodificarEntidades(datos.domicilio) : null,
      };
    }
    this.cache.set(cuit, { datos, vence: Date.now() + CACHE_TTL_MS });
    return datos;
  }

  private cliente(): Afip {
    if (this.afip) return this.afip;
    if (!this.configurado()) {
      throw new ServiceUnavailableException('La validación con ARCA no está configurada en el servidor. Podés completar los datos a mano.');
    }
    this.afip = new Afip({
      CUIT: Number(normalizarCuit(this.config.get<string>('PADRON_CUIT') as string)),
      access_token: this.config.get<string>('PADRON_AFIP_SDK_API_KEY') as string,
      production: true,
      cert: normalizarPem(this.config.get<string>('PADRON_CERT') as string),
      key: normalizarPem(this.config.get<string>('PADRON_KEY') as string),
    });
    return this.afip;
  }

  private registrarConsulta(tenantId: string): void {
    const dia = new Date().toISOString().slice(0, 10);
    const actual = this.consultasPorTenant.get(tenantId);
    const cantidad = actual?.dia === dia ? actual.cantidad : 0;
    if (cantidad >= MAX_CONSULTAS_DIARIAS_POR_TENANT) {
      throw new HttpException('Se alcanzó el límite diario de consultas a ARCA. Podés completar los datos a mano.', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.consultasPorTenant.set(tenantId, { dia, cantidad: cantidad + 1 });
  }
}
