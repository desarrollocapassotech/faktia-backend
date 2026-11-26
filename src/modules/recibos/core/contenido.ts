import { aCentavos, formatearCentavos } from './montos';
import { centavosEnLetras } from './numero-a-letras';
import { ReciboInvalidoError, type Parte, type ReciboInput } from './recibo.types';

// Todo lo que el PDF muestra, ya decidido y como texto. Separado del dibujo para poder testearlo.

export interface ContenidoRecibo {
  titulo: 'RECIBO DE COBRO' | 'RECIBO DE PAGO';
  /** La parte que encabeza el recibo: quien cobra (COBRO) o quien paga (PAGO). */
  encabezado: Parte;
  numero: string | null;
  fecha: string; // dd/mm/aaaa
  cuerpo: string;
  items: Array<{ descripcion: string; cantidad: string; importe: string }>;
  total: string; // "$ 1.234,50"
  comprobantesAplicados: Array<{ descripcion: string; importe: string }>;
  datosExtra: Array<[string, string]>; // medio de pago y los que pida quien arma el recibo
  secciones: Array<{ titulo: string; filas: Array<{ texto: string; detalle: string; importe: string; destacado: boolean }> }>;
  observaciones: string | null;
  firma: { etiqueta: string; nombre: string; documento: string | null };
  filename: string;
}

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_ITEMS = 200;

