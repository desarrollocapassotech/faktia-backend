import Decimal from 'decimal.js';

// Reglas puras de presupuestos: totales según la forma de cotizar y el IVA, numeración P-0000001,
// vencimiento por validez y estados.

export type FormaCotizar = 'POR_ITEM' | 'GLOBAL' | 'SUPERFICIE';
export type IvaModo = 'SIN_IVA' | 'NO_INCLUYE' | 'DISCRIMINADO';
export type Estado = 'BORRADOR' | 'ENVIADO' | 'ACEPTADO' | 'RECHAZADO' | 'VENCIDO';

export interface Superficie {
  ancho?: string | null;
  largo?: string | null;
  alturaLateral?: string | null;
  alturaCumbrera?: string | null;
  /** Si no viene, ancho × largo. */
  metrosCuadrados?: string | null;
  precioMetroCuadrado?: string | null;
}

export class PresupuestoInvalidoError extends Error {}

/** "P-0000001". */
export const numeroPresupuesto = (n: number) => `P-${String(n).padStart(7, '0')}`;

/** Fecha + días de validez (fechas sin hora, en UTC). */
export function vencimientoPorValidez(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Metros cuadrados de la superficie: los cargados o ancho × largo. */
export function metrosCuadrados(s: Superficie | null | undefined): Decimal | null {
  if (!s) return null;
  if (s.metrosCuadrados && new Decimal(s.metrosCuadrados).gt(0)) return new Decimal(s.metrosCuadrados);
  if (s.ancho && s.largo) return new Decimal(s.ancho).times(s.largo).toDecimalPlaces(2);
  return null;
}

/**
 * Subtotal, IVA y total:
 * - por ítem: la suma de los importes de los ítems (todos tienen que tener importe);
 * - global: el importe global;
 * - por superficie: m² × precio por m², o el importe global si no hay precio.
 * IVA solo si se discrimina (alícuota del presupuesto); "no incluye" y "sin IVA" no lo suman.
 */
export function calcularTotales(p: {
  formaCotizar: FormaCotizar;
  items: Array<{ importe?: string | null }>;
  importeGlobal?: string | null;
  superficie?: Superficie | null;
  ivaModo: IvaModo;
  alicuotaIva: string;
}): { subtotal: Decimal; iva: Decimal; total: Decimal } {
  let subtotal: Decimal;
  if (p.formaCotizar === 'POR_ITEM') {
    if (p.items.some((i) => i.importe == null || i.importe === '')) throw new PresupuestoInvalidoError('Cotizando por ítem, cada ítem necesita su importe.');
    subtotal = p.items.reduce((s, i) => s.plus(i.importe!), new Decimal(0));
  } else if (p.formaCotizar === 'SUPERFICIE') {
    const m2 = metrosCuadrados(p.superficie);
    if (!m2) throw new PresupuestoInvalidoError('Cotizando por superficie, cargá las medidas o los metros cuadrados.');
    if (p.superficie?.precioMetroCuadrado) subtotal = m2.times(p.superficie.precioMetroCuadrado).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    else if (p.importeGlobal) subtotal = new Decimal(p.importeGlobal);
    else throw new PresupuestoInvalidoError('Cotizando por superficie, cargá el precio por m² o el importe total.');
  } else {
    if (!p.importeGlobal) throw new PresupuestoInvalidoError('Cotizando por total global, cargá el importe.');
    subtotal = new Decimal(p.importeGlobal);
  }
  if (p.items.length === 0 && p.formaCotizar !== 'SUPERFICIE') throw new PresupuestoInvalidoError('El presupuesto necesita al menos un ítem.');
  const iva = p.ivaModo === 'DISCRIMINADO' ? subtotal.times(p.alicuotaIva).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : new Decimal(0);
  return { subtotal, iva, total: subtotal.plus(iva) };
}

/** Pasa solo a vencido: borrador o enviado con la fecha de vencimiento ya pasada. */
export function estadoVigente(estado: Estado, fechaVencimiento: Date, hoy: Date): Estado {
  return (estado === 'BORRADOR' || estado === 'ENVIADO') && fechaVencimiento < hoy ? 'VENCIDO' : estado;
}

/** Cambios de estado a mano. Vencido lo pone el sistema; un vencido se duplica con fecha nueva. */
const TRANSICIONES: Record<Estado, Estado[]> = {
  BORRADOR: ['ENVIADO', 'ACEPTADO', 'RECHAZADO'],
  ENVIADO: ['BORRADOR', 'ACEPTADO', 'RECHAZADO'],
  ACEPTADO: ['ENVIADO', 'RECHAZADO'],
  RECHAZADO: ['ENVIADO'],
  VENCIDO: ['ACEPTADO', 'RECHAZADO'],
};

export function puedePasar(de: Estado, a: Estado): boolean {
  return TRANSICIONES[de].includes(a);
}

/** Al crear un proyecto desde el presupuesto: qué se toma como monto acordado y con qué modo de IVA. */
export function acordadoDesdePresupuesto(p: { ivaModo: IvaModo; subtotal: Decimal.Value; total: Decimal.Value }): {
  montoAcordado: string;
  modoIva: 'MAS_IVA' | 'ACORDADO_FINAL';
} {
  // "No incluye IVA": el acordado es el neto y las facturas suman su IVA. Con IVA discriminado o sin
  // mencionarlo, el total del presupuesto ya es el precio final.
  if (p.ivaModo === 'NO_INCLUYE') return { montoAcordado: new Decimal(p.subtotal).toFixed(2), modoIva: 'MAS_IVA' };
  return { montoAcordado: new Decimal(p.total).toFixed(2), modoIva: 'ACORDADO_FINAL' };
}
