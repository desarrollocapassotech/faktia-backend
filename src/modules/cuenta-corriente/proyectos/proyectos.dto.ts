import { EstadoProyecto, ModoIvaProyecto, Moneda } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const MONTO = /^\d{1,13}(\.\d{1,2})?$/;
const MSJ_MONTO = 'debe ser un importe con punto decimal y hasta 2 decimales.';
const TC = /^\d{1,9}(\.\d{1,6})?$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MSJ_FECHA = 'debe tener formato YYYY-MM-DD.';

export class HitoDto {
  /** Hito existente (para conservarlo); sin id, es nuevo. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  id?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Cada hito necesita una descripción.' })
  @MaxLength(200)
  descripcion: string;

  @Matches(MONTO, { message: `importe ${MSJ_MONTO}` })
  importe: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(FECHA, { message: `fechaVencimiento ${MSJ_FECHA}` })
  fechaVencimiento?: string | null;

  /** "Según avance de obra": cuenta en el saldo, pero solo es exigible lo certificado. */
  @IsOptional()
  @IsBoolean()
  porCertificacion?: boolean;
}

/** Monto acordado y su plan de pagos. Los hitos tienen que sumar el acordado. */
export class PlanDto {
  @ValidateIf((_, v) => v !== null)
  @Matches(MONTO, { message: `montoAcordado ${MSJ_MONTO}` })
  montoAcordado: string | null;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => HitoDto)
  hitos: HitoDto[];
}

export class CrearProyectoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  clienteId: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Falta el nombre.' })
  @MaxLength(200)
  nombre: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  ubicacion?: string;

  @IsOptional()
  @IsEnum(Moneda)
  moneda?: Moneda;

  @IsOptional()
  @IsEnum(ModoIvaProyecto)
  modoIva?: ModoIvaProyecto;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(TC, { message: 'tipoCambioFijo debe ser un número con punto decimal.' })
  tipoCambioFijo?: string | null;

  @IsOptional()
  @Matches(FECHA, { message: `fechaInicio ${MSJ_FECHA}` })
  fechaInicio?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  observaciones?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(MONTO, { message: `montoAcordado ${MSJ_MONTO}` })
  montoAcordado?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => HitoDto)
  hitos?: HitoDto[];
}

export class ActualizarProyectoDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Falta el nombre.' })
  @MaxLength(200)
  nombre?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  ubicacion?: string | null;

  @IsOptional()
  @IsEnum(EstadoProyecto)
  estado?: EstadoProyecto;

  /** Solo sin movimientos. */
  @IsOptional()
  @IsEnum(Moneda)
  moneda?: Moneda;

  /** Cambiarlo recalcula los movimientos de las facturas del proyecto. */
  @IsOptional()
  @IsEnum(ModoIvaProyecto)
  modoIva?: ModoIvaProyecto;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(TC, { message: 'tipoCambioFijo debe ser un número con punto decimal.' })
  tipoCambioFijo?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(FECHA, { message: `fechaInicio ${MSJ_FECHA}` })
  fechaInicio?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(FECHA, { message: `fechaFin ${MSJ_FECHA}` })
  fechaFin?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  observaciones?: string | null;
}

export class ListarProyectosQuery {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  clienteId?: string;

  @IsOptional()
  @IsEnum(EstadoProyecto)
  estado?: EstadoProyecto;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class CertificacionDto {
  @Matches(FECHA, { message: `fecha ${MSJ_FECHA}` })
  fecha: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Describí el avance que se certifica.' })
  @MaxLength(300)
  descripcion: string;

  @Matches(MONTO, { message: `importe ${MSJ_MONTO}` })
  importe: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(FECHA, { message: `fechaVencimiento ${MSJ_FECHA}` })
  fechaVencimiento?: string | null;
}

export class AdicionalDto {
  @Matches(FECHA, { message: `fecha ${MSJ_FECHA}` })
  fecha: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Falta el concepto.' })
  @MaxLength(120)
  concepto: string;

  @Matches(MONTO, { message: `importe ${MSJ_MONTO}` })
  importe: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(FECHA, { message: `fechaVencimiento ${MSJ_FECHA}` })
  fechaVencimiento?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  observaciones?: string;
}

/** Entrega del cliente: con recibo (lo normal) o sin recibo (pagos viejos cargados con su fecha original). */
export class EntregaDto {
  @Matches(FECHA, { message: `fecha ${MSJ_FECHA}` })
  fecha: string;

  @IsIn(['ARS', 'USD'])
  moneda: 'ARS' | 'USD';

  @Matches(MONTO, { message: `importe ${MSJ_MONTO}` })
  importe: string;

  /** Pesos por dólar si la entrega no está en la moneda del proyecto. Sin esto: fijo del proyecto o ARCA. */
  @IsOptional()
  @Matches(TC, { message: 'tipoCambio debe ser un número con punto decimal.' })
  tipoCambio?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  medioPago?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  observaciones?: string;

  /** Por defecto sí. Sin recibo: queda como pago manual en la cuenta corriente. */
  @IsOptional()
  @IsBoolean()
  conRecibo?: boolean;

  /** Número del recibo; sin esto, el siguiente al último. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  numero?: string;

  /** Texto del concepto del recibo; por defecto "Entrega a cuenta de la obra …". */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  concepto?: string;
}

export class CotizacionQuery {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  proyectoId?: string;
}
