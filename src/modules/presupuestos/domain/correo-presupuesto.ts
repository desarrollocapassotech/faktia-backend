// Arma el email con el que se manda un presupuesto (asunto, HTML y texto), puro: sin base ni envío.
// Es un mensaje del sistema, no de la persona: sin saludos ni frases en primera persona, solo los datos
// del presupuesto, el adjunto, el contacto de la empresa y una aclaración de que se generó automáticamente.
// Arriba van el nombre y el color de la empresa; Faktia aparece solo en esa aclaración del pie.

export interface CorreoPresupuesto {
  numero: string;
  titulo: string | null;
  lugar: string | null;
  /** Etiqueta de la empresa para "proyecto" (Proyecto, Obra…). */
  etiquetaProyecto: string;
  fecha: string; // YYYY-MM-DD
  fechaVencimiento: string; // YYYY-MM-DD
  moneda: 'ARS' | 'USD';
  total: string;
  ivaModo: 'SIN_IVA' | 'NO_INCLUYE' | 'DISCRIMINADO';
  cliente: string;
  emisor: { nombre: string; cuit: string | null; domicilio: string | null; telefono: string | null; email: string | null };
  /** Color principal de la plantilla PDF de la empresa (#RRGGBB). */
  colorPrimario: string;
}

const fechaAr = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const importe = (v: string, moneda: 'ARS' | 'USD') =>
  `${moneda === 'USD' ? 'US$' : '$'} ${new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v))}`;
const escapar = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Solo un hex válido entra en los estilos; si no, el casi negro por defecto de la plantilla. */
const color = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#111827');

const etiquetaTotal = (modo: CorreoPresupuesto['ivaModo']) => (modo === 'DISCRIMINADO' ? 'Total con IVA' : modo === 'NO_INCLUYE' ? 'Total (no incluye IVA)' : 'Total');

function filas(c: CorreoPresupuesto): Array<[string, string]> {
  return [
    ['Cliente', c.cliente],
    ...(c.titulo ? ([['Trabajo', c.titulo]] as Array<[string, string]>) : []),
    ...(c.lugar ? ([[`${c.etiquetaProyecto} o lugar`, c.lugar]] as Array<[string, string]>) : []),
    ['Fecha', fechaAr(c.fecha)],
    ['Válido hasta', fechaAr(c.fechaVencimiento)],
  ];
}

const contacto = (c: CorreoPresupuesto) =>
  [c.emisor.cuit ? `CUIT ${c.emisor.cuit}` : null, c.emisor.domicilio, c.emisor.telefono ? `Tel. ${c.emisor.telefono}` : null, c.emisor.email].filter((x): x is string => Boolean(x));

/** Aclaración del pie: lo generó el sistema y, si la empresa tiene email, a quién le llegan las respuestas. */
const aclaracion = (c: CorreoPresupuesto) =>
  `Mensaje generado automáticamente por Faktia a pedido de ${c.emisor.nombre}.${c.emisor.email ? ` Las respuestas a este correo le llegan a ${c.emisor.nombre}.` : ''}`;

export function asuntoPresupuesto(c: CorreoPresupuesto): string {
  return `Presupuesto N° ${c.numero}${c.titulo ? ` · ${c.titulo}` : ''} · ${c.emisor.nombre}`;
}

export function textoPresupuesto(c: CorreoPresupuesto): string {
  return [
    `${c.emisor.nombre}\nPresupuesto N° ${c.numero}`,
    [...filas(c).map(([k, v]) => `${k}: ${v}`), `${etiquetaTotal(c.ivaModo)}: ${importe(c.total, c.moneda)}`].join('\n'),
    'Adjunto: presupuesto en PDF.',
    contacto(c).length ? `Contacto de ${c.emisor.nombre}:\n${contacto(c).join('\n')}` : null,
    `—\n${aclaracion(c)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** HTML compatible con clientes de correo: tablas, estilos en línea y ancho máximo de 600 px. */
export function htmlPresupuesto(c: CorreoPresupuesto): string {
  const primario = color(c.colorPrimario);
  const datos = filas(c)
    .map(
      ([k, v]) => `<tr>
<td style="padding:10px 0;border-bottom:1px solid #E4E2DA;color:#4A5258;font-size:13px;white-space:nowrap;vertical-align:top">${escapar(k)}</td>
<td style="padding:10px 0 10px 16px;border-bottom:1px solid #E4E2DA;font-size:14px;text-align:right">${escapar(v)}</td>
</tr>`,
    )
    .join('\n');
  const lineasContacto = contacto(c);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapar(asuntoPresupuesto(c))}</title></head>
<body style="margin:0;padding:0;background:#F2F1EC;font-family:Arial,Helvetica,sans-serif;color:#1B262D;line-height:1.5">
<div style="display:none;max-height:0;overflow:hidden">${escapar(etiquetaTotal(c.ivaModo))}: ${escapar(importe(c.total, c.moneda))} · Válido hasta ${fechaAr(c.fechaVencimiento)} · PDF adjunto</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F1EC"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border:1px solid #E4E2DA;border-top:4px solid ${primario};border-radius:4px">
<tr><td style="padding:28px 32px 8px">
<p style="margin:0;font-size:20px;font-weight:700;color:${primario}">${escapar(c.emisor.nombre)}</p>
<p style="margin:4px 0 0;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#4A5258">Presupuesto N° ${escapar(c.numero)}</p>
</td></tr>
<tr><td style="padding:12px 32px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
${datos}
<tr>
<td style="padding:14px 0 0;font-size:14px;font-weight:700;white-space:nowrap">${escapar(etiquetaTotal(c.ivaModo))}</td>
<td style="padding:14px 0 0 16px;font-size:22px;font-weight:700;text-align:right;color:${primario};white-space:nowrap">${escapar(importe(c.total, c.moneda))}</td>
</tr>
</table>
</td></tr>
<tr><td style="padding:20px 32px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F1EC;border-radius:4px"><tr>
<td style="padding:12px 16px;font-size:13px;color:#4A5258"><strong style="color:#1B262D">Adjunto:</strong> presupuesto en PDF.</td>
</tr></table>
</td></tr>
${
  lineasContacto.length
    ? `<tr><td style="padding:20px 32px 0">
<p style="margin:0 0 4px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#4A5258">Contacto</p>
<p style="margin:0;font-size:14px;font-weight:700">${escapar(c.emisor.nombre)}</p>
${lineasContacto.map((l) => `<p style="margin:2px 0 0;font-size:13px;color:#4A5258">${escapar(l)}</p>`).join('\n')}
</td></tr>`
    : ''
}
<tr><td style="padding:28px 32px 0"></td></tr>
</table>
<p style="margin:16px 0 0;max-width:600px;font-size:11px;color:#4A5258">${escapar(aclaracion(c))}</p>
</td></tr></table>
</body></html>`;
}
