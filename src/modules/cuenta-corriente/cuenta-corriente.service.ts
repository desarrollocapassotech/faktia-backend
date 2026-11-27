import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Moneda, type TipoComprobante } from '@prisma/client';
import Decimal from 'decimal.js';
import type { AuthContext } from '../auth';
import { ClientesService } from '../clientes';
import { ComprobantesService, type ComprobanteParaCuentaCorriente } from '../comprobantes';
import { RecibosService, type ReciboParaCuentaCorriente } from '../recibos';
import { TenantsService } from '../tenants';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { estadoDe, ordenMoneda, pendienteDe, repartirHaber, saldosAcumulados, saldosPorMoneda, sumarDias, importeAImputar } from './domain/cuenta';
import { convertir, elegirTipoCambio, impactoFactura, pendientePorCertificacion, pendientesDe, repartirEnProyecto, type DebeProyecto } from './domain/proyecto';
import { PROVEEDOR_COTIZACION, type ProveedorCotizacion } from './cotizacion';
import type { ActualizarMovimientoDto, CrearImputacionDto, CrearMovimientoDto } from './dto/cuenta-corriente.dto';

/** Imputar o sincronizar encadena varias escrituras: el default de Prisma (5 s) puede no alcanzar. */
export const TX = { timeout: 20_000, maxWait: 10_000 } as const;

const NOTAS_CREDITO: TipoComprobante[] = ['NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C'];

const TIPO_TEXTO: Record<TipoComprobante, string> = {
  FACTURA_A: 'Factura A',
  NOTA_DEBITO_A: 'Nota de débito A',
  NOTA_CREDITO_A: 'Nota de crédito A',
  FACTURA_B: 'Factura B',
  NOTA_DEBITO_B: 'Nota de débito B',
  NOTA_CREDITO_B: 'Nota de crédito B',
  FACTURA_C: 'Factura C',
  NOTA_DEBITO_C: 'Nota de débito C',
  NOTA_CREDITO_C: 'Nota de crédito C',
};

export const deYmd = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
export const aYmd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
export const dinero = (d: Decimal.Value) => new Decimal(d).toFixed(2);
const numeroComprobante = (pv: number, numero: number) => `${String(pv).padStart(5, '0')}-${String(numero).padStart(8, '0')}`;

/** Hoy en Argentina, como fecha sin hora (igual que las de la base). */
export function hoyAr(): Date {
  return deYmd(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date()));
}

/** Un DEBE con lo que le falta cobrar (para el listado de cuentas y el resumen). */
export interface DebeAbierto {
  id: string;
  clienteId: string;
  razonSocial: string;
  proyectoId: string | null;
  proyecto: string | null;
  /** Certificación de un hito (lo que vence es la certificación, no el hito entero). */
  certificacionId: string | null;
  concepto: string;
  numero: string | null;
  moneda: Moneda;
  importe: Decimal;
  pendiente: Decimal;
  fecha: Date;
  fechaVencimiento: Date | null;
}

/**
 * Cuenta corriente de clientes, tomando de ejemplo la de Vialto: movimientos DEBE/HABER por cliente,
 * imputaciones de cobros a facturas puntuales y saldo por moneda (nunca se suman pesos con dólares).
 *
 * Los comprobantes emitidos y los recibos de cobro entran solos: `sincronizar` crea el movimiento de
 * los que todavía no lo tienen (también los anteriores a este módulo) cada vez que se consulta la
 * cuenta. Así no hace falta que Comprobantes ni Recibos conozcan a este módulo.
 */
