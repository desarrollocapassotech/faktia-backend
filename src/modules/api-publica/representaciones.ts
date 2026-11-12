import type {
  ClientePublicoDto,
  ConfiguracionPublicaDto,
  ComprobantePublicoDto,
  ImportacionPublicaDto,
  ItemPublicoDto,
} from './dto/api-publica.dto';

// Cómo se ven los recursos hacia afuera (API pública y webhooks): sin snapshots internos,
// logs de ARCA ni ids de usuarios. Montos como string decimal.

type Dec = { toString(): string };
const fecha = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString().slice(0, 10) : null);
const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

export interface ComprobanteInterno {
  id: string;
  tipo: string;
  estado: string;
  ambiente: string;
  version: number;
  numero: number | null;
  fechaEmision: Date;
  concepto: string;
  fechaServicioDesde: Date | null;
  fechaServicioHasta: Date | null;
  fechaVtoPago: Date | null;
  moneda: string;
  cotizacion: Dec;
  importeNetoGravado: Dec;
  importeIva: Dec;
  importeTributos: Dec;
  importeTotal: Dec;
  cae: string | null;
  caeVencimiento: Date | null;
  errorMensaje: string | null;
  errorDetalle: string | null;
  emitidoEn: Date | null;
  puntoVenta: { numero: number };
  puntoVentaId?: string;
  observaciones?: string | null;
  advertenciaLetra?: string | null;
  cliente: {
    id: string;
    razonSocial: string;
    tipoDocumento: string;
    numeroDocumento: string;
    condicionIva: string;
    domicilio?: string | null;
    email?: string | null;
  };
  lineas: Array<{
    descripcion: string;
    cantidad: Dec;
    unidad: string;
    precioUnitario: Dec;
    bonificacionPct?: Dec;
    alicuotaIva: Dec;
    importeNeto: Dec;
    importeTotal: Dec;
  }>;
  asociado: { id: string; tipo: string; numero: number | null } | null;
  asociadosDesde?: Array<{ id: string; tipo: string; numero: number | null; estado: string }>;
  items?: Array<{ referenciaExterna: string; metadatos: unknown }>;
}

/** Claves que agrega el staging a los metadatos: no son del integrador y no se devuelven. */
const METADATOS_INTERNOS = ['precioDeTarifa', 'tarifaId', 'descripcionOriginal', 'valoresOriginales'];

export function metadatosPublicos(m: unknown): Record<string, unknown> {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return {};
  return Object.fromEntries(Object.entries(m).filter(([k]) => !METADATOS_INTERNOS.includes(k)));
}

export function clientePublico(c: ComprobanteInterno['cliente']): ClientePublicoDto {
  return {
    id: c.id,
    razonSocial: c.razonSocial,
    tipoDocumento: c.tipoDocumento,
    numeroDocumento: c.numeroDocumento,
    condicionIva: c.condicionIva,
    domicilio: c.domicilio ?? null,
    email: c.email ?? null,
  };
}

export function comprobantePublico(c: ComprobanteInterno): ComprobantePublicoDto {
  const desde = fecha(c.fechaServicioDesde);
  const hasta = fecha(c.fechaServicioHasta);
  return {
    id: c.id,
    tipo: c.tipo,
    estado: c.estado,
    ambiente: c.ambiente,
    version: c.version,
    puntoVenta: c.puntoVenta.numero,
    puntoVentaId: c.puntoVentaId ?? null,
    numero: c.numero,
    fechaEmision: fecha(c.fechaEmision) as string,
    concepto: c.concepto,
    periodo: desde && hasta ? { desde, hasta } : null,
    vencimientoPago: fecha(c.fechaVtoPago),
    moneda: c.moneda,
    cotizacion: c.cotizacion.toString(),
    importes: {
      netoGravado: c.importeNetoGravado.toString(),
      iva: c.importeIva.toString(),
      tributos: c.importeTributos.toString(),
      total: c.importeTotal.toString(),
    },
    cae: c.cae,
    caeVencimiento: fecha(c.caeVencimiento),
    cliente: clientePublico(c.cliente),
    lineas: c.lineas.map((l) => ({
      descripcion: l.descripcion,
      cantidad: l.cantidad.toString(),
      unidad: l.unidad,
      precioUnitario: l.precioUnitario.toString(),
      bonificacionPct: l.bonificacionPct?.toString() ?? '0',
      alicuotaIva: l.alicuotaIva.toString(),
      importeNeto: l.importeNeto.toString(),
      importeTotal: l.importeTotal.toString(),
    })),
    asociado: c.asociado ? { id: c.asociado.id, tipo: c.asociado.tipo, numero: c.asociado.numero } : null,
    notas: (c.asociadosDesde ?? []).map((n) => ({ id: n.id, tipo: n.tipo, numero: n.numero, estado: n.estado })),
    observaciones: c.observaciones ?? null,
    items: (c.items ?? []).map((i) => ({ referenciaExterna: i.referenciaExterna, metadatos: metadatosPublicos(i.metadatos) })),
    advertenciaLetra: c.advertenciaLetra ?? null,
    error:
      c.errorMensaje && (c.estado === 'RECHAZADO' || c.estado === 'PENDIENTE_VERIFICACION')
        ? { mensaje: c.errorMensaje, detalle: c.errorDetalle }
        : null,
    emitidoEn: iso(c.emitidoEn),
  };
}

