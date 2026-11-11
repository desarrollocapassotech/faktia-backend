import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createSign, generateKeyPairSync, type KeyObject } from 'crypto';
import { FirebaseFederacionService } from './firebase-federacion.service';
import type { IntegracionesService } from './integraciones.service';

const PROYECTO = 'efecapitaladmin';
const KID = 'kid-1';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
// Los certificados de Google son X.509; para verificar alcanza con la clave pública en PEM.
const PEM = (publicKey as KeyObject).export({ type: 'spki', format: 'pem' }).toString();

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function firmar(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: KID }) {
  const cuerpo = `${b64(header)}.${b64(claims)}`;
  const firma = createSign('RSA-SHA256').update(cuerpo).sign(privateKey).toString('base64url');
  return `${cuerpo}.${firma}`;
}

const ahora = () => Math.floor(Date.now() / 1000);
const claimsValidos = (extra: Record<string, unknown> = {}) => ({
  iss: `https://securetoken.google.com/${PROYECTO}`,
  aud: PROYECTO,
  sub: 'uid-1',
  iat: ahora() - 10,
  exp: ahora() + 3600,
  auth_time: ahora() - 10,
  email: 'Persona@EFE.com',
  ...extra,
});

describe('FirebaseFederacionService', () => {
  const integraciones = {
    contextoDeIntegracion: jest.fn(async (id: string) => ({ tenantId: 't1', tipo: 'integracion', integracionId: id, scopes: ['comprobantes:read'] })),
    actuarComo: jest.fn(async (auth: object, email: string) => ({ ...auth, usuarioId: `u:${email}` })),
  } as unknown as IntegracionesService;

  const servicio = (crudo?: string) =>
    new FirebaseFederacionService({ get: () => crudo } as unknown as ConfigService, integraciones);

  const config = JSON.stringify([{ projectId: PROYECTO, integracionId: 'int-efe', emails: ['persona@efe.com'] }]);

  beforeEach(() => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ [KID]: PEM }),
      headers: new Headers({ 'cache-control': 'public, max-age=600' }),
    } as Response);
  });
  afterEach(() => jest.restoreAllMocks());

  it('apagada sin configuración: devuelve null', async () => {
    await expect(servicio(undefined).validar(firmar(claimsValidos()))).resolves.toBeNull();
  });

  it('valida el token y actúa como el email (normalizado)', async () => {
    const auth = await servicio(config).validar(firmar(claimsValidos()));
    expect(auth).toMatchObject({ integracionId: 'int-efe', usuarioId: 'u:persona@efe.com' });
  });

  it('ignora tokens que no son de un proyecto federado', async () => {
    await expect(servicio(config).validar(firmar(claimsValidos({ iss: 'https://securetoken.google.com/otro' })))).resolves.toBeNull();
    await expect(servicio(config).validar('no-es-un-jwt')).resolves.toBeNull();
  });

  it('rechaza una firma inválida', async () => {
    const token = firmar(claimsValidos());
    const adulterado = token.replace(/\.[^.]+\./, `.${b64(claimsValidos({ email: 'persona@efe.com', sub: 'otro' }))}.`);
    await expect(servicio(config).validar(adulterado)).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza audiencia incorrecta, token vencido o kid desconocido', async () => {
    const s = servicio(config);
    await expect(s.validar(firmar(claimsValidos({ aud: 'otro' })))).rejects.toThrow(UnauthorizedException);
    await expect(s.validar(firmar(claimsValidos({ exp: ahora() - 3600 })))).rejects.toThrow(UnauthorizedException);
    await expect(s.validar(firmar(claimsValidos(), { alg: 'RS256', kid: 'otro' }))).rejects.toThrow(UnauthorizedException);
    await expect(s.validar(firmar(claimsValidos(), { alg: 'none', kid: KID }))).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza emails no habilitados', async () => {
    await expect(servicio(config).validar(firmar(claimsValidos({ email: 'intruso@x.com' })))).rejects.toThrow(UnauthorizedException);
  });

  it('valida la configuración al arrancar', () => {
    expect(() => servicio('no-json')).toThrow('JSON');
    expect(() => servicio(JSON.stringify([{ projectId: PROYECTO }]))).toThrow('integracionId');
  });
});
