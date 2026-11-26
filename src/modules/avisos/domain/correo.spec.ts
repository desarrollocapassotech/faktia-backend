import { asuntoAviso, htmlAviso, textoAviso, type ResumenAviso } from './correo';

const resumen: ResumenAviso = {
  empresa: 'Ale Herrería',
  etiquetaProyecto: 'Obra',
  dias: 3,
  url: 'https://app.faktia.test/cuenta-corriente',
  vencidos: [
    { cliente: 'La Agrícola Regional', proyecto: 'Galpón Costa Doll', concepto: 'Según avance de obra: Estructura', numero: null, moneda: 'ARS', pendiente: '5000000', fechaVencimiento: '2026-11-20' },
  ],
  proximos: [{ cliente: 'Wilson Carrillo <x>', proyecto: null, concepto: 'Saldo inicial', numero: null, moneda: 'USD', pendiente: '1200', fechaVencimiento: '2026-11-28' }],
};

describe('resumen diario de vencimientos', () => {
  it('asunto con cuántos vencidos y por vencer', () => {
    expect(asuntoAviso(resumen)).toBe('Faktia · Ale Herrería: 1 vencido y 1 por vencer');
  });
  it('texto con fecha, cliente, obra e importe', () => {
    const t = textoAviso(resumen);
    expect(t).toContain('20/11/2026 · La Agrícola Regional · Según avance de obra: Estructura · Obra: Galpón Costa Doll · $ 5.000.000,00');
    expect(t).toContain('Vence en los próximos 3 días (US$ 1.200,00)');
  });
  it('el HTML escapa lo que viene de los datos', () => {
    expect(htmlAviso(resumen)).toContain('Wilson Carrillo &lt;x&gt;');
    expect(htmlAviso(resumen)).not.toContain('<x>');
  });
});