function limpio(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

function validarParte(p: Parte | undefined, rol: string): Parte {
  if (!p || !limpio(p.nombre)) throw new ReciboInvalidoError(`Falta el nombre de ${rol}.`);
  const detalle = (p.detalle ?? []).map((d) => limpio(d)).filter((d): d is string => Boolean(d));
  return { nombre: p.nombre.trim(), documento: limpio(p.documento), domicilio: limpio(p.domicilio), ...(detalle.length ? { detalle } : {}) };
}

function centavos(v: string, donde: string): bigint {
  try {
    return aCentavos(v);
  } catch {
    throw new ReciboInvalidoError(`${donde}: el importe "${v}" no es válido (número con punto y hasta 2 decimales).`);
  }
}

function slug(texto: string): string {
  return (
    texto
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'recibo'
  );
}

function describirParte(p: Parte): string {
  return p.documento ? `${p.nombre} (${p.documento})` : p.nombre;
}

/** Valida el recibo y arma sus textos. Lanza ReciboInvalidoError con un mensaje para el usuario. */
export function armarContenido(input: ReciboInput): ContenidoRecibo {
  if (input.tipo !== 'COBRO' && input.tipo !== 'PAGO') throw new ReciboInvalidoError('El tipo tiene que ser COBRO o PAGO.');
  if (input.moneda !== 'ARS' && input.moneda !== 'USD') throw new ReciboInvalidoError('La moneda tiene que ser ARS o USD.');

  const f = FECHA.exec(input.fecha ?? '');
  const real = f ? new Date(Date.UTC(Number(f[1]), Number(f[2]) - 1, Number(f[3]))) : null;
  if (!f || !real || real.toISOString().slice(0, 10) !== input.fecha) {
    throw new ReciboInvalidoError('La fecha tiene que ser una fecha válida con formato YYYY-MM-DD.');
  }
  const fecha = `${f[3]}/${f[2]}/${f[1]}`;

  if (!input.items?.length) throw new ReciboInvalidoError('El recibo necesita al menos un concepto.');
  if (input.items.length > MAX_ITEMS) throw new ReciboInvalidoError(`El recibo admite hasta ${MAX_ITEMS} conceptos.`);

  const simbolo = input.moneda === 'USD' ? 'US$' : '$';
  let suma = 0n;
  const items = input.items.map((it, i) => {
    const descripcion = limpio(it.descripcion);
    if (!descripcion) throw new ReciboInvalidoError(`Concepto ${i + 1}: falta la descripción.`);
    const c = centavos(it.importe, `Concepto ${i + 1}`);
    suma += c;
    return { descripcion, cantidad: limpio(it.cantidad) ?? '', importe: `${simbolo} ${formatearCentavos(c)}` };
  });

  const total = centavos(input.total, 'Total');
  if (total <= 0n) throw new ReciboInvalidoError('El total tiene que ser mayor a 0.');
  if (total !== suma) {
    throw new ReciboInvalidoError(
      `El total (${simbolo} ${formatearCentavos(total)}) no coincide con la suma de los conceptos (${simbolo} ${formatearCentavos(suma)}).`,
    );
  }

  const letras = centavosEnLetras(total, input.moneda);
  const totalTexto = `${simbolo} ${formatearCentavos(total)}`;
  const conceptos = items.map((i) => i.descripcion).join('; ');
  const numero = limpio(input.numero) ?? null;
  const medioPago = limpio(input.medioPago);
  const datosExtra: Array<[string, string]> = [];
  const extra = (input.datosExtra ?? [])
    .map(([k, v]) => [limpio(k), limpio(v)] as const)
    .filter((x): x is readonly [string, string] => Boolean(x[0] && x[1]))
    .map(([k, v]): [string, string] => [k, v]);
  const secciones = (input.secciones ?? [])
    .filter((s) => limpio(s.titulo) && s.filas?.length)
    .map((s) => ({
      titulo: s.titulo.trim(),
      filas: s.filas.map((f) => ({ texto: f.texto?.trim() ?? '', detalle: limpio(f.detalle) ?? '', importe: f.importe?.trim() ?? '', destacado: Boolean(f.destacado) })),
    }));

  if (input.tipo === 'COBRO') {
    const emisor = validarParte(input.emisor, 'quien emite el recibo');
    const pagador = validarParte(input.pagador, 'quien paga');
    const aplicados = (input.comprobantesAplicados ?? []).map((c, i) => {
      const descripcion = limpio(c.descripcion);
      if (!descripcion) throw new ReciboInvalidoError(`Comprobante aplicado ${i + 1}: falta la descripción.`);
      return { descripcion, importe: `${simbolo} ${formatearCentavos(centavos(c.importe, `Comprobante aplicado ${i + 1}`))}` };
    });
    if (medioPago) datosExtra.push(['Medio de pago', medioPago]);
    datosExtra.push(...extra);
    return {
      titulo: 'RECIBO DE COBRO',
      encabezado: emisor,
      numero,
      fecha,
      cuerpo: `Recibí de ${describirParte(pagador)} la suma de ${letras} (${totalTexto}) en concepto de ${conceptos}.`,
      items,
      total: totalTexto,
      comprobantesAplicados: aplicados,
      datosExtra,
      secciones,
      observaciones: limpio(input.observaciones) ?? null,
      firma: { etiqueta: 'Firma y aclaración de quien recibe el pago', nombre: emisor.nombre, documento: emisor.documento ?? null },
      filename: `Recibo-Cobro_${slug(numero ?? input.fecha)}_${slug(pagador.nombre)}.pdf`,
    };
  }

  const pagador = validarParte(input.pagador, 'quien paga');
  const beneficiario = validarParte(input.beneficiario, 'quien cobra');
  const periodo = limpio(input.periodo); // va en el texto del recibo
  if (medioPago) datosExtra.push(['Medio de pago', medioPago]);
  datosExtra.push(...extra);
  return {
    titulo: 'RECIBO DE PAGO',
    encabezado: pagador,
    numero,
    fecha,
    cuerpo: `Recibí de ${describirParte(pagador)} la suma de ${letras} (${totalTexto}) en concepto de ${conceptos}${
      periodo ? `, correspondiente a ${periodo}` : ''
    }.`,
    items,
    total: totalTexto,
    comprobantesAplicados: [],
    datosExtra,
    secciones,
    observaciones: limpio(input.observaciones) ?? null,
    firma: { etiqueta: 'Firma y aclaración del beneficiario', nombre: beneficiario.nombre, documento: beneficiario.documento ?? null },
    filename: `Recibo-Pago_${slug(numero ?? input.fecha)}_${slug(beneficiario.nombre)}.pdf`,
  };
}
