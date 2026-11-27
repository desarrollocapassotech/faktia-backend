import { DocumentoPdf, type EstiloDocumento, type ParteDocumento } from '../../shared/pdf/documento-pdf';

/** Lo que el PDF necesita del listado (la vista del servicio). */
export interface ListadoParaPdf {
  titulo: string;
  fecha: string;
  proyecto: { nombre: string } | null;
  presupuesto: { numero: string } | null;
  proveedor: { nombre: string; telefono: string | null; email: string | null } | null;
  destino: string | null;
  observaciones: string | null;
  precios: 'NINGUNO' | 'COSTO' | 'VENTA';
  renglones: Array<{ cantidad: string; nombre: string; unidad: string; precioCosto: string | null; monedaCosto: 'ARS' | 'USD' | null; precioVenta: string | null; monedaVenta: 'ARS' | 'USD' | null; subtotal: string | null }>;
  totales: Array<{ moneda: 'ARS' | 'USD'; total: string }>;
}

const fechaAr = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const num = (v: string, min = 2, max = 2) => new Intl.NumberFormat('es-AR', { minimumFractionDigits: min, maximumFractionDigits: max }).format(Number(v));
const $ = (v: string, m: 'ARS' | 'USD') => `${m === 'USD' ? 'US$' : '$'} ${num(v)}`;

/** PDF del listado: sin precios (para pedir cotización) o con los de costo o venta, con totales por moneda. */
export async function generarPdfListado(l: ListadoParaPdf, emisor: ParteDocumento, estilo: Omit<EstiloDocumento, 'leyenda'>, etiquetaProyecto: string): Promise<Buffer> {
  const doc = new DocumentoPdf({ ...estilo, leyenda: l.precios === 'NINGUNO' ? undefined : `Precios de ${l.precios === 'COSTO' ? 'costo' : 'venta'}, sujetos a modificación.` }, l.titulo);
  doc.encabezado(emisor, 'MATERIALES', null, [['Fecha', fechaAr(l.fecha)]]);
  doc.subtitulo(l.titulo);
  doc.datos([
    [etiquetaProyecto, l.proyecto?.nombre ?? ''],
    ['Presupuesto', l.presupuesto?.numero ?? ''],
    ['Proveedor', l.proveedor ? [l.proveedor.nombre, l.proveedor.telefono].filter(Boolean).join(' · ') : ''],
    ['Entrega en', l.destino ?? ''],
  ]);
  const conPrecios = l.precios !== 'NINGUNO';
  doc.tabla(
    conPrecios
      ? [
          { titulo: 'Cant.', ancho: 0.1, alinear: 'right', numero: true },
          { titulo: 'Unidad', ancho: 0.12 },
          { titulo: 'Material', ancho: 0.46 },
          { titulo: 'Precio', ancho: 0.15, alinear: 'right', numero: true },
          { titulo: 'Subtotal', ancho: 0.17, alinear: 'right', numero: true },
        ]
      : [
          { titulo: 'Cant.', ancho: 0.12, alinear: 'right', numero: true },
          { titulo: 'Unidad', ancho: 0.16 },
          { titulo: 'Material', ancho: 0.72 },
        ],
    l.renglones.map((r) => {
      const base = [num(r.cantidad, 0, 3), r.unidad, r.nombre];
      if (!conPrecios) return base;
      const precio = l.precios === 'COSTO' ? r.precioCosto : r.precioVenta;
      const moneda = (l.precios === 'COSTO' ? r.monedaCosto : r.monedaVenta) ?? 'ARS';
      return [...base, precio ? $(precio, moneda) : '—', r.subtotal ? $(r.subtotal, moneda) : '—'];
    }),
  );
  if (conPrecios && l.totales.length) doc.totales(l.totales.map((t) => [`Total en ${t.moneda === 'USD' ? 'dólares' : 'pesos'}`, $(t.total, t.moneda)] as [string, string]), true);
  if (l.observaciones) {
    doc.subtitulo('Observaciones');
    doc.lista(l.observaciones.split(/\r?\n/).map((x) => x.trim()).filter(Boolean));
  }
  doc.firma();
  return doc.terminar();
}
