// Texto con formato limitado para las descripciones de presupuestos y la biblioteca: negrita,
// cursiva, subrayado y una paleta corta de colores, para que el PDF salga siempre prolijo.
// Entra HTML (el del editor del navegador) y sale un HTML canónico y seguro: <p>, <b>, <i>, <u> y
// <span class="c-…">. Todo lo demás se descarta conservando el texto.

export const COLORES = {
  rojo: '#A3352B',
  azul: '#1E3A4C',
  verde: '#23423A',
  naranja: '#A84A2C',
} as const;
export type Color = keyof typeof COLORES;

export interface Tramo {
  texto: string;
  negrita?: boolean;
  cursiva?: boolean;
  subrayado?: boolean;
  color?: Color;
}
/** Un párrafo es una lista de tramos. */
export type Parrafo = Tramo[];

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decodificar(t: string): string {
  return t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTIDADES[e.toLowerCase()] ?? m;
  });
}
const escapar = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Color de la paleta más cercano a un color CSS (hex o rgb). Negro, gris o desconocido: sin color. */
export function colorDePaleta(css: string | undefined): Color | undefined {
  if (!css) return undefined;
  const v = css.trim().toLowerCase();
  const porNombre: Record<string, Color> = { red: 'rojo', blue: 'azul', green: 'verde', orange: 'naranja' };
  if (porNombre[v]) return porNombre[v];
  if ((Object.keys(COLORES) as Color[]).includes(v as Color)) return v as Color;
  let rgb: [number, number, number] | null = null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    rgb = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v);
  if (m) rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!rgb) return undefined;
  const [r, g, b] = rgb;
  if (Math.max(r, g, b) - Math.min(r, g, b) < 40) return undefined; // grises y negro: texto normal
  let mejor: Color | undefined;
  let distancia = Infinity;
  for (const [nombre, hexColor] of Object.entries(COLORES) as Array<[Color, string]>) {
    const c = [1, 3, 5].map((i) => parseInt(hexColor.slice(i, i + 2), 16));
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
    if (d < distancia) [mejor, distancia] = [nombre, d];
  }
  return mejor;
}

const BLOQUES = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote']);

/** Parsea el HTML del editor (o texto plano) a párrafos de tramos con el formato permitido. */
export function parsearFormato(entrada: string): Parrafo[] {
  const parrafos: Parrafo[] = [[]];
  type Estilo = Omit<Tramo, 'texto'>;
  const pila: Array<{ tag: string; estilo: Estilo }> = [];
  const estiloActual = (): Estilo => pila.reduce<Estilo>((acc, p) => ({ ...acc, ...p.estilo }), {});
  const cortar = () => {
    if (parrafos[parrafos.length - 1].length > 0) parrafos.push([]);
  };
  const agregar = (texto: string) => {
    if (!texto) return;
    const e = estiloActual();
    const actual = parrafos[parrafos.length - 1];
    const ultimo = actual[actual.length - 1];
    if (ultimo && ultimo.negrita === e.negrita && ultimo.cursiva === e.cursiva && ultimo.subrayado === e.subrayado && ultimo.color === e.color) {
      ultimo.texto += texto;
    } else {
      actual.push({ texto, ...(e.negrita ? { negrita: true } : {}), ...(e.cursiva ? { cursiva: true } : {}), ...(e.subrayado ? { subrayado: true } : {}), ...(e.color ? { color: e.color } : {}) });
    }
  };
  // Sin etiquetas: texto plano, un párrafo por renglón.
  if (!/<[a-z!/]/i.test(entrada)) {
    const lineas = entrada.replace(/\r\n?/g, '\n').split('\n');
    return lineas.map((l) => (l ? [{ texto: l }] : [])).filter((p, i, arr) => p.length || (i > 0 && i < arr.length - 1)).map((p) => p) as Parrafo[];
  }
  const re = /<!--[\s\S]*?-->|<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(entrada))) {
    if (m[4] !== undefined) {
      agregar(decodificar(m[4].replace(/[\r\n\t]+/g, ' ')));
      continue;
    }
    if (!m[2]) continue; // comentario
    const cierre = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] ?? '';
    if (tag === 'br') {
      parrafos.push([]);
      continue;
    }
    if (!cierre && (tag === 'script' || tag === 'style')) {
      // Se descarta todo hasta el cierre.
      const fin = entrada.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
      re.lastIndex = fin === -1 ? entrada.length : fin;
      continue;
    }
    if (BLOQUES.has(tag)) {
      cortar();
      continue;
    }
    if (cierre) {
      const i = pila.map((p) => p.tag).lastIndexOf(tag);
      if (i !== -1) pila.splice(i);
      continue;
    }
    if (/\/\s*$/.test(attrs)) continue;
    const estilo: Omit<Tramo, 'texto'> = {};
    if (tag === 'b' || tag === 'strong') estilo.negrita = true;
    if (tag === 'i' || tag === 'em') estilo.cursiva = true;
    if (tag === 'u' || tag === 'ins') estilo.subrayado = true;
    const style = /style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/i.exec(attrs);
    const css = (style?.[1] ?? style?.[2] ?? '').toLowerCase();
    if (/font-weight\s*:\s*(bold|[6-9]00)/.test(css)) estilo.negrita = true;
    if (/font-style\s*:\s*italic/.test(css)) estilo.cursiva = true;
    if (/text-decoration[^;]*underline/.test(css)) estilo.subrayado = true;
    const colorCss = /(?:^|;)\s*color\s*:\s*([^;]+)/.exec(css)?.[1];
    const colorAttr = /\bcolor\s*=\s*"([^"]*)"/i.exec(attrs)?.[1];
    const clase = /class\s*=\s*"[^"]*\bc-(rojo|azul|verde|naranja)\b/i.exec(attrs)?.[1] as Color | undefined;
    const color = clase ?? colorDePaleta(colorCss ?? colorAttr);
    if (color) estilo.color = color;
    pila.push({ tag, estilo });
  }
  // Sin párrafos vacíos al principio ni al final.
  while (parrafos.length && parrafos[0].length === 0) parrafos.shift();
  while (parrafos.length && parrafos[parrafos.length - 1].length === 0) parrafos.pop();
  return parrafos;
}

/** HTML canónico y seguro a partir de los párrafos. */
export function serializarFormato(parrafos: Parrafo[]): string {
  return parrafos
    .map((p) => {
      const interior = p
        .map((t) => {
          let h = escapar(t.texto);
          if (t.subrayado) h = `<u>${h}</u>`;
          if (t.cursiva) h = `<i>${h}</i>`;
          if (t.negrita) h = `<b>${h}</b>`;
          if (t.color) h = `<span class="c-${t.color}">${h}</span>`;
          return h;
        })
        .join('');
      return `<p>${interior}</p>`;
    })
    .join('');
}

/** Lo que se guarda: el HTML del editor saneado. */
export function sanearFormato(entrada: string): string {
  return serializarFormato(parsearFormato(entrada));
}

/** Texto sin formato (para listados y búsquedas). */
export function textoPlano(html: string): string {
  return parsearFormato(html)
    .map((p) => p.map((t) => t.texto).join(''))
    .join('\n')
    .trim();
}
