import { EstadoPresupuesto, FormaCotizar, IvaPresupuesto, Moneda } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { HitoDto } from '../../cuenta-corriente';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const MONTO = /^\d{1,13}(\.\d{1,2})?$/;
const MSJ_MONTO = 'debe ser un importe con punto decimal y hasta 2 decimales.';
const DECIMAL = /^\d{1,9}(\.\d{1,4})?$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MSJ_FECHA = 'debe tener formato YYYY-MM-DD.';

export class ItemPresupuestoDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  cantidad?: string;

  /** Con formato limitado (HTML del editor): el servidor lo sanea. */
  @IsString()
  @IsNotEmpty({ message: 'Cada ítem necesita una descripción.' })
  @MaxLength(20000)
  descripcion: string;

  /** Solo cotizando por ítem: total del renglón. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(MONTO, { message: `importe ${MSJ_MONTO}` })
  importe?: string | null;
}

export class SuperficieDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DECIMAL, { message: 'ancho debe ser un número con punto decimal.' })
  ancho?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DECIMAL, { message: 'largo debe ser un número con punto decimal.' })
  largo?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DECIMAL, { message: 'alturaLateral debe ser un número con punto decimal.' })
  alturaLateral?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DECIMAL, { message: 'alturaCumbrera debe ser un número con punto decimal.' })
  alturaCumbrera?: string | null;

  /** Sin esto, ancho × largo. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DECIMAL, { message: 'metrosCuadrados debe ser un número con punto decimal.' })
  metrosCuadrados?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(MONTO, { message: `precioMetroCuadrado ${MSJ_MONTO}` })
  precioMetroCuadrado?: string | null;
}

export class ObservacionElegidaDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  texto: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  valor?: string;
}

export class GuardarPresupuestoDto {
  @IsString()
  @IsNotEmpty({ message: 'Elegí un cliente.' })
  @MaxLength(40)
  clienteId: string;

  @Matches(FECHA, { message: `fecha ${MSJ_FECHA}` })
  fecha: string;

  /** Sin esto: la fecha más los días de validez de la empresa. */
  @IsOptional()
  @Matches(FECHA, { message: `fechaVencimiento ${MSJ_FECHA}` })
  fechaVencimiento?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  titulo?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  lugar?: string;

  @IsEnum(Moneda)
  moneda: Moneda;

  @IsEnum(FormaCotizar)
  formaCotizar: FormaCotizar;

  @IsOptional()
  @ValidateNested()
  @Type(() => SuperficieDto)
  superficie?: SuperficieDto | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(MONTO, { message: `importeGlobal ${MSJ_MONTO}` })
  importeGlobal?: string | null;

  @IsEnum(IvaPresupuesto)
  ivaModo: IvaPresupuesto;

  @IsOptional()
  @IsIn(['0', '2.5', '5', '10.5', '21', '27'], { message: 'La alícuota tiene que ser 0, 2,5, 5, 10,5, 21 o 27.' })
  alicuotaIva?: string;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ItemPresupuestoDto)
  items: ItemPresupuestoDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ObservacionElegidaDto)
  observaciones?: ObservacionElegidaDto[];

  /** Texto con formato antes de las observaciones. */
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  notas?: string;
}

export class CambiarEstadoDto {
  @IsIn(['BORRADOR', 'ENVIADO', 'ACEPTADO', 'RECHAZADO'])
  estado: Exclude<EstadoPresupuesto, 'VENCIDO'>;
}

export class DuplicarDto {
  /** El duplicado reemplaza al original (aceptado con cambios): el original queda rechazado. */
  @IsOptional()
  @IsBoolean()
  reemplaza?: boolean;
}

export class CrearProyectoDesdePresupuestoDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  nombre?: string;

  /** Plan de pagos (por ejemplo, de la condición de pago). Sin hitos: un único hito por el acordado. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => HitoDto)
  hitos?: HitoDto[];
}

export class ListarPresupuestosQuery {
  @IsOptional()
  @IsEnum(EstadoPresupuesto)
  estado?: EstadoPresupuesto;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  clienteId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class ItemBibliotecaDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Falta el título.' })
  @MaxLength(120)
  titulo: string;

  @IsString()
  @IsNotEmpty({ message: 'Falta la descripción.' })
  @MaxLength(20000)
  descripcion: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  categoria?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class ObservacionCatalogoDto {
  /** Puede llevar {valor} donde va lo que se completa: "Plazo de obra: {valor}". */
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Falta el texto.' })
  @MaxLength(500)
  texto: string;

  @IsOptional()
  @IsBoolean()
  llevaValor?: boolean;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  valorSugerido?: string;

  @IsOptional()
  @IsBoolean()
  porDefecto?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  orden?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
