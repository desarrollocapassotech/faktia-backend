import { Moneda, TipoMovimientoCc } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const MONTO = /^\d{1,13}(\.\d{1,2})?$/;
const MSJ_MONTO = 'debe ser un importe mayor a 0, con punto decimal y hasta 2 decimales.';
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MSJ_FECHA = 'debe tener formato YYYY-MM-DD.';

export class ResumenQuery {
  /** Ventana de "próximos a vencer", en días desde hoy. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  diasProximos?: number;
}

/** Movimiento cargado a mano: saldo inicial, ajuste, venta sin factura (DEBE) o cobro sin recibo (HABER). */
export class CrearMovimientoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  clienteId: string;

  @IsEnum(TipoMovimientoCc)
  tipo: TipoMovimientoCc;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Falta el concepto.' })
  @MaxLength(120)
  concepto: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  numero?: string;

  @Matches(FECHA, { message: `fecha ${MSJ_FECHA}` })
  fecha: string;

  /** Solo DEBE. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(FECHA, { message: `fechaVencimiento ${MSJ_FECHA}` })
  fechaVencimiento?: string | null;

  @IsEnum(Moneda)
  moneda: Moneda;

  @Matches(MONTO, { message: `importe ${MSJ_MONTO}` })
  importe: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  observaciones?: string;

  /**
   * Proyecto (obra): un adicional (DEBE) o un pago sin recibo (HABER), por ejemplo las entregas viejas
   * cargadas con su fecha original. El pago se imputa solo a las deudas del proyecto.
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  proyectoId?: string;

  /** Pago en otra moneda que el proyecto: pesos por dólar. Sin esto, el fijo del proyecto o la cotización de ARCA. */
  @IsOptional()
  @Matches(/^\d{1,9}(\.\d{1,6})?$/, { message: 'tipoCambio debe ser un número con punto decimal.' })
  tipoCambio?: string;

  /** Solo HABER: DEBE de la misma cuenta y moneda a los que se aplica, del más viejo al más nuevo. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  imputarA?: string[];
}

/**
 * Editar un movimiento. Los manuales admiten todo; los de comprobantes y recibos, solo el
 * vencimiento (el resto sale del comprobante).
 */
export class ActualizarMovimientoDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Falta el concepto.' })
  @MaxLength(120)
  concepto?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  numero?: string | null;

  @IsOptional()
  @Matches(FECHA, { message: `fecha ${MSJ_FECHA}` })
  fecha?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(FECHA, { message: `fechaVencimiento ${MSJ_FECHA}` })
  fechaVencimiento?: string | null;

  @IsOptional()
  @Matches(MONTO, { message: `importe ${MSJ_MONTO}` })
  importe?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  observaciones?: string | null;
}

export class CrearImputacionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  haberId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  debeId: string;

  /** Sin importe: todo lo posible (lo que le falta al DEBE o lo que le queda al HABER). */
  @IsOptional()
  @Matches(MONTO, { message: `importe ${MSJ_MONTO}` })
  importe?: string;
}
