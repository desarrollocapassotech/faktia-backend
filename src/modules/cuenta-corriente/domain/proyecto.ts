import Decimal from 'decimal.js';

// Reglas de proyectos sobre la cuenta corriente, puras (sin base): hitos y certificaciones, saldo
// total y exigible, cómo impacta una factura según el modo de IVA, conversión de moneda y el orden en
// que un pago cancela las deudas de un proyecto.

const cero = () => new Decimal(0);
const suma = (vs: Decimal.Value[]) => vs.reduce<Decimal>((s, v) => s.plus(v), cero());

/** Deuda (DEBE) de un proyecto vista para imputar y para calcular lo exigible. */
export interface DebeProyecto {
  id: string;
  importe: Decimal.Value;
  imputado: Decimal.Value;
  /** Solo hitos por certificación: la suma de sus certificaciones. */
  porCertificacion?: boolean;
  certificado?: Decimal.Value;
  orden?: number | null;
  fecha: Date;
  fechaVencimiento?: Date | null;
  createdAt?: Date;
}

/**
 * Lo pendiente de una deuda:
 * - total: lo que falta cobrar del importe completo (cuenta en el saldo total);
 * - exigible: lo que se puede cobrar hoy. En un hito por certificación, solo lo certificado;
 * - aCertificar: lo que todavía no se certificó (no vence ni genera avisos).
 */
export function pendientesDe(d: Pick<DebeProyecto, 'importe' | 'imputado' | 'porCertificacion' | 'certificado'>) {
  const importe = new Decimal(d.importe);
  const imputado = new Decimal(d.imputado);
  const total = Decimal.max(importe.minus(imputado), 0);
  if (!d.porCertificacion) return { total, exigible: total, aCertificar: cero() };
  const certificado = Decimal.min(new Decimal(d.certificado ?? 0), importe);
  return { total, exigible: Decimal.max(certificado.minus(imputado), 0), aCertificar: importe.minus(certificado) };
}

/**
 * Orden en que un pago de un proyecto cancela sus deudas: primero los hitos por su orden en el plan,
 * después el resto por vencimiento (los que no vencen, al final) y por fecha.
 */
