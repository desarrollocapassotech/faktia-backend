import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Identidad visual de Faktia para los PDF (comprobantes y recibos): tipografía, colores neutros y la
 * marca "Generado con faktia" del pie. Los colores principales de cada empresa (plantilla PDF) no
 * salen de acá: los define el tenant.
 */

/** Neutros de la marca (mismos valores que los tokens --fk-* del frontend). */
export const COLORES_PDF = {
  grafito: '#1B262D', // texto
  grisTexto: '#4A5258', // texto secundario
  borde: '#E4E2DA', // divisores finos
  marco: '#000000', // recuadros del comprobante (emisor, receptor)
  fiordo: '#1E3A4C',
  terracota: '#C45C3B',
  blanco: '#FFFFFF',
} as const;

export interface FuentesPdf {
  normal: Buffer;
  media: Buffer;
  seminegrita: Buffer;
  negrita: Buffer;
  italica: Buffer;
}

/** Nombres con los que quedan registradas en el documento (usar con doc.font()). */
export const FUENTE = {
  normal: 'fk-normal',
  media: 'fk-media',
  seminegrita: 'fk-seminegrita',
  negrita: 'fk-negrita',
  italica: 'fk-italica',
} as const;

// assets/ está en la raíz del repo: tres niveles arriba tanto desde src/shared/pdf como desde dist/shared/pdf.
const DIR_FUENTES = join(__dirname, '..', '..', '..', 'assets', 'fonts');

let cache: FuentesPdf | null = null;

/** Familjen Grotesk (OFL), leída una sola vez. */
export function fuentesPdf(): FuentesPdf {
  cache ??= {
    normal: readFileSync(join(DIR_FUENTES, 'FamiljenGrotesk-Regular.ttf')),
    media: readFileSync(join(DIR_FUENTES, 'FamiljenGrotesk-Medium.ttf')),
    seminegrita: readFileSync(join(DIR_FUENTES, 'FamiljenGrotesk-SemiBold.ttf')),
    negrita: readFileSync(join(DIR_FUENTES, 'FamiljenGrotesk-Bold.ttf')),
    italica: readFileSync(join(DIR_FUENTES, 'FamiljenGrotesk-Italic.ttf')),
  };
  return cache;
}

export function registrarFuentes(doc: PDFKit.PDFDocument) {
  const f = fuentesPdf();
  doc.registerFont(FUENTE.normal, f.normal);
  doc.registerFont(FUENTE.media, f.media);
  doc.registerFont(FUENTE.seminegrita, f.seminegrita);
  doc.registerFont(FUENTE.negrita, f.negrita);
  doc.registerFont(FUENTE.italica, f.italica);
}

// Ícono de Faktia, copiado tal cual de faktia-icono.svg (viewBox 0 0 120 120; el dibujo va de x 22 a 98, y 10 a 110).
const ICONO = {
  cuerpo: 'M30 10 H74 L98 34 V102 a8 8 0 0 1 -8 8 H30 a8 8 0 0 1 -8 -8 V18 a8 8 0 0 1 8 -8 Z',
  pliegue: 'M74 10 V28 a6 6 0 0 0 6 6 H98 Z',
  k: 'M44 42 V92 M44 74 L70 46 M54 64 L72 92',
  x: 22,
  y: 10,
  ancho: 76,
  alto: 100,
};

/**
 * Dibuja "Generado con [ícono] faktia" alineado a la derecha de `xDerecha`, con la base del texto en
 * `y` (arriba del renglón). Devuelve el ancho que ocupa. La marca acompaña: nunca reemplaza los datos del emisor.
 */
export function dibujarGeneradoCon(doc: PDFKit.PDFDocument, xDerecha: number, y: number): number {
  const altoIcono = 10;
  const escala = altoIcono / ICONO.alto;
  const anchoIcono = ICONO.ancho * escala;
  const separacion = 3;

  registrarFuentes(doc); // por si el documento no las registró (los recibos usan sus propios nombres)
  doc.font(FUENTE.normal).fontSize(6.5);
  const anchoLeyenda = doc.widthOfString('Generado con');
  doc.font(FUENTE.seminegrita).fontSize(8);
  const anchoNombre = doc.widthOfString('faktia');
  const total = anchoLeyenda + separacion + anchoIcono + separacion + anchoNombre;

  let x = xDerecha - total;
  doc.font(FUENTE.normal).fontSize(6.5).fillColor(COLORES_PDF.grisTexto).text('Generado con', x, y + 2, { lineBreak: false });
  x += anchoLeyenda + separacion;

  doc.save();
  doc.translate(x - ICONO.x * escala, y - ICONO.y * escala).scale(escala);
  doc.path(ICONO.cuerpo).fill(COLORES_PDF.fiordo);
  doc.path(ICONO.pliegue).fill(COLORES_PDF.terracota);
  doc.path(ICONO.k).lineWidth(9).lineCap('round').lineJoin('round').stroke(COLORES_PDF.blanco);
  doc.restore();
  x += anchoIcono + separacion;

  doc.font(FUENTE.seminegrita).fontSize(8).fillColor(COLORES_PDF.fiordo).text('faktia', x, y + 0.5, { lineBreak: false });
  return total;
}
