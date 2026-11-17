import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import Decimal from 'decimal.js';
import { EVENTOS, type EventoComprobante } from '../../shared/eventos/eventos';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ARCA_GATEWAY, ArcaError, type ArcaGateway, type CredencialesArca, type SolicitudCae } from '../arca';
import type { AuthContext } from '../auth';
import { ItemsFacturablesService } from '../importaciones';
import { CredencialesArcaProvider, TenantsService } from '../tenants';
import { ComprobantesService, validarFechasServicio, type ComprobanteDetalle } from './comprobantes.service';
import { CONCEPTO, CONDICION_IVA, MONEDA_ARCA, TIPOS_COMPROBANTE, TIPO_DOCUMENTO } from './domain/codigos';
import { aYmdArca, deYmdArca, fechaAsociadaValida, resolverFechaCbte } from './domain/fechas';
import { resolverReceptorArca, type ReceptorArca } from './domain/receptor-arca';

/** Cuánto puede quedar un comprobante en EMITIENDO antes de que el cron lo recupere. */
const EMITIENDO_MAX_MS = 5 * 60_000;

export interface EmisorSnapshot {
  razonSocial: string;
  nombreFantasia: string;
  cuit: string;
  condicionIva: string;
  domicilio: string;
  ingresosBrutos: string | null;
  inicioActividades: string | null;
  cuitArca: string;
  usaCuitPrueba: boolean;
}

export interface ReceptorSnapshot {
  razonSocial: string;
  tipoDocumento: string;
  numeroDocumento: string;
  condicionIva: string;
  domicilio: string | null;
  arca: ReceptorArca;
}

/**
 * Emisión idempotente (ARCHITECTURE.md §8.3):
 * 1. BORRADOR/RECHAZADO → EMITIENDO con lock optimista (version).
 * 2. Lock de base por (CUIT, punto de venta, tipo): serializa la numeración.
 * 3. Número = último autorizado + 1, guardado como numeroReservado ANTES de pedir el CAE.
 * 4. FECAESolicitar → EMITIDO | RECHAZADO | PENDIENTE_VERIFICACION (si no sabemos qué pasó).
 * Un PENDIENTE_VERIFICACION nunca se vuelve a pedir a ciegas: primero se consulta ese número.
 */
@Injectable()
export class EmisionService {
  private readonly logger = new Logger(EmisionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comprobantes: ComprobantesService,
    private readonly tenants: TenantsService,
    private readonly credenciales: CredencialesArcaProvider,
    @Inject(ARCA_GATEWAY) private readonly arca: ArcaGateway,
    private readonly items: ItemsFacturablesService,
    private readonly eventos: EventEmitter2,
  ) {}

  async emitir(auth: AuthContext, id: string, version: number, idempotencyKey: string) {
    const c = await this.comprobantes.buscar(auth.tenantId, id);

    // Reintento del mismo clic: devolver el resultado sin volver a emitir.
    if (c.idempotencyKey === idempotencyKey && c.estado !== 'RECHAZADO') {
      if (c.estado === 'EMITIENDO') throw new ConflictException('La emisión de este comprobante está en curso.');
      return this.comprobantes.obtener(auth.tenantId, id);
    }
    if (c.estado === 'EMITIDO' || c.estado === 'ANULADO') throw new ConflictException('El comprobante ya fue emitido.');
    if (c.estado === 'EMITIENDO') throw new ConflictException('La emisión de este comprobante está en curso.');
    if (c.estado === 'PENDIENTE_VERIFICACION') {
      return this.verificar(auth.tenantId, id);
    }
    if (c.version !== version) {
      throw new ConflictException('El comprobante cambió desde que lo abriste. Recargalo antes de emitir.');
    }

    const cred = await this.credenciales.obtener(auth.tenantId);
    const { emisor, receptor } = await this.validarYArmarSnapshots(auth.tenantId, c, cred);

    try {
      const { count } = await this.prisma.comprobante.updateMany({
        where: { tenantId: auth.tenantId, id, version, estado: { in: ['BORRADOR', 'RECHAZADO'] } },
        data: {
          estado: 'EMITIENDO',
          idempotencyKey,
          intentos: { increment: 1 },
          version: { increment: 1 },
          ambiente: cred.ambiente,
          emisorSnapshot: emisor as unknown as Prisma.InputJsonValue,
          receptorSnapshot: receptor as unknown as Prisma.InputJsonValue,
          errorMensaje: null,
          errorDetalle: null,
          emitidoPorId: auth.usuarioId ?? null,
        },
      });
      if (!count) throw new ConflictException('El comprobante cambió desde que lo abriste. Recargalo antes de emitir.');
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new UnprocessableEntityException('Esa clave de idempotencia ya se usó para otro comprobante.');
      }
      throw err;
    }