export interface ItemInterno {
  id: string;
  referenciaExterna: string;
  estado: string;
  errores: unknown;
  clienteId: string | null;
  descripcion: string;
  cantidad: Dec;
  unidad: string;
  precioUnitario: Dec;
  moneda: string;
  alicuotaIva: Dec;
  comprobanteId: string | null;
  importacionId: string | null;
}

export function itemPublico(i: ItemInterno): ItemPublicoDto {
  return {
    id: i.id,
    referenciaExterna: i.referenciaExterna,
    estado: i.estado,
    errores: Array.isArray(i.errores) ? (i.errores as ItemPublicoDto['errores']) : [],
    clienteId: i.clienteId,
    descripcion: i.descripcion,
    cantidad: i.cantidad.toString(),
    unidad: i.unidad,
    precioUnitario: i.precioUnitario.toString(),
    moneda: i.moneda,
    alicuotaIva: i.alicuotaIva.toString(),
    comprobanteId: i.comprobanteId,
    importacionId: i.importacionId,
  };
}

export interface ImportacionInterna {
  id: string;
  estado: string;
  origen: string;
  descripcion: string | null;
  totalItems: number;
  validos: number;
  conErrores: number;
  duplicados: number;
  actualizados: number;
  advertencias: unknown;
  createdAt: Date;
}

export function importacionPublica(i: ImportacionInterna): ImportacionPublicaDto {
  return {
    id: i.id,
    estado: i.estado,
    origen: i.origen,
    descripcion: i.descripcion,
    totalItems: i.totalItems,
    validos: i.validos,
    conErrores: i.conErrores,
    duplicados: i.duplicados,
    actualizados: i.actualizados,
    advertencias: Array.isArray(i.advertencias) ? (i.advertencias as ImportacionPublicaDto['advertencias']) : [],
    createdAt: i.createdAt.toISOString(),
  };
}

export interface ConfiguracionInterna {
  emisor: {
    razonSocial: string;
    nombreFantasia: string;
    cuit: string;
    condicionIva: string;
    domicilioFiscal: string;
    ingresosBrutos: string | null;
    inicioActividades: Date | null;
    ambienteArca: string;
  };
  puntosVenta: Array<{ id: string; numero: number; ambiente: string; descripcion: string | null; activo: boolean }>;
}

/** Datos de solo lectura para armar comprobantes desde otro sistema (la configuración se edita en Faktia). */
export function configuracionPublica(c: ConfiguracionInterna): ConfiguracionPublicaDto {
  return {
    emisor: {
      razonSocial: c.emisor.razonSocial,
      nombreFantasia: c.emisor.nombreFantasia,
      cuit: c.emisor.cuit,
      condicionIva: c.emisor.condicionIva,
      domicilioFiscal: c.emisor.domicilioFiscal,
      ingresosBrutos: c.emisor.ingresosBrutos,
      inicioActividades: c.emisor.inicioActividades ? c.emisor.inicioActividades.toISOString().slice(0, 10) : null,
      ambiente: c.emisor.ambienteArca,
    },
    puntosVenta: c.puntosVenta
      .filter((p) => p.activo && p.ambiente === c.emisor.ambienteArca)
      .map((p) => ({ id: p.id, numero: p.numero, descripcion: p.descripcion })),
  };
}