export function ordenParaImputar(a: DebeProyecto, b: DebeProyecto): number {
  const oa = a.orden ?? Number.MAX_SAFE_INTEGER;
  const ob = b.orden ?? Number.MAX_SAFE_INTEGER;
  if (oa !== ob) return oa - ob;
  const va = a.fechaVencimiento?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const vb = b.fechaVencimiento?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (va !== vb) return va - vb;
  if (a.fecha.getTime() !== b.fecha.getTime()) return a.fecha.getTime() - b.fecha.getTime();
  return (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
}

/**
 * Reparte lo que queda de un pago entre las deudas del proyecto, en orden y cada una hasta su
 * pendiente exigible (lo no certificado no se cobra). Devuelve cuánto va a cada una.
 */
export function repartirEnProyecto(disponible: Decimal.Value, debes: DebeProyecto[]): Array<{ id: string; importe: Decimal }> {
  let restante = new Decimal(disponible);
  const reparto: Array<{ id: string; importe: Decimal }> = [];
  for (const d of [...debes].sort(ordenParaImputar)) {
    if (restante.lte(0)) break;
    const importe = Decimal.min(pendientesDe(d).exigible, restante).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    if (importe.lte(0)) continue;
    reparto.push({ id: d.id, importe });
    restante = restante.minus(importe);
  }
  return reparto;
}

export interface Certificacion {
  id: string;
  importe: Decimal.Value;
  fecha: Date;
  fechaVencimiento: Date | null;
}

/**
 * Lo cobrado de un hito por certificación se aplica a sus certificaciones de la que vence primero a
 * la última (las sin vencimiento, al final). Devuelve lo que le falta a cada una: es lo que vence.
 */
export function pendientePorCertificacion(imputado: Decimal.Value, certificaciones: Certificacion[]): Array<{ id: string; pendiente: Decimal }> {
  let cubierto = new Decimal(imputado);
  const orden = [...certificaciones].sort(
    (a, b) =>
      (a.fechaVencimiento?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.fechaVencimiento?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
      a.fecha.getTime() - b.fecha.getTime(),
  );
  return orden.map((c) => {
    const aplicado = Decimal.min(cubierto, c.importe);
    cubierto = Decimal.max(cubierto.minus(aplicado), 0);
    return { id: c.id, pendiente: new Decimal(c.importe).minus(aplicado) };
  });
}

export type ModoIva = 'MAS_IVA' | 'ACORDADO_FINAL';

/**
 * Cuánto suma (o resta, si es nota de crédito) una factura de un proyecto a la cuenta corriente:
 * - proyecto sin monto acordado: el total, como cualquier factura;
 * - "acordado final": nada (el acordado ya es el precio final);
 * - "más IVA": solo el IVA y los tributos (el neto ya está contado en el acordado).
 */
export function impactoFactura(
  proyecto: { montoAcordado: Decimal.Value | null; modoIva: ModoIva } | null,
  factura: { total: Decimal.Value; iva: Decimal.Value; tributos: Decimal.Value },
): { importe: Decimal; detalle: string | null } {
  if (!proyecto || proyecto.montoAcordado === null) return { importe: new Decimal(factura.total), detalle: null };
  if (proyecto.modoIva === 'ACORDADO_FINAL') return { importe: cero(), detalle: 'Incluida en el monto acordado.' };
  return { importe: new Decimal(factura.iva).plus(factura.tributos), detalle: 'Solo el IVA y los tributos: el neto está en el monto acordado.' };
}

export type Moneda = 'ARS' | 'USD';

/**
 * Pasa un importe a la moneda de destino con un tipo de cambio en pesos por dólar.
 * Pesos a dólares divide; dólares a pesos multiplica. Redondea a centavos.
 */
export function convertir(importe: Decimal.Value, origen: Moneda, destino: Moneda, tipoCambio?: Decimal.Value | null): Decimal {
  const monto = new Decimal(importe);
  if (origen === destino) return monto.toDecimalPlaces(2);
  if (!tipoCambio || !new Decimal(tipoCambio).gt(0)) throw new Error('Falta el tipo de cambio.');
  const tc = new Decimal(tipoCambio);
  return (origen === 'ARS' ? monto.div(tc) : monto.times(tc)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Tipo de cambio a usar en un pago: el editado en el pago, el fijo del proyecto o la cotización oficial. */
export function elegirTipoCambio(
  editado: Decimal.Value | null | undefined,
  fijoProyecto: Decimal.Value | null | undefined,
  oficial: () => Promise<Decimal.Value>,
): Promise<{ valor: Decimal; fuente: 'PAGO' | 'PROYECTO' | 'ARCA' }> {
  if (editado != null && new Decimal(editado).gt(0)) return Promise.resolve({ valor: new Decimal(editado), fuente: 'PAGO' });
  if (fijoProyecto != null && new Decimal(fijoProyecto).gt(0)) return Promise.resolve({ valor: new Decimal(fijoProyecto), fuente: 'PROYECTO' });
  return oficial().then((v) => ({ valor: new Decimal(v), fuente: 'ARCA' as const }));
}

export interface HitoPlan {
  id?: string;
  descripcion: string;
  importe: string;
  porCertificacion?: boolean;
}

/** Los hitos tienen que sumar el monto acordado. Sin acordado no hay hitos. Devuelve el error o null. */
export function errorDePlan(montoAcordado: string | null, hitos: HitoPlan[]): string | null {
  if (montoAcordado === null) return hitos.length ? 'Sin monto acordado no se cargan hitos.' : null;
  if (!new Decimal(montoAcordado).gt(0)) return 'El monto acordado tiene que ser mayor a 0.';
  if (hitos.some((h) => !new Decimal(h.importe).gt(0))) return 'Cada hito tiene que tener un importe mayor a 0.';
  const total = suma(hitos.map((h) => h.importe));
  if (hitos.length && !total.eq(montoAcordado)) {
    return `Los hitos suman ${total.toFixed(2)} y el monto acordado es ${new Decimal(montoAcordado).toFixed(2)}: tienen que coincidir.`;
  }
  return null;
}

/** Con acordado y sin hitos, el acordado queda como un único hito. */
export function planEfectivo(montoAcordado: string | null, hitos: HitoPlan[]): HitoPlan[] {
  if (montoAcordado === null || hitos.length) return hitos;
  return [{ descripcion: 'Monto acordado', importe: new Decimal(montoAcordado).toFixed(2) }];
}

/** Totales del proyecto: saldo total (todo lo acordado y adicionales menos lo cobrado) y exigible (sin lo que falta certificar). */
export function saldosProyecto(debes: Array<Pick<DebeProyecto, 'importe' | 'imputado' | 'porCertificacion' | 'certificado'>>, totalHaber: Decimal.Value) {
  const totalDebe = suma(debes.map((d) => d.importe));
  const aCertificar = suma(debes.map((d) => pendientesDe(d).aCertificar));
  const saldo = totalDebe.minus(totalHaber);
  return { totalDebe, totalHaber: new Decimal(totalHaber), saldo, aCertificar, saldoExigible: saldo.minus(aCertificar) };
}
