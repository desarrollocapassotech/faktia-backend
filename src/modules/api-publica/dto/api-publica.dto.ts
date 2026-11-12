import { Type } from 'class-transformer';
import { CrearClienteDto } from '../../clientes';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// DTOs de la API pública (/api/v1). El plugin de Swagger (nest-cli.json) genera la documentación
// a partir de estos tipos y de los comentarios /** … */ de cada propiedad.

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// ── Entrada ────────────────────────────────────────────────────────────────

export class CrearClienteApiDto extends CrearClienteDto {
  /** Id del cliente en tu sistema: queda asociado y los ítems que lo usen lo encuentran. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  referenciaExterna?: string;
}

export class VincularReferenciaDto {
  /** Id del cliente en tu sistema. Si ya estaba asociado a otro cliente, pasa a este. */
  @IsString()
  @MaxLength(200)
  referenciaExterna: string;
}

export class AltaClienteDto {
  /** Razón social para dar de alta al cliente si no existe (se ofrece en el staging). */
  @IsString()
  @MaxLength(200)
  razonSocial: string;

  /** RESPONSABLE_INSCRIPTO, MONOTRIBUTO, EXENTO, CONSUMIDOR_FINAL, … */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  condicionIva?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  domicilio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;
}

/** Cómo identificar al cliente: por id de Faktia, por documento o por tu propio id. */
export class ClienteRefDto {
  /** Id del cliente en Faktia. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  clienteId?: string;

  /** Tipo de documento, si se identifica por documento. */
  @IsOptional()
  @IsIn(['CUIT', 'CUIL', 'DNI', 'PASAPORTE', 'CONSUMIDOR_FINAL'])
  tipoDocumento?: 'CUIT' | 'CUIL' | 'DNI' | 'PASAPORTE' | 'CONSUMIDOR_FINAL';

  /** Número de documento (con o sin guiones). */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  numeroDocumento?: string;

  /** Id del cliente en tu sistema. Se asocia al cliente de Faktia la primera vez que se resuelve. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  referenciaExterna?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AltaClienteDto)
  alta?: AltaClienteDto;
}

export class PeriodoDto {
  /** YYYY-MM-DD */
  @Matches(FECHA, { message: 'periodo.desde debe tener formato YYYY-MM-DD.' })
  desde: string;

  /** YYYY-MM-DD */
  @Matches(FECHA, { message: 'periodo.hasta debe tener formato YYYY-MM-DD.' })
  hasta: string;
}

/**
 * Un concepto a facturar. La validación de contenido (montos, alícuota, cliente, período) la hace
 * el staging por ítem: un ítem inválido no rechaza el lote, queda CON_ERRORES con el detalle.
 */
export class ItemApiDto {
  /** Id estable en tu sistema. Reenviar la misma referencia con los mismos datos no duplica; con datos distintos, actualiza. */
  @IsString()
  @MaxLength(200)
  referenciaExterna: string;

  @ValidateNested()
  @Type(() => ClienteRefDto)
  cliente: ClienteRefDto;

  @IsString()
  @MaxLength(500)
  descripcion: string;

  /** Decimal como string, con punto: "10.5". */
  @IsString()
  @MaxLength(30)
  cantidad: string;

  @IsIn(['HORA', 'UNIDAD', 'SERVICIO', 'MES'])
  unidad: 'HORA' | 'UNIDAD' | 'SERVICIO' | 'MES';

  /** Sin IVA, decimal como string. Si falta, se toma de la tarifa vigente del cliente. */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  precioUnitario?: string;

  @IsOptional()
  @IsIn(['ARS', 'USD'])
  moneda?: 'ARS' | 'USD';

  /** "0", "2.5", "5", "10.5", "21" o "27". */
  @IsOptional()
  @IsString()
  @MaxLength(5)
  alicuotaIva?: string;

  /** YYYY-MM-DD */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  fecha?: string;

