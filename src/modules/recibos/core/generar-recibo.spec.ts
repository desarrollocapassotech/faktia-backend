import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { inflateSync } from 'zlib';
import { generarRecibo } from './generar-recibo';
import { ReciboInvalidoError, type ReciboCobro } from './recibo.types';

const base: ReciboCobro = {
  tipo: 'COBRO',
  numero: '1',
  fecha: '2026-09-28',
  moneda: 'ARS',
  emisor: { nombre: 'Empresa Demo SA', documento: 'CUIT 30-71234567-1' },
  pagador: { nombre: 'Cliente SRL' },
  items: [{ descripcion: 'Pago a cuenta', importe: '5000' }],
  total: '5000',
};

// Los diccionarios de página no se comprimen: se pueden contar en el PDF crudo.
function paginas(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
}

// Texto dibujado con las fuentes estándar: pdfkit comprime los streams (FlateDecode) y
// escribe cada línea como un arreglo TJ de trozos hexadecimales partidos por el kerning.
function texto(pdf: Buffer): string {
  const crudo = pdf.toString('latin1');
  const streams = [...crudo.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((m) => {
    try {
      return inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch {
      return '';
    }
  });
  return streams
    .flatMap((s) => [...s.matchAll(/\[([^\]]*)\]\s*TJ/g)])
    .map((tj) => [...tj[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join(''))
    .join('\n');
}

describe('generarRecibo', () => {
  it('genera un PDF de una página con el nombre de archivo del tipo', async () => {
    const { pdf, filename } = await generarRecibo(base, { colorPrimario: '#0F766E', textoPie: 'CBU 000000' });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(paginas(pdf)).toBe(1);
    expect(filename).toBe('Recibo-Cobro_1_Cliente-SRL.pdf');
  });

  it('agrega páginas cuando hay muchos conceptos', async () => {
    const items = Array.from({ length: 80 }, (_, i) => ({ descripcion: `Concepto ${i + 1}`, importe: '10' }));
    const { pdf } = await generarRecibo({ ...base, items, total: '800' });
    expect(paginas(pdf)).toBeGreaterThan(1);
  });

  it('ignora un color inválido y un logo ilegible sin fallar', async () => {
    const { pdf } = await generarRecibo(base, { colorPrimario: 'rojo', logo: new Uint8Array([1, 2, 3]) });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('sin línea de firma no lleva la leyenda para firmar', async () => {
    const dibujado = async (lineaFirma: boolean) => texto((await generarRecibo(base, { lineaFirma })).pdf);
    expect(await dibujado(true)).toContain('Firma y aclaración');
    expect(await dibujado(false)).not.toContain('Firma y aclaración');
  });

  it('valida antes de dibujar', async () => {
    await expect(generarRecibo({ ...base, total: '1' })).rejects.toThrow(ReciboInvalidoError);
  });
});

describe('límites del núcleo', () => {
  it('core/ solo importa pdfkit y sus propios archivos', () => {
    const dir = __dirname;
    const imports = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
      .flatMap((f) => [...readFileSync(join(dir, f), 'utf8').matchAll(/from '([^']+)'/g)].map((m) => [f, m[1]]));
    const ajenos = imports.filter(([, m]) => m !== 'pdfkit' && !m.startsWith('./'));
    expect(ajenos).toEqual([]);
  });
});
