import { armarContenido } from './contenido';
import { ReciboInvalidoError, type ReciboCobro, type ReciboPago } from './recibo.types';

const cobro: ReciboCobro = {
  tipo: 'COBRO',
  numero: '0001-00000012',
  fecha: '2026-09-28',
  moneda: 'ARS',
  emisor: { nombre: 'Empresa Demo SA', documento: 'CUIT 30-71234567-1', domicilio: 'Av. Siempre Viva 123' },
  pagador: { nombre: 'Cliente SRL', documento: 'CUIT 30-70000000-7' },
  items: [
    { descripcion: 'Pago Factura A 00001-00000045', importe: '100000' },
    { descripcion: 'Intereses', importe: '1500.50' },
  ],
  total: '101500.50',
  medioPago: 'Transferencia',
  comprobantesAplicados: [{ descripcion: 'Factura A 00001-00000045 del 01/09/2026', importe: '121000' }],
};

const pago: ReciboPago = {
  tipo: 'PAGO',
  numero: '15',
  fecha: '2026-09-30',
  moneda: 'USD',
  pagador: { nombre: 'Empresa Demo SA', documento: 'CUIT 30-71234567-1' },
  beneficiario: { nombre: 'Ana Pérez', documento: 'DNI 30.123.456' },
  items: [{ descripcion: 'Desarrollo', cantidad: '80 hs', importe: '2400' }],
  total: '2400',
  periodo: 'Septiembre 2026',
};

describe('armarContenido', () => {
  it('COBRO: título, texto, firma del emisor, comprobantes y nombre de archivo', () => {
    const c = armarContenido(cobro);
    expect(c.titulo).toBe('RECIBO DE COBRO');
    expect(c.encabezado.nombre).toBe('Empresa Demo SA');
    expect(c.fecha).toBe('28/09/2026');
    expect(c.cuerpo).toBe(
      'Recibí de Cliente SRL (CUIT 30-70000000-7) la suma de PESOS CIENTO UN MIL QUINIENTOS CON CINCUENTA CENTAVOS ($ 101.500,50) ' +
        'en concepto de Pago Factura A 00001-00000045; Intereses.',
    );
    expect(c.total).toBe('$ 101.500,50');
    expect(c.firma).toEqual({ etiqueta: 'Firma y aclaración de quien recibe el pago', nombre: 'Empresa Demo SA', documento: 'CUIT 30-71234567-1' });
    expect(c.comprobantesAplicados).toEqual([{ descripcion: 'Factura A 00001-00000045 del 01/09/2026', importe: '$ 121.000,00' }]);
    expect(c.datosExtra).toEqual([['Medio de pago', 'Transferencia']]);
    expect(c.filename).toBe('Recibo-Cobro_0001-00000012_Cliente-SRL.pdf');
  });

  it('PAGO: encabeza quien paga, firma el beneficiario, período en el texto', () => {
    const c = armarContenido(pago);
    expect(c.titulo).toBe('RECIBO DE PAGO');
    expect(c.encabezado.nombre).toBe('Empresa Demo SA');
    expect(c.cuerpo).toBe(
      'Recibí de Empresa Demo SA (CUIT 30-71234567-1) la suma de DÓLARES ESTADOUNIDENSES DOS MIL CUATROCIENTOS ' +
        '(US$ 2.400,00) en concepto de Desarrollo, correspondiente a Septiembre 2026.',
    );
    expect(c.firma).toEqual({ etiqueta: 'Firma y aclaración del beneficiario', nombre: 'Ana Pérez', documento: 'DNI 30.123.456' });
    expect(c.items).toEqual([{ descripcion: 'Desarrollo', cantidad: '80 hs', importe: 'US$ 2.400,00' }]);
    expect(c.datosExtra).toEqual([]); // el período ya está en el texto
    expect(c.comprobantesAplicados).toEqual([]);
    expect(c.filename).toBe('Recibo-Pago_15_Ana-Perez.pdf');
  });

  it('sin número, el archivo lleva la fecha', () => {
    expect(armarContenido({ ...pago, numero: '  ' }).filename).toBe('Recibo-Pago_2026-09-30_Ana-Perez.pdf');
    expect(armarContenido({ ...pago, numero: undefined }).numero).toBeNull();
  });

  it.each([
    ['total distinto de la suma', { total: '2399.99' }, /no coincide con la suma/],
    ['sin conceptos', { items: [] }, /al menos un concepto/],
    ['concepto sin descripción', { items: [{ descripcion: ' ', importe: '1' }], total: '1' }, /Concepto 1: falta la descripción/],
    ['importe con coma', { items: [{ descripcion: 'x', importe: '1,5' }], total: '1.5' }, /Concepto 1: el importe/],
    ['total cero', { items: [{ descripcion: 'x', importe: '0' }], total: '0' }, /mayor a 0/],
    ['fecha inexistente', { fecha: '2026-02-30' }, /fecha válida/],
    ['fecha con otro formato', { fecha: '30/09/2026' }, /fecha válida/],
    ['beneficiario sin nombre', { beneficiario: { nombre: '' } }, /quien cobra/],
  ])('rechaza: %s', (_caso, cambio, mensaje) => {
    expect(() => armarContenido({ ...pago, ...cambio } as ReciboPago)).toThrow(ReciboInvalidoError);
    expect(() => armarContenido({ ...pago, ...cambio } as ReciboPago)).toThrow(mensaje);
  });

  it('rechaza tipo desconocido', () => {
    expect(() => armarContenido({ ...pago, tipo: 'OTRO' } as unknown as ReciboPago)).toThrow(/COBRO o PAGO/);
  });
});

describe('secciones y datos extra (estado de una obra)', () => {
  it('pasan al contenido limpias; las vacías se descartan', () => {
    const c = armarContenido({
      ...cobro,
      emisor: { ...cobro.emisor, detalle: ['Tel. 343 412-3456', '  ', 'IVA Responsable Inscripto'] },
      datosExtra: [['Equivalencia', 'US$ 1.000,00'], ['', 'sin clave']],
      secciones: [
        { titulo: 'Entregas', filas: [{ texto: 'Anticipo', detalle: '14/10/2026', importe: '$ 2.595.000,00' }] },
        { titulo: 'Vacía', filas: [] },
      ],
    });
    expect(c.encabezado.detalle).toEqual(['Tel. 343 412-3456', 'IVA Responsable Inscripto']);
    expect(c.datosExtra).toEqual([['Medio de pago', 'Transferencia'], ['Equivalencia', 'US$ 1.000,00']]);
    expect(c.secciones).toEqual([{ titulo: 'Entregas', filas: [{ texto: 'Anticipo', detalle: '14/10/2026', importe: '$ 2.595.000,00', destacado: false }] }]);
  });
});
