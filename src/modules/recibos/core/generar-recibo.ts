import PDFDocument from 'pdfkit';
import { armarContenido, type ContenidoRecibo } from './contenido';
import type { ReciboEstilo, ReciboInput, ReciboOutput } from './recibo.types';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 36;
const CW = PAGE_W - M * 2;
const FIRMA_ALTO = 90;
const QR_LADO = 64;
const PIE_ALTO = 24;
const HEX = /^#[0-9a-fA-F]{6}$/;
const LINEA = 0.75;
const NUM = { features: ['tnum'] as PDFKit.Mixins.OpenTypeFeatures[] }; // importes con cifras tabulares

// Neutros: texto, texto secundario y divisores finos.
const TEXTO = '#1B262D';
const TEXTO_SECUNDARIO = '#4A5258';
const BORDE = '#E4E2DA';

interface Colores {
  primario: string;
  secundario: string;
}

interface Fuentes {
  normal: string;
  seminegrita: string;
  italica: string;
}

/**
 * Genera el PDF de un recibo de cobro o de pago. Valida los datos (lanza ReciboInvalidoError)
 * y dibuja con el logo y los colores del estilo. No es un comprobante electrónico de ARCA.
 */
export async function generarRecibo(input: ReciboInput, estilo: ReciboEstilo = {}): Promise<ReciboOutput> {
  const c = armarContenido(input);
  const colores: Colores = {
    primario: estilo.colorPrimario && HEX.test(estilo.colorPrimario) ? estilo.colorPrimario : '#111827',
    secundario: estilo.colorSecundario && HEX.test(estilo.colorSecundario) ? estilo.colorSecundario : '#6B7280',
  };

  const pdf = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      info: { Title: c.numero ? `${c.titulo} N° ${c.numero}` : c.titulo, Producer: 'Faktia' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (b: Buffer) => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      dibujar(doc, c, estilo, colores, registrarFuentes(doc, estilo));
      doc.end();
    } catch (e) {
      reject(e);
    }
  });

  return { pdf, filename: c.filename };
}

function registrarFuentes(doc: PDFKit.PDFDocument, estilo: ReciboEstilo): Fuentes {
  const f: Fuentes = { normal: 'Helvetica', seminegrita: 'Helvetica-Bold', italica: 'Helvetica-Oblique' };
  for (const k of ['normal', 'seminegrita', 'italica'] as const) {
    const archivo = estilo.fuentes?.[k];
    if (archivo?.length) {
      doc.registerFont(`recibo-${k}`, Buffer.from(archivo));
      f[k] = `recibo-${k}`;
    }
  }
  return f;
}

