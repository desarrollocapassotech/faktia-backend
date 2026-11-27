import { BadRequestException, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { CurrentAuth, Modulo, UsuariosService, type AuthContext } from '../auth';
import { AvisosService } from './avisos.service';

/** Avisos de vencimientos por email: vista previa, prueba y últimos envíos. */
@Modulo('cuenta-corriente')
@Controller('avisos')
export class AvisosController {
  constructor(
    private readonly avisos: AvisosService,
    private readonly usuarios: UsuariosService,
  ) {}

  @Get('vista-previa')
  vistaPrevia(@CurrentAuth() auth: AuthContext) {
    return this.avisos.armar(auth.tenantId);
  }

  @Get('historial')
  historial(@CurrentAuth() auth: AuthContext) {
    return this.avisos.historial(auth.tenantId);
  }

  /** Manda el resumen de hoy solo a quien lo pide (para probar el SMTP). */
  @Post('probar')
  @HttpCode(200)
  async probar(@CurrentAuth() auth: AuthContext) {
    const email = auth.usuarioId ? await this.usuarios.email(auth.tenantId, auth.usuarioId) : null;
    if (!email) throw new BadRequestException('La prueba se pide con la sesión de un usuario.');
    return this.avisos.enviar(auth.tenantId, [email]);
  }
}
