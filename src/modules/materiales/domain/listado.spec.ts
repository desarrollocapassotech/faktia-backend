import { subtotalDe, totalesPorMoneda } from './listado';

// Algunos renglones del listado del galpón (doc §11).
const renglones = [
  { cantidad: '24', precioCosto: '38500', monedaCosto: 'ARS' as const, precioVenta: '46200', monedaVenta: 'ARS' as const }, // perfil C 160 (barras)
  { cantidad: '180', precioCosto: '21', monedaCosto: 'USD' as const, precioVenta: '25', monedaVenta: 'USD' as const }, // chapa trapezoidal (metros)
  { cantidad: '3', precioCosto: null, monedaCosto: null, precioVenta: null, monedaVenta: null }, // texto libre sin precio
];

describe('listado de materiales', () => {
  it('subtotal por renglón: cantidad × precio elegido', () => {
    expect(subtotalDe(renglones[0], 'COSTO')?.importe.toFixed(2)).toBe('924000.00');
    expect(subtotalDe(renglones[0], 'VENTA')?.importe.toFixed(2)).toBe('1108800.00');
    expect(subtotalDe(renglones[0], 'NINGUNO')).toBeNull();
  });
  it('totales por moneda, sin mezclar, y cuenta los renglones sin precio', () => {
    const r = totalesPorMoneda(renglones, 'VENTA');
    expect(r.totales.map((t) => [t.moneda, t.total.toFixed(2)])).toEqual([
      ['ARS', '1108800.00'],
      ['USD', '4500.00'],
    ]);
    expect(r.sinPrecio).toBe(1);
  });
  it('sin precios (para pedir cotización al proveedor) no hay totales', () => {
    expect(totalesPorMoneda(renglones, 'NINGUNO')).toEqual({ totales: [], sinPrecio: 0 });
  });
});
