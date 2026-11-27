import type { SeccionRecibo } from './core';

/**
 * Copia del estado de un proyecto (obra) que guarda un recibo de cobro al emitirse. La arma la cuenta
 * corriente; el recibo solo la muestra. Importes como string decimal en la moneda del proyecto y fechas
 * YYYY-MM-DD.
 */
export interface EstadoProyectoRecibo {
  /** Etiqueta de la empresa para sus proyectos ("Obra"). */
  etiqueta: string;
  nombre: string;
  ubicacion: string | null;
  moneda: 'ARS' | 'USD';
  montoAcordado: string | null;
  modoIva: 'MAS_IVA' | 'ACORDADO_FINAL';
  /** Trabajos adicionales y otros cargos del proyecto (sin los hitos). */
  adicionales: string;
  entregas: Array<{
    fecha: string;
    descripcion: string;
    importe: string;
    /** La entrega de este recibo. */
    esEsta?: boolean;
  }>;
  totalEntregado: string;
  saldo: string;
  saldoExigible: string;
  /** Lo que falta cobrar: hitos pendientes, lo que falta certificar y cargos. */
  pendientes: Array<{ descripcion: string; importe: string; vencimiento: string | null; aCertificar?: boolean }>;
  calculadoEn: string;
}

const fechaAr = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

export function formatearImporte(importe: string, moneda: 'ARS' | 'USD'): string {
  const n = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(importe));
  return `${moneda === 'USD' ? 'US$' : '$'} ${n}`;
}

/** Las tablas del PDF del recibo para el estado del proyecto: acordado, entregas y saldo con lo que falta. */
export function seccionesDeEstado(e: EstadoProyectoRecibo): SeccionRecibo[] {
  const $ = (v: string) => formatearImporte(v, e.moneda);
  const secciones: SeccionRecibo[] = [];
  const resumen: SeccionRecibo['filas'] = [];
  if (e.montoAcordado !== null) {
    resumen.push({ texto: `Monto acordado${e.modoIva === 'MAS_IVA' ? ' (más IVA)' : ''}`, importe: $(e.montoAcordado) });
  }
  if (Number(e.adicionales) > 0) resumen.push({ texto: 'Adicionales y otros cargos', importe: $(e.adicionales) });
  if (resumen.length) {
    secciones.push({ titulo: `${e.etiqueta}: ${e.nombre}${e.ubicacion ? ` (${e.ubicacion})` : ''}`, filas: resumen });
  }
  if (e.entregas.length) {
    secciones.push({
      titulo: 'Entregas',
      filas: [
        ...e.entregas.map((x) => ({ texto: x.esEsta ? `${x.descripcion} (este recibo)` : x.descripcion, detalle: fechaAr(x.fecha), importe: $(x.importe) })),
        { texto: 'Total entregado', importe: $(e.totalEntregado), destacado: true },
      ],
    });
  }
  const saldo: SeccionRecibo['filas'] = [{ texto: 'Saldo pendiente', importe: $(e.saldo), destacado: true }];
  for (const p of e.pendientes) {
    saldo.push({
      texto: p.aCertificar ? `${p.descripcion} (a certificar)` : p.descripcion,
      detalle: p.vencimiento ? `Vence ${fechaAr(p.vencimiento)}` : undefined,
      importe: $(p.importe),
    });
  }
  secciones.push({ titulo: 'Saldo', filas: saldo });
  return secciones;
}
