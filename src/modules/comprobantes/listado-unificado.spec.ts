import { Prisma } from '@prisma/client';
import { compararFilas, filaDeRecibo, paginaUnificada, type FilaListado } from './listado-unificado';

function fila(p: Partial<FilaListado> & { id: string }): FilaListado {
  return {
    clase: 'comprobante',
    tipo: 'FACTURA_C',
    estado: 'EMITIDO',
    ambiente: 'PRODUCCION',
    numero: 1,
    numeroTexto: null,
    puntoVenta: { numero: 1 },
    fechaEmision: new Date('2026-11-01'),
    moneda: 'ARS',
    importeTotal: new Prisma.Decimal(100),
    cae: null,
    errorMensaje: null,
    createdAt: new Date('2026-11-01T10:00:00Z'),
    cliente: { id: 'c', razonSocial: 'Cliente' },
    ...p,
  };
}

const recibo = (p: Partial<FilaListado> & { id: string }) =>
  fila({ clase: 'recibo', tipo: 'RECIBO_COBRO', ambiente: null, numero: null, puntoVenta: null, ...p });

describe('listado unificado (comprobantes + recibos)', () => {
  it('sin columna, los más recientes primero mezclando los dos', () => {
    const c1 = fila({ id: 'c1', createdAt: new Date('2026-11-01T10:00:00Z') });
    const r1 = recibo({ id: 'r1', createdAt: new Date('2026-11-02T10:00:00Z') });
    const c2 = fila({ id: 'c2', createdAt: new Date('2026-11-03T10:00:00Z') });
    expect(paginaUnificada([c2, c1], [r1], {}, 1, 10).map((f) => f.id)).toEqual(['c2', 'r1', 'c1']);
  });

  it('pagina sobre la mezcla', () => {
    const c = [1, 2, 3].map((d) => fila({ id: `c${d}`, createdAt: new Date(`2026-11-0${d * 2}T00:00:00Z`) }));
    const r = [1, 2, 3].map((d) => recibo({ id: `r${d}`, createdAt: new Date(`2026-11-0${d * 2 + 1}T00:00:00Z`) }));
    // Orden: r3 (7), c3 (6), r2 (5), c2 (4), r1 (3), c1 (2)
    expect(paginaUnificada(c, r, {}, 2, 2).map((f) => f.id)).toEqual(['r2', 'c2']);
  });

  it('por total, en los dos sentidos', () => {
    const a = fila({ id: 'a', importeTotal: new Prisma.Decimal(300) });
    const b = recibo({ id: 'b', importeTotal: new Prisma.Decimal(50) });
    expect([a, b].sort(compararFilas('total', 'asc')).map((f) => f.id)).toEqual(['b', 'a']);
    expect([a, b].sort(compararFilas('total', 'desc')).map((f) => f.id)).toEqual(['a', 'b']);
  });

  it('por número: sin número al final en los dos sentidos', () => {
    const borrador = fila({ id: 'borrador', numero: null });
    const f15 = fila({ id: 'f15', numero: 15 });
    const r = recibo({ id: 'r', numeroTexto: '0001-00000003' });
    expect([borrador, f15, r].sort(compararFilas('numero', 'asc')).map((f) => f.id)).toEqual(['r', 'f15', 'borrador']);
    expect([borrador, f15, r].sort(compararFilas('numero', 'desc')).map((f) => f.id)).toEqual(['f15', 'r', 'borrador']);
  });

  it('por tipo, los recibos van después de las notas', () => {
    const r = recibo({ id: 'r' });
    const nc = fila({ id: 'nc', tipo: 'NOTA_CREDITO_C' });
    const fa = fila({ id: 'fa', tipo: 'FACTURA_A' });
    expect([r, nc, fa].sort(compararFilas('comprobante', 'asc')).map((f) => f.id)).toEqual(['fa', 'nc', 'r']);
  });

  it('por cliente sin distinguir mayúsculas ni acentos', () => {
    const a = fila({ id: 'a', cliente: { id: null, razonSocial: 'Ángel' } });
    const b = recibo({ id: 'b', cliente: { id: null, razonSocial: 'beta' } });
    expect([b, a].sort(compararFilas('cliente', 'asc')).map((f) => f.id)).toEqual(['a', 'b']);
  });
});

describe('recibos en el listado', () => {
  const base = { id: 'r', tipo: 'COBRO' as const, numero: '0001-00000001', fecha: new Date('2026-11-01'), moneda: 'ARS' as const, total: new Prisma.Decimal(100), createdAt: new Date(), clienteId: null, contraparteNombre: 'X' };
  it('un recibo vigente figura emitido y uno anulado, anulado', () => {
    expect(filaDeRecibo({ ...base, anuladoEn: null }).estado).toBe('EMITIDO');
    expect(filaDeRecibo({ ...base, anuladoEn: new Date() }).estado).toBe('ANULADO');
  });
});
