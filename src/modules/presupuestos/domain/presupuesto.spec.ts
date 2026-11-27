import { acordadoDesdePresupuesto, calcularTotales, estadoVigente, metrosCuadrados, numeroPresupuesto, puedePasar, vencimientoPorValidez } from './presupuesto';

const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

describe('presupuestos', () => {
  it('numeración P-0000001', () => {
    expect(numeroPresupuesto(1)).toBe('P-0000001');
    expect(numeroPresupuesto(1234)).toBe('P-0001234');
  });

  it('vence a los 15 días por defecto', () => {
    expect(vencimientoPorValidez('2026-11-26', 15)).toBe('2026-12-11');
  });

  it('por ítem (Diego Streck): suma los importes', () => {
    const t = calcularTotales({
      formaCotizar: 'POR_ITEM',
      items: [{ importe: '850000' }, { importe: '620000' }, { importe: '380000' }],
      ivaModo: 'NO_INCLUYE',
      alicuotaIva: '21',
    });
    expect([t.subtotal.toFixed(2), t.iva.toFixed(2), t.total.toFixed(2)]).toEqual(['1850000.00', '0.00', '1850000.00']);
  });

  it('global (Municipalidad): un solo total, con IVA discriminado', () => {
    const t = calcularTotales({ formaCotizar: 'GLOBAL', items: [{}, {}, {}], importeGlobal: '4200000', ivaModo: 'DISCRIMINADO', alicuotaIva: '21' });
    expect([t.subtotal.toFixed(2), t.iva.toFixed(2), t.total.toFixed(2)]).toEqual(['4200000.00', '882000.00', '5082000.00']);
  });

  it('por superficie (La Agrícola Regional): m² × precio por m²', () => {
    const superficie = { ancho: '20', largo: '45', alturaLateral: '6', alturaCumbrera: '8' };
    expect(metrosCuadrados(superficie)?.toFixed(2)).toBe('900.00');
    const t = calcularTotales({ formaCotizar: 'SUPERFICIE', items: [], superficie: { ...superficie, precioMetroCuadrado: '19222.22' }, ivaModo: 'NO_INCLUYE', alicuotaIva: '21' });
    expect(t.subtotal.toFixed(2)).toBe('17299998.00');
  });

  it('alícuota elegible (10,5%)', () => {
    const t = calcularTotales({ formaCotizar: 'GLOBAL', items: [{}], importeGlobal: '1000000', ivaModo: 'DISCRIMINADO', alicuotaIva: '10.5' });
    expect(t.iva.toFixed(2)).toBe('105000.00');
  });

  it('errores claros', () => {
    expect(() => calcularTotales({ formaCotizar: 'POR_ITEM', items: [{ importe: null }], ivaModo: 'SIN_IVA', alicuotaIva: '21' })).toThrow(/cada ítem/);
    expect(() => calcularTotales({ formaCotizar: 'GLOBAL', items: [{}], ivaModo: 'SIN_IVA', alicuotaIva: '21' })).toThrow(/importe/);
    expect(() => calcularTotales({ formaCotizar: 'SUPERFICIE', items: [], ivaModo: 'SIN_IVA', alicuotaIva: '21' })).toThrow(/medidas/);
  });

  it('pasa solo a vencido si no se aceptó ni rechazó', () => {
    expect(estadoVigente('ENVIADO', d('2026-11-01'), d('2026-11-26'))).toBe('VENCIDO');
    expect(estadoVigente('ACEPTADO', d('2026-11-01'), d('2026-11-26'))).toBe('ACEPTADO');
    expect(estadoVigente('BORRADOR', d('2026-11-26'), d('2026-11-26'))).toBe('BORRADOR');
  });

  it('transiciones', () => {
    expect(puedePasar('BORRADOR', 'ENVIADO')).toBe(true);
    expect(puedePasar('RECHAZADO', 'ACEPTADO')).toBe(false);
    expect(puedePasar('ACEPTADO', 'VENCIDO')).toBe(false);
  });

  it('el acordado de la obra: neto si no incluye IVA; total si ya es precio final', () => {
    expect(acordadoDesdePresupuesto({ ivaModo: 'NO_INCLUYE', subtotal: '17300000', total: '17300000' })).toEqual({ montoAcordado: '17300000.00', modoIva: 'MAS_IVA' });
    expect(acordadoDesdePresupuesto({ ivaModo: 'DISCRIMINADO', subtotal: '100', total: '121' })).toEqual({ montoAcordado: '121.00', modoIva: 'ACORDADO_FINAL' });
  });
});
