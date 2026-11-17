import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { normalizarCuit } from '../../shared/util/cuit';
import { ARCA_GATEWAY, ArcaError, type ArcaGateway } from '../arca';
import type { AuthContext } from '../auth';
import { CredencialesArcaProvider, TenantsService } from '../tenants';
import { evaluarChecklist, listoParaProduccion } from './checklist';

/** Factura A y C: con una de las dos alcanza para comprobar acceso a WSFE con ese punto de venta. */
const TIPO_PRUEBA = { RESPONSABLE_INSCRIPTO: 1, OTRO: 11 };

/**
 * Pase de un tenant a producción (Fase 6). Nunca emite: la prueba de conexión solo consulta el
 * último número autorizado, que no tiene efectos fiscales.
 */
@Injectable()
export class ProduccionService {
  private readonly logger = new Logger(ProduccionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
    private readonly credenciales: CredencialesArcaProvider,
    @Inject(ARCA_GATEWAY) private readonly arca: ArcaGateway,
    private readonly config: ConfigService,
  ) {}

  async estado(tenantId: string) {
    const emisor = await this.tenants.obtenerEmisor(tenantId);
    const [certificado, puntos, borradores] = await Promise.all([
      this.tenants.certificadoVigente(tenantId, 'PRODUCCION'),
      this.prisma.puntoVenta.findMany({ where: { tenantId, ambiente: 'PRODUCCION', activo: true }, orderBy: { numero: 'asc' }, select: { numero: true } }),
      this.prisma.comprobante.count({ where: { tenantId, ambiente: 'HOMOLOGACION', estado: { in: ['BORRADOR', 'RECHAZADO'] } } }),
    ]);
    const chequeos = evaluarChecklist({
      emisor: { razonSocial: emisor.razonSocial, domicilioFiscal: emisor.domicilioFiscal, inicioActividades: emisor.inicioActividades, cuit: emisor.cuit },
      afipSdkConfigurado: Boolean(this.config.get('AFIP_SDK_API_KEY')),
      certificado,
      puntosVentaProduccion: puntos.map((p) => p.numero),
      borradoresHomologacion: borradores,
    });
    return { ambiente: emisor.ambienteArca, cuit: emisor.cuit, listo: listoParaProduccion(chequeos), chequeos, puntosVenta: puntos.map((p) => p.numero) };
  }

  /** Consulta a ARCA producción el último número autorizado de cada punto de venta (solo lectura). */
  async probarConexion(tenantId: string) {
    const estado = await this.estado(tenantId);
    const obligatoriosSinArca = estado.chequeos.filter((c) => c.obligatorio && !c.ok);
    if (obligatoriosSinArca.length) {
      throw new BadRequestException(`Antes de probar la conexión: ${obligatoriosSinArca.map((c) => c.mensaje).join(' ')}`);
    }
    const emisor = await this.tenants.obtenerEmisorCompleto(tenantId);
    const tipo = emisor.condicionIva === 'RESPONSABLE_INSCRIPTO' ? TIPO_PRUEBA.RESPONSABLE_INSCRIPTO : TIPO_PRUEBA.OTRO;
    const cred = await this.credenciales.paraAmbiente(tenantId, 'PRODUCCION');
    const resultados: Array<{ puntoVenta: number; ok: boolean; ultimoAutorizado?: number; error?: string }> = [];
    for (const pv of estado.puntosVenta) {
      try {
        resultados.push({ puntoVenta: pv, ok: true, ultimoAutorizado: await this.arca.ultimoAutorizado(cred, pv, tipo) });
      } catch (err) {
        const mensaje = err instanceof ArcaError ? err.message : 'Error inesperado al consultar ARCA.';
        resultados.push({ puntoVenta: pv, ok: false, error: mensaje });
      }
    }
    return { ok: resultados.length > 0 && resultados.every((r) => r.ok), resultados };
  }

  async activar(auth: AuthContext, confirmacionCuit: string) {
    const estado = await this.estado(auth.tenantId);
    if (estado.ambiente === 'PRODUCCION') return this.estado(auth.tenantId);
    if (normalizarCuit(confirmacionCuit) !== estado.cuit) {
      throw new BadRequestException('Para confirmar, escribí el CUIT de la empresa.');
    }
    if (!estado.listo) {
      throw new BadRequestException(`Todavía no se puede pasar a producción: ${estado.chequeos.filter((c) => c.obligatorio && !c.ok).map((c) => c.mensaje).join(' ')}`);
    }
    const prueba = await this.probarConexion(auth.tenantId);
    if (!prueba.ok) {
      const errores = prueba.resultados.filter((r) => !r.ok).map((r) => `PV ${r.puntoVenta}: ${r.error}`);
      throw new BadRequestException({ message: 'ARCA producción no respondió bien con el certificado y el punto de venta cargados.', detalle: errores.join('\n') });
    }
    await this.tenants.cambiarAmbiente(auth.tenantId, 'PRODUCCION');
    this.logger.warn(`Tenant ${auth.tenantId} pasó a PRODUCCIÓN (usuario ${auth.usuarioId ?? '—'}).`);
    return this.estado(auth.tenantId);
  }

  async volverAHomologacion(auth: AuthContext, confirmacionCuit: string) {
    const emisor = await this.tenants.obtenerEmisor(auth.tenantId);
    if (normalizarCuit(confirmacionCuit) !== emisor.cuit) throw new BadRequestException('Para confirmar, escribí el CUIT de la empresa.');
    await this.tenants.cambiarAmbiente(auth.tenantId, 'HOMOLOGACION');
    this.logger.warn(`Tenant ${auth.tenantId} volvió a HOMOLOGACIÓN (usuario ${auth.usuarioId ?? '—'}).`);
    return this.estado(auth.tenantId);
  }
}
