import Decimal from 'decimal.js';

// Cuentas puras de un listado de materiales: subtotal por renglón y totales por moneda (nunca se
// suman pesos con dólares).

export type Precios = 'NINGUNO' | 'COSTO' | 'VENTA';
export type Moneda = 'ARS' | 'USD';

export interface RenglonParaTotal {
  cantidad: Decimal.Value;
  precioCosto?: Decimal.Value | null;
  monedaCosto?: Moneda | null;
  precioVenta?: Decimal.Value | null;
  monedaVenta?: Moneda | null;
}

/** Precio y moneda que muestra el renglón según lo elegido (null si no tiene ese precio). */
export function precioDe(r: RenglonParaTotal, precios: Precios): { precio: Decimal; moneda: Moneda } | null {
  if (precios === 'NINGUNO') return null;
  const precio = precios === 'COSTO' ? r.precioCosto : r.precioVenta;
  const moneda = precios === 'COSTO' ? r.monedaCosto : r.monedaVenta;
  if (precio == null || !moneda) return null;
  return { precio: new Decimal(precio), moneda };
}

export function subtotalDe(r: RenglonParaTotal, precios: Precios): { importe: Decimal; moneda: Moneda } | null {
  const p = precioDe(r, precios);
  return p ? { importe: new Decimal(r.cantidad).times(p.precio).toDecimalPlaces(2, Decimal.ROUND_HALF_UP), moneda: p.moneda } : null;
}

/** Totales por moneda, pesos primero. Los renglones sin precio no suman (y se cuentan aparte). */
export function totalesPorMoneda(renglones: RenglonParaTotal[], precios: Precios): { totales: Array<{ moneda: Moneda; total: Decimal }>; sinPrecio: number } {
  if (precios === 'NINGUNO') return { totales: [], sinPrecio: 0 };
  const m = new Map<Moneda, Decimal>();
  let sinPrecio = 0;
  for (const r of renglones) {
    const s = subtotalDe(r, precios);
    if (!s) {
      sinPrecio += 1;
      continue;
    }
    m.set(s.moneda, (m.get(s.moneda) ?? new Decimal(0)).plus(s.importe));
  }
  const totales = [...m.entries()].sort(([a]) => (a === 'ARS' ? -1 : 1)).map(([moneda, total]) => ({ moneda, total }));
  return { totales, sinPrecio };
}
