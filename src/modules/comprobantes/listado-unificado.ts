import { EstadoComprobante, TipoComprobante, type AmbienteArca, type Moneda, type Prisma } from '@prisma/client';
import type { ReciboResumen } from '../recibos';
import type { ComprobanteListado } from './comprobantes.service';
import type { OrdenComprobantes } from './dto/comprobantes.dto';

/**
 * Fila del listado de comprobantes de la app: comprobantes de ARCA y recibos guardados juntos.
 * Los recibos no tienen punto de venta, CAE ni ambiente; su número es texto libre (`numeroTexto`)
 * y siempre están emitidos.
 */
export interface FilaListado {
  id: string;
  clase: 'comprobante' | 'recibo';
  tipo: TipoComprobante | 'RECIBO_COBRO' | 'RECIBO_PAGO';
  estado: EstadoComprobante;
  ambiente: AmbienteArca | null;
  numero: number | null;
  numeroTexto: string | null;
  puntoVenta: { numero: number } | null;
  fechaEmision: Date;
  moneda: Moneda;
  importeTotal: Prisma.Decimal;
  cae: string | null;
  errorMensaje: string | null;
  createdAt: Date;
  cliente: { id: string | null; razonSocial: string };
}

export function filaDeComprobante(c: ComprobanteListado): FilaListado {
  return { ...c, clase: 'comprobante', numeroTexto: null };
}

export function filaDeRecibo(r: ReciboResumen): FilaListado {
  return {
    id: r.id,
    clase: 'recibo',
    tipo: r.tipo === 'COBRO' ? 'RECIBO_COBRO' : 'RECIBO_PAGO',
    estado: 'EMITIDO',
    ambiente: null,
    numero: null,
    numeroTexto: r.numero,
    puntoVenta: null,
    fechaEmision: r.fecha,
    moneda: r.moneda,
    importeTotal: r.total,
    cae: null,
    errorMensaje: null,
    createdAt: r.createdAt,
    cliente: { id: r.clienteId, razonSocial: r.contraparteNombre },
  };
}

// Mismo orden que en la base: los enums ordenan como están declarados; los recibos, después de las notas.
const ORDEN_TIPO = [...Object.values(TipoComprobante), 'RECIBO_COBRO', 'RECIBO_PAGO'];
const ORDEN_ESTADO = Object.values(EstadoComprobante);
const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

/** "00002-00000015" para comprobantes; el texto del usuario para recibos; null sin número (borradores). */
function numeroOrdenable(f: FilaListado): string | null {
  if (f.clase === 'recibo') return f.numeroTexto?.trim() || null;
  if (f.numero === null || !f.puntoVenta) return null;
  return `${String(f.puntoVenta.numero).padStart(5, '0')}-${String(f.numero).padStart(8, '0')}`;
}

/**
 * Comparador del listado unificado: la misma regla que `ordenListado` (comprobantes) y `ordenRecibos`.
 * Sin columna, los más recientes primero. Sin número, siempre al final. Desempata por creación (más
 * nuevo primero) y por id.
 */
export function compararFilas(por: OrdenComprobantes | undefined, dir: 'asc' | 'desc'): (a: FilaListado, b: FilaListado) => number {
  const signo = dir === 'asc' ? 1 : -1;
  const desempate = (a: FilaListado, b: FilaListado) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  return (a, b) => {
    let cmp = 0;
    switch (por) {
      case 'comprobante':
        cmp = signo * (ORDEN_TIPO.indexOf(a.tipo) - ORDEN_TIPO.indexOf(b.tipo));
        break;
      case 'numero': {
        const na = numeroOrdenable(a);
        const nb = numeroOrdenable(b);
        if (na === null || nb === null) cmp = na === nb ? 0 : na === null ? 1 : -1;
        else cmp = signo * collator.compare(na, nb);
        break;
      }
      case 'fecha':
        cmp = signo * (a.fechaEmision.getTime() - b.fechaEmision.getTime());
        break;
      case 'cliente':
        cmp = signo * collator.compare(a.cliente.razonSocial, b.cliente.razonSocial);
        break;
      case 'total':
        cmp = signo * a.importeTotal.comparedTo(b.importeTotal);
        break;
      case 'estado':
        cmp = signo * (ORDEN_ESTADO.indexOf(a.estado) - ORDEN_ESTADO.indexOf(b.estado));
        break;
    }
    return cmp || desempate(a, b);
  };
}

/**
 * Junta las primeras `pagina × porPagina` filas de cada lado (ya ordenadas y filtradas en la base),
 * las ordena con la misma regla y devuelve la página pedida.
 */
export function paginaUnificada(
  comprobantes: FilaListado[],
  recibos: FilaListado[],
  orden: { por?: OrdenComprobantes; dir?: 'asc' | 'desc' },
  pagina: number,
  porPagina: number,
): FilaListado[] {
  return [...comprobantes, ...recibos].sort(compararFilas(orden.por, orden.dir ?? 'asc')).slice((pagina - 1) * porPagina, pagina * porPagina);
}
