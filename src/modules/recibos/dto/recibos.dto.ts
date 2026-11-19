import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const MONTO = /^\d{1,13}(\.\d{1,2})?$/;
const MSJ_MONTO = 'debe ser un importe con punto decimal y hasta 2 decimales.';

export class ParteDto {
  @IsString()
  @IsNotEmpty({ message: 'Falta el nombre de la contraparte.' })
  @MaxLength(200)
  nombre: string;

  /** Ya formateado: "CUIT 20-12345678-9", "DNI 12.345.678". */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  documento?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  domicilio?: string;
}

export class ItemReciboDto {
  @IsString()
  @IsNotEmpty({ message: 'Cada concepto necesita una descripción.' })
  @MaxLength(500)
  descripcion: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  cantidad?: string;

  @Matches(MONTO, { message: `importe ${MSJ_MONTO}` })
  importe: string;
}

export class ComprobanteAplicadoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  descripcion: string;

  @Matches(MONTO, { message: `importe ${MSJ_MONTO}` })
  importe: string;

  /** Id del comprobante de Faktia que cancela: con él, el cobro se imputa solo en la cuenta corriente. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  comprobanteId?: string;
}

/**
 * La parte del tenant (quien cobra en COBRO, quien paga en PAGO) la completa el servidor con los
 * datos del emisor: acá solo viene la contraparte (el cliente que paga o el beneficiario que cobra).
 */
export class GenerarReciboDto {
  @IsIn(['COBRO', 'PAGO'])
  tipo: 'COBRO' | 'PAGO';

  @IsOptional()
  @IsString()
  @MaxLength(30)
  numero?: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fecha debe tener formato YYYY-MM-DD.' })
  fecha: string;

  @IsIn(['ARS', 'USD'])
  moneda: 'ARS' | 'USD';

  @ValidateNested()
  @Type(() => ParteDto)
  contraparte: ParteDto;

  @ValidateNested({ each: true })
  @Type(() => ItemReciboDto)
  @ArrayMinSize(1, { message: 'El recibo necesita al menos un concepto.' })
  @ArrayMaxSize(200)
  items: ItemReciboDto[];

  @Matches(MONTO, { message: `total ${MSJ_MONTO}` })
  total: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  medioPago?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observaciones?: string;

  /** Solo COBRO. */
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ComprobanteAplicadoDto)
  @ArrayMaxSize(50)
  comprobantesAplicados?: ComprobanteAplicadoDto[];

  /** Solo PAGO. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  periodo?: string;
}

/** Crear (guardar) un recibo: lo mismo que para el PDF, más el cliente si se eligió uno cargado. */
export class CrearReciboDto extends GenerarReciboDto {
  /** Solo COBRO: cliente de Faktia que paga (sus datos igual vienen en `contraparte`). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  clienteId?: string;
}

export class VerificarReciboQuery {
  /** Firma del link de verificación (la pone el QR del recibo). */
  @IsString()
  @MaxLength(64)
  c: string;
}

export class SiguienteNumeroQuery {
  @IsIn(['COBRO', 'PAGO'])
  tipo: 'COBRO' | 'PAGO';
}
