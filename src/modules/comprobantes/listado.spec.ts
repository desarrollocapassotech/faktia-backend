import { filtroNumero, ordenListado, tiposDeClase } from './comprobantes.service';

describe('listado de comprobantes', () => {
  it('la clase incluye las tres letras y nada más', () => {
    expect(tiposDeClase('FACTURA').sort()).toEqual(['FACTURA_A', 'FACTURA_B', 'FACTURA_C']);
    expect(tiposDeClase('NOTA_CREDITO').sort()).toEqual(['NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C']);
  });

  it('filtra por punto de venta y número, con o sin ceros', () => {
    expect(filtroNumero('00002-00000015')).toEqual({ puntoVenta: { numero: 2 }, numero: 15 });
    expect(filtroNumero(' 2 - 15 ')).toEqual({ puntoVenta: { numero: 2 }, numero: 15 });
  });

  it('solo el número busca en cualquier punto de venta', () => {
    expect(filtroNumero('00000015')).toEqual({ numero: 15 });
  });

  it('sin columna: los más recientes primero', () => {
    expect(ordenListado(undefined, 'asc')).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('por número: punto de venta, número (borradores al final) y desempate', () => {
    expect(ordenListado('numero', 'desc')).toEqual([
      { puntoVenta: { numero: 'desc' } },
      { numero: { sort: 'desc', nulls: 'last' } },
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('por cliente ordena por razón social', () => {
    expect(ordenListado('cliente', 'asc')[0]).toEqual({ cliente: { razonSocial: 'asc' } });
  });
});
