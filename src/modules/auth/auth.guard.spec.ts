import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import type { AuthService } from './auth.service';
import { API_KEY_SCOPES, IS_PUBLIC_KEY } from './decorators';
import type { FirebaseFederacionService } from './firebase-federacion.service';
import type { IntegracionesService } from './integraciones.service';

function contexto(headers: Record<string, string>, request: Record<string, unknown> = {}) {
  Object.assign(request, { headers });
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function reflector(meta: { publica?: boolean; scopes?: string[] }) {
  return {
    getAllAndOverride: (key: string) => (key === IS_PUBLIC_KEY ? meta.publica : key === API_KEY_SCOPES ? meta.scopes : undefined),
  } as unknown as Reflector;
}

describe('AuthGuard', () => {
  const authService = {
    validarSesion: jest.fn(async (token: string) => {
      if (token !== 'ok') throw new UnauthorizedException();
      return { tenantId: 't1', tipo: 'usuario', usuarioId: 'u1', scopes: [] };
    }),
  } as unknown as AuthService;
  const integraciones = {
    validarApiKey: jest.fn(async (clave: string) => {
      if (clave !== 'fct_buena') throw new UnauthorizedException();
      return { tenantId: 't1', tipo: 'integracion', integracionId: 'i1', scopes: ['acceso:emitir'] };
    }),
  } as unknown as IntegracionesService;
  const federacion = {
    validar: jest.fn(async (token: string) =>
      token === 'firebase-ok'
        ? { tenantId: 't1', tipo: 'integracion', integracionId: 'i2', usuarioId: 'u9', scopes: ['comprobantes:read'] }
        : null,
    ),
  } as unknown as FirebaseFederacionService;
  const guard = (meta: { publica?: boolean; scopes?: string[] }) =>
    new AuthGuard(reflector(meta), authService, integraciones, federacion);

  it('deja pasar rutas @Public() sin header', async () => {
    await expect(guard({ publica: true }).canActivate(contexto({}))).resolves.toBe(true);
  });

  it('exige Bearer en rutas protegidas', async () => {
    await expect(guard({}).canActivate(contexto({}))).rejects.toThrow(UnauthorizedException);
  });

  it('carga el AuthContext en la request', async () => {
    const request: Record<string, unknown> = {};
    await guard({}).canActivate(contexto({ authorization: 'Bearer ok' }, request));
    expect(request.auth).toMatchObject({ tenantId: 't1', usuarioId: 'u1' });
  });

  it('una API key no sirve en rutas de usuario', async () => {
    await expect(guard({}).canActivate(contexto({ 'x-api-key': 'fct_buena' }))).rejects.toThrow(UnauthorizedException);
  });

  describe('rutas @ApiKey', () => {
    it('aceptan la API key con los scopes pedidos', async () => {
      const request: Record<string, unknown> = {};
      await guard({ scopes: ['acceso:emitir'] }).canActivate(contexto({ 'x-api-key': 'fct_buena' }, request));
      expect(request.auth).toMatchObject({ tipo: 'integracion', integracionId: 'i1' });
    });

    it('rechazan la sesión de un usuario', async () => {
      await expect(guard({ scopes: ['acceso:emitir'] }).canActivate(contexto({ authorization: 'Bearer ok' }))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rechazan una key sin el scope', async () => {
      await expect(guard({ scopes: ['items:write'] }).canActivate(contexto({ 'x-api-key': 'fct_buena' }))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rechazan una key inválida', async () => {
      await expect(guard({ scopes: [] }).canActivate(contexto({ 'x-api-key': 'fct_mala' }))).rejects.toThrow(UnauthorizedException);
    });

    it('aceptan un token de Firebase federado con el scope', async () => {
      const request: Record<string, unknown> = {};
      await guard({ scopes: ['comprobantes:read'] }).canActivate(contexto({ authorization: 'Bearer firebase-ok' }, request));
      expect(request.auth).toMatchObject({ integracionId: 'i2', usuarioId: 'u9' });
    });

    it('rechazan un token de Firebase federado sin el scope', async () => {
      await expect(
        guard({ scopes: ['comprobantes:write'] }).canActivate(contexto({ authorization: 'Bearer firebase-ok' })),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
