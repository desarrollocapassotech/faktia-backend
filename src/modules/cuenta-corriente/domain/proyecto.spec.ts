import Decimal from 'decimal.js';
import {
  convertir,
  elegirTipoCambio,
  errorDePlan,
  impactoFactura,
  ordenParaImputar,
  pendientePorCertificacion,
  pendientesDe,
  planEfectivo,
  repartirEnProyecto,
  saldosProyecto,
  type DebeProyecto,
} from './proyecto';

const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

// Obra real del doc (§7): La Agrícola Regional, sucursal Costa Doll, $17.300.000 más IVA.
function hitosCostaDoll(imputado = { anticipo: '0', avance: '0', final: '0' }, certificado = '0'): DebeProyecto[] {
  return [
    { id: 'anticipo', importe: '2595000', imputado: imputado.anticipo, orden: 1, fecha: d('2026-10-09') },
    { id: 'avance', importe: '13385000', imputado: imputado.avance, orden: 2, porCertificacion: true, certificado, fecha: d('2026-10-09') },
    { id: 'final', importe: '1320000', imputado: imputado.final, orden: 3, fecha: d('2026-10-09') },
  ];
}

describe('plan de pagos', () => {
  it('los hitos de Costa Doll suman el acordado', () => {
    expect(errorDePlan('17300000', [{ descripcion: 'Anticipo', importe: '2595000' }, { descripcion: 'Según avance de obra', importe: '13385000' }, { descripcion: 'Al terminar', importe: '1320000' }])).toBeNull();
  });
  it('si no suman, avisa con los dos totales', () => {
    expect(errorDePlan('17300000', [{ descripcion: 'Anticipo', importe: '2595000' }])).toMatch(/2595000\.00.*17300000\.00/);
  });
  it('sin acordado no hay hitos', () => {
    expect(errorDePlan(null, [{ descripcion: 'x', importe: '1' }])).not.toBeNull();
    expect(errorDePlan(null, [])).toBeNull();
  });
  it('con acordado y sin hitos queda un único hito', () => {
    expect(planEfectivo('500000', [])).toEqual([{ descripcion: 'Monto acordado', importe: '500000.00' }]);
  });
});

describe('certificaciones', () => {
  it('un hito por certificación solo es exigible en lo certificado', () => {
    expect(pendientesDe({ importe: '13385000', imputado: '0', porCertificacion: true, certificado: '5000000' })).toEqual({
      total: new Decimal('13385000'),
      exigible: new Decimal('5000000'),
      aCertificar: new Decimal('8385000'),
    });
  });
  it('lo cobrado se aplica a la certificación que vence primero', () => {
    const certs = [
      { id: 'c2', importe: '3000000', fecha: d('2026-12-01'), fechaVencimiento: d('2026-12-15') },
      { id: 'c1', importe: '5000000', fecha: d('2026-11-01'), fechaVencimiento: d('2026-11-15') },
    ];
    expect(pendientePorCertificacion('6000000', certs).map((c) => [c.id, c.pendiente.toFixed(0)])).toEqual([
      ['c1', '0'],
      ['c2', '2000000'],
    ]);
  });
});

describe('saldos de Costa Doll (doc §7)', () => {
  it('con el anticipo cobrado, el saldo es $14.705.000', () => {
    const s = saldosProyecto(hitosCostaDoll({ anticipo: '2595000', avance: '0', final: '0' }), '2595000');
    expect(s.saldo.toFixed(0)).toBe('14705000');
  });
  it('con un primer avance certificado de $5.000.000, quedan $8.385.000 a certificar', () => {
    const s = saldosProyecto(hitosCostaDoll({ anticipo: '2595000', avance: '0', final: '0' }, '5000000'), '2595000');
    expect(s.aCertificar.toFixed(0)).toBe('8385000');
    expect(s.saldoExigible.toFixed(0)).toBe('6320000'); // 5.000.000 certificados + 1.320.000 al terminar
  });
  it('una factura A por $5.000.000 + IVA suma solo el IVA ($1.050.000)', () => {
    const r = impactoFactura({ montoAcordado: '17300000', modoIva: 'MAS_IVA' }, { total: '6050000', iva: '1050000', tributos: '0' });
    expect(r.importe.toFixed(0)).toBe('1050000');
  });
});

