import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ActualizarPerfilDto {
  /** Vacío borra el nombre (se muestra el email). */
  @IsString()
  @MaxLength(120, { message: 'El nombre no puede superar 120 caracteres.' })
  nombre: string;
}

export class CambiarPasswordDto {
  /** Obligatoria si el usuario ya tiene contraseña. Los creados por una integración no tienen. */
  @IsOptional()
  @IsString()
  @MaxLength(72)
  passwordActual?: string;

  @IsString()
  @MinLength(10, { message: 'La contraseña debe tener al menos 10 caracteres.' })
  @MaxLength(72, { message: 'La contraseña no puede superar 72 caracteres.' })
  passwordNueva: string;
}
