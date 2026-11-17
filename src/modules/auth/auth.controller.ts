import { Body, Controller, Get, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { AuthContext } from './auth-context';
import { AuthService } from './auth.service';
import { CurrentAuth, Public } from './decorators';
import { LoginDto } from './dto/login.dto';
import { ActualizarPerfilDto, CambiarPasswordDto } from './dto/perfil.dto';
import { RegistroDto } from './dto/registro.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @Post('registro')
  @HttpCode(201)
  registro(@Body() dto: RegistroDto) {
    return this.authService.registrar(dto);
  }

  @Get('me')
  me(@CurrentAuth() auth: AuthContext) {
    return this.authService.perfil(auth);
  }

  @Patch('me')
  actualizarPerfil(@CurrentAuth() auth: AuthContext, @Body() dto: ActualizarPerfilDto) {
    return this.authService.actualizarPerfil(auth, dto);
  }

  /** Devuelve una sesión nueva: cambiar la contraseña cierra todas las anteriores. */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password')
  @HttpCode(200)
  cambiarPassword(@CurrentAuth() auth: AuthContext, @Body() dto: CambiarPasswordDto) {
    return this.authService.cambiarPassword(auth, dto);
  }
}