  /** Período del servicio (ARCA lo exige para servicios; si no hay, se usa `fecha`). */
  @IsOptional()
  @ValidateNested()
  @Type(() => PeriodoDto)
  periodo?: PeriodoDto;

  /** Datos libres que querés conservar con el ítem (se devuelven tal cual). */
  @IsOptional()
  @IsObject()
  metadatos?: Record<string, unknown>;
}

export class CargarItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemApiDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  items: ItemApiDto[];

  /** Texto para reconocer el lote en Faktia. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  descripcion?: string;

  /** Confirmar el lote en el mismo request (deja los ítems válidos listos para facturar). */
  @IsOptional()
  @IsBoolean()
  confirmar?: boolean;
}

export class GenerarBorradoresApiDto {
  /** Ids de ítems de Faktia. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(2000)
  itemIds?: string[];

  /** O tus propias referencias (`referenciaExterna`) de los ítems. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(2000)
  referencias?: string[];

  /** O todos los ítems válidos de una importación confirmada. */
  @IsOptional()
  @IsString()
  importacionId?: string;

  /** `cliente`: un borrador por cliente y moneda. `cliente-periodo`: además, uno por mes. */
  @IsOptional()
  @IsIn(['cliente', 'cliente-periodo'])
  agrupacion?: 'cliente' | 'cliente-periodo';

  /** YYYY-MM-DD; por defecto, hoy. */
  @IsOptional()
  @Matches(FECHA)
  fechaEmision?: string;
}

export class EmitirApiDto {
  /** Versión del comprobante que viste (lock optimista). Si se omite, se emite la versión actual. */
  @IsOptional()
  @IsInt()
  @Min(0)
  version?: number;
}

export class ListarComprobantesApiQuery {
  @IsOptional()
  @IsIn(['BORRADOR', 'EMITIENDO', 'PENDIENTE_VERIFICACION', 'EMITIDO', 'RECHAZADO', 'ANULADO'])
  estado?: 'BORRADOR' | 'EMITIENDO' | 'PENDIENTE_VERIFICACION' | 'EMITIDO' | 'RECHAZADO' | 'ANULADO';

  @IsOptional()
  @IsString()
  clienteId?: string;

  /** YYYY-MM: comprobantes cuyo período de servicio abarca ese mes (ej. las facturas de octubre: `2026-10`). */
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'periodo debe tener formato YYYY-MM.' })
  periodo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  porPagina?: number;
}

// ── Salida ─────────────────────────────────────────────────────────────────

export class ErrorItemDto {
  campo: string;
  mensaje: string;
}

export class ItemPublicoDto {
  id: string;
  referenciaExterna: string;
  /** VALIDO, CON_ERRORES, EN_BORRADOR, FACTURADO o DESCARTADO. */
  estado: string;
  errores: ErrorItemDto[];
  clienteId: string | null;
  descripcion: string;
  cantidad: string;
  unidad: string;
  precioUnitario: string;
  moneda: string;
  alicuotaIva: string;
  /** Comprobante al que pertenece (borrador o emitido). */
  comprobanteId: string | null;
  importacionId: string | null;
}

export class AdvertenciaDto {
  /** Referencia del ítem al que se refiere, si aplica. */
  referencia?: string;
  mensaje: string;
}

export class ImportacionPublicaDto {
  id: string;
  /** EN_STAGING, CONFIRMADA o DESCARTADA. */
  estado: string;
  origen: string;
  descripcion: string | null;
  totalItems: number;
  validos: number;
  conErrores: number;
  /** Reenviados sin cambios (idempotencia por referencia). */
  duplicados: number;
  actualizados: number;
  advertencias: AdvertenciaDto[];
  createdAt: string;
}

export class ResultadoCargaDto {
  importacion: ImportacionPublicaDto;
  items: ItemPublicoDto[];
}

export class ClientePublicoDto {
  id: string;
  razonSocial: string;
  tipoDocumento: string;
  numeroDocumento: string;
  condicionIva: string;
  domicilio: string | null;
  email: string | null;
}

