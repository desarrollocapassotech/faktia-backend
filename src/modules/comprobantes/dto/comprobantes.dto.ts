import { ConceptoArca, EstadoComprobante, Moneda, TipoComprobante, UnidadItem } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  ValidateNested,
} from 'class-validator';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
export const PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/;
const aTexto = ({ value }: { value: unknown }) => (typeof value === 'number' ? String(value) : value);

export class LineaDto {
  @IsString()
  @IsNotEmpty({ message: 'Cada línea necesita una descripción.' })
  @MaxLength(500)
  descripcion: string;

  @Transform(aTexto)
  @Matches(/^\d{1,11}(\.\d{1,4})?$/, { message: 'cantidad debe ser un número con hasta 4 decimales.' })
  cantidad: string;

  @IsEnum(UnidadItem)
  unidad: UnidadItem;

  @Transform(aTexto)
  @Matches(/^\d{1,11}(\.\d{1,4})?$/, { message: 'precioUnitario debe ser un número con hasta 4 decimales.' })
  precioUnitario: string;

  @IsOptional()
  @Transform(aTexto)
  @Matches(/^\d{1,2}(\.\d{1,2})?$/, { message: 'bonificacionPct debe estar entre 0 y 99,99.' })
  bonificacionPct?: string;

  @Transform(aTexto)
  @IsIn(['0', '2.5', '5', '10.5', '21', '27'], { message: 'alicuotaIva debe ser 0, 2.5, 5, 10.5, 21 o 27.' })
  alicuotaIva: string;
}

export class CrearBorradorDto {
  @IsString()
  @IsNotEmpty()
  clienteId: string;

  @IsString()
  @IsNotEmpty()
  puntoVentaId: string;

  /** Si se omite, se usa la letra sugerida. Solo facturas: las notas se crean desde la factura. */
  @IsOptional()
  @IsIn(['FACTURA_A', 'FACTURA_B', 'FACTURA_C'])
  tipo?: TipoComprobante;

  @Matches(FECHA, { message: 'fechaEmision debe tener formato YYYY-MM-DD.' })
  fechaEmision: string;

  @IsEnum(ConceptoArca)
  concepto: ConceptoArca;

  @IsOptional()
  @Matches(FECHA)
  fechaServicioDesde?: string | null;

  @IsOptional()
  @Matches(FECHA)
  fechaServicioHasta?: string | null;

  @IsOptional()
  @Matches(FECHA)
  fechaVtoPago?: string | null;

  @IsOptional()
  @IsEnum(Moneda)
  moneda?: Moneda;

  @IsOptional()
  @IsBoolean()
  cancelaMismaMoneda?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observaciones?: string | null;

  @ValidateNested({ each: true })
  @Type(() => LineaDto)
  @ArrayMinSize(1, { message: 'El comprobante necesita al menos una línea.' })
  @ArrayMaxSize(200)
  lineas: LineaDto[];
}

export class ActualizarBorradorDto {
  @IsInt()
  version: number;

  @IsOptional()
  @IsString()
  clienteId?: string;

  @IsOptional()
  @IsString()
  puntoVentaId?: string;

  @IsOptional()
  @IsEnum(TipoComprobante)
  tipo?: TipoComprobante;

  @IsOptional()
  @Matches(FECHA)
  fechaEmision?: string;

  @IsOptional()
  @IsEnum(ConceptoArca)
  concepto?: ConceptoArca;

  @IsOptional()
  @Matches(FECHA)
  fechaServicioDesde?: string | null;

  @IsOptional()
  @Matches(FECHA)
  fechaServicioHasta?: string | null;

  @IsOptional()
  @Matches(FECHA)
  fechaVtoPago?: string | null;

  @IsOptional()
  @IsEnum(Moneda)
  moneda?: Moneda;

  @IsOptional()
  @IsBoolean()
  cancelaMismaMoneda?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observaciones?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string | null;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => LineaDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  lineas?: LineaDto[];
}

export class EmitirDto {
  @IsInt()
  version: number;
}

export class CrearNotaDto {
  @IsIn(['NOTA_CREDITO', 'NOTA_DEBITO'])
  clase: 'NOTA_CREDITO' | 'NOTA_DEBITO';

  @IsString()
  @IsNotEmpty({ message: 'Indicá el motivo de la nota.' })
  @MaxLength(500)
  motivo: string;
}

export class GenerarBorradoresDto {
  @IsOptional()
  @IsString({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  itemIds?: string[];

  @IsOptional()
  @IsString()
  importacionId?: string;

  /** 'cliente': un borrador por cliente y moneda. 'cliente-periodo': además, uno por mes. */
  @IsOptional()
  @IsIn(['cliente', 'cliente-periodo'])
  agrupacion?: 'cliente' | 'cliente-periodo';

  @IsOptional()
  @IsString()
  puntoVentaId?: string;

  @IsOptional()
  @Matches(FECHA, { message: 'fechaEmision debe tener formato YYYY-MM-DD.' })
  fechaEmision?: string;
}

export class ListarComprobantesQuery {
  @IsOptional()
  @IsEnum(EstadoComprobante)
  estado?: EstadoComprobante;

  @IsOptional()
  @IsString()
  clienteId?: string;

  /** YYYY-MM: comprobantes cuyo período de servicio abarca ese mes. */
  @IsOptional()
  @Matches(PERIODO, { message: 'periodo debe tener formato YYYY-MM.' })
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
