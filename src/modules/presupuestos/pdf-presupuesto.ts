import { DocumentoPdf, type EstiloDocumento, type ParrafoPdf } from '../../shared/pdf/documento-pdf';
import { COLORES, parsearFormato } from './domain/formato';
import { metrosCuadrados, type Superficie } from './domain/presupuesto';

/** Lo que el PDF necesita de un presupuesto (la vista del servicio). */
export interface PresupuestoParaPdf {
  numero: string;
  fecha: string;
  fechaVencimiento: string;
  titulo: string | null;
  lugar: string | null;
  moneda: 'ARS' | 'USD';
  formaCotizar: 'POR_ITEM' | 'GLOBAL' | 'SUPERFICIE';
  superficie: Superficie | null;
  ivaModo: 'SIN_IVA' | 'NO_INCLUYE' | 'DISCRIMINADO';
  alicuotaIva: string;
  subtotal: string;
  iva: string;
  total: string;
  observaciones: Array<{ texto: string; valor?: string }>;
  notas: string | null;
  cliente: { razonSocial: string; documento: string | null; domicilio: string | null };
  emisor: {
    nombre: string;
    cuit: string | null;
    domicilio: string | null;
    telefono: string | null;
    email: string | null;
    ingresosBrutos: string | null;
    inicioActividades: string | null;
    condicionIva: string | null;
  };
  items: Array<{ cantidad: string | null; descripcion: string; importe: string | null }>;
}

const CONDICION_IVA: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: 'IVA Responsable Inscripto',
  EXENTO: 'IVA Exento',
  MONOTRIBUTO: 'Responsable Monotributo',
};

const fechaAr = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const numero = (v: string, decimales = 2) => new Intl.NumberFormat('es-AR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(Number(v));
const cuit = (c: string) => (/^\d{11}$/.test(c) ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c);

/** Texto con formato del presupuesto → párrafos para el PDF (colores de la paleta). */
export function aParrafosPdf(html: string): ParrafoPdf[] {
  return parsearFormato(html).map((p) => p.map((t) => ({ texto: t.texto, negrita: t.negrita, cursiva: t.cursiva, subrayado: t.subrayado, colorHex: t.color ? COLORES[t.color] : undefined })));
}

/** Observación del catálogo con su valor: "Plazo de obra: {valor}." + "120 días hábiles". */
export function textoObservacion(o: { texto: string; valor?: string }): string {
  if (o.texto.includes('{valor}')) return o.texto.replace('{valor}', o.valor?.trim() || '…');
  return o.valor ? `${o.texto} ${o.valor}` : o.texto;
}

export async function generarPdfPresupuesto(p: PresupuestoParaPdf, estilo: Omit<EstiloDocumento, 'leyenda'>, etiquetaProyecto: string): Promise<Buffer> {
  const $ = (v: string) => `${p.moneda === 'USD' ? 'US$' : '$'} ${numero(v)}`;
  const doc = new DocumentoPdf({ ...estilo, leyenda: 'Presupuesto. No válido como factura.' }, `Presupuesto ${p.numero}`);
  const e = p.emisor;
  doc.encabezado(
    {
      nombre: e.nombre,
      lineas: [
        e.cuit ? `CUIT ${cuit(e.cuit)}` : '',
        e.domicilio ?? '',
        e.telefono ? `Tel. ${e.telefono}` : '',
        e.email ?? '',
        e.ingresosBrutos ? `Ingresos Brutos: ${e.ingresosBrutos}` : '',
        e.inicioActividades ? `Inicio de actividades: ${fechaAr(e.inicioActividades)}` : '',
        e.condicionIva ? (CONDICION_IVA[e.condicionIva] ?? '') : '',
      ].filter(Boolean),
    },
    'PRESUPUESTO',
    p.numero,
    [
      ['Fecha', fechaAr(p.fecha)],
      ['Válido hasta', fechaAr(p.fechaVencimiento)],
    ],
  );
  doc.datos([
    ['Cliente', p.cliente.razonSocial],
    ['Documento', p.cliente.documento ?? ''],
    ['Domicilio', p.cliente.domicilio ?? ''],
    [etiquetaProyecto, [p.titulo, p.lugar].filter(Boolean).join(' · ')],
  ]);

  const porItem = p.formaCotizar === 'POR_ITEM';
  if (p.items.length) {
    doc.tabla(
      porItem
        ? [
            { titulo: 'Cant.', ancho: 0.1, alinear: 'center', numero: true },
            { titulo: 'Descripción', ancho: 0.68 },
            { titulo: 'Importe', ancho: 0.22, alinear: 'right', numero: true },
          ]
        : [
            { titulo: 'Cant.', ancho: 0.1, alinear: 'center', numero: true },
            { titulo: 'Descripción', ancho: 0.9 },
          ],
      p.items.map((i) => (porItem ? [i.cantidad ?? '', aParrafosPdf(i.descripcion), i.importe ? $(i.importe) : ''] : [i.cantidad ?? '', aParrafosPdf(i.descripcion)])),
    );
  }

  if (p.formaCotizar === 'SUPERFICIE' && p.superficie) {
    const s = p.superficie;
    const m2 = metrosCuadrados(s);
    doc.subtitulo('Superficie');
    doc.datos([
      ['Ancho', s.ancho ? `${numero(s.ancho)} m` : ''],
      ['Largo', s.largo ? `${numero(s.largo)} m` : ''],
      ['Altura lateral', s.alturaLateral ? `${numero(s.alturaLateral)} m` : ''],
      ['Altura en cumbrera', s.alturaCumbrera ? `${numero(s.alturaCumbrera)} m` : ''],
      ['Metros cuadrados a cubrir', m2 ? `${numero(m2.toString())} m²` : ''],
      ['Precio por m²', s.precioMetroCuadrado ? $(s.precioMetroCuadrado) : ''],
    ]);
  }

  const filas: Array<[string, string]> = [];
  if (p.ivaModo === 'DISCRIMINADO') {
    filas.push(['Subtotal', $(p.subtotal)], [`IVA ${numero(p.alicuotaIva, p.alicuotaIva.includes('.') ? 1 : 0)}%`, $(p.iva)], ['Total con IVA', $(p.total)]);
  } else {
    filas.push([p.ivaModo === 'NO_INCLUYE' ? 'Total (no incluye IVA)' : 'Total', $(p.total)]);
  }
  doc.totales(filas);

  if (p.notas) doc.texto(aParrafosPdf(p.notas));
  const observaciones = [...(p.ivaModo === 'NO_INCLUYE' ? ['Los precios no incluyen IVA.'] : []), ...p.observaciones.map(textoObservacion)];
  if (observaciones.length) {
    doc.subtitulo('Observaciones');
    doc.lista(observaciones);
  }
  doc.firma();
  return doc.terminar();
}
