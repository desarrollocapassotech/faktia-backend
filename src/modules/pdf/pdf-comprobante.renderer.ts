import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { COLORES_PDF as C, dibujarGeneradoCon, FUENTE, registrarFuentes } from '../../shared/pdf/marca-pdf';
import { importeEnLetras } from './numero-a-letras';
import type { ComprobantePdfData, EstiloPdf } from './pdf.types';

// Layout adaptado de Vialto (liquidaciones-arca/factura-pdf.service.ts), sin viajes ni Prisma:
// recibe los datos ya armados y devuelve el PDF. Estilo: Familjen Grotesk, texto grafito,
// divisores finos y el color principal de la plantilla del tenant en títulos y letra.

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 28;
const CW = PAGE_W - M * 2;
const PIE_ALTO = 150; // espacio reservado al pie en la última página
const LINEA = 0.75;
const NUM = { features: ['tnum'] as PDFKit.Mixins.OpenTypeFeatures[] }; // importes con cifras tabulares

function fmt(n: string | number): string {
  return Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtCantidad(n: string): string {
  return Number(n).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

const UNIDAD: Record<string, string> = { HORA: 'hs', UNIDAD: 'u.', SERVICIO: 'serv.', MES: 'mes' };

/** Marca de agua de homologación (copiada de Vialto: pdf-homologacion-watermark.ts). */
function marcaDeAgua(doc: PDFKit.PDFDocument) {
  doc.save();
  doc.opacity(0.14).fillColor('#A3352B').font(FUENTE.negrita);
  doc.translate(PAGE_W / 2, PAGE_H / 2).rotate(-42);
  const banda = Math.sqrt(PAGE_W * PAGE_W + PAGE_H * PAGE_H);
  doc.fontSize(28).text('COMPROBANTE DE PRUEBA', -banda / 2, -28, { width: banda, align: 'center', lineBreak: false });
  doc.fontSize(22).text('SIN VALIDEZ FISCAL', -banda / 2, 8, { width: banda, align: 'center', lineBreak: false });
  doc.restore();
}

@Injectable()
export class PdfComprobanteRenderer {
  async render(d: ComprobantePdfData, estilo: EstiloPdf): Promise<Buffer> {
    const qr = await QRCode.toBuffer(d.cae.qrUrl, { width: 160, margin: 1 });
    const copias = estilo.mostrarDuplicado ? ['ORIGINAL', 'DUPLICADO'] : ['ORIGINAL'];

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `${d.titulo} ${d.letra}`, Producer: 'Faktia' } });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      try {
        registrarFuentes(doc);
        copias.forEach((copia, i) => {
          if (i > 0) doc.addPage();
          this.dibujarCopia(doc, d, estilo, copia, qr);
        });
        doc.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  private dibujarCopia(doc: PDFKit.PDFDocument, d: ComprobantePdfData, e: EstiloPdf, copia: string, qr: Buffer) {
    let y = this.encabezado(doc, d, e, copia);
    y = this.receptor(doc, d, y);

    const discrimina = d.letra === 'A';
    // La bonificación solo se muestra si alguna línea la tiene (casi nunca): su ancho va a la descripción.
    const conBonif = d.lineas.some((l) => Number(l.bonificacionPct) !== 0);
    const bonif = conBonif ? 40 : 0;
    const cols = (
      discrimina
        ? [
            { t: 'Descripción', w: 245 - bonif, a: 'left' as const },
            { t: 'Cantidad', w: 58, a: 'right' as const },
            { t: 'Precio unit.', w: 70, a: 'right' as const },
            ...(conBonif ? [{ t: '% Bonif.', w: bonif, a: 'right' as const, bonif: true }] : []),
            { t: 'Subtotal', w: 70, a: 'right' as const },
            { t: 'IVA %', w: 36, a: 'right' as const },
            { t: 'Subtotal c/IVA', w: CW - 479, a: 'right' as const },
          ]
        : [
            { t: 'Descripción', w: 305 - bonif, a: 'left' as const },
            { t: 'Cantidad', w: 64, a: 'right' as const },
            { t: 'Precio unit.', w: 80, a: 'right' as const },
            ...(conBonif ? [{ t: '% Bonif.', w: bonif, a: 'right' as const, bonif: true }] : []),
            { t: 'Subtotal', w: CW - 449, a: 'right' as const },
          ]
    ) as Array<{ t: string; w: number; a: 'left' | 'right'; bonif?: boolean }>;

    // Encabezado de la tabla: etiquetas chicas en mayúsculas y una línea en el color principal.
    const encabezadoTabla = (yy: number) => {
      let x = M;
      for (const c of cols) {
        doc.fontSize(6.5).font(FUENTE.negrita).fillColor(e.colorPrimario)
          .text(c.t.toUpperCase(), x + 3, yy + 5, { width: c.w - 6, align: c.a, characterSpacing: 0.5 });
        x += c.w;
      }
      doc.moveTo(M, yy + 16).lineTo(M + CW, yy + 16).lineWidth(LINEA).stroke(e.colorPrimario);
      return yy + 16;
    };

    y = encabezadoTabla(y);
    for (const l of d.lineas) {
      // En B el precio y subtotal se muestran con IVA incluido (el IVA no se discrimina).
      const conIva = d.letra === 'B';
      const unitario = conIva
        ? Number(l.precioUnitario) * (1 + Number(l.alicuotaIva) / 100)
        : Number(l.precioUnitario);
      const todas = discrimina
        ? [l.descripcion, `${fmtCantidad(l.cantidad)} ${UNIDAD[l.unidad] ?? ''}`, fmt(l.precioUnitario), fmt(l.bonificacionPct), fmt(l.importeNeto), fmt(l.alicuotaIva), fmt(l.importeTotal)]
        : [l.descripcion, `${fmtCantidad(l.cantidad)} ${UNIDAD[l.unidad] ?? ''}`, fmt(unitario), fmt(l.bonificacionPct), fmt(conIva ? l.importeTotal : l.importeNeto)];
      // Sin la columna de bonificación se saca su celda (es la cuarta en los dos formatos).
      const celdas = conBonif ? todas : todas.filter((_, i) => i !== 3);

      doc.fontSize(7.5).font(FUENTE.normal);
      const alto = Math.max(18, ...celdas.map((v, i) => doc.heightOfString(v, { width: cols[i].w - 6 }) + 9));
      if (y + alto > PAGE_H - M - PIE_ALTO) {
        doc.addPage();
        y = encabezadoTabla(M);
      }
      let x = M;
      celdas.forEach((v, i) => {
        doc.fillColor(C.grafito).text(v, x + 3, y + 5, { width: cols[i].w - 6, align: cols[i].a, ...(i > 0 ? NUM : {}) });
        x += cols[i].w;
      });
      doc.moveTo(M, y + alto).lineTo(M + CW, y + alto).lineWidth(0.5).stroke(C.borde);
      y += alto;
    }

    if (d.asociado) {
      y += 8;
      doc.fontSize(8).font(FUENTE.seminegrita).fillColor(C.grafito).text('Comprobante asociado: ', M, y, { continued: true })
        .font(FUENTE.normal).text(d.asociado.descripcion);
      y += 12;
    }
    if (d.observaciones) {
      y += 6;
      doc.fontSize(7.5).font(FUENTE.italica).fillColor(C.grisTexto).text(d.observaciones, M, y, { width: CW });
    }

    this.pie(doc, d, e, qr);
    if (d.homologacion) marcaDeAgua(doc);
  }

  private encabezado(doc: PDFKit.PDFDocument, d: ComprobantePdfData, e: EstiloPdf, copia: string): number {
    let y = M;
    doc.fontSize(7).font(FUENTE.negrita).fillColor(C.grisTexto).text(copia, M, y + 3, { width: CW, align: 'center', characterSpacing: 1.5 });
    doc.moveTo(M, y + 14).lineTo(M + CW, y + 14).lineWidth(LINEA).stroke(C.marco);
    y += 20;

    const alto = 112;
    const x1 = M + CW / 2 - 30;
    const x2 = M + CW / 2 + 30;
    doc.rect(M, y, CW, alto).lineWidth(LINEA).stroke(C.marco);

    // Emisor
    let ey = y + 8;
    if (e.logo) {
      try {
        doc.image(e.logo, M + 8, ey, { fit: [160, 58] });
        ey += 64;
      } catch {
        // logo ilegible: se omite
      }
    }
    const anchoIzq = x1 - M - 16;
    doc.fontSize(10.5).font(FUENTE.seminegrita).fillColor(e.colorPrimario).text(d.emisor.razonSocial, M + 8, ey, { width: anchoIzq });
    ey = doc.y + 2;
    doc.fontSize(7.5).font(FUENTE.normal).fillColor(C.grafito).text(d.emisor.domicilio, M + 8, ey, { width: anchoIzq });
    doc.text(d.emisor.condicionIva, { width: anchoIzq });

    // Letra: recuadro central en el color principal.
    doc.rect(x1, y, x2 - x1, 52).lineWidth(1).fillAndStroke(C.blanco, e.colorPrimario);
    doc.fontSize(32).font(FUENTE.seminegrita).fillColor(e.colorPrimario).text(d.letra, x1, y + 5, { width: x2 - x1, align: 'center' });
    doc.fontSize(6.5).font(FUENTE.negrita).fillColor(C.grisTexto)
      .text(`COD. ${String(d.codigo).padStart(3, '0')}`, x1, y + 40, { width: x2 - x1, align: 'center', characterSpacing: 0.5 });
    doc.moveTo((x1 + x2) / 2, y + 52).lineTo((x1 + x2) / 2, y + alto).lineWidth(LINEA).stroke(C.marco);

    // Datos del comprobante
    const xr = x2 + 10;
    const wr = M + CW - xr - 8;
    doc.fontSize(13).font(FUENTE.seminegrita).fillColor(e.colorPrimario).text(d.titulo, xr, y + 8, { width: wr });
    doc.fontSize(8.5).font(FUENTE.seminegrita).fillColor(C.grafito)
      .text(`N° ${String(d.puntoVenta).padStart(5, '0')}-${String(d.numero).padStart(8, '0')}`, xr, y + 28, { width: wr, ...NUM });
    const filas = [
      ['Fecha de emisión', d.fechaEmision],
      ['CUIT', d.emisor.cuit],
      ['Ingresos Brutos', d.emisor.ingresosBrutos || '-'],
      ['Inicio de actividades', d.emisor.inicioActividades || '-'],
    ];
    // Rótulo en negrita y valor normal, como en el bloque del receptor.
    filas.forEach(([k, v], i) =>
      doc.fontSize(7.5).font(FUENTE.seminegrita).fillColor(C.grafito).text(`${k}: `, xr, y + 44 + i * 11, { width: wr, continued: true })
        .font(FUENTE.normal).text(v, { width: wr, ...NUM }),
    );

    return y + alto + 6;
  }

  private receptor(doc: PDFKit.PDFDocument, d: ComprobantePdfData, y: number): number {
    const colW = CW / 2 - 12;
    const izq = [
      ['Cliente', d.receptor.razonSocial],
      [d.receptor.documentoTipo, d.receptor.documento],
      ['Condición IVA', d.receptor.condicionIva],
      ['Domicilio', d.receptor.domicilio || '-'],
    ];
    const der = [
      ['Concepto', d.concepto],
      ['Moneda', d.moneda === 'USD' ? `Dólares (cotización ${d.cotizacion ?? '-'})` : 'Pesos argentinos'],
      ...(d.periodoServicio
        ? [
            ['Período facturado', `${d.periodoServicio.desde} al ${d.periodoServicio.hasta}`],
            ['Vencimiento de pago', d.periodoServicio.vtoPago],
          ]
        : []),
    ];
    // Cada dato ocupa lo que necesita: si un valor largo baja de renglón, los siguientes se corren.
    const dibujar = (items: string[][], x: number) => {
      let yy = y + 7;
      for (const [k, v] of items) {
        doc.fontSize(7.5).font(FUENTE.seminegrita).fillColor(C.grafito).text(`${k}: `, x, yy, { width: colW, continued: true })
          .font(FUENTE.normal).fillColor(C.grafito).text(v, { width: colW, ...NUM });
        yy = Math.max(doc.y, yy + 10) + 2;
      }
      return yy;
    };
    const fin = Math.max(dibujar(izq, M + 8), dibujar(der, M + CW / 2 + 4));
    const alto = fin - y + 5;
    doc.rect(M, y, CW, alto).lineWidth(LINEA).stroke(C.marco);
    return y + alto + 10;
  }

  private pie(doc: PDFKit.PDFDocument, d: ComprobantePdfData, e: EstiloPdf, qr: Buffer) {
    const y = PAGE_H - M - PIE_ALTO + 10;
    doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(LINEA).stroke(C.borde);

    doc.fontSize(7.5).font(FUENTE.seminegrita).fillColor(C.grafito).text('Son: ', M, y + 7, { continued: true })
      .font(FUENTE.normal).text(importeEnLetras(d.totales.total, d.moneda), { width: CW - 220 });

    // Totales
    const tx = M + CW - 210;
    const filas: Array<[string, string, boolean?]> = [];
    const simbolo = d.moneda === 'USD' ? 'US$' : '$';
    if (d.letra === 'A') {
      filas.push(['Importe neto gravado', d.totales.netoGravado]);
      for (const a of d.totales.iva) filas.push([`IVA ${fmt(a.alicuota)} %`, a.importe]);
      filas.push(['Otros tributos', d.totales.tributos]);
    } else {
      filas.push(['Subtotal', d.totales.total]);
      filas.push(['Otros tributos', d.totales.tributos]);
    }
    filas.push(['Importe total', d.totales.total, true]);
    let ty = y + 26;
    for (const [k, v, fuerte] of filas) {
      if (fuerte) {
        doc.moveTo(tx, ty + 1).lineTo(tx + 210, ty + 1).lineWidth(0.5).stroke(C.borde);
        ty += 5;
      }
      doc.fontSize(fuerte ? 9.5 : 8).font(fuerte ? FUENTE.seminegrita : FUENTE.normal).fillColor(fuerte ? e.colorPrimario : C.grafito)
        .text(`${k}: ${simbolo}`, tx, ty, { width: 130 }).text(fmt(v), tx + 130, ty, { width: 80, align: 'right', ...NUM });
      ty += fuerte ? 14 : 11;
    }
    if (d.letra === 'B') {
      doc.fontSize(6.5).font(FUENTE.normal).fillColor(C.grisTexto)
        .text(`Régimen de Transparencia Fiscal al Consumidor (Ley 27.743) — IVA contenido: ${simbolo} ${fmt(d.totales.ivaTotal)}`, tx - 90, ty + 2, { width: 300, align: 'right', ...NUM });
    }

    // QR + CAE (izquierda)
    doc.image(qr, M, y + 26, { width: 72, height: 72 });
    doc.fontSize(9).font(FUENTE.seminegrita).fillColor(C.grafito).text('Comprobante autorizado', M + 80, y + 32);
    doc.fontSize(8).font(FUENTE.normal)
      .text(`CAE N°: ${d.cae.numero}`, M + 80, y + 46, NUM)
      .text(`Vto. CAE: ${d.cae.vencimiento}`, M + 80, y + 58, NUM);
    doc.fontSize(6.5).fillColor(C.grisTexto).text('ARCA — Agencia de Recaudación y Control Aduanero', M + 80, y + 72);

    // Última línea: texto de la plantilla a la izquierda y "Generado con faktia" a la derecha.
    const yUltima = PAGE_H - M - 14;
    doc.moveTo(M, yUltima - 6).lineTo(M + CW, yUltima - 6).lineWidth(0.5).stroke(C.borde);
    const anchoMarca = dibujarGeneradoCon(doc, M + CW, yUltima);
    if (e.textoPie) {
      doc.fontSize(7).font(FUENTE.normal).fillColor(e.colorSecundario).text(e.textoPie, M, yUltima + 1, { width: CW - anchoMarca - 16 });
    }
  }
}