    await this.solicitarCae(auth.tenantId, id, cred, receptor);
    const final = await this.comprobantes.obtener(auth.tenantId, id);
    if (final.estado === 'RECHAZADO') {
      throw new UnprocessableEntityException({ message: final.errorMensaje, detalle: final.errorDetalle, comprobante: final });
    }
    return final;
  }

  /** Pasos 2 a 4. Nunca lanza por errores de ARCA: los deja registrados en el comprobante. */
  private async solicitarCae(tenantId: string, id: string, cred: CredencialesArca, receptor: ReceptorSnapshot) {
    const c = await this.comprobantes.buscar(tenantId, id);
    const tipo = TIPOS_COMPROBANTE[c.tipo];
    const pv = c.puntoVenta.numero;
    const lockKey = `${cred.ambiente}:${cred.cuit}:${pv}:${tipo.codigo}`;
    let reservado: number | null = null;

    try {
      await this.prisma.$transaction(
        async (tx) => {
          // El tx solo sostiene el lock; las escrituras van por fuera para que se confirmen al instante
          // (si el proceso muere después de reservar el número, el número queda guardado).
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

          const ctx = { comprobanteId: id };
          const ultimo = await this.arca.ultimoAutorizado(cred, pv, tipo.codigo, ctx);
          reservado = ultimo + 1;
          await this.prisma.comprobante.update({
            where: { tenantId_id: { tenantId, id } },
            data: { numeroReservado: reservado },
          });

          let ultimaFecha: string | null = null;
          if (cred.ambiente === 'HOMOLOGACION' && ultimo > 0) {
            ultimaFecha = (await this.arca.consultar(cred, pv, tipo.codigo, ultimo, ctx).catch(() => null))?.cbteFch ?? null;
          }
          const solicitud = await this.armarSolicitud(c, cred, receptor.arca, reservado, ultimaFecha);

          await this.prisma.comprobante.update({
            where: { tenantId_id: { tenantId, id } },
            data: {
              fechaEmision: deYmdArca(solicitud.cbteFch),
              ...(solicitud.fchVtoPago ? { fechaVtoPago: deYmdArca(solicitud.fchVtoPago) } : {}),
              cotizacion: solicitud.monCotiz,
              payloadHash: createHash('sha256').update(JSON.stringify(solicitud)).digest('hex'),
            },
          });

          const cae = await this.arca.autorizar(cred, solicitud, ctx);
          await this.marcarEmitido(tenantId, id, reservado, cae.cae, cae.caeVto, cae.observaciones);
        },
        { timeout: 120_000, maxWait: 30_000 },
      );
    } catch (err) {
      await this.registrarFallo(tenantId, id, reservado, err);
    }
  }

  private async armarSolicitud(
    c: ComprobanteDetalle,
    cred: CredencialesArca,
    receptor: ReceptorArca,
    numero: number,
    ultimaFechaYmd: string | null,
  ): Promise<SolicitudCae> {
    const tipo = TIPOS_COMPROBANTE[c.tipo];
    const cbteFch = resolverFechaCbte(
      cred.ambiente,
      c.fechaEmision,
      ultimaFechaYmd,
      new Date(),
      c.asociado ? aYmdArca(c.asociado.fechaEmision) : null,
    );
    const servicios = c.concepto !== 'PRODUCTOS';

    let fchVtoPago = c.fechaVtoPago ? aYmdArca(c.fechaVtoPago) : undefined;
    if (servicios && fchVtoPago && fchVtoPago < cbteFch) {
      if (cred.ambiente === 'PRODUCCION') {
        throw new ArcaError('RECHAZO', 'El vencimiento de pago no puede ser anterior a la fecha del comprobante.');
      }
      fchVtoPago = cbteFch; // homologación ajusta la fecha a hoy: se corre el vencimiento para acompañar
    }

    const monCotiz = c.moneda === 'USD' ? await this.arca.cotizacionDolar(cred, { comprobanteId: c.id }) : '1';
    const d2 = (v: Prisma.Decimal) => new Decimal(v.toString()).toFixed(2);

    return {
      ptoVta: c.puntoVenta.numero,
      cbteTipo: tipo.codigo,
      cbteNro: numero,
      concepto: CONCEPTO[c.concepto].codigo,
      docTipo: receptor.docTipo,
      docNro: receptor.docNro,
      condicionIvaReceptorId: receptor.condicionIvaReceptorId,
      cbteFch,
      ...(servicios
        ? {
            fchServDesde: aYmdArca(c.fechaServicioDesde!),
            fchServHasta: aYmdArca(c.fechaServicioHasta!),
            fchVtoPago,
          }
        : {}),
      impTotal: d2(c.importeTotal),
      impTotConc: d2(c.importeNoGravado),
      impNeto: d2(c.importeNetoGravado),
      impOpEx: d2(c.importeExento),
      impIva: d2(c.importeIva),
      impTrib: d2(c.importeTributos),
      monId: MONEDA_ARCA[c.moneda],
      monCotiz,
      ...(c.moneda !== 'ARS' ? { canMisMonExt: c.cancelaMismaMoneda ? 'S' : 'N' } : {}),
      ...(tipo.letra !== 'C' && c.alicuotas.length
        ? { iva: c.alicuotas.map((a) => ({ id: a.arcaId, baseImp: d2(a.baseImponible), importe: d2(a.importe) })) }
        : {}),
      ...(c.asociado
        ? {
            cbtesAsoc: [
              {
                tipo: TIPOS_COMPROBANTE[c.asociado.tipo].codigo,
                ptoVta: c.asociado.puntoVenta.numero,
                nro: c.asociado.numero!,
                cuit: cred.cuit,
                cbteFch: aYmdArca(c.asociado.fechaEmision),
              },
            ],
          }
        : {}),
    };
  }

  private async marcarEmitido(
    tenantId: string,
    id: string,
    numero: number,
    cae: string,
    caeVto: string,
    observaciones: unknown,
  ) {
    const c = await this.prisma.comprobante.update({
      where: { tenantId_id: { tenantId, id } },
      data: {
        estado: 'EMITIDO',
        numero,
        numeroReservado: null,
        cae,
        caeVencimiento: deYmdArca(caeVto),
        observacionesArca: (observaciones ?? []) as Prisma.InputJsonValue,
        errorMensaje: null,
        errorDetalle: null,
        emitidoEn: new Date(),
      },
    });
    if (c.asociadoId && TIPOS_COMPROBANTE[c.tipo].clase === 'NOTA_CREDITO') {
      await this.actualizarAnulacion(tenantId, c.asociadoId);
    }
    await this.items.marcarFacturados(tenantId, id);
    this.eventos.emit(EVENTOS.COMPROBANTE_EMITIDO, { tenantId, comprobanteId: id } satisfies EventoComprobante);
  }

  private async avisarRechazo(tenantId: string, id: string) {
    const { intentos } = await this.prisma.comprobante.findUniqueOrThrow({ where: { tenantId_id: { tenantId, id } }, select: { intentos: true } });
    this.eventos.emit(EVENTOS.COMPROBANTE_RECHAZADO, { tenantId, comprobanteId: id, intento: intentos } satisfies EventoComprobante);
  }

  /** Una factura queda ANULADA cuando sus NC emitidas cubren el total; sus ítems se liberan para refacturarlos. */
  private async actualizarAnulacion(tenantId: string, facturaId: string) {
    const factura = await this.prisma.comprobante.findUnique({ where: { tenantId_id: { tenantId, id: facturaId } } });
    if (!factura) return;
    const notas = await this.prisma.comprobante.findMany({
      where: { tenantId, asociadoId: facturaId, estado: 'EMITIDO', tipo: { in: ['NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C'] } },
      select: { importeTotal: true },
    });
    const acreditado = notas.reduce((s, n) => s.plus(n.importeTotal.toString()), new Decimal(0));
    if (acreditado.gte(factura.importeTotal.toString()) && factura.estado === 'EMITIDO') {
      await this.prisma.comprobante.update({ where: { tenantId_id: { tenantId, id: facturaId } }, data: { estado: 'ANULADO' } });
      await this.items.liberarAnulados(tenantId, facturaId);
    }
  }

  private async registrarFallo(tenantId: string, id: string, reservado: number | null, err: unknown) {
    const arcaErr =
      err instanceof ArcaError
        ? err
        : new ArcaError(reservado !== null ? 'INCIERTO' : 'RECHAZO', (err as Error)?.message ?? 'Error inesperado al emitir.');
    // Un error después de reservar número que no sea un rechazo explícito de ARCA es incierto.
    const incierto = reservado !== null && arcaErr.tipo === 'INCIERTO';
    this.logger.warn(`Emisión ${id}: ${incierto ? 'PENDIENTE_VERIFICACION' : 'RECHAZADO'} — ${arcaErr.message}`);
    await this.prisma.comprobante.update({
      where: { tenantId_id: { tenantId, id } },
      data: incierto
        ? {
            estado: 'PENDIENTE_VERIFICACION',
            errorMensaje: `No se pudo confirmar la respuesta de ARCA. Se va a verificar automáticamente. (${arcaErr.message})`,
            errorDetalle: arcaErr.detalle ?? null,
          }
        : {
            estado: 'RECHAZADO',
            numeroReservado: null,
            errorMensaje: arcaErr.message,
            errorDetalle: arcaErr.detalle ?? null,
          },
    });
    if (!incierto) await this.avisarRechazo(tenantId, id);
  }

  // ── Verificación de emisiones inciertas ─────────────────────────────────

  async verificar(tenantId: string, id: string) {
    const c = await this.comprobantes.buscar(tenantId, id);
    if (c.estado !== 'PENDIENTE_VERIFICACION' || c.numeroReservado === null) {
      return this.comprobantes.obtener(tenantId, id);
    }
    const cred = await this.credenciales.obtener(tenantId);
    const tipo = TIPOS_COMPROBANTE[c.tipo];
    const receptor = c.receptorSnapshot as unknown as ReceptorSnapshot;
    const ctx = { comprobanteId: id };

    try {
      const enArca = await this.arca.consultar(cred, c.puntoVenta.numero, tipo.codigo, c.numeroReservado, ctx);
      if (enArca) {
        const coincide =
          enArca.docNro === receptor.arca.docNro &&
          new Decimal(enArca.impTotal).minus(c.importeTotal.toString()).abs().lt(0.01) &&
          enArca.cae;
        if (coincide) {
          await this.marcarEmitido(tenantId, id, c.numeroReservado, enArca.cae, enArca.caeVto, []);
          this.logger.log(`Emisión ${id} recuperada: ARCA la había autorizado (CAE ${enArca.cae}).`);
        } else {
          await this.prisma.comprobante.update({
            where: { tenantId_id: { tenantId, id } },
            data: {
              errorMensaje:
                `ARCA tiene un comprobante con el número ${c.numeroReservado} que no coincide con este. ` +
                'Requiere revisión manual antes de volver a emitir.',
              errorDetalle: JSON.stringify(enArca),
            },
          });
        }
      } else {
        const ultimo = await this.arca.ultimoAutorizado(cred, c.puntoVenta.numero, tipo.codigo, ctx);
        if (ultimo < c.numeroReservado) {
          await this.prisma.comprobante.update({
            where: { tenantId_id: { tenantId, id } },
            data: {
              estado: 'RECHAZADO',
              numeroReservado: null,
              errorMensaje: 'El pedido no llegó a ARCA: no se emitió nada. Podés volver a emitir.',
              errorDetalle: null,
            },
          });
          await this.avisarRechazo(tenantId, id);
        }
      }
    } catch (err) {
      const msg = err instanceof ArcaError ? err.message : (err as Error).message;
      this.logger.warn(`Verificación de ${id} falló: ${msg}`);
    }
    return this.comprobantes.obtener(tenantId, id);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async recuperarEmisiones() {
    const limite = new Date(Date.now() - EMITIENDO_MAX_MS);
    // EMITIENDO colgado (el proceso murió a mitad de camino).
    const colgados = await this.prisma.comprobante.findMany({
      where: { estado: 'EMITIENDO', updatedAt: { lt: limite } },
      select: { id: true, tenantId: true, numeroReservado: true },
      take: 20,
    });
    for (const c of colgados) {
      await this.prisma.comprobante.update({
        where: { tenantId_id: { tenantId: c.tenantId, id: c.id } },
        data:
          c.numeroReservado !== null
            ? { estado: 'PENDIENTE_VERIFICACION', errorMensaje: 'La emisión se interrumpió. Verificando con ARCA…' }
            : { estado: 'RECHAZADO', errorMensaje: 'La emisión se interrumpió antes de llegar a ARCA. Podés volver a emitir.' },
      });
      if (c.numeroReservado === null) await this.avisarRechazo(c.tenantId, c.id);
    }

    const pendientes = await this.prisma.comprobante.findMany({
      where: { estado: 'PENDIENTE_VERIFICACION', updatedAt: { lt: new Date(Date.now() - 60_000) } },
      select: { id: true, tenantId: true },
      take: 10,
    });
    for (const p of pendientes) {
      await this.verificar(p.tenantId, p.id).catch((err) =>
        this.logger.error(`Cron de verificación ${p.id}: ${(err as Error).message}`),
      );
    }
  }

  // ── Validaciones previas ────────────────────────────────────────────────

  private async validarYArmarSnapshots(
    tenantId: string,
    c: ComprobanteDetalle,
    cred: CredencialesArca,
  ): Promise<{ emisor: EmisorSnapshot; receptor: ReceptorSnapshot }> {
    const emisor = await this.tenants.obtenerEmisorCompleto(tenantId);
    const faltan: string[] = [];
    if (!emisor.razonSocial.trim()) faltan.push('razón social del emisor');
    if (!emisor.domicilioFiscal.trim()) faltan.push('domicilio fiscal del emisor');
    if (!emisor.inicioActividades) faltan.push('inicio de actividades del emisor');
    if (!c.cliente.razonSocial.trim()) faltan.push('razón social del cliente');
    if (faltan.length) throw new BadRequestException(`Faltan datos para emitir: ${faltan.join(', ')}.`);

    if (c.ambiente !== cred.ambiente || c.puntoVenta.ambiente !== cred.ambiente) {
      throw new BadRequestException(
        'El comprobante se armó para otro ambiente de ARCA. Elegí un punto de venta del ambiente actual.',
      );
    }
    if (!c.puntoVenta.activo) throw new BadRequestException('El punto de venta está desactivado.');

    const letra = TIPOS_COMPROBANTE[c.tipo].letra;
    if (letra === 'A' && c.cliente.tipoDocumento !== 'CUIT') {
      throw new BadRequestException('Una Factura A requiere que el cliente tenga CUIT.');
    }

    validarFechasServicio(
      {
        concepto: c.concepto,
        fechaServicioDesde: c.fechaServicioDesde?.toISOString().slice(0, 10) ?? null,
        fechaServicioHasta: c.fechaServicioHasta?.toISOString().slice(0, 10) ?? null,
        fechaVtoPago: c.fechaVtoPago?.toISOString().slice(0, 10) ?? null,
      },
      true,
    );

    if (c.asociado) {
      if (!c.asociado.numero) throw new BadRequestException('La factura asociada no tiene número.');
      const asociadaYmd = aYmdArca(c.asociado.fechaEmision);
      if (cred.ambiente === 'PRODUCCION' && !fechaAsociadaValida(resolverFechaCbte('PRODUCCION', c.fechaEmision, null), asociadaYmd)) {
        const [a, m, d] = [asociadaYmd.slice(0, 4), asociadaYmd.slice(4, 6), asociadaYmd.slice(6, 8)];
        throw new BadRequestException(
          `La factura asociada es del ${d}/${m}/${a}: ARCA no acepta una nota de un mes anterior. Emitila a partir del 01/${m}/${a}.`,
        );
      }
      if (TIPOS_COMPROBANTE[c.tipo].clase === 'NOTA_CREDITO') {
        const otras = await this.prisma.comprobante.findMany({
          where: { tenantId, asociadoId: c.asociado.id, estado: 'EMITIDO', id: { not: c.id }, tipo: c.tipo },
          select: { importeTotal: true },
        });
        const acreditado = otras.reduce((s, n) => s.plus(n.importeTotal.toString()), new Decimal(c.importeTotal.toString()));
        if (acreditado.gt(c.asociado.importeTotal.toString())) {
          throw new BadRequestException('Las notas de crédito superan el total de la factura asociada.');
        }
      }
    }

    let arca: ReceptorArca;
    try {
      arca = resolverReceptorArca(cred.usaCuitPrueba, letra, c.cliente);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    return {
      emisor: {
        razonSocial: emisor.razonSocial,
        nombreFantasia: emisor.nombreFantasia,
        cuit: emisor.cuit,
        condicionIva: CONDICION_IVA[emisor.condicionIva].etiqueta,
        domicilio: emisor.domicilioFiscal,
        ingresosBrutos: emisor.ingresosBrutos,
        inicioActividades: emisor.inicioActividades?.toISOString().slice(0, 10) ?? null,
        cuitArca: cred.cuit,
        usaCuitPrueba: cred.usaCuitPrueba,
      },
      receptor: {
        razonSocial: c.cliente.razonSocial,
        tipoDocumento: TIPO_DOCUMENTO[c.cliente.tipoDocumento].etiqueta,
        numeroDocumento: c.cliente.numeroDocumento,
        condicionIva: CONDICION_IVA[c.cliente.condicionIva].etiqueta,
        domicilio: c.cliente.domicilio,
        arca,
      },
    };
  }
}