function dibujar(doc: PDFKit.PDFDocument, c: ContenidoRecibo, estilo: ReciboEstilo, col: Colores, f: Fuentes) {
  const limite = PAGE_H - M - PIE_ALTO;
  const pie = (ultima: boolean) => {
    const y = PAGE_H - M - 12;
    const anchoMarca = ultima && estilo.marcaPie ? estilo.marcaPie(doc, M + CW, y) : 0;
    if (estilo.textoPie) {
      doc.fontSize(7).font(f.normal).fillColor(col.secundario)
        .text(estilo.textoPie, M, y + 1, { width: CW - (anchoMarca ? anchoMarca + 16 : 0), lineBreak: false, ellipsis: true });
    }
  };
  const nuevaPagina = () => {
    pie(false);
    doc.addPage();
    return M;
  };

  let y = encabezado(doc, c, estilo, col, f);

  // Cuerpo
  doc.fontSize(10).font(f.normal).fillColor(TEXTO);
  doc.text(c.cuerpo, M, y, { width: CW, align: 'justify', lineGap: 2 });
  y = doc.y + 16;

  // Conceptos
  const cols = [
    { t: 'Concepto', w: CW - 190, a: 'left' as const },
    { t: 'Cantidad', w: 80, a: 'right' as const },
    { t: 'Importe', w: 110, a: 'right' as const },
  ];
  // Encabezado de tabla: etiquetas chicas en mayúsculas y una línea en el color principal.
  const cabecera = (yy: number, titulos = cols) => {
    let x = M;
    for (const k of titulos) {
      doc.fontSize(7).font(f.seminegrita).fillColor(col.primario)
        .text(k.t.toUpperCase(), x + 4, yy + 5, { width: k.w - 8, align: k.a, characterSpacing: 0.5 });
      x += k.w;
    }
    doc.moveTo(M, yy + 18).lineTo(M + CW, yy + 18).lineWidth(LINEA).stroke(col.primario);
    return yy + 18;
  };
  const fila = (yy: number, celdas: string[], anchos = cols) => {
    doc.fontSize(8.5).font(f.normal);
    const alto = Math.max(20, ...celdas.map((v, i) => doc.heightOfString(v, { width: anchos[i].w - 8 }) + 10));
    if (yy + alto > limite) yy = cabecera(nuevaPagina(), anchos);
    let x = M;
    celdas.forEach((v, i) => {
      doc.fillColor(TEXTO).text(v, x + 4, yy + 5, { width: anchos[i].w - 8, align: anchos[i].a, ...(i > 0 ? NUM : {}) });
      x += anchos[i].w;
    });
    doc.moveTo(M, yy + alto).lineTo(M + CW, yy + alto).lineWidth(0.5).stroke(BORDE);
    return yy + alto;
  };

  y = cabecera(y);
  for (const it of c.items) y = fila(y, [it.descripcion, it.cantidad, it.importe]);
  if (y + 22 > limite) y = nuevaPagina();
  doc.fontSize(10).font(f.seminegrita).fillColor(col.primario)
    .text('Total', M + 4, y + 7, { width: CW - 118, align: 'right' })
    .text(c.total, M + CW - 110, y + 7, { width: 106, align: 'right', ...NUM });
  y += 28;

  // Comprobantes que cancela (solo cobro)
  if (c.comprobantesAplicados.length) {
    const colsAplic = [
      { t: 'Comprobantes que cancela', w: CW - 110, a: 'left' as const },
      { t: 'Importe', w: 110, a: 'right' as const },
    ];
    if (y + 40 > limite) y = nuevaPagina();
    y = cabecera(y + 6, colsAplic);
    for (const a of c.comprobantesAplicados) y = fila(y, [a.descripcion, a.importe], colsAplic);
    y += 10;
  }

  // Período, medio de pago, observaciones
  for (const [k, v] of c.datosExtra) {
    if (y + 14 > limite) y = nuevaPagina();
    doc.fontSize(9).font(f.seminegrita).fillColor(TEXTO).text(`${k}: `, M, y, { continued: true }).font(f.normal).text(v, { width: CW });
    y = doc.y + 4;
  }
  if (c.observaciones) {
    doc.fontSize(8.5).font(f.italica).fillColor(TEXTO_SECUNDARIO);
    const alto = doc.heightOfString(c.observaciones, { width: CW });
    if (y + alto + 6 > limite) y = nuevaPagina();
    doc.text(c.observaciones, M, y + 4, { width: CW });
    y = doc.y + 4;
  }

  // Firma: al pie de la página (o en una nueva si no entra). Sin línea, solo nombre y documento.
  if (y + FIRMA_ALTO > limite) y = nuevaPagina();
  const fy = Math.max(y + 30, limite - FIRMA_ALTO + 30);
  const fx = M + CW - 220;
  if (estilo.lineaFirma !== false) {
    doc.moveTo(fx, fy).lineTo(fx + 220, fy).lineWidth(LINEA).stroke(TEXTO);
    doc.fontSize(8).font(f.normal).fillColor(TEXTO_SECUNDARIO).text(c.firma.etiqueta, fx, fy + 4, { width: 220, align: 'center' });
  }
  doc.fontSize(9).font(f.seminegrita).fillColor(TEXTO).text(c.firma.nombre, fx, fy + 16, { width: 220, align: 'center' });
  if (c.firma.documento) {
    doc.fontSize(8).font(f.normal).fillColor(TEXTO_SECUNDARIO).text(c.firma.documento, fx, doc.y + 1, { width: 220, align: 'center', ...NUM });
  }

  // QR a la izquierda de la firma, con su leyenda al lado.
  if (estilo.qr?.imagen.length) {
    const lado = QR_LADO;
    const qy = fy - 8;
    try {
      doc.image(Buffer.from(estilo.qr.imagen), M, qy, { width: lado, height: lado });
      doc.fontSize(7.5).font(f.normal).fillColor(TEXTO_SECUNDARIO)
        .text(estilo.qr.leyenda, M + lado + 8, qy + 6, { width: fx - (M + lado + 8) - 24, lineGap: 1 });
    } catch {
      // QR ilegible: se omite
    }
  }
  pie(true);
}

function encabezado(doc: PDFKit.PDFDocument, c: ContenidoRecibo, estilo: ReciboEstilo, col: Colores, f: Fuentes): number {
  const y = M;
  const mitad = M + CW * 0.55;

  // Quien encabeza (el tenant): logo y datos.
  let ey = y + 10;
  if (estilo.logo?.length) {
    try {
      doc.image(Buffer.from(estilo.logo), M + 10, ey, { fit: [180, 64] });
      ey += 70;
    } catch {
      // logo ilegible: se omite
    }
  }
  const anchoIzq = mitad - M - 20;
  doc.fontSize(11).font(f.seminegrita).fillColor(col.primario).text(c.encabezado.nombre, M + 10, ey, { width: anchoIzq });
  doc.fontSize(8).font(f.normal).fillColor(TEXTO);
  if (c.encabezado.documento) doc.text(c.encabezado.documento, { width: anchoIzq, ...NUM });
  if (c.encabezado.domicilio) doc.text(c.encabezado.domicilio, { width: anchoIzq });

  // El recuadro crece con el logo y los datos (como mínimo, lo que ocupa la columna del título).
  const alto = Math.max(96, doc.y - y + 10);
  doc.rect(M, y, CW, alto).lineWidth(LINEA).stroke(BORDE);

  // Título, número y fecha.
  doc.moveTo(mitad, y).lineTo(mitad, y + alto).lineWidth(LINEA).stroke(BORDE);
  const xr = mitad + 12;
  const wr = M + CW - xr - 10;
  doc.fontSize(15).font(f.seminegrita).fillColor(col.primario).text(c.titulo, xr, y + 12, { width: wr });
  doc.fontSize(9).font(f.seminegrita).fillColor(TEXTO);
  if (c.numero) doc.text(`N° ${c.numero}`, xr, y + 36, { width: wr, ...NUM });
  doc.font(f.normal).text(`Fecha: ${c.fecha}`, xr, y + 50, { width: wr, ...NUM });
  doc.fontSize(7).fillColor(TEXTO_SECUNDARIO).text('Documento no válido como factura.', xr, y + 76, { width: wr });

  return y + alto + 18;
}
