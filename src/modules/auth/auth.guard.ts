import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthContext } from './auth-context';
import { AuthService } from './auth.service';
import type { Scope } from './claves';
import { API_KEY_SCOPES, IS_PUBLIC_KEY } from './decorators';
import { FirebaseFederacionService } from './firebase-federacion.service';
import { IntegracionesService } from './integraciones.service';

/**
 * Guard global: toda ruta requiere sesión salvo las marcadas con @Public().
 * Las rutas @ApiKey(...) son solo para integraciones: exigen `X-Api-Key` con los scopes
 * pedidos y rechazan la sesión de usuario (opcional `X-Usuario-Email`: quién actúa, para
 * la auditoría). En el resto, `X-Api-Key` no sirve.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
    private readonly integraciones: IntegracionesService,
    private readonly federacion: FirebaseFederacionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
    const scopes = this.reflector.getAllAndOverride<Scope[] | undefined>(API_KEY_SCOPES, targets);

    if (Array.isArray(scopes)) {
      const clave = request.headers['x-api-key'];
      if (typeof clave !== 'string' || !clave) {
        // Sin API key: integraciones sin backend pueden usar su sesión de Firebase (federación).
        const bearer = request.headers.authorization;
        const federado = bearer?.startsWith('Bearer ')
          ? await this.federacion.validar(bearer.slice('Bearer '.length).trim())
          : null;
        if (!federado) throw new UnauthorizedException('Falta el header X-Api-Key.');
        this.exigirScopes(federado, scopes);
        request.auth = federado;
        return true;
      }
      const auth = await this.integraciones.validarApiKey(clave);
      this.exigirScopes(auth, scopes);
      const email = request.headers['x-usuario-email'];
      request.auth = typeof email === 'string' && email.trim() ? await this.integraciones.actuarComo(auth, email) : auth;
      return true;
    }

    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Falta la sesión.');
    }

    request.auth = await this.authService.validarSesion(header.slice('Bearer '.length).trim());
    return true;
  }

  private exigirScopes(auth: AuthContext, scopes: Scope[]) {
    const faltan = scopes.filter((s) => !auth.scopes.includes(s));
    if (faltan.length) throw new ForbiddenException(`La API key no tiene permiso para: ${faltan.join(', ')}.`);
  }
}
