import Decimal from 'decimal.js';

// Cuentas de la cuenta corriente, puras (sin base): como Vialto, pero con Decimal en vez de Float.
// DEBE suma al saldo (lo que el cliente debe) y HABER resta (lo que lo cancela). Nunca se mezclan
// monedas: todo se acumula por moneda.

export type TipoMovimiento = 'DEBE' | 'HABER';

export interface MovimientoParaSaldo {
  id: string;
  tipo: TipoMovimiento;
  moneda: string;
  importe: Decimal.Value;
}

/** Lo que queda sin imputar de un movimiento: en un DEBE, lo que falta cobrar; en un HABER, lo que sobra (a cuenta). */
export function pendienteDe(importe: Decimal.Value, imputaciones: Decimal.Value[]): Decimal {
  const imputado = imputaciones.reduce<Decimal>((s, i) => s.plus(i), new Decimal(0));
  return Decimal.max(new Decimal(importe).minus(imputado), 0);
}

export type EstadoMovimiento = 'PENDIENTE' | 'PARCIAL' | 'CANCELADO';

/** DEBE: pendiente / cobrado en parte / cobrado. HABER: sin imputar / imputado en parte / imputado. */
export function estadoDe(importe: Decimal.Value, pendiente: Decimal.Value): EstadoMovimiento {
  const p = new Decimal(pendiente);
  if (p.lte(0)) return 'CANCELADO';
  return p.gte(importe) ? 'PENDIENTE' : 'PARCIAL';
}

/** Saldo por moneda (DEBE − HABER), ordenado: pesos primero. */
export function saldosPorMoneda(movimientos: Array<Omit<MovimientoParaSaldo, 'id'>>): Array<{ moneda: string; saldo: Decimal }> {
  const porMoneda = new Map<string, Decimal>();
  for (const m of movimientos) {
    const actual = porMoneda.get(m.moneda) ?? new Decimal(0);
    porMoneda.set(m.moneda, m.tipo === 'DEBE' ? actual.plus(m.importe) : actual.minus(m.importe));
  }
  return [...porMoneda.entries()].sort(([a], [b]) => ordenMoneda(a, b)).map(([moneda, saldo]) => ({ moneda, saldo }));
}

/** Pesos primero; el resto, alfabético. */
export function ordenMoneda(a: string, b: string): number {
  if (a === b) return 0;
  if (a === 'ARS') return -1;
  if (b === 'ARS') return 1;
  return a.localeCompare(b);
}

/**
 * Saldo acumulado de la moneda de cada movimiento, recorriéndolos en el orden dado (el de la
 * pantalla, del más viejo al más nuevo). Devuelve un mapa id → saldo después de ese movimiento.
 */
export function saldosAcumulados(movimientos: MovimientoParaSaldo[]): Map<string, Decimal> {
  const porMoneda = new Map<string, Decimal>();
  const resultado = new Map<string, Decimal>();
  for (const m of movimientos) {
    const actual = porMoneda.get(m.moneda) ?? new Decimal(0);
    const nuevo = m.tipo === 'DEBE' ? actual.plus(m.importe) : actual.minus(m.importe);
    porMoneda.set(m.moneda, nuevo);
    resultado.set(m.id, nuevo);
  }
  return resultado;
}

/**
 * Cuánto se imputa de un HABER a un DEBE: lo pedido (o todo lo posible si no se pide), sin pasarse
 * de lo que le falta al DEBE ni de lo que le queda al HABER. Como Vialto, un importe mayor no se
 * rechaza: se recorta.
 */
export function importeAImputar(pendienteDebe: Decimal.Value, disponibleHaber: Decimal.Value, pedido?: Decimal.Value): Decimal {
  const tope = Decimal.min(pendienteDebe, disponibleHaber);
  const valor = pedido === undefined ? tope : Decimal.min(pedido, tope);
  return Decimal.max(valor, 0).toDecimalPlaces(2, Decimal.ROUND_DOWN);
}

/**
 * Reparte un HABER entre varios DEBE, del primero al último (el llamador los ordena, por ejemplo
 * del más viejo al más nuevo), cada uno hasta su pendiente. Los que no reciben nada no aparecen.
 */
export function repartirHaber(
  disponible: Decimal.Value,
  debes: Array<{ id: string; pendiente: Decimal.Value; tope?: Decimal.Value }>,
): Array<{ id: string; importe: Decimal }> {
  let restante = new Decimal(disponible);
  const reparto: Array<{ id: string; importe: Decimal }> = [];
  for (const d of debes) {
    if (restante.lte(0)) break;
    const maximo = d.tope === undefined ? new Decimal(d.pendiente) : Decimal.min(d.pendiente, d.tope);
    const importe = importeAImputar(maximo, restante);
    if (importe.lte(0)) continue;
    reparto.push({ id: d.id, importe });
    restante = restante.minus(importe);
  }
  return reparto;
}

/** Fecha + días, en UTC (las fechas de la base son días calendario, sin hora). */
export function sumarDias(fecha: Date, dias: number): Date {
  const d = new Date(fecha.getTime());
  d.setUTCDate(d.getUTCDate() + dias);
  return d;
}
