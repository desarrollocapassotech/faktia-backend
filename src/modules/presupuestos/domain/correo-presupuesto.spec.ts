import { asuntoPresupuesto, htmlPresupuesto, textoPresupuesto, type CorreoPresupuesto } from './correo-presupuesto';

const base: CorreoPresupuesto = {
  numero: 'P-0000002',
  titulo: 'Actualización general',
  lugar: 'Página web',
  etiquetaProyecto: 'Proyecto',
  fecha: '2026-11-27',
  fechaVencimiento: '2026-12-12',
  moneda: 'ARS',
  total: '447700',
  ivaModo: 'DISCRIMINADO',
  cliente: 'EFE Capital',
  emisor: { nombre: 'Elias Nicolas Capasso', cuit: '20-38442199-8', domicilio: 'French 94', telefono: null, email: 'hola@ejemplo.com' },
  colorPrimario: '#0F766E',
};

describe('correo del presupuesto', () => {
  it('asunto con número, trabajo y empresa', () => {
    expect(asuntoPresupuesto(base)).toBe('Presupuesto N° P-0000002 · Actualización general · Elias Nicolas Capasso');
  });

  it('es un mensaje del sistema: solo datos, sin saludos ni primera persona', () => {
    const t = textoPresupuesto(base);
    expect(t).toContain('Cliente: EFE Capital');
    expect(t).toContain('Total con IVA: $ 447.700,00');
    expect(t).toContain('Válido hasta: 12/12/2026');
    expect(t).toContain('CUIT 20-38442199-8');
    expect(t).toContain('Mensaje generado automáticamente por Faktia a pedido de Elias Nicolas Capasso.');
    expect(t).toContain('Las respuestas a este correo le llegan a Elias Nicolas Capasso.');
    for (const relleno of ['Hola', 'Saludos', 'te enviamos', 'Te enviamos', 'respondé']) {
      expect(t).not.toContain(relleno);
      expect(htmlPresupuesto(base)).not.toContain(relleno);
    }
  });

  it('el HTML usa el color de la empresa, escapa los datos y no deja inyectar estilos', () => {
    const html = htmlPresupuesto({ ...base, cliente: '<script>x</script>', colorPrimario: 'red;background:url(x)' });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('url(x)');
    expect(html).toContain('#111827');
    expect(htmlPresupuesto(base)).toContain('border-top:4px solid #0F766E');
  });

  it('sin email de la empresa no dice que las respuestas le llegan', () => {
    const t = textoPresupuesto({ ...base, emisor: { ...base.emisor, email: null, telefono: '343 555 1234' } });
    expect(t).toContain('Tel. 343 555 1234');
    expect(t).not.toContain('Las respuestas');
  });
});
