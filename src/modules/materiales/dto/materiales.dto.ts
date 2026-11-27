import { Moneda, PreciosListado } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateIf, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const vacioANull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const MONTO = /^\d{1,13}(\.\d{1,2})?$/;
const MSJ_MONTO = 'debe ser un importe con punto decimal y hasta 2 decimales.';
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export class ProveedorDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Falta el nombre o la razón social.' })
  @MaxLength(200)
  nombre: string;

  @IsOptional()
  @Transform(vacioANull)
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\d{2}-?\d{8}-?\d$/, { message: 'El CUIT tiene que tener 11 dígitos.' })
  cuit?: string | null;

  @IsOptional()
  @Transform(vacioANull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  contacto?: string | null;

  @IsOptional()
  @Transform(vacioANull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(60)
  telefono?: string | null;

  @IsOptional()
  @Transform(vacioANull)
  @ValidateIf((_, v) => v !== null)
  @IsEmail({}, { message: 'El email no es válido.' })
  email?: string | null;

  @IsOptional()
  @Transform(vacioANull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  notas?: string | null;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class MaterialDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Falta el nombre.' })
  @MaxLength(200)
  nombre: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Falta la unidad.' })
  @MaxLength(30)
  unidad: string;

  @IsOptional()
  @Transform(vacioANull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(60)
  categoria?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(MONTO, { message: `precioCosto ${MSJ_MONTO}` })
  precioCosto?: string | null;

  @IsOptional()
  @IsEnum(Moneda)
  monedaCosto?: Moneda;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(MONTO, { message: `precioVenta ${MSJ_MONTO}` })
  precioVenta?: string | null;

  @IsOptional()
  @IsEnum(Moneda)
  monedaVenta?: Moneda;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(40)
  proveedorId?: string | null;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class ListarQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsString()
  inactivos?: string;
}

export class RenglonDto {
  @Matches(/^\d{1,10}(\.\d{1,3})?$/, { message: 'La cantidad tiene que ser un número con punto decimal y hasta 3 decimales.' })
  cantidad: string;

  /** Material del catálogo: se copian nombre, unidad y precios. Sin material, va el texto libre. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  materialId?: string;

  /** Texto libre, o el nombre editado del material. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  nombre?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  unidad?: string;

  /** Solo para conservar el precio copiado al editar un listado (lo manda el servidor). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  renglonId?: string;
}

export class ListadoDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Falta el título.' })
  @MaxLength(200)
  titulo: string;

  @Matches(FECHA, { message: 'fecha debe tener formato YYYY-MM-DD.' })
  fecha: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(40)
  proyectoId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(40)
  presupuestoId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(40)
  proveedorId?: string | null;

  @IsOptional()
  @Transform(vacioANull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(300)
  destino?: string | null;

  @IsOptional()
  @Transform(vacioANull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(3000)
  observaciones?: string | null;

  @IsEnum(PreciosListado)
  precios: PreciosListado;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => RenglonDto)
  renglones: RenglonDto[];
}

export class ListarListadosQuery {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  proyectoId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
