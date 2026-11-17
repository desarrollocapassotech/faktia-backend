import { AmbienteArca, CondicionIva } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ActualizarEmisorDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombreFantasia?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  razonSocial?: string;

  /** Se carga una sola vez (las empresas registradas por autoservicio nacen sin CUIT). */
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}-?\d{8}-?\d$/, { message: 'El CUIT tiene que tener 11 dígitos (con o sin guiones).' })
  cuit?: string;

  @IsOptional()
  @IsEnum(CondicionIva)
  condicionIva?: CondicionIva;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  domicilioFiscal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  ingresosBrutos?: string | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'inicioActividades debe tener formato YYYY-MM-DD.' })
  inicioActividades?: string | null;
}

export class CrearPuntoVentaDto {
  @IsInt()
  @Min(1)
  @Max(99998)
  numero: number;

  @IsEnum(AmbienteArca)
  ambiente: AmbienteArca;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  descripcion?: string;
}

export class ActualizarPuntoVentaDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  descripcion?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class CargarCertificadoDto {
  @IsEnum(AmbienteArca)
  ambiente: AmbienteArca;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  certificadoPem: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  clavePrivadaPem: string;
}

export class ActualizarPlantillaPdfDto {
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'colorPrimario debe ser un color hex (#RRGGBB).' })
  colorPrimario?: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'colorSecundario debe ser un color hex (#RRGGBB).' })
  colorSecundario?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  textoPie?: string | null;

  @IsOptional()
  @IsBoolean()
  mostrarDuplicado?: boolean;
}
