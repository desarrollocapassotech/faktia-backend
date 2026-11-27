import { normalizarColor, parsearFormato, sanearFormato, textoPlano } from './formato';

describe('texto con formato limitado', () => {
  it('conserva negrita, cursiva, subrayado y colores de la paleta', () => {
    const html = '<div><b>Columnas</b> de <i>perfil C</i> <u>galvanizado</u> <span style="color: rgb(163, 53, 43);">no incluye pintura</span></div>';
    expect(sanearFormato(html)).toBe('<p><b>Columnas</b> de <i>perfil C</i> <u>galvanizado</u> <span class="c-rojo">no incluye pintura</span></p>');
  });
  it('descarta lo peligroso y lo no permitido, pero conserva el texto', () => {
    const html = '<p onclick="x()">Hola <script>alert(1)</script><a href="javascript:x">link</a> <img src=x onerror=y> <font color="#0000ff">azul</font></p>';
    expect(sanearFormato(html)).toBe('<p>Hola link  <span style="color:#0000ff">azul</span></p>');
  });
  it('los saltos (div, br) son párrafos y se escapan los caracteres', () => {
    expect(sanearFormato('Desmontaje de techo<br>Retiro de chapas &amp; <tirantes>')).toBe('<p>Desmontaje de techo</p><p>Retiro de chapas &amp; </p>');
    expect(parsearFormato('Línea 1\nLínea 2')).toEqual([[{ texto: 'Línea 1' }], [{ texto: 'Línea 2' }]]);
  });
  it('es idempotente', () => {
    const una = sanearFormato('<b>Viga <i>reticulada</i></b> de 12 m');
    expect(sanearFormato(una)).toBe(una);
  });
  it('normaliza cualquier color a #rrggbb; negro y el grafito del texto son texto normal', () => {
    expect(normalizarColor('#000000')).toBeUndefined();
    expect(normalizarColor('rgb(27, 38, 45)')).toBeUndefined();
    expect(normalizarColor('#777')).toBe('#777777');
    expect(normalizarColor('#FF0000')).toBe('#ff0000');
    expect(normalizarColor('rgb(10, 200, 30)')).toBe('#0ac81e');
    expect(normalizarColor('green')).toBe('#23423a');
    expect(normalizarColor('url(x)')).toBeUndefined();
  });
  it('los colores de la paleta se guardan como clase; los demás, como color en línea', () => {
    expect(sanearFormato('<span style="color: rgb(163, 53, 43);">rojo</span> <span style="color: rgb(0, 128, 255);">celeste</span>')).toBe(
      '<p><span class="c-rojo">rojo</span> <span style="color:#0080ff">celeste</span></p>',
    );
    const una = sanearFormato('<span style="color:#0080ff">celeste</span>');
    expect(sanearFormato(una)).toBe(una);
  });
  it('no deja pasar nada raro dentro del style', () => {
    expect(sanearFormato('<span style="color: red; background: url(javascript:x)">a</span>')).toBe('<p><span class="c-rojo">a</span></p>');
    expect(sanearFormato('<span style="color: #fff&quot;onmouseover=x">a</span>')).toBe('<p>a</p>');
  });
  it('texto plano para listados', () => {
    expect(textoPlano('<p><b>Techado</b> con chapa</p><p>Incluye canaletas</p>')).toBe('Techado con chapa\nIncluye canaletas');
  });
});
