// Texto con formato limitado para las descripciones de presupuestos y la biblioteca: negrita,
// cursiva, subrayado y color de texto (cualquiera).
// Entra HTML (el del editor del navegador) y sale un HTML canónico y seguro: <p>, <b>, <i>, <u>,
// <span class="c-…"> para los colores de la paleta y <span style="color:#rrggbb"> para los demás.
// Todo lo demás se descarta conservando el texto.

/** Paleta con nombre: se guarda como clase (`c-rojo`), igual que antes de admitir cualquier color. */
export const COLORES = {
  rojo: '#a3352b',
  azul: '#1e3a4c',
  verde: '#23423a',
  naranja: '#a84a2c',
} as const;
type NombreColor = keyof typeof COLORES;

export interface Tramo {
  texto: string;
  negrita?: boolean;
  cursiva?: boolean;
  subrayado?: boolean;
  /** Hex en minúsculas (#rrggbb). Sin color: el texto normal. */
  color?: string;
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

// Colores que equivalen a "texto normal": negro y el grafito del texto (lo que pone "Normal" en el editor).
const SIN_COLOR = new Set(['#000000', '#1b262d']);
const POR_NOMBRE_CSS: Record<string, string> = { red: COLORES.rojo, blue: COLORES.azul, green: COLORES.verde, orange: COLORES.naranja };
const hex2 = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');

/**
 * Color CSS (hex de 3 o 6 dígitos, rgb/rgba, un nombre de la paleta o red/blue/green/orange) a
 * #rrggbb. Negro, el grafito del texto o algo que no se entiende: sin color (texto normal).
 */
export function normalizarColor(css: string | undefined): string | undefined {
  const hex = aHex(css);
  return hex && !SIN_COLOR.has(hex) ? hex : undefined;
}

/** El color es el del texto normal (negro o grafito): lo que deja el botón "Normal" del editor. */
export function esColorNormal(css: string | undefined): boolean {
  const hex = aHex(css);
  return Boolean(hex && SIN_COLOR.has(hex));
}

function aHex(css: string | undefined): string | undefined {
  if (!css) return undefined;
  const v = css.trim().toLowerCase();
  let hex: string | undefined = POR_NOMBRE_CSS[v] ?? (COLORES as Record<string, string>)[v] ?? (v === 'black' ? '#000000' : undefined);
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (h) hex = `#${h[1].length === 3 ? h[1].replace(/./g, (c) => c + c) : h[1]}`;
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v);
  if (m) hex = `#${hex2(Number(m[1]))}${hex2(Number(m[2]))}${hex2(Number(m[3]))}`;
  return hex;
}

const nombreDeColor = (hex: string) => (Object.keys(COLORES) as NombreColor[]).find((n) => COLORES[n] === hex);

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
    const clase = /class\s*=\s*"[^"]*\bc-(rojo|azul|verde|naranja)\b/i.exec(attrs)?.[1]?.toLowerCase() as NombreColor | undefined;
    const color = clase ? COLORES[clase] : normalizarColor(colorCss ?? colorAttr);
    if (color) estilo.color = color;
    // "Normal" dentro de un texto con color: el editor agrega un span con el color del texto adentro
    // del span coloreado. Tiene que anular el color de afuera, no ignorarse.
    else if (esColorNormal(colorCss ?? colorAttr)) estilo.color = undefined;
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
          if (t.color) {
            // `t.color` siempre sale de normalizarColor (#rrggbb): es seguro dentro del style.
            const nombre = nombreDeColor(t.color);
            h = nombre ? `<span class="c-${nombre}">${h}</span>` : `<span style="color:${t.color}">${h}</span>`;
          }
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
