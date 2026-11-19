import Decimal from 'decimal.js';
import { estadoDe, importeAImputar, pendienteDe, repartirHaber, saldosAcumulados, saldosPorMoneda, sumarDias } from './cuenta';

const str = (d: Decimal) => d.toFixed(2);

describe('pendienteDe', () => {
  it('resta lo imputado', () => {
    expect(str(pendienteDe('1000', ['300', '200.5']))).toBe('499.50');
  });
  it('sin imputaciones es el importe', () => {
    expect(str(pendienteDe('1000', []))).toBe('1000.00');
  });
  it('nunca da negativo', () => {
    expect(str(pendienteDe('100', ['150']))).toBe('0.00');
  });
});

describe('estadoDe', () => {
  it('pendiente, parcial y cancelado', () => {
    expect(estadoDe('100', '100')).toBe('PENDIENTE');
    expect(estadoDe('100', '0.01')).toBe('PARCIAL');
    expect(estadoDe('100', '0')).toBe('CANCELADO');
  });
});

describe('saldosPorMoneda', () => {
  it('DEBE suma, HABER resta y no mezcla monedas (pesos primero)', () => {
    const r = saldosPorMoneda([
      { tipo: 'DEBE', moneda: 'USD', importe: '50' },
      { tipo: 'DEBE', moneda: 'ARS', importe: '1000' },
      { tipo: 'HABER', moneda: 'ARS', importe: '1200' },
    ]);
    expect(r.map((s) => [s.moneda, str(s.saldo)])).toEqual([
      ['ARS', '-200.00'],
      ['USD', '50.00'],
    ]);
  });
});

describe('saldosAcumulados', () => {
  it('acumula por la moneda de cada movimiento', () => {
    const r = saldosAcumulados([
      { id: 'a', tipo: 'DEBE', moneda: 'ARS', importe: '100' },
      { id: 'b', tipo: 'DEBE', moneda: 'USD', importe: '10' },
      { id: 'c', tipo: 'HABER', moneda: 'ARS', importe: '40' },
    ]);
    expect(str(r.get('a')!)).toBe('100.00');
    expect(str(r.get('b')!)).toBe('10.00');
    expect(str(r.get('c')!)).toBe('60.00');
  });
});

describe('importeAImputar', () => {
  it('sin pedido, todo lo posible', () => {
    expect(str(importeAImputar('300', '1000'))).toBe('300.00');
    expect(str(importeAImputar('300', '120'))).toBe('120.00');
  });
  it('recorta un pedido mayor', () => {
    expect(str(importeAImputar('300', '1000', '500'))).toBe('300.00');
  });
  it('respeta un pedido menor', () => {
    expect(str(importeAImputar('300', '1000', '99.99'))).toBe('99.99');
  });
});

describe('repartirHaber', () => {
  it('cubre en orden hasta agotar el haber', () => {
    const r = repartirHaber('500', [
      { id: 'f1', pendiente: '300' },
      { id: 'f2', pendiente: '300' },
      { id: 'f3', pendiente: '300' },
    ]);
    expect(r.map((x) => [x.id, str(x.importe)])).toEqual([
      ['f1', '300.00'],
      ['f2', '200.00'],
    ]);
  });
  it('respeta el tope de cada uno y saltea los cancelados', () => {
    const r = repartirHaber('1000', [
      { id: 'f1', pendiente: '0' },
      { id: 'f2', pendiente: '300', tope: '100' },
    ]);
    expect(r.map((x) => [x.id, str(x.importe)])).toEqual([['f2', '100.00']]);
  });
});

describe('sumarDias', () => {
  it('suma días calendario sin correr por la zona horaria', () => {
    expect(sumarDias(new Date('2026-11-25T00:00:00Z'), 10).toISOString().slice(0, 10)).toBe('2026-12-05');
  });
});
