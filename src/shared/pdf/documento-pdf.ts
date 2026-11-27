import PDFDocument from 'pdfkit';
import { COLORES_PDF, dibujarGeneradoCon, FUENTE, registrarFuentes } from './marca-pdf';

/**
 * Layout común de los documentos que no van a ARCA (presupuestos, listados de materiales): encabezado
 * con el logo y los datos de la empresa, título con número y fechas, bloques de datos, tablas (con
 * texto con formato), totales, observaciones, firma y "Generado con faktia" al pie.
 */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 40;
const CW = PAGE_W - M * 2;
const PIE = 28;
const HEX = /^#[0-9a-fA-F]{6}$/;
const NUM = { features: ['tnum'] as PDFKit.Mixins.OpenTypeFeatures[] };

/** Tramo de texto con formato (misma forma que el texto de presupuestos). */
export interface TramoPdf {
  texto: string;
  negrita?: boolean;
  cursiva?: boolean;
  subrayado?: boolean;
  /** Color ya resuelto (#RRGGBB). */
  colorHex?: string;
}
export type ParrafoPdf = TramoPdf[];
export type Celda = string | ParrafoPdf[];

export interface ColumnaPdf {
  titulo: string;
  ancho: number; // fracción del ancho útil (las columnas suman 1)
  alinear?: 'left' | 'right' | 'center';
  numero?: boolean;
}

export interface EstiloDocumento {
  colorPrimario?: string;
  logo?: Buffer | null;
  firmaTexto?: string | null;
  /** Texto chico arriba a la derecha bajo el título (ej. "Documento no válido como factura."). */
  leyenda?: string;
}

export interface ParteDocumento {
  nombre: string;
  lineas: string[];
}

export class DocumentoPdf {
  private readonly doc: PDFKit.PDFDocument;
  private readonly chunks: Buffer[] = [];
  private readonly fin: Promise<Buffer>;
  private readonly primario: string;
  y = M;