export class ClienteVinculadoDto {
  /** Id del cliente en tu sistema. */
  referenciaExterna: string;
  cliente: ClientePublicoDto;
}

export class PadronDto {
  cuit: string;
  razonSocial: string;
  domicilio: string | null;
  /** Condición de IVA según ARCA, lista para dar de alta al cliente. */
  condicionIva: string | null;
  /** Ambiente de ARCA en el que se consultó. */
  ambiente: string;
}

export class EmisorPublicoDto {
  razonSocial: string;
  nombreFantasia: string;
  cuit: string;
  condicionIva: string;
  /** HOMOLOGACION (sin validez fiscal) o PRODUCCION. */
  ambiente: string;
}

export class PuntoVentaPublicoDto {
  id: string;
  numero: number;
  descripcion: string | null;
}

export class ConfiguracionPublicaDto {
  emisor: EmisorPublicoDto;
  /** Puntos de venta activos del ambiente actual (para `puntoVentaId` al crear un borrador). */
  puntosVenta: PuntoVentaPublicoDto[];
}

export class LineaPublicaDto {
  descripcion: string;
  cantidad: string;
  unidad: string;
  precioUnitario: string;
  bonificacionPct: string;
  alicuotaIva: string;
  importeNeto: string;
  importeTotal: string;
}

export class ImportesDto {
  netoGravado: string;
  iva: string;
  tributos: string;
  total: string;
}

export class ComprobanteAsociadoDto {
  id: string;
  tipo: string;
  numero: number | null;
}

export class NotaAsociadaDto {
  id: string;
  tipo: string;
  numero: number | null;
  estado: string;
}

export class ErrorComprobanteDto {
  mensaje: string;
  detalle: string | null;
}

export class PeriodoPublicoDto {
  desde: string;
  hasta: string;
}

export class ItemDelComprobanteDto {
  referenciaExterna: string;
  /** Los `metadatos` que mandaste con el ítem. */
  metadatos: Record<string, unknown>;
}

export class ComprobantePublicoDto {
  id: string;
  /** FACTURA_A, NOTA_CREDITO_B, … */
  tipo: string;
  /** BORRADOR, EMITIENDO, PENDIENTE_VERIFICACION, EMITIDO, RECHAZADO o ANULADO. */
  estado: string;
  /** HOMOLOGACION (sin validez fiscal) o PRODUCCION. */
  ambiente: string;
  /** Versión para el lock optimista al emitir. */
  version: number;
  puntoVenta: number;
  puntoVentaId: string | null;
  numero: number | null;
  fechaEmision: string;
  concepto: string;
  periodo: PeriodoPublicoDto | null;
  vencimientoPago: string | null;
  moneda: string;
  cotizacion: string;
  importes: ImportesDto;
  cae: string | null;
  caeVencimiento: string | null;
  cliente: ClientePublicoDto;
  lineas: LineaPublicaDto[];
  /** Factura asociada (solo notas de crédito o débito). */
  asociado: ComprobanteAsociadoDto | null;
  /** Notas de crédito o débito hechas sobre esta factura. */
  notas: NotaAsociadaDto[];
  observaciones: string | null;
  /** Ítems facturados en este comprobante, con tu referencia y tus metadatos (vacío si se cargó a mano). */
  items: ItemDelComprobanteDto[];
  /** Aviso si la letra elegida no es la habitual para el emisor y el cliente. */
  advertenciaLetra: string | null;
  /** Motivo del rechazo de ARCA o del estado pendiente. */
  error: ErrorComprobanteDto | null;
  emitidoEn: string | null;
}

export class BorradoresGeneradosDto {
  comprobantes: ComprobantePublicoDto[];
}

export class ComprobantesPaginadosDto {
  total: number;
  pagina: number;
  porPagina: number;
  items: ComprobantePublicoDto[];
}
