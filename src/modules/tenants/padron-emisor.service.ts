import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PadronService, type DatosPadron } from '../arca';
import { TenantsService, type CampoArca, type DatosDeArca } from './tenants.service';

export const CUIT_NO_REGISTRADO = 'ARCA no tiene registrado ese CUIT. Revisá que esté bien escrito.';

/** Para comparar domicilios escritos distinto pero equivalentes (tildes, mayúsculas, puntuación). */
function normalizar(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function datosDeArca(d: DatosPadron): DatosDeArca {
  return {
    ...(d.razonSocial ? { razonSocial: d.razonSocial } : {}),
    ...(d.condicionIva ? { condicionIva: d.condicionIva } : {}),
    ...(d.domicilio ? { domicilioFiscal: d.domicilio } : {}),
  };
}

/**
 * Valida en el padrón de ARCA el CUIT con el que la empresa se da de alta y trae sus datos.
 * Usa el certificado de plataforma (`PadronService`), así funciona también en homologación.
 * Razón social, condición IVA y domicilio que vienen de ARCA quedan bloqueados (`camposDeArca`).
 */
@Injectable()
export class PadronEmisorService {
  private readonly logger = new Logger(PadronEmisorService.name);

  constructor(
    private readonly padron: PadronService,
    private readonly tenants: TenantsService,
  ) {}

  /** Si el servidor tiene configurado el padrón (para que el formulario sepa si validar). */
  disponible(): boolean {
    return this.padron.configurado();
  }

  /** Para autocompletar el formulario: 404 si ARCA no lo conoce; 503/429 si no se pudo consultar. */
  async consultar(tenantId: string, cuit: string) {
    const datos = await this.padron.consultar(cuit, tenantId);
    if (!datos) throw new NotFoundException(CUIT_NO_REGISTRADO);
    return {
      cuit: datos.cuit,
      razonSocial: datos.razonSocial,
      domicilio: datos.domicilio,
      condicionIva: datos.condicionIva,
      inicioActividadesSugerido: datos.inicioActividadesSugerido ?? null,
    };
  }

  /**
   * Al guardar el CUIT por primera vez: los datos de ARCA que pisan a los del formulario.
   * Rechaza si ARCA dice que no existe. Si el padrón no está configurado o no responde,
   * devuelve undefined y se guarda lo que cargó la empresa (no frenar el alta por una caída).
   */
  async datosParaAlta(tenantId: string, cuit: string): Promise<DatosDeArca | undefined> {
    if (!this.padron.configurado()) return undefined;
    try {
      const datos = await this.padron.consultar(cuit, tenantId);
      if (!datos) throw new NotFoundException(CUIT_NO_REGISTRADO);
      return datosDeArca(datos);
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      if (err instanceof HttpException && err.getStatus() === HttpStatus.BAD_REQUEST) throw err;
      this.logger.warn(`No se pudo verificar el CUIT del tenant ${tenantId} en el padrón: ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * Para una empresa que ya tiene el CUIT guardado: bloquea los campos que coinciden con ARCA
   * (sin pisar nada) y devuelve el inicio de actividades sugerido.
   */
  async sincronizar(tenantId: string) {
    const emisor = await this.tenants.obtenerEmisor(tenantId);
    if (!emisor.cuit) throw new BadRequestException('Primero cargá el CUIT de la empresa.');
    const datos = await this.padron.consultar(emisor.cuit, tenantId);
    if (!datos) throw new NotFoundException(CUIT_NO_REGISTRADO);

    const coinciden: CampoArca[] = [];
    if (datos.razonSocial && normalizar(datos.razonSocial) === normalizar(emisor.razonSocial)) coinciden.push('razonSocial');
    if (datos.condicionIva && datos.condicionIva === emisor.condicionIva) coinciden.push('condicionIva');
    if (datos.domicilio && normalizar(datos.domicilio) === normalizar(emisor.domicilioFiscal)) coinciden.push('domicilioFiscal');

    const nuevos = coinciden.filter((c) => !emisor.camposDeArca.includes(c));
    const camposDeArca = nuevos.length ? await this.tenants.marcarCamposDeArca(tenantId, nuevos) : emisor.camposDeArca;
    return { camposDeArca, inicioActividadesSugerido: datos.inicioActividadesSugerido ?? null };
  }
}