  constructor(
    private readonly estilo: EstiloDocumento,
    titulo: string,
  ) {
    this.doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: titulo, Producer: 'Faktia' } });
    registrarFuentes(this.doc);
    this.primario = estilo.colorPrimario && HEX.test(estilo.colorPrimario) ? estilo.colorPrimario : '#111827';
    this.fin = new Promise((resolve, reject) => {
      this.doc.on('data', (b: Buffer) => this.chunks.push(b));
      this.doc.on('end', () => resolve(Buffer.concat(this.chunks)));
      this.doc.on('error', reject);
    });
  }

  private get limite() {
    return PAGE_H - M - PIE;
  }

  private nuevaPagina() {
    this.doc.addPage();
    this.y = M;
  }

  /** Asegura `alto` puntos libres; si no entran, pasa de página. */
  espacio(alto: number) {
    if (this.y + alto > this.limite) this.nuevaPagina();
  }

  /** Logo y datos de la empresa a la izquierda; título, número y fechas a la derecha. */
  encabezado(emisor: ParteDocumento, titulo: string, numero: string | null, datos: Array<[string, string]>) {
    const d = this.doc;
    const y0 = this.y;
    const mitad = M + CW * 0.56;
    let ey = y0;
    if (this.estilo.logo?.length) {
      try {
        d.image(this.estilo.logo, M, ey, { fit: [170, 60] });
        ey += 66;
      } catch {
        // logo ilegible: se omite
      }
    }
    const anchoIzq = mitad - M - 16;
    d.font(FUENTE.seminegrita).fontSize(11).fillColor(this.primario).text(emisor.nombre, M, ey, { width: anchoIzq });
    d.font(FUENTE.normal).fontSize(8).fillColor(COLORES_PDF.grafito);
    for (const l of emisor.lineas) d.text(l, { width: anchoIzq, ...NUM });
    const finIzq = d.y;

    d.font(FUENTE.seminegrita).fontSize(18).fillColor(this.primario).text(titulo, mitad, y0, { width: M + CW - mitad, align: 'right' });
    let ry = d.y + 2;
    if (numero) {
      d.font(FUENTE.seminegrita).fontSize(11).fillColor(COLORES_PDF.grafito).text(`N° ${numero}`, mitad, ry, { width: M + CW - mitad, align: 'right', ...NUM });
      ry = d.y + 2;
    }
    d.font(FUENTE.normal).fontSize(8.5).fillColor(COLORES_PDF.grafito);
    for (const [k, v] of datos) {
      d.text(`${k}: ${v}`, mitad, ry, { width: M + CW - mitad, align: 'right', ...NUM });
      ry = d.y + 1;
    }
    if (this.estilo.leyenda) {
      d.font(FUENTE.normal).fontSize(7).fillColor(COLORES_PDF.grisTexto).text(this.estilo.leyenda, mitad, ry + 3, { width: M + CW - mitad, align: 'right' });
      ry = d.y;
    }
    this.y = Math.max(finIzq, ry) + 12;
    d.moveTo(M, this.y).lineTo(M + CW, this.y).lineWidth(1).stroke(this.primario);
    this.y += 14;
  }

  /** Datos en dos columnas de pares etiqueta / valor (cliente, lugar de la obra…). */
  datos(pares: Array<[string, string]>) {
    const d = this.doc;
    const filas = pares.filter(([, v]) => v);
    for (let i = 0; i < filas.length; i += 2) {
      const par = filas.slice(i, i + 2);
      const alto = Math.max(...par.map(([k, v]) => d.font(FUENTE.normal).fontSize(9).heightOfString(`${k}: ${v}`, { width: CW / 2 - 12 }))) + 4;
      this.espacio(alto);
      par.forEach(([k, v], j) => {
        d.font(FUENTE.seminegrita).fontSize(9).fillColor(COLORES_PDF.grafito).text(`${k}: `, M + j * (CW / 2), this.y, { continued: true, width: CW / 2 - 12 })
          .font(FUENTE.normal).text(v);
      });
      this.y += alto;
    }
    this.y += 8;
  }

  /** Título de sección en el color principal. */
  subtitulo(texto: string) {
    this.espacio(30);
    this.doc.font(FUENTE.seminegrita).fontSize(8).fillColor(this.primario).text(texto.toUpperCase(), M, this.y, { characterSpacing: 0.6 });
    this.y = this.doc.y + 4;
  }

  private altoCelda(c: Celda, ancho: number): number {
    const d = this.doc;
    if (typeof c === 'string') return d.font(FUENTE.normal).fontSize(9).heightOfString(c || ' ', { width: ancho });
    // Con formato: se mide con la seminegrita (la más ancha) para no quedarse corto.
    return c.reduce((s, p) => s + d.font(FUENTE.seminegrita).fontSize(9).heightOfString(p.map((t) => t.texto).join('') || ' ', { width: ancho }) + 2, 0);
  }

  private dibujarParrafos(parrafos: ParrafoPdf[], x: number, y: number, ancho: number) {
    const d = this.doc;
    let yy = y;
    for (const p of parrafos) {
      if (!p.length) {
        yy += 6;
        continue;
      }
      p.forEach((t, i) => {
        const fuente = t.negrita ? FUENTE.seminegrita : t.cursiva ? FUENTE.italica : FUENTE.normal;
        d.font(fuente).fontSize(9).fillColor(t.colorHex ?? COLORES_PDF.grafito);
        const opciones = { width: ancho, continued: i < p.length - 1, underline: Boolean(t.subrayado), lineGap: 1 };
        if (i === 0) d.text(t.texto, x, yy, opciones);
        else d.text(t.texto, opciones);
      });
      yy = d.y + 2;
    }
    d.fillColor(COLORES_PDF.grafito);
  }

  /** Tabla con encabezado en el color principal; repite el encabezado al pasar de página. */
  tabla(columnas: ColumnaPdf[], filas: Celda[][]) {
    const d = this.doc;
    const anchos = columnas.map((c) => c.ancho * CW);
    const cabecera = () => {
      let x = M;
      columnas.forEach((c, i) => {
        d.font(FUENTE.seminegrita).fontSize(7).fillColor(this.primario).text(c.titulo.toUpperCase(), x + 4, this.y + 4, { width: anchos[i] - 8, align: c.alinear ?? 'left', characterSpacing: 0.5 });
        x += anchos[i];
      });
      this.y += 16;
      d.moveTo(M, this.y).lineTo(M + CW, this.y).lineWidth(0.75).stroke(this.primario);
    };
    this.espacio(40);
    cabecera();
    for (const fila of filas) {
      const alto = Math.max(20, ...fila.map((c, i) => this.altoCelda(c, anchos[i] - 8) + 10));
      if (this.y + alto > this.limite) {
        this.nuevaPagina();
        cabecera();
      }
      let x = M;
      fila.forEach((c, i) => {
        const col = columnas[i];
        if (typeof c === 'string') {
          d.font(FUENTE.normal).fontSize(9).fillColor(COLORES_PDF.grafito).text(c, x + 4, this.y + 5, { width: anchos[i] - 8, align: col.alinear ?? 'left', ...(col.numero ? NUM : {}) });
        } else {
          this.dibujarParrafos(c, x + 4, this.y + 5, anchos[i] - 8);
        }
        x += anchos[i];
      });
      this.y += alto;
      d.moveTo(M, this.y).lineTo(M + CW, this.y).lineWidth(0.5).stroke(COLORES_PDF.borde);
    }
    this.y += 8;
  }

  /** Renglones de totales alineados a la derecha; el último destacado (o todos, si son totales por moneda). */
  totales(filas: Array<[string, string]>, todosDestacados = false) {
    const d = this.doc;
    this.espacio(filas.length * 18 + 8);
    filas.forEach(([k, v], i) => {
      const ultimo = todosDestacados || i === filas.length - 1;
      d.font(ultimo ? FUENTE.seminegrita : FUENTE.normal).fontSize(ultimo ? 11 : 9).fillColor(ultimo ? this.primario : COLORES_PDF.grafito);
      d.text(k, M, this.y, { width: CW - 130, align: 'right' });
      d.text(v, M + CW - 125, this.y, { width: 125, align: 'right', ...NUM });
      this.y += ultimo ? 20 : 15;
    });
    this.y += 6;
  }

  /** Lista con viñetas (observaciones). */
  lista(items: string[]) {
    const d = this.doc;
    for (const t of items) {
      const alto = d.font(FUENTE.normal).fontSize(9).heightOfString(t, { width: CW - 14 }) + 4;
      this.espacio(alto);
      d.fillColor(this.primario).text('•', M, this.y, { width: 10 });
      d.fillColor(COLORES_PDF.grafito).text(t, M + 14, this.y, { width: CW - 14 });
      this.y += alto;
    }
    this.y += 6;
  }

  /** Párrafos con formato a todo el ancho (notas). */
  texto(parrafos: ParrafoPdf[]) {
    const alto = this.altoCelda(parrafos, CW);
    this.espacio(alto + 6);
    this.dibujarParrafos(parrafos, M, this.y, CW);
    this.y += alto + 6;
  }

  /** Firma de la plantilla (ej. "ATTE. ALEXIS NAHUEL HERMAN"), a la derecha. */
  firma() {
    const f = this.estilo.firmaTexto?.trim();
    if (!f) return;
    this.espacio(50);
    this.y += 24;
    this.doc.font(FUENTE.seminegrita).fontSize(10).fillColor(COLORES_PDF.grafito).text(f, M + CW - 260, this.y, { width: 260, align: 'right' });
    this.y = this.doc.y + 8;
  }

  /** Cierra el documento: numera las páginas y pone la marca al pie de cada una. */
  async terminar(): Promise<Buffer> {
    const d = this.doc;
    const { start, count } = d.bufferedPageRange();
    for (let i = start; i < start + count; i++) {
      d.switchToPage(i);
      const y = PAGE_H - M + 6;
      dibujarGeneradoCon(d, M + CW, y);
      if (count > 1) d.font(FUENTE.normal).fontSize(7).fillColor(COLORES_PDF.grisTexto).text(`Página ${i - start + 1} de ${count}`, M, y + 2, { lineBreak: false });
    }
    d.end();
    return this.fin;
  }
}
