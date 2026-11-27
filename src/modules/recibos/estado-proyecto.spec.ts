import { seccionesDeEstado, type EstadoProyectoRecibo } from './estado-proyecto';

// Recibo de La Agrícola Regional (Costa Doll) con el anticipo cobrado (doc §7).
const estado: EstadoProyectoRecibo = {
  etiqueta: 'Obra',
  nombre: 'Galpón sucursal Costa Doll',
  ubicacion: 'Costa Doll',
  moneda: 'ARS',
  montoAcordado: '17300000.00',
  modoIva: 'MAS_IVA',
  adicionales: '0.00',
  entregas: [{ fecha: '2026-10-14', descripcion: 'Recibo N° 0001-00000001', importe: '2595000.00', esEsta: true }],
  totalEntregado: '2595000.00',
  saldo: '14705000.00',
  saldoExigible: '1320000.00',
  pendientes: [
    { descripcion: 'Según avance de obra', importe: '13385000.00', vencimiento: null, aCertificar: true },
    { descripcion: 'Al terminar (llenado de 4 columnas)', importe: '1320000.00', vencimiento: null },
  ],
  calculadoEn: '2026-10-14T12:00:00.000Z',
};

describe('estado de la obra en el recibo', () => {
  it('muestra acordado, entregas con fecha, saldo y lo que falta', () => {
    const [obra, entregas, saldo] = seccionesDeEstado(estado);
    expect(obra.titulo).toBe('Obra: Galpón sucursal Costa Doll (Costa Doll)');
    expect(obra.filas[0]).toMatchObject({ texto: 'Monto acordado (más IVA)', importe: '$ 17.300.000,00' });
    expect(entregas.filas[0]).toMatchObject({ texto: 'Recibo N° 0001-00000001 (este recibo)', detalle: '14/10/2026', importe: '$ 2.595.000,00' });
    expect(saldo.filas[0]).toMatchObject({ texto: 'Saldo pendiente', importe: '$ 14.705.000,00', destacado: true });
    expect(saldo.filas[1].texto).toBe('Según avance de obra (a certificar)');
  });
});
