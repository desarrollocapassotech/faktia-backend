/**
 * Genera los PDF de muestra de docs/muestras con los datos del doc funcional (sin base de datos):
 * presupuestos (La Agrícola Regional, Municipalidad, Diego Streck), recibos (La Agrícola Regional,
 * Wilson Carrillo) y el listado de materiales del galpón.
 *
 *   npx ts-node scripts/muestras-pdf.ts
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { generarPdfPresupuesto, sanearFormato, type PresupuestoParaPdf } from '../src/modules/presupuestos';
import { generarRecibo } from '../src/modules/recibos';
import { seccionesDeEstado, type EstadoProyectoRecibo } from '../src/modules/recibos/estado-proyecto';
import { dibujarGeneradoCon, fuentesPdf } from '../src/shared/pdf/marca-pdf';
import { muestraListado } from './muestras-pdf-materiales';

const DIR = join(__dirname, '..', 'docs', 'muestras');
const COLOR = '#1E3A4C';
const FIRMA = 'ATTE. ALEXIS NAHUEL HERMAN';

export const EMISOR = {
  nombre: 'HERMAN ALEXIS NAHUEL',
  cuit: '20111111112',
  domicilio: 'Calle Falsa 123, General Ramírez, Entre Ríos',
  telefono: '343 400-0000',
  email: 'aleherreria@ejemplo.com',
  ingresosBrutos: '20-11111111-2',
  inicioActividades: '2018-03-01',
  condicionIva: 'RESPONSABLE_INSCRIPTO',
};

const base = {
  emisor: EMISOR,
  alicuotaIva: '21',
  iva: '0',
  superficie: null,
  notas: null,
};

const presupuestos: Array<[string, PresupuestoParaPdf]> = [
  [
    'presupuesto-LAR-superficie.pdf',
    {
      ...base,
      numero: 'P-0000003',
      fecha: '2026-10-01',
      fechaVencimiento: '2026-10-16',
      titulo: 'Galpón sucursal Costa Doll',
      lugar: 'Costa Doll, Entre Ríos',
      moneda: 'ARS',
      formaCotizar: 'SUPERFICIE',
      superficie: { ancho: '20', largo: '45', alturaLateral: '6', alturaCumbrera: '8' },
      ivaModo: 'NO_INCLUYE',
      subtotal: '17300000',
      total: '17300000',
      cliente: { razonSocial: 'La Agrícola Regional Coop. Ltda.', documento: 'CUIT 30-66834690-8', domicilio: 'Crespo, Entre Ríos' },
      items: [
        { cantidad: '8', descripcion: sanearFormato('<b>Columnas</b> de perfil C de chapa plegada, soldadas en cajón, con placa base y cartelas.'), importe: null },
        { cantidad: '4', descripcion: sanearFormato('<b>Vigas reticuladas</b> de 20 m de luz, de hierro redondo y perfil ángulo, según cálculo.'), importe: null },
        { cantidad: '', descripcion: sanearFormato('<b>Correas</b> de perfil C galvanizado, con tensores y arriostramientos.'), importe: null },
        { cantidad: '', descripcion: sanearFormato('<b>Techado</b> con chapa trapezoidal galvanizada calibre 25 y <b>cerramiento lateral</b> hasta 3 m.<br><span style="color:#A3352B">No incluye bases de hormigón.</span>'), importe: null },
        { cantidad: '', descripcion: sanearFormato('<b>Canaletas</b> de chapa galvanizada calibre 24 con bajadas y <b>cenefas</b> prepintadas.'), importe: null },
      ],
      observaciones: [
        { texto: 'Materiales incluidos.' },
        { texto: 'Plazo de obra: {valor}.', valor: '120 días hábiles' },
        { texto: 'Condición de pago: {valor}.', valor: '15% de anticipo, $ 13.385.000 según avance de obra y $ 1.320.000 al terminar (llenado de 4 columnas)' },
        { texto: 'Incluye servicio de {valor}.', valor: 'grúa y autoelevador' },
        { texto: 'El uso de grúa de más de 14 m se cotiza aparte.' },
      ],
    },
  ],
  [
    'presupuesto-Municipalidad-global.pdf',
    {
      ...base,
      numero: 'P-0000002',
      fecha: '2026-11-26',
      fechaVencimiento: '2026-12-11',
      titulo: 'Reparación de techos del corralón',
      lugar: 'Corralón municipal, General Ramírez',
      moneda: 'ARS',
      formaCotizar: 'GLOBAL',
      ivaModo: 'DISCRIMINADO',
      subtotal: '4200000',
      iva: '882000',
      total: '5082000',
      cliente: { razonSocial: 'Municipalidad de General Ramírez', documento: null, domicilio: 'General Ramírez, Entre Ríos' },
      items: [
        { cantidad: '', descripcion: sanearFormato('<b>Desmontaje</b> de chapas dañadas y retiro del material.'), importe: null },
        { cantidad: '320 m²', descripcion: sanearFormato('<b>Techado</b> con chapa trapezoidal galvanizada calibre 25.'), importe: null },
        { cantidad: '60 m', descripcion: sanearFormato('<b>Canaletas</b> de chapa galvanizada con bajadas.'), importe: null },
        { cantidad: '', descripcion: sanearFormato('<i>Pintura</i> de la estructura existente con antióxido.'), importe: null },
      ],
      observaciones: [
        { texto: 'Materiales incluidos.' },
        { texto: 'Plazo de obra: {valor}.', valor: '30 días hábiles' },
        { texto: 'Los trabajos adicionales que surjan en obra se cotizan aparte.' },
      ],
    },
  ],
  [
    'presupuesto-DiegoStreck-por-item.pdf',
    {
      ...base,
      numero: 'P-0000001',
      fecha: '2026-11-26',
      fechaVencimiento: '2026-12-11',
      titulo: 'Portón corredizo y rejas',
      lugar: 'General Ramírez',
      moneda: 'ARS',
      formaCotizar: 'POR_ITEM',
      ivaModo: 'SIN_IVA',
      subtotal: '1850000',
      total: '1850000',
      cliente: { razonSocial: 'Diego Streck', documento: null, domicilio: 'General Ramírez' },
      items: [
        { cantidad: '1', descripcion: sanearFormato('<b>Portón corredizo</b> de 4 m de caño estructural, con revestimiento de chapa, guía inferior y rodamientos.'), importe: '850000' },
        { cantidad: '4', descripcion: sanearFormato('<b>Rejas</b> de hierro macizo para ventanas, con amurado.'), importe: '620000' },
        { cantidad: '1', descripcion: sanearFormato('<b>Pintura</b>: dos manos de antióxido y dos de esmalte sintético <u>negro</u>.'), importe: '380000' },
      ],
      observaciones: [
        { texto: 'Materiales incluidos.' },
        { texto: 'Plazo de obra: {valor}.', valor: '20 días hábiles' },
        { texto: 'Condición de pago: {valor}.', valor: '50% de anticipo y 50% al terminar' },
      ],
    },
  ],
];

const parteTenant = {
  nombre: EMISOR.nombre,
  documento: 'CUIT 20-11111111-2',
  domicilio: EMISOR.domicilio,
  detalle: ['Tel. 343 400-0000', 'aleherreria@ejemplo.com', 'Ingresos Brutos: 20-11111111-2', 'Inicio de actividades: 01/03/2018', 'IVA Responsable Inscripto'],
};

const estadoLar: EstadoProyectoRecibo = {
  etiqueta: 'Obra',
  nombre: 'Galpón sucursal Costa Doll',
  ubicacion: 'Costa Doll, Entre Ríos',
  moneda: 'ARS',
  montoAcordado: '17300000.00',
  modoIva: 'MAS_IVA',
  adicionales: '0.00',
  entregas: [{ fecha: '2026-10-14', descripcion: 'Recibo N° 0001-00000001', importe: '2595000.00', esEsta: true }],
  totalEntregado: '2595000.00',
  saldo: '14705000.00',
  saldoExigible: '1320000.00',
  pendientes: [
    { descripcion: 'Facturación según avance de obra', importe: '13385000.00', vencimiento: null, aCertificar: true },
    { descripcion: 'Saldo al terminar (llenado de 4 columnas)', importe: '1320000.00', vencimiento: null },
  ],
  calculadoEn: '2026-10-14T12:00:00.000Z',
};

const estadoWilson: EstadoProyectoRecibo = {
  etiqueta: 'Obra',
  nombre: 'Tinglado casa',
  ubicacion: null,
  moneda: 'USD',
  montoAcordado: '12000.00',
  modoIva: 'ACORDADO_FINAL',
  adicionales: '0.00',
  entregas: [
    { fecha: '2024-03-10', descripcion: 'Entrega sin recibo', importe: '4000.00' },
    { fecha: '2024-06-02', descripcion: 'Entrega sin recibo', importe: '2000.00' },
    { fecha: '2026-11-20', descripcion: 'Recibo N° 0001-00000002', importe: '2000.00', esEsta: true },
  ],
  totalEntregado: '8000.00',
  saldo: '4000.00',
  saldoExigible: '4000.00',
  pendientes: [{ descripcion: 'Saldo al terminar', importe: '4000.00', vencimiento: null }],
  calculadoEn: '2026-11-20T12:00:00.000Z',
};

async function main() {
  mkdirSync(DIR, { recursive: true });
  for (const [archivo, p] of presupuestos) {
    writeFileSync(join(DIR, archivo), await generarPdfPresupuesto(p, { colorPrimario: COLOR, firmaTexto: FIRMA }, 'Obra'));
  }
  const fuentes = fuentesPdf();
  const estilo = { colorPrimario: COLOR, lineaFirma: false, fuentes: { normal: fuentes.normal, seminegrita: fuentes.seminegrita, italica: fuentes.italica }, marcaPie: dibujarGeneradoCon, firmaTexto: FIRMA };
  const lar = await generarRecibo(
    {
      tipo: 'COBRO',
      numero: '0001-00000001',
      fecha: '2026-10-14',
      moneda: 'ARS',
      emisor: parteTenant,
      pagador: { nombre: 'La Agrícola Regional Coop. Ltda.', documento: 'CUIT 30-66834690-8', domicilio: 'Crespo, Entre Ríos' },
      items: [{ descripcion: 'Anticipo de obra Galpón sucursal Costa Doll', importe: '2595000' }],
      total: '2595000',
      medioPago: 'Transferencia',
      secciones: seccionesDeEstado(estadoLar),
    },
    estilo,
  );
  writeFileSync(join(DIR, 'recibo-LAR-anticipo.pdf'), lar.pdf);
  const wilson = await generarRecibo(
    {
      tipo: 'COBRO',
      numero: '0001-00000002',
      fecha: '2026-11-20',
      moneda: 'ARS',
      emisor: parteTenant,
      pagador: { nombre: 'Wilson Carrillo' },
      items: [{ descripcion: 'Entrega a cuenta de obra Tinglado casa', importe: '2900000' }],
      total: '2900000',
      medioPago: 'Transferencia',
      datosExtra: [['Equivalencia', 'US$ 2.000,00 al tipo de cambio $ 1.450,00 por dólar']],
      secciones: seccionesDeEstado(estadoWilson),
    },
    estilo,
  );
  writeFileSync(join(DIR, 'recibo-WilsonCarrillo-USD.pdf'), wilson.pdf);
  await muestraListado(DIR, { colorPrimario: COLOR, firmaTexto: FIRMA });
  console.log(`Muestras en ${DIR}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