@Injectable()
export class CuentaCorrienteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientes: ClientesService,
    private readonly comprobantes: ComprobantesService,
    private readonly recibos: RecibosService,
    private readonly tenants: TenantsService,
    @Inject(PROVEEDOR_COTIZACION) private readonly cotizacion: ProveedorCotizacion,
  ) {}

  // ───────────────────────────── Sincronización ─────────────────────────────

  /**
   * Crea los movimientos que faltan:
   * - factura / nota de débito emitida → DEBE, con el vencimiento de pago del comprobante (o la fecha
   *   + los días de vencimiento del cliente);
   * - nota de crédito emitida → HABER, imputado a su factura por lo que le falte cobrar;
   * - recibo de cobro guardado con un cliente → HABER, imputado a las facturas que dice cancelar.
   * Solo cuentan los comprobantes del ambiente actual de la empresa: al pasar a producción, lo emitido
   * en homologación (sin validez fiscal) sale de la cuenta.
   * Comprobantes y recibos se leen por sus servicios públicos (un módulo no lee tablas ajenas). Un
   * advisory lock por empresa evita que dos pedidos simultáneos creen lo mismo dos veces.
   */
  async sincronizar(tenantId: string): Promise<void> {
    const { ambienteArca } = await this.tenants.obtenerEmisor(tenantId);
    const [idsComprobantes, idsRecibos, idsAnulados, registrados] = await Promise.all([
      this.comprobantes.idsConCae(tenantId, ambienteArca),
      this.recibos.idsCobrosConCliente(tenantId),
      this.recibos.idsAnulados(tenantId),
      this.prisma.movimientoCuentaCorriente.findMany({
        where: { tenantId, origen: { in: ['COMPROBANTE', 'RECIBO'] } },
        select: { id: true, comprobanteId: true, reciboId: true, _count: { select: { anuladoPor: true } } },
      }),
    ]);
    const conCae = new Set(idsComprobantes);
    const anulados = new Set(idsAnulados);
    const comprobantesRegistrados = new Set(registrados.map((r) => r.comprobanteId).filter(Boolean));
    const recibosRegistrados = new Set(registrados.map((r) => r.reciboId).filter(Boolean));
    const faltanComprobantes = idsComprobantes.filter((id) => !comprobantesRegistrados.has(id));
    const faltanRecibos = idsRecibos.filter((id) => !recibosRegistrados.has(id));
    const deOtroAmbiente = registrados.filter((r) => r.comprobanteId && !conCae.has(r.comprobanteId)).map((r) => r.id);
    // Cobros de recibos anulados que todavía no tienen su movimiento de anulación (o recién se registran).
    const hayAnulacionesPendientes =
      registrados.some((r) => r.reciboId && anulados.has(r.reciboId) && r._count.anuladoPor === 0) || faltanRecibos.some((id) => anulados.has(id));
    // Lo de siempre es que no falte nada: no se abre la transacción.
    if (faltanComprobantes.length + faltanRecibos.length + deOtroAmbiente.length === 0 && !hayAnulacionesPendientes) return;

    const [comprobantes, recibos] = await Promise.all([
      this.comprobantes.paraCuentaCorriente(tenantId, faltanComprobantes),
      this.recibos.paraCuentaCorriente(tenantId, faltanRecibos),
    ]);
    await this.prisma.$transaction(async (tx) => {
      await this.bloquear(tx, tenantId);
      if (deOtroAmbiente.length) await tx.movimientoCuentaCorriente.deleteMany({ where: { tenantId, id: { in: deOtroAmbiente } } });
      await this.registrarComprobantes(tx, tenantId, comprobantes);
      await this.registrarRecibos(tx, tenantId, recibos);
      await this.registrarAnulaciones(tx, tenantId, anulados);
    }, TX);
  }

  /** Proyecto de un comprobante, solo si es del mismo cliente y moneda (si no, la factura cuenta como sin proyecto). */
  private async proyectoDeComprobante(tx: Prisma.TransactionClient, tenantId: string, c: ComprobanteParaCuentaCorriente) {
    if (!c.proyectoId) return null;
    const p = await tx.proyecto.findUnique({
      where: { tenantId_id: { tenantId, id: c.proyectoId } },
      select: { id: true, clienteId: true, moneda: true, montoAcordado: true, modoIva: true, nombre: true },
    });
    return p && p.clienteId === c.clienteId && p.moneda === c.moneda ? p : null;
  }

  /** Importe y observación del movimiento de un comprobante según su proyecto (ModoIvaProyecto). */
  async impactoDeComprobante(tx: Prisma.TransactionClient, tenantId: string, c: ComprobanteParaCuentaCorriente) {
    const proyecto = await this.proyectoDeComprobante(tx, tenantId, c);
    const r = impactoFactura(proyecto ? { montoAcordado: proyecto.montoAcordado?.toString() ?? null, modoIva: proyecto.modoIva } : null, {
      total: c.importeTotal.toString(),
      iva: c.importeIva.toString(),
      tributos: c.importeTributos.toString(),
    });
    return { proyectoId: proyecto?.id ?? null, importe: r.importe, observaciones: r.detalle };
  }

  private async registrarComprobantes(tx: Prisma.TransactionClient, tenantId: string, comprobantes: ComprobanteParaCuentaCorriente[]) {
    // Primero facturas y notas de débito: las notas de crédito se imputan a ellas.
    const ordenados = [...comprobantes.filter((c) => !NOTAS_CREDITO.includes(c.tipo)), ...comprobantes.filter((c) => NOTAS_CREDITO.includes(c.tipo))];
    const proyectos = new Set<string>();
    for (const c of ordenados) {
      // Otro pedido pudo registrarlo mientras se esperaba el lock.
      const ya = await tx.movimientoCuentaCorriente.findUnique({ where: { tenantId_comprobanteId: { tenantId, comprobanteId: c.id } }, select: { id: true } });
      if (ya) continue;
      const esNc = NOTAS_CREDITO.includes(c.tipo);
      const vencimiento = esNc
        ? null
        : (c.fechaVtoPago ?? (c.cliente.diasVencimiento != null ? sumarDias(c.fechaEmision, c.cliente.diasVencimiento) : null));
      const impacto = await this.impactoDeComprobante(tx, tenantId, c);
      const mov = await tx.movimientoCuentaCorriente.create({
        data: {
          tenantId,
          clienteId: c.clienteId,
          tipo: esNc ? 'HABER' : 'DEBE',
          origen: 'COMPROBANTE',
          comprobanteId: c.id,
          proyectoId: impacto.proyectoId,
          concepto: TIPO_TEXTO[c.tipo],
          numero: numeroComprobante(c.puntoVenta.numero, c.numero!),
          moneda: c.moneda,
          importe: impacto.importe.toFixed(2),
          fecha: c.fechaEmision,
          fechaVencimiento: vencimiento,
          observaciones: impacto.observaciones,
        },
      });
      if (impacto.proyectoId) proyectos.add(impacto.proyectoId);
      if (esNc && c.asociadoId) await this.imputarNotaASuFactura(tx, tenantId, mov, c.asociadoId);
    }
    for (const id of proyectos) await this.imputarProyecto(tx, tenantId, id);
  }

  /** Nota de crédito: se imputa a su factura por lo que le falte cobrar; lo que sobra queda a favor del cliente. */
  private async imputarNotaASuFactura(
    tx: Prisma.TransactionClient,
    tenantId: string,
    nc: { id: string; moneda: Moneda; clienteId: string; importe: Prisma.Decimal | Decimal | string },
    facturaId: string,
  ) {
    const factura = await tx.movimientoCuentaCorriente.findUnique({ where: { tenantId_comprobanteId: { tenantId, comprobanteId: facturaId } } });
    if (!factura || factura.moneda !== nc.moneda || factura.clienteId !== nc.clienteId) return;
    const importe = importeAImputar(await this.pendienteDebe(tx, tenantId, factura.id), await this.disponibleHaber(tx, tenantId, nc.id));
    if (importe.gt(0)) {
      await tx.imputacionCuentaCorriente.create({
        data: { tenantId, haberId: nc.id, debeId: factura.id, importe: importe.toFixed(2), automatica: true },
      });
    }
  }

  private async registrarRecibos(tx: Prisma.TransactionClient, tenantId: string, recibos: ReciboParaCuentaCorriente[]) {
    for (const r of recibos) {
      if (!r.clienteId) continue;
      const ya = await tx.movimientoCuentaCorriente.findUnique({ where: { tenantId_reciboId: { tenantId, reciboId: r.id } }, select: { id: true } });
      if (ya) continue;
      // Pago en otra moneda que el proyecto: la cuenta lo registra en la moneda de la deuda y guarda lo que entró.
      const convertido = r.monedaImputacion && r.importeImputacion && r.monedaImputacion !== r.moneda;
      const mov = await tx.movimientoCuentaCorriente.create({
        data: {
          tenantId,
          clienteId: r.clienteId,
          tipo: 'HABER',
          origen: 'RECIBO',
          reciboId: r.id,
          proyectoId: r.proyectoId,
          concepto: 'Recibo de cobro',
          numero: r.numero,
          moneda: convertido ? r.monedaImputacion! : r.moneda,
          importe: convertido ? r.importeImputacion! : r.total,
          monedaOrigen: convertido ? r.moneda : null,
          importeOrigen: convertido ? r.total : null,
          tipoCambio: convertido ? r.tipoCambio : null,
          fecha: r.fecha,
          observaciones: r.medioPago,
        },
      });
      if (r.proyectoId) await this.imputarProyecto(tx, tenantId, r.proyectoId);
      else await this.imputarReciboASusFacturas(tx, tenantId, mov, r.comprobantesAplicados);
    }
  }

  /**
   * Recibo anulado: su cobro deja de cancelar deudas (se deshacen sus imputaciones) y se compensa con
   * un DEBE de anulación imputado a él. El saldo vuelve a quedar como antes del cobro y queda el rastro.
   */
  private async registrarAnulaciones(tx: Prisma.TransactionClient, tenantId: string, anulados: Set<string>) {
    if (anulados.size === 0) return;
    const pendientes = await tx.movimientoCuentaCorriente.findMany({
      where: { tenantId, origen: 'RECIBO', reciboId: { in: [...anulados] }, anuladoPor: { none: {} } },
    });
    for (const h of pendientes) {
      await tx.imputacionCuentaCorriente.deleteMany({ where: { tenantId, haberId: h.id } });
      const debe = await tx.movimientoCuentaCorriente.create({
        data: {
          tenantId,
          clienteId: h.clienteId,
          tipo: 'DEBE',
          origen: 'ANULACION',
          anulaId: h.id,
          proyectoId: h.proyectoId,
          concepto: 'Anulación de recibo',
          numero: h.numero,
          moneda: h.moneda,
          importe: h.importe,
          fecha: hoyAr(),
        },
      });
      await tx.imputacionCuentaCorriente.create({ data: { tenantId, haberId: h.id, debeId: debe.id, importe: h.importe, automatica: true } });
      if (h.proyectoId) await this.imputarProyecto(tx, tenantId, h.proyectoId);
    }
  }

  /**
   * Un recibo de cobro que dice qué facturas cancela (con su id): se imputa a cada una, en el orden
   * del recibo, hasta el importe aplicado y lo que le falte cobrar. Lo que sobra queda a cuenta.
   */
  private async imputarReciboASusFacturas(
    tx: Prisma.TransactionClient,
    tenantId: string,
    haber: { id: string; clienteId: string; moneda: Moneda; importe: Prisma.Decimal },
    aplicados: Prisma.JsonValue,
  ) {
    if (!Array.isArray(aplicados)) return;
    const pedidos = aplicados
      .map((a) => a as { comprobanteId?: unknown; importe?: unknown })
      .filter((a): a is { comprobanteId: string; importe: string } => typeof a?.comprobanteId === 'string' && typeof a.importe === 'string');
    if (pedidos.length === 0) return;
    // Un cobro sin proyecto solo cancela deudas sin proyecto.
    const debes = await tx.movimientoCuentaCorriente.findMany({
      where: { tenantId, tipo: 'DEBE', clienteId: haber.clienteId, moneda: haber.moneda, proyectoId: null, comprobanteId: { in: pedidos.map((p) => p.comprobanteId) } },
      select: { id: true, comprobanteId: true },
    });
    const porComprobante = new Map(debes.map((d) => [d.comprobanteId, d.id]));
    const candidatos: Array<{ id: string; pendiente: Decimal; tope: string }> = [];
    for (const p of pedidos) {
      const debeId = porComprobante.get(p.comprobanteId);
      if (!debeId) continue;
      candidatos.push({ id: debeId, pendiente: await this.pendienteDebe(tx, tenantId, debeId), tope: p.importe });
    }
    for (const r of repartirHaber(haber.importe.toString(), candidatos)) {
      await tx.imputacionCuentaCorriente.create({
        data: { tenantId, haberId: haber.id, debeId: r.id, importe: r.importe.toFixed(2), automatica: true },
      });
    }
  }

  // ───────────────────────────── Proyectos ─────────────────────────────

  /**
   * Las deudas de un proyecto con lo imputado y, en los hitos por certificación, lo certificado.
   * Lo usan la imputación automática y los saldos.
   */
  async debesDeProyecto(tx: Prisma.TransactionClient, tenantId: string, proyectoId: string): Promise<Array<DebeProyecto & { origen: string; concepto: string }>> {
    const filas = await tx.movimientoCuentaCorriente.findMany({
      where: { tenantId, proyectoId, tipo: 'DEBE' },
      select: {
        id: true,
        origen: true,
        concepto: true,
        importe: true,
        orden: true,
        porCertificacion: true,
        fecha: true,
        fechaVencimiento: true,
        createdAt: true,
        imputacionesComoDebe: { select: { importe: true } },
        certificaciones: { select: { importe: true } },
      },
    });
    return filas.map((f) => ({
      id: f.id,
      origen: f.origen,
      concepto: f.concepto,
      importe: f.importe.toString(),
      imputado: f.imputacionesComoDebe.reduce((acc, i) => acc.plus(i.importe.toString()), new Decimal(0)),
      porCertificacion: f.porCertificacion,
      certificado: f.certificaciones.reduce((acc, c) => acc.plus(c.importe.toString()), new Decimal(0)),
      orden: f.orden,
      fecha: f.fecha,
      fechaVencimiento: f.fechaVencimiento,
      createdAt: f.createdAt,
    }));
  }

  /**
   * Aplica lo que quede sin imputar de los pagos del proyecto (del más viejo al más nuevo) a sus deudas
   * exigibles: hitos por orden, después el resto por vencimiento (domain/proyecto.ts). Nunca toca lo
   * ya imputado. Se llama después de cada cambio del proyecto: un hito o una certificación nuevos
   * absorben lo que el cliente tenía a cuenta.
   */
  async imputarProyecto(tx: Prisma.TransactionClient, tenantId: string, proyectoId: string): Promise<void> {
    const habers = await tx.movimientoCuentaCorriente.findMany({
      where: { tenantId, proyectoId, tipo: 'HABER' },
      select: { id: true, importe: true, imputacionesComoHaber: { select: { importe: true } } },
      orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    const conDisponible = habers
      .map((h) => ({ id: h.id, disponible: pendienteDe(h.importe.toString(), h.imputacionesComoHaber.map((i) => i.importe.toString())) }))
      .filter((h) => h.disponible.gt(0));
    if (conDisponible.length === 0) return;
    const debes = await this.debesDeProyecto(tx, tenantId, proyectoId);
    for (const h of conDisponible) {
      for (const r of repartirEnProyecto(h.disponible, debes)) {
        const existente = await tx.imputacionCuentaCorriente.findUnique({ where: { tenantId_haberId_debeId: { tenantId, haberId: h.id, debeId: r.id } } });
        if (existente) {
          await tx.imputacionCuentaCorriente.update({ where: { id: existente.id }, data: { importe: new Decimal(existente.importe.toString()).plus(r.importe).toFixed(2) } });
        } else {
          await tx.imputacionCuentaCorriente.create({ data: { tenantId, haberId: h.id, debeId: r.id, importe: r.importe.toFixed(2), automatica: true } });
        }
        const d = debes.find((x) => x.id === r.id)!;
        d.imputado = new Decimal(d.imputado).plus(r.importe);
      }
    }
  }

  /**
   * Recalcula los movimientos de las facturas y notas de un proyecto (al cambiar el modo de IVA o el
   * monto acordado): deshace todas sus imputaciones, corrige los importes y vuelve a imputar.
   */
  async recalcularComprobantesDeProyecto(tx: Prisma.TransactionClient, tenantId: string, proyectoId: string): Promise<void> {
    const movs = await tx.movimientoCuentaCorriente.findMany({
      where: { tenantId, proyectoId, origen: 'COMPROBANTE' },
      select: { id: true, comprobanteId: true, tipo: true },
    });
    if (movs.length === 0) return;
    const ids = movs.map((m) => m.id);
    await tx.imputacionCuentaCorriente.deleteMany({ where: { tenantId, OR: [{ debeId: { in: ids } }, { haberId: { in: ids } }] } });
    const comprobantes = await this.comprobantes.paraCuentaCorriente(tenantId, movs.map((m) => m.comprobanteId!).filter(Boolean));
    for (const c of comprobantes) {
      const impacto = await this.impactoDeComprobante(tx, tenantId, c);
      await tx.movimientoCuentaCorriente.update({
        where: { tenantId_comprobanteId: { tenantId, comprobanteId: c.id } },
        data: { importe: impacto.importe.toFixed(2), observaciones: impacto.observaciones },
      });
    }
    for (const c of comprobantes.filter((x) => NOTAS_CREDITO.includes(x.tipo) && x.asociadoId)) {
      const nc = await tx.movimientoCuentaCorriente.findUniqueOrThrow({ where: { tenantId_comprobanteId: { tenantId, comprobanteId: c.id } } });
      await this.imputarNotaASuFactura(tx, tenantId, nc, c.asociadoId!);
    }
    await this.imputarProyecto(tx, tenantId, proyectoId);
  }

  /** Tipo de cambio para un pago: el editado, el fijo del proyecto o la cotización de ARCA del día. */
  tipoCambioPara(tenantId: string, editado: string | null | undefined, fijoProyecto: Prisma.Decimal | null | undefined) {
    return elegirTipoCambio(editado, fijoProyecto?.toString() ?? null, () => this.cotizacion.cotizacionDolar(tenantId));
  }

  /** Lo que cancela en la moneda de destino un pago hecho en otra moneda. */
  convertirPago(importe: string, origen: Moneda, destino: Moneda, tipoCambio: Decimal.Value | null) {
    return convertir(importe, origen, destino, tipoCambio);
  }

  /** Bloqueo de la empresa para que ProyectosService encadene escrituras con la misma serialización. */
  bloquearEmpresa(tx: Prisma.TransactionClient, tenantId: string) {
    return this.bloquear(tx, tenantId);
  }

  /** Serializa sincronización e imputaciones de una misma empresa (se libera al terminar la transacción). */
  private async bloquear(tx: Prisma.TransactionClient, tenantId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cuenta-corriente:${tenantId}`}))`;
  }

  /** Lo que se le puede imputar a un DEBE: lo pendiente, y en un hito por certificación solo lo certificado. */
  private async pendienteDebe(tx: Prisma.TransactionClient, tenantId: string, debeId: string): Promise<Decimal> {
    const [mov, suma, certificado] = await Promise.all([
      tx.movimientoCuentaCorriente.findUniqueOrThrow({ where: { tenantId_id: { tenantId, id: debeId } }, select: { importe: true, porCertificacion: true } }),
      tx.imputacionCuentaCorriente.aggregate({ where: { tenantId, debeId }, _sum: { importe: true } }),
      tx.certificacionHito.aggregate({ where: { tenantId, hitoId: debeId }, _sum: { importe: true } }),
    ]);
    return pendientesDe({
      importe: mov.importe.toString(),
      imputado: suma._sum.importe?.toString() ?? '0',
      porCertificacion: mov.porCertificacion,
      certificado: certificado._sum.importe?.toString() ?? '0',
    }).exigible;
  }

  private async disponibleHaber(tx: Prisma.TransactionClient, tenantId: string, haberId: string): Promise<Decimal> {
    const [mov, suma] = await Promise.all([
      tx.movimientoCuentaCorriente.findUniqueOrThrow({ where: { tenantId_id: { tenantId, id: haberId } }, select: { importe: true } }),
      tx.imputacionCuentaCorriente.aggregate({ where: { tenantId, haberId }, _sum: { importe: true } }),
    ]);
    return pendienteDe(mov.importe.toString(), [suma._sum.importe?.toString() ?? '0']);
  }

  // ───────────────────────────── Lectura ─────────────────────────────

  /**
   * Lo exigible pendiente de cobro, de todas las cuentas: cada DEBE con lo que le falta y, en los
   * hitos por certificación, cada certificación con lo que le falta (lo no certificado no vence ni
   * se avisa). `nombres`: razón social por id de cliente.
   */
  async debesAbiertos(tenantId: string, nombres: Map<string, string>, clienteId?: string): Promise<DebeAbierto[]> {
    const filas = await this.prisma.movimientoCuentaCorriente.findMany({
      where: { tenantId, tipo: 'DEBE', ...(clienteId ? { clienteId } : {}) },
      select: {
        id: true,
        clienteId: true,
        proyectoId: true,
        proyecto: { select: { nombre: true } },
        concepto: true,
        numero: true,
        moneda: true,
        importe: true,
        porCertificacion: true,
        fecha: true,
        fechaVencimiento: true,
        imputacionesComoDebe: { select: { importe: true } },
        certificaciones: { select: { id: true, descripcion: true, importe: true, fecha: true, fechaVencimiento: true } },
      },
    });
    const abiertos: DebeAbierto[] = [];
    for (const f of filas) {
      const imputado = f.imputacionesComoDebe.reduce((acc, i) => acc.plus(i.importe.toString()), new Decimal(0));
      const base = {
        clienteId: f.clienteId,
        razonSocial: nombres.get(f.clienteId) ?? '—',
        proyectoId: f.proyectoId,
        proyecto: f.proyecto?.nombre ?? null,
        numero: f.numero,
        moneda: f.moneda,
        fecha: f.fecha,
      };
      if (!f.porCertificacion) {
        const pendiente = pendienteDe(f.importe.toString(), [imputado]);
        if (pendiente.gt(0)) {
          abiertos.push({ ...base, id: f.id, certificacionId: null, concepto: f.concepto, importe: new Decimal(f.importe.toString()), pendiente, fechaVencimiento: f.fechaVencimiento });
        }
        continue;
      }
      const pendientes = new Map(
        pendientePorCertificacion(
          imputado,
          f.certificaciones.map((c) => ({ id: c.id, importe: c.importe.toString(), fecha: c.fecha, fechaVencimiento: c.fechaVencimiento })),
        ).map((x) => [x.id, x.pendiente]),
      );
      for (const c of f.certificaciones) {
        const pendiente = pendientes.get(c.id) ?? new Decimal(0);
        if (pendiente.lte(0)) continue;
        abiertos.push({
          ...base,
          id: f.id,
          certificacionId: c.id,
          concepto: `${f.concepto}: ${c.descripcion}`,
          importe: new Decimal(c.importe.toString()),
          pendiente,
          fecha: c.fecha,
          fechaVencimiento: c.fechaVencimiento,
        });
      }
    }
    return abiertos;
  }

  /** Lo que falta certificar por cliente y moneda (suma al saldo total, no al exigible). */
  private async aCertificarPorCliente(tenantId: string): Promise<Map<string, Map<string, Decimal>>> {
    const hitos = await this.prisma.movimientoCuentaCorriente.findMany({
      where: { tenantId, tipo: 'DEBE', porCertificacion: true },
      select: { clienteId: true, moneda: true, importe: true, certificaciones: { select: { importe: true } } },
    });
    const r = new Map<string, Map<string, Decimal>>();
    for (const h of hitos) {
      const falta = pendientesDe({
        importe: h.importe.toString(),
        imputado: 0,
        porCertificacion: true,
        certificado: h.certificaciones.reduce((acc, c) => acc.plus(c.importe.toString()), new Decimal(0)),
      }).aCertificar;
      if (falta.lte(0)) continue;
      const porMoneda = r.get(h.clienteId) ?? new Map<string, Decimal>();
      porMoneda.set(h.moneda, (porMoneda.get(h.moneda) ?? new Decimal(0)).plus(falta));
      r.set(h.clienteId, porMoneda);
    }
    return r;
  }

  /** Saldo por moneda de cada cliente: DEBE − HABER. */
  private async saldosPorCliente(tenantId: string): Promise<Map<string, Array<{ moneda: string; saldo: Decimal }>>> {
    const grupos = await this.prisma.movimientoCuentaCorriente.groupBy({
      by: ['clienteId', 'moneda', 'tipo'],
      where: { tenantId },
      _sum: { importe: true },
    });
    const porCliente = new Map<string, Array<{ tipo: 'DEBE' | 'HABER'; moneda: string; importe: string }>>();
    for (const g of grupos) {
      const lista = porCliente.get(g.clienteId) ?? [];
      lista.push({ tipo: g.tipo, moneda: g.moneda, importe: g._sum.importe?.toString() ?? '0' });
      porCliente.set(g.clienteId, lista);
    }
    return new Map([...porCliente.entries()].map(([id, movs]) => [id, saldosPorMoneda(movs)]));
  }

  /**
   * Tablero: total por cobrar (suma de los saldos de las cuentas, por moneda: un cobro a cuenta
   * resta), lo vencido y lo que vence en los próximos `diasProximos` días.
   */
  async resumen(tenantId: string, diasProximos = 15) {
    await this.sincronizar(tenantId);
    const clientes = await this.clientes.todosParaCuentas(tenantId);
    const [saldos, abiertos] = await Promise.all([
      this.saldosPorCliente(tenantId),
      this.debesAbiertos(tenantId, new Map(clientes.map((c) => [c.id, c.razonSocial]))),
    ]);
    const hoy = hoyAr();
    const limite = sumarDias(hoy, diasProximos);

    const porCobrar = new Map<string, Decimal>();
    for (const lista of saldos.values()) {
      for (const s of lista) porCobrar.set(s.moneda, (porCobrar.get(s.moneda) ?? new Decimal(0)).plus(s.saldo));
    }
    // Lo que falta certificar está en el total por cobrar, pero todavía no se puede cobrar.
    const aCertificar = new Map<string, Decimal>();
    for (const porMoneda of (await this.aCertificarPorCliente(tenantId)).values()) {
      for (const [moneda, v] of porMoneda) aCertificar.set(moneda, (aCertificar.get(moneda) ?? new Decimal(0)).plus(v));
    }
    const sumarPorMoneda = (items: DebeAbierto[]) => {
      const m = new Map<string, Decimal>();
      for (const i of items) m.set(i.moneda, (m.get(i.moneda) ?? new Decimal(0)).plus(i.pendiente));
      return [...m.entries()].sort(([a], [b]) => ordenMoneda(a, b)).map(([moneda, total]) => ({ moneda, total: dinero(total) }));
    };
    const item = (d: DebeAbierto) => ({
      id: d.id,
      clienteId: d.clienteId,
      razonSocial: d.razonSocial,
      proyectoId: d.proyectoId,
      proyecto: d.proyecto,
      certificacionId: d.certificacionId,
      concepto: d.concepto,
      numero: d.numero,
      moneda: d.moneda,
      importe: dinero(d.importe),
      pendiente: dinero(d.pendiente),
      fecha: aYmd(d.fecha),
      fechaVencimiento: aYmd(d.fechaVencimiento),
    });
    const porVencimiento = (a: DebeAbierto, b: DebeAbierto) => a.fechaVencimiento!.getTime() - b.fechaVencimiento!.getTime();
    const vencidos = abiertos.filter((d) => d.fechaVencimiento && d.fechaVencimiento < hoy).sort(porVencimiento);
    const proximos = abiertos.filter((d) => d.fechaVencimiento && d.fechaVencimiento >= hoy && d.fechaVencimiento <= limite).sort(porVencimiento);

    return {
      diasProximos,
      porCobrar: [...porCobrar.entries()].sort(([a], [b]) => ordenMoneda(a, b)).map(([moneda, total]) => ({ moneda, total: dinero(total) })),
      aCertificar: [...aCertificar.entries()].sort(([a], [b]) => ordenMoneda(a, b)).map(([moneda, total]) => ({ moneda, total: dinero(total) })),
      vencido: sumarPorMoneda(vencidos),
      proximo: sumarPorMoneda(proximos),
      vencidos: vencidos.map(item),
      proximos: proximos.map(item),
    };
  }

  /**
   * Listado de cuentas: cada cliente activo (y los inactivos con movimientos) con su saldo por moneda,
   * cuántos comprobantes tiene sin cobrar y el vencimiento más viejo de esos.
   */
  async cuentas(tenantId: string) {
    await this.sincronizar(tenantId);
    const clientes = await this.clientes.todosParaCuentas(tenantId);
    const [saldos, abiertos, aCertificar] = await Promise.all([
      this.saldosPorCliente(tenantId),
      this.debesAbiertos(tenantId, new Map(clientes.map((c) => [c.id, c.razonSocial]))),
      this.aCertificarPorCliente(tenantId),
    ]);
    const hoy = hoyAr();
    const abiertosPorCliente = new Map<string, DebeAbierto[]>();
    for (const d of abiertos) abiertosPorCliente.set(d.clienteId, [...(abiertosPorCliente.get(d.clienteId) ?? []), d]);

    return clientes
      .filter((c) => c.activo || saldos.has(c.id))
      .map((c) => {
        const propios = abiertosPorCliente.get(c.id) ?? [];
        const vencimientos = propios.map((d) => d.fechaVencimiento).filter((f): f is Date => f !== null);
        const proximo = vencimientos.length ? new Date(Math.min(...vencimientos.map((f) => f.getTime()))) : null;
        return {
          clienteId: c.id,
          razonSocial: c.razonSocial,
          tipoDocumento: c.tipoDocumento,
          numeroDocumento: c.numeroDocumento,
          activo: c.activo,
          tieneMovimientos: saldos.has(c.id),
          saldos: (saldos.get(c.id) ?? []).map((s) => ({
            moneda: s.moneda,
            saldo: dinero(s.saldo),
            // Sin lo que falta certificar de sus proyectos.
            exigible: dinero(s.saldo.minus(aCertificar.get(c.id)?.get(s.moneda) ?? 0)),
          })),
          comprobantesPendientes: propios.length,
          proximoVencimiento: aYmd(proximo),
          vencido: proximo !== null && proximo < hoy,
        };
      });
  }

  /** La cuenta de un cliente: saldo por moneda y todos sus movimientos (el más nuevo primero), con lo pendiente y el saldo acumulado. */
  async cuenta(tenantId: string, clienteId: string) {
    const c = await this.clientes.obtener(tenantId, clienteId); // 404 si no es de esta empresa
    const cliente = {
      id: c.id,
      razonSocial: c.razonSocial,
      tipoDocumento: c.tipoDocumento,
      numeroDocumento: c.numeroDocumento,
      condicionIva: c.condicionIva,
      activo: c.activo,
      diasVencimiento: c.diasVencimiento,
      monedaPreferida: c.monedaPreferida,
    };
    await this.sincronizar(tenantId);

    const contraparte = { select: { id: true, concepto: true, numero: true, fecha: true, comprobanteId: true, reciboId: true } };
    const movimientos = await this.prisma.movimientoCuentaCorriente.findMany({
      where: { tenantId, clienteId },
      include: {
        proyecto: { select: { id: true, nombre: true } },
        certificaciones: { select: { importe: true } },
        imputacionesComoDebe: { select: { id: true, importe: true, automatica: true, haber: contraparte }, orderBy: { createdAt: 'asc' } },
        imputacionesComoHaber: { select: { id: true, importe: true, automatica: true, debe: contraparte }, orderBy: { createdAt: 'asc' } },
      },
      // Orden del estado de cuenta: por fecha; a igual fecha, primero lo que se cargó antes.
      orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    const acumulados = saldosAcumulados(movimientos.map((m) => ({ id: m.id, tipo: m.tipo, moneda: m.moneda, importe: m.importe.toString() })));
    const hoy = hoyAr();

    const filas = movimientos.map((m) => {
      const imputaciones =
        m.tipo === 'DEBE'
          ? m.imputacionesComoDebe.map((i) => ({ id: i.id, importe: dinero(i.importe.toString()), automatica: i.automatica, movimiento: i.haber }))
          : m.imputacionesComoHaber.map((i) => ({ id: i.id, importe: dinero(i.importe.toString()), automatica: i.automatica, movimiento: i.debe }));
      const certificado = m.certificaciones.reduce((acc, c) => acc.plus(c.importe.toString()), new Decimal(0));
      const pendientes = pendientesDe({
        importe: m.importe.toString(),
        imputado: imputaciones.reduce((acc, i) => acc.plus(i.importe), new Decimal(0)),
        porCertificacion: m.porCertificacion,
        certificado,
      });
      const pendiente = pendientes.total;
      return {
        id: m.id,
        tipo: m.tipo,
        origen: m.origen,
        concepto: m.concepto,
        numero: m.numero,
        comprobanteId: m.comprobanteId,
        reciboId: m.reciboId,
        moneda: m.moneda,
        importe: dinero(m.importe.toString()),
        fecha: aYmd(m.fecha),
        fechaVencimiento: aYmd(m.fechaVencimiento),
        vencido: m.tipo === 'DEBE' && pendientes.exigible.gt(0) && m.fechaVencimiento !== null && m.fechaVencimiento < hoy,
        observaciones: m.observaciones,
        proyecto: m.proyecto,
        porCertificacion: m.porCertificacion,
        certificado: m.porCertificacion ? dinero(certificado) : null,
        aCertificar: m.porCertificacion ? dinero(pendientes.aCertificar) : null,
        monedaOrigen: m.monedaOrigen,
        importeOrigen: m.importeOrigen ? dinero(m.importeOrigen.toString()) : null,
        tipoCambio: m.tipoCambio?.toString() ?? null,
        anulado: m.origen === 'RECIBO' && movimientos.some((x) => x.anulaId === m.id),
        pendiente: dinero(pendiente),
        estado: estadoDe(m.importe.toString(), pendiente),
        saldo: dinero(acumulados.get(m.id) ?? 0),
        imputaciones: imputaciones.map((i) => ({
          ...i,
          movimiento: { ...i.movimiento, fecha: aYmd(i.movimiento.fecha) },
        })),
        createdAt: m.createdAt,
      };
    });

    const aCertificar = (await this.aCertificarPorCliente(tenantId)).get(clienteId);
    return {
      cliente,
      saldos: saldosPorMoneda(movimientos.map((m) => ({ tipo: m.tipo, moneda: m.moneda, importe: m.importe.toString() }))).map((s) => ({
        moneda: s.moneda,
        saldo: dinero(s.saldo),
        exigible: dinero(s.saldo.minus(aCertificar?.get(s.moneda) ?? 0)),
      })),
      movimientos: filas.reverse(),
    };
  }

  // ───────────────────────────── Escritura ─────────────────────────────

  private async obtenerMovimiento(tenantId: string, id: string) {
    const mov = await this.prisma.movimientoCuentaCorriente.findUnique({ where: { tenantId_id: { tenantId, id } } });
    if (!mov) throw new NotFoundException('Movimiento no encontrado.');
    return mov;
  }

  private validarImporte(importe: string) {
    if (!new Decimal(importe).gt(0)) throw new BadRequestException('El importe tiene que ser mayor a 0.');
  }

  private validarVencimiento(fecha: string, vencimiento: string | null | undefined) {
    if (vencimiento && vencimiento < fecha) throw new BadRequestException('El vencimiento no puede ser anterior a la fecha.');
  }

  /**
   * Movimiento cargado a mano. Un HABER (cobro sin recibo, ajuste a favor) se puede imputar en el
   * mismo paso a facturas de la cuenta: del más viejo al más nuevo, cada una hasta lo que le falte.
   */
  async crearMovimiento(auth: AuthContext, dto: CrearMovimientoDto) {
    const tenantId = auth.tenantId;
    this.validarImporte(dto.importe);
    if (!(await this.clientes.existentes(tenantId, [dto.clienteId])).has(dto.clienteId)) throw new BadRequestException('El cliente no existe.');
    const esDebe = dto.tipo === 'DEBE';
    if (esDebe && dto.imputarA?.length) throw new BadRequestException('Solo un cobro o un crédito se imputa a facturas.');
    if (esDebe) this.validarVencimiento(dto.fecha, dto.fechaVencimiento);

    // Con proyecto: es del cliente y se registra en su moneda (un pago en otra moneda se convierte).
    const proyecto = dto.proyectoId
      ? await this.prisma.proyecto.findUnique({ where: { tenantId_id: { tenantId, id: dto.proyectoId } } })
      : null;
    if (dto.proyectoId && (!proyecto || proyecto.clienteId !== dto.clienteId)) throw new BadRequestException('El proyecto no es de este cliente.');
    if (proyecto && dto.imputarA?.length) throw new BadRequestException('Un pago de un proyecto se imputa solo, a las deudas de ese proyecto.');
    let moneda = dto.moneda;
    let importe = new Decimal(dto.importe);
    let conversion: { monedaOrigen: Moneda; importeOrigen: string; tipoCambio: string } | null = null;
    if (proyecto && proyecto.moneda !== dto.moneda) {
      if (esDebe) throw new BadRequestException(`Los cargos de este proyecto van en su moneda (${proyecto.moneda}).`);
      const tc = await this.tipoCambioPara(tenantId, dto.tipoCambio, proyecto.tipoCambioFijo);
      importe = convertir(dto.importe, dto.moneda, proyecto.moneda, tc.valor);
      conversion = { monedaOrigen: dto.moneda, importeOrigen: dto.importe, tipoCambio: tc.valor.toString() };
      moneda = proyecto.moneda;
    }

    return this.prisma.$transaction(async (tx) => {
      await this.bloquear(tx, tenantId);
      const mov = await tx.movimientoCuentaCorriente.create({
        data: {
          tenantId,
          clienteId: dto.clienteId,
          tipo: dto.tipo,
          origen: 'MANUAL',
          proyectoId: proyecto?.id ?? null,
          concepto: dto.concepto,
          numero: dto.numero || null,
          moneda,
          importe: importe.toFixed(2),
          ...(conversion ?? {}),
          fecha: deYmd(dto.fecha),
          fechaVencimiento: esDebe && dto.fechaVencimiento ? deYmd(dto.fechaVencimiento) : null,
          observaciones: dto.observaciones || null,
          creadoPorId: auth.usuarioId ?? null,
        },
      });
      if (proyecto) {
        await this.imputarProyecto(tx, tenantId, proyecto.id);
        return { id: mov.id };
      }
      const ids = [...new Set(dto.imputarA ?? [])];
      if (ids.length) {
        const debes = await tx.movimientoCuentaCorriente.findMany({
          where: { tenantId, id: { in: ids }, tipo: 'DEBE', clienteId: dto.clienteId },
          orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }],
        });
        if (debes.length !== ids.length) throw new BadRequestException('Uno de los comprobantes elegidos no es de esta cuenta.');
        if (debes.some((d) => d.moneda !== dto.moneda)) throw new BadRequestException('Los comprobantes elegidos tienen que estar en la moneda del cobro.');
        if (debes.some((d) => d.proyectoId)) throw new BadRequestException('Un cobro sin proyecto no cancela deudas de un proyecto.');
        const candidatos = await Promise.all(debes.map(async (d) => ({ id: d.id, pendiente: await this.pendienteDebe(tx, tenantId, d.id) })));
        for (const r of repartirHaber(dto.importe, candidatos)) {
          await tx.imputacionCuentaCorriente.create({
            data: { tenantId, haberId: mov.id, debeId: r.id, importe: r.importe.toFixed(2), creadoPorId: auth.usuarioId ?? null },
          });
        }
      }
      return { id: mov.id };
    }, TX);
  }

  /**
   * Edita un movimiento. Los manuales, todo (el importe no puede quedar por debajo de lo ya imputado:
   * primero hay que deshacer imputaciones). Los de comprobantes y recibos, solo el vencimiento.
   */
  async actualizarMovimiento(tenantId: string, id: string, dto: ActualizarMovimientoDto) {
    const mov = await this.obtenerMovimiento(tenantId, id);
    const otrosCampos = (['concepto', 'numero', 'fecha', 'importe', 'observaciones'] as const).filter((k) => dto[k] !== undefined);
    if (mov.origen !== 'MANUAL' && otrosCampos.length) {
      throw new BadRequestException('Este movimiento sale de un comprobante: solo se puede cambiar el vencimiento.');
    }
    if (mov.tipo === 'HABER' && dto.fechaVencimiento) throw new BadRequestException('Un cobro o crédito no tiene vencimiento.');
    const fecha = dto.fecha ?? aYmd(mov.fecha)!;
    const vencimiento = dto.fechaVencimiento !== undefined ? dto.fechaVencimiento : aYmd(mov.fechaVencimiento);
    this.validarVencimiento(fecha, vencimiento);

    return this.prisma.$transaction(async (tx) => {
      await this.bloquear(tx, tenantId);
      if (dto.importe !== undefined) {
        this.validarImporte(dto.importe);
        const campo = mov.tipo === 'DEBE' ? 'debeId' : 'haberId';
        const suma = await tx.imputacionCuentaCorriente.aggregate({ where: { tenantId, [campo]: id }, _sum: { importe: true } });
        if (new Decimal(suma._sum.importe?.toString() ?? '0').gt(dto.importe)) {
          throw new BadRequestException('Tiene imputado más que ese importe: primero deshacé alguna imputación.');
        }
      }
      await tx.movimientoCuentaCorriente.update({
        where: { tenantId_id: { tenantId, id } },
        data: {
          concepto: dto.concepto,
          numero: dto.numero === undefined ? undefined : dto.numero || null,
          fecha: dto.fecha ? deYmd(dto.fecha) : undefined,
          fechaVencimiento: dto.fechaVencimiento === undefined ? undefined : dto.fechaVencimiento ? deYmd(dto.fechaVencimiento) : null,
          importe: dto.importe,
          observaciones: dto.observaciones === undefined ? undefined : dto.observaciones || null,
        },
      });
      return { id };
    }, TX);
  }

  /** Solo los cargados a mano. Sus imputaciones se borran con él (lo cobrado vuelve a quedar pendiente). */
  async eliminarMovimiento(tenantId: string, id: string) {
    const mov = await this.obtenerMovimiento(tenantId, id);
    if (mov.origen !== 'MANUAL') {
      throw new BadRequestException('Los movimientos de comprobantes y recibos no se eliminan: para anular una factura, emití una nota de crédito.');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.bloquear(tx, tenantId);
      await tx.movimientoCuentaCorriente.delete({ where: { tenantId_id: { tenantId, id } } });
      // Lo que cubría (o lo cubría a él) se vuelve a repartir dentro del proyecto.
      if (mov.proyectoId) await this.imputarProyecto(tx, tenantId, mov.proyectoId);
    }, TX);
    return { id };
  }

  /** Aplica un HABER (cobro, NC) a un DEBE (factura) de la misma cuenta y moneda. Si ya había una imputación entre los dos, la agranda. */
  async crearImputacion(auth: AuthContext, dto: CrearImputacionDto) {
    const tenantId = auth.tenantId;
    if (dto.importe !== undefined) this.validarImporte(dto.importe);
    const [haber, debe] = await Promise.all([this.obtenerMovimiento(tenantId, dto.haberId), this.obtenerMovimiento(tenantId, dto.debeId)]);
    if (haber.tipo !== 'HABER') throw new BadRequestException('Lo que se imputa tiene que ser un cobro o un crédito.');
    if (debe.tipo !== 'DEBE') throw new BadRequestException('Solo se imputa a una factura, nota de débito o cargo.');
    if (haber.clienteId !== debe.clienteId) throw new BadRequestException('Los dos movimientos tienen que ser del mismo cliente.');
    if (haber.moneda !== debe.moneda) throw new BadRequestException('Los dos movimientos tienen que estar en la misma moneda.');
    if (haber.proyectoId !== debe.proyectoId) {
      throw new BadRequestException(haber.proyectoId ? 'Un pago de un proyecto solo se imputa a deudas de ese proyecto.' : 'Un cobro sin proyecto solo se imputa a deudas sin proyecto.');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.bloquear(tx, tenantId);
      const [pendiente, disponible] = await Promise.all([this.pendienteDebe(tx, tenantId, debe.id), this.disponibleHaber(tx, tenantId, haber.id)]);
      if (pendiente.lte(0)) throw new BadRequestException('Ese comprobante ya está cobrado (o no tiene nada certificado para cobrar).');
      if (disponible.lte(0)) throw new BadRequestException('Ese cobro ya está imputado por completo.');
      const importe = importeAImputar(pendiente, disponible, dto.importe);
      const existente = await tx.imputacionCuentaCorriente.findUnique({
        where: { tenantId_haberId_debeId: { tenantId, haberId: haber.id, debeId: debe.id } },
      });
      const imputacion = existente
        ? await tx.imputacionCuentaCorriente.update({
            where: { id: existente.id },
            data: { importe: new Decimal(existente.importe.toString()).plus(importe).toFixed(2) },
          })
        : await tx.imputacionCuentaCorriente.create({
            data: { tenantId, haberId: haber.id, debeId: debe.id, importe: importe.toFixed(2), creadoPorId: auth.usuarioId ?? null },
          });
      return { id: imputacion.id, importe: importe.toFixed(2) };
    }, TX);
  }

  /** Deshace una imputación: el comprobante vuelve a quedar pendiente y el cobro, a cuenta. */
  async eliminarImputacion(tenantId: string, id: string) {
    const { count } = await this.prisma.imputacionCuentaCorriente.deleteMany({ where: { tenantId, id } });
    if (count === 0) throw new NotFoundException('Imputación no encontrada.');
    return { id };
  }
}