describe('impacto de facturas según el modo de IVA', () => {
  const factura = { total: '121000', iva: '21000', tributos: '500' };
  it('acordado final: no suma nada', () => {
    expect(impactoFactura({ montoAcordado: '100000', modoIva: 'ACORDADO_FINAL' }, factura).importe.toFixed(2)).toBe('0.00');
  });
  it('más IVA: IVA y tributos', () => {
    expect(impactoFactura({ montoAcordado: '100000', modoIva: 'MAS_IVA' }, factura).importe.toFixed(2)).toBe('21500.00');
  });
  it('proyecto sin acordado (Municipalidad, por trabajo): el total', () => {
    expect(impactoFactura({ montoAcordado: null, modoIva: 'MAS_IVA' }, factura).importe.toFixed(2)).toBe('121000.00');
    expect(impactoFactura(null, factura).importe.toFixed(2)).toBe('121000.00');
  });
});

describe('imputación dentro de un proyecto', () => {
  it('un pago cancela los hitos en orden y no cobra lo no certificado', () => {
    // $4.000.000: anticipo completo; el avance no tiene nada certificado; el resto va al hito final.
    const r = repartirEnProyecto('4000000', hitosCostaDoll());
    expect(r.map((x) => [x.id, x.importe.toFixed(0)])).toEqual([
      ['anticipo', '2595000'],
      ['final', '1320000'],
    ]);
  });
  it('con avance certificado, el pago lo cubre antes que el hito final', () => {
    const r = repartirEnProyecto('3000000', hitosCostaDoll({ anticipo: '2595000', avance: '0', final: '0' }, '2000000'));
    expect(r.map((x) => [x.id, x.importe.toFixed(0)])).toEqual([
      ['avance', '2000000'],
      ['final', '1000000'],
    ]);
  });
  it('los adicionales (sin orden) van después de los hitos, por vencimiento', () => {
    const debes: DebeProyecto[] = [
      { id: 'adic-sin-vto', importe: '10', imputado: '0', fecha: d('2026-01-01') },
      { id: 'adic-vto', importe: '10', imputado: '0', fecha: d('2026-02-01'), fechaVencimiento: d('2026-03-01') },
      { id: 'hito', importe: '10', imputado: '0', orden: 1, fecha: d('2026-05-01') },
    ];
    expect([...debes].sort(ordenParaImputar).map((x) => x.id)).toEqual(['hito', 'adic-vto', 'adic-sin-vto']);
  });
});

describe('tipo de cambio', () => {
  it('obra en dólares cobrada en pesos (Wilson Carrillo): divide por el TC', () => {
    expect(convertir('1050000', 'ARS', 'USD', '1050').toFixed(2)).toBe('1000.00');
  });
  it('dólares a pesos multiplica', () => {
    expect(convertir('100', 'USD', 'ARS', '1452.5').toFixed(2)).toBe('145250.00');
  });
  it('misma moneda no necesita TC', () => {
    expect(convertir('10.555', 'ARS', 'ARS').toFixed(2)).toBe('10.56');
  });
  it('sin TC entre monedas distintas, error', () => {
    expect(() => convertir('1', 'ARS', 'USD')).toThrow();
  });
  it('prioridad: editado en el pago, fijo del proyecto, cotización de ARCA', async () => {
    const arca = jest.fn(async () => '1400');
    await expect(elegirTipoCambio('1500', '1300', arca)).resolves.toMatchObject({ fuente: 'PAGO' });
    await expect(elegirTipoCambio(null, '1300', arca)).resolves.toMatchObject({ fuente: 'PROYECTO' });
    expect(arca).not.toHaveBeenCalled();
    const r = await elegirTipoCambio(undefined, null, arca);
    expect([r.fuente, r.valor.toFixed(0)]).toEqual(['ARCA', '1400']);
  });
});
