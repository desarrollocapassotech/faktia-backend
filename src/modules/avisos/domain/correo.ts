// Arma el resumen diario de vencimientos (HTML y texto), puro: sin base ni envío.

export interface ItemAviso {
  cliente: string;
  proyecto: string | null;
  concepto: string;
  numero: string | null;
  moneda: 'ARS' | 'USD';
  pendiente: string;
  fechaVencimiento: string; // YYYY-MM-DD
}

export interface ResumenAviso {
  empresa: string;
  etiquetaProyecto: string;
  dias: number;
  vencidos: ItemAviso[];
  proximos: ItemAviso[];
  /** Link a la cuenta corriente en Faktia. */
  url: string;
}

const fechaAr = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const importe = (v: string, moneda: 'ARS' | 'USD') =>
  `${moneda === 'USD' ? 'US$' : '$'} ${new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v))}`;
const escapar = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function totales(items: ItemAviso[]): string {
  const porMoneda = new Map<string, number>();
  for (const i of items) porMoneda.set(i.moneda, (porMoneda.get(i.moneda) ?? 0) + Number(i.pendiente));
  return [...porMoneda.entries()]
    .sort(([a]) => (a === 'ARS' ? -1 : 1))
    .map(([m, v]) => importe(v.toFixed(2), m as 'ARS' | 'USD'))
    .join(' · ');
}

function descripcion(i: ItemAviso, etiqueta: string): string {
  return [i.numero ? `${i.concepto} ${i.numero}` : i.concepto, i.proyecto ? `${etiqueta}: ${i.proyecto}` : null].filter(Boolean).join(' · ');
}

export function asuntoAviso(r: ResumenAviso): string {
  const partes = [r.vencidos.length ? `${r.vencidos.length} vencido${r.vencidos.length === 1 ? '' : 's'}` : null, r.proximos.length ? `${r.proximos.length} por vencer` : null];
  return `Faktia · ${r.empresa}: ${partes.filter(Boolean).join(' y ')}`;
}

export function textoAviso(r: ResumenAviso): string {
  const bloque = (titulo: string, items: ItemAviso[]) =>
    items.length
      ? [`${titulo} (${totales(items)})`, ...items.map((i) => `- ${fechaAr(i.fechaVencimiento)} · ${i.cliente} · ${descripcion(i, r.etiquetaProyecto)} · ${importe(i.pendiente, i.moneda)}`)].join('\n')
      : '';
  return [
    `Resumen de cobranzas de ${r.empresa}.`,
    bloque('Vencido', r.vencidos),
    bloque(`Vence en los próximos ${r.dias} días`, r.proximos),
    `Ver la cuenta corriente: ${r.url}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** HTML simple y compatible con clientes de correo: tablas, estilos en línea, colores de Faktia. */
export function htmlAviso(r: ResumenAviso): string {
  const tabla = (titulo: string, items: ItemAviso[], color: string) =>
    items.length
      ? `<h2 style="font-size:16px;margin:24px 0 8px;color:${color}">${escapar(titulo)} <span style="font-weight:400;color:#4A5258">(${escapar(totales(items))})</span></h2>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:14px">
${items
  .map(
    (i) => `<tr>
<td style="padding:8px 8px 8px 0;border-bottom:1px solid #E4E2DA;white-space:nowrap;color:#4A5258">${fechaAr(i.fechaVencimiento)}</td>
<td style="padding:8px;border-bottom:1px solid #E4E2DA"><strong>${escapar(i.cliente)}</strong><br><span style="color:#4A5258">${escapar(descripcion(i, r.etiquetaProyecto))}</span></td>
<td style="padding:8px 0 8px 8px;border-bottom:1px solid #E4E2DA;text-align:right;white-space:nowrap">${importe(i.pendiente, i.moneda)}</td>
</tr>`,
  )
  .join('\n')}
</table>`
      : '';
  return `<!doctype html><html lang="es"><body style="margin:0;background:#F2F1EC;font-family:Arial,Helvetica,sans-serif;color:#1B262D">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#FFFFFF;border:1px solid #E4E2DA;border-radius:4px">
<tr><td style="background:#1E3A4C;color:#F2F1EC;padding:16px 24px;font-size:18px;font-weight:700;border-radius:4px 4px 0 0">faktia</td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 4px;font-size:20px;font-weight:600;color:#1E3A4C">Resumen de cobranzas</p>
<p style="margin:0;color:#4A5258">${escapar(r.empresa)}</p>
${tabla('Vencido', r.vencidos, '#A3352B')}
${tabla(`Vence en los próximos ${r.dias} días`, r.proximos, '#1E3A4C')}
<p style="margin:24px 0 0"><a href="${escapar(r.url)}" style="display:inline-block;background:#A84A2C;color:#FFFFFF;text-decoration:none;padding:10px 16px;border-radius:4px;font-weight:600">Ver la cuenta corriente</a></p>
<p style="margin:16px 0 0;font-size:12px;color:#4A5258">Lo que falta certificar de una obra no aparece acá: no vence. Para dejar de recibir este resumen, desactivalo en Configuración → Preferencias.</p>
</td></tr></table>
</td></tr></table></body></html>`;
}
