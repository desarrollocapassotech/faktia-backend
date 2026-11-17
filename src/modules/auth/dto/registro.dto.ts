import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/** Registro por autoservicio: lo mínimo para entrar. Los datos fiscales se completan después en Configuración. */
export class RegistroDto {
  @IsString()
  @IsNotEmpty({ message: 'Falta el nombre de la empresa.' })
  @MaxLength(120, { message: 'El nombre de la empresa no puede superar 120 caracteres.' })
  nombreEmpresa: string;

  @IsEmail({}, { message: 'El email no es válido.' })
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(10, { message: 'La contraseña debe tener al menos 10 caracteres.' })
  @MaxLength(72, { message: 'La contraseña no puede superar 72 caracteres.' })
  password: string;
}
