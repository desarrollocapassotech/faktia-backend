import { colorDePaleta, parsearFormato, sanearFormato, textoPlano } from './formato';

describe('texto con formato limitado', () => {
  it('conserva negrita, cursiva, subrayado y colores de la paleta', () => {
    const html = '<div><b>Columnas</b> de <i>perfil C</i> <u>galvanizado</u> <span style="color: rgb(163, 53, 43);">no incluye pintura</span></div>';
    expect(sanearFormato(html)).toBe('<p><b>Columnas</b> de <i>perfil C</i> <u>galvanizado</u> <span class="c-rojo">no incluye pintura</span></p>');
  });
  it('descarta lo peligroso y lo no permitido, pero conserva el texto', () => {
    const html = '<p onclick="x()">Hola <script>alert(1)</script><a href="javascript:x">link</a> <img src=x onerror=y> <font color="#0000ff">azul</font></p>';
    expect(sanearFormato(html)).toBe('<p>Hola link  <span class="c-azul">azul</span></p>');
  });
  it('los saltos (div, br) son párrafos y se escapan los caracteres', () => {
    expect(sanearFormato('Desmontaje de techo<br>Retiro de chapas &amp; <tirantes>')).toBe('<p>Desmontaje de techo</p><p>Retiro de chapas &amp; </p>');
    expect(parsearFormato('Línea 1\nLínea 2')).toEqual([[{ texto: 'Línea 1' }], [{ texto: 'Línea 2' }]]);
  });
  it('es idempotente', () => {
    const una = sanearFormato('<b>Viga <i>reticulada</i></b> de 12 m');
    expect(sanearFormato(una)).toBe(una);
  });
  it('grises y negro no son color; los demás van al más cercano', () => {
    expect(colorDePaleta('#000000')).toBeUndefined();
    expect(colorDePaleta('#777')).toBeUndefined();
    expect(colorDePaleta('#ff0000')).toBe('rojo');
    expect(colorDePaleta('green')).toBe('verde');
  });
  it('texto plano para listados', () => {
    expect(textoPlano('<p><b>Techado</b> con chapa</p><p>Incluye canaletas</p>')).toBe('Techado con chapa\nIncluye canaletas');
  });
});
