import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { AuthService, slugDeNombre } from './auth.service';
import { hashPassword } from './password';

const SECRET = 'secreto-de-test-con-mas-de-32-caracteres!!';

type UsuarioFake = {
  id: string;
  tenantId: string;
  email: string;
  nombre: string | null;
  passwordHash: string | null;
  tokenVersion: number;
  activo: boolean;
  tenant: { id: string; slug: string; nombreFantasia: string; activo: boolean };
};

function crearPrismaFake(usuarios: UsuarioFake[]) {
  return {
    usuario: {
      findMany: jest.fn(async ({ where }) =>
        usuarios.filter(
          (u) =>
            u.email === where.email &&
            u.activo &&
            u.passwordHash !== null &&
            u.tenant.activo &&
            (!where.tenant.slug || u.tenant.slug === where.tenant.slug),
        ),
      ),
      findFirst: jest.fn(
        async ({ where }) =>
          usuarios.find((u) => u.email === where.email && (where.passwordHash === undefined || u.passwordHash !== null)) ?? null,
      ),
      create: jest.fn(async ({ data }) => {
        const slug = data.tenant.create.slug as string;
        if (usuarios.some((u) => u.tenant.slug === slug)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
            meta: { target: ['slug'] },
          });
        }
        const n = usuarios.length + 1;
        const nuevo: UsuarioFake = {
          id: `u${n}`,
          tenantId: `t${n}`,
          email: data.email,
          nombre: null,
          passwordHash: data.passwordHash,
          tokenVersion: 0,
          activo: true,
          tenant: { id: `t${n}`, slug, nombreFantasia: data.tenant.create.nombreFantasia, activo: true },
        };
        usuarios.push(nuevo);
        return { id: nuevo.id, tenantId: nuevo.tenantId };
      }),
      update: jest.fn(async ({ where, data }) => {
        const u = usuarios.find((x) =>
          where.tenantId_id ? x.id === where.tenantId_id.id && x.tenantId === where.tenantId_id.tenantId : x.id === where.id,
        );
        if (!u) throw new Error('no existe');
        if ('nombre' in data) u.nombre = data.nombre;
        if ('passwordHash' in data) u.passwordHash = data.passwordHash;
        if (data.tokenVersion?.increment) u.tokenVersion += data.tokenVersion.increment;
        return u;
      }),
      findUnique: jest.fn(async ({ where }) => {
        const u = usuarios.find(
          (x) => x.id === where.tenantId_id.id && x.tenantId === where.tenantId_id.tenantId,
        );
        return u ?? null;
      }),
      findUniqueOrThrow: jest.fn(async ({ where }) => {
        const u = usuarios.find(
          (x) => x.id === where.tenantId_id.id && x.tenantId === where.tenantId_id.tenantId,
        );
        if (!u) throw new Error('no existe');
        return u;
      }),
    },
  } as unknown as PrismaService;
}

describe('AuthService', () => {
  let hash: string;
  const jwt = new JwtService({ secret: SECRET, signOptions: { algorithm: 'HS256', expiresIn: '1h' } });

  beforeAll(async () => {
    hash = await hashPassword('clave-correcta-123');
  });

  const usuario = (over: Partial<UsuarioFake> = {}): UsuarioFake => ({
    id: 'u1',
    tenantId: 't1',
    email: 'ana@empresa.com',
    nombre: 'Ana',
    passwordHash: hash,
    tokenVersion: 0,
    activo: true,
    tenant: { id: 't1', slug: 'empresa-uno', nombreFantasia: 'Empresa Uno', activo: true },
    ...over,
  });

  it('devuelve un JWT válido con credenciales correctas (email en mayúsculas incluido)', async () => {
    const service = new AuthService(crearPrismaFake([usuario()]), jwt);
    const res = await service.login({ email: ' ANA@Empresa.com ', password: 'clave-correcta-123' });

    expect(res.tenant.slug).toBe('empresa-uno');
    const payload = await jwt.verifyAsync(res.accessToken);
    expect(payload).toMatchObject({ sub: 'u1', tid: 't1', tv: 0 });
  });

  it('rechaza contraseña incorrecta y email inexistente con el mismo mensaje', async () => {
    const service = new AuthService(crearPrismaFake([usuario()]), jwt);

    const mal = service.login({ email: 'ana@empresa.com', password: 'otra-clave-123' });
    const inexistente = service.login({ email: 'nadie@empresa.com', password: 'clave-correcta-123' });

    await expect(mal).rejects.toThrow(UnauthorizedException);
    await expect(inexistente).rejects.toThrow(UnauthorizedException);
    await expect(mal).rejects.toThrow('Email o contraseña incorrectos.');
    await expect(inexistente).rejects.toThrow('Email o contraseña incorrectos.');
  });

  it('no deja entrar con contraseña a un usuario sin passwordHash (creado por integración)', async () => {
    const service = new AuthService(crearPrismaFake([usuario({ passwordHash: null })]), jwt);
    await expect(
      service.login({ email: 'ana@empresa.com', password: 'clave-correcta-123' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('pide elegir empresa cuando el email tiene cuenta con la misma contraseña en dos tenants', async () => {
    const otro = usuario({
      id: 'u2',
      tenantId: 't2',
      tenant: { id: 't2', slug: 'empresa-dos', nombreFantasia: 'Empresa Dos', activo: true },
    });
    const service = new AuthService(crearPrismaFake([usuario(), otro]), jwt);

    await expect(
      service.login({ email: 'ana@empresa.com', password: 'clave-correcta-123' }),
    ).rejects.toThrow(ConflictException);

    const res = await service.login({
      email: 'ana@empresa.com',
      password: 'clave-correcta-123',
      tenantSlug: 'empresa-dos',
    });
    expect(res.tenant.slug).toBe('empresa-dos');
  });

  describe('registrar', () => {
    it('crea empresa y usuario, abre la sesión y después puede loguearse', async () => {
      const usuarios: UsuarioFake[] = [];
      const service = new AuthService(crearPrismaFake(usuarios), jwt);
      const res = await service.registrar({ nombreEmpresa: '  Estudio Pérez  ', email: 'Nuevo@Mail.com', password: 'una-clave-larga' });

      expect(res.tenant).toMatchObject({ slug: 'estudio-perez', nombre: 'Estudio Pérez' });
      expect(res.usuario.email).toBe('nuevo@mail.com');
      expect(await jwt.verifyAsync(res.accessToken)).toMatchObject({ sub: res.usuario.id, tid: res.tenant.id });

      const login = await service.login({ email: 'nuevo@mail.com', password: 'una-clave-larga' });
      expect(login.tenant.id).toBe(res.tenant.id);
    });

    it('si el slug está tomado, le agrega un sufijo', async () => {
      const service = new AuthService(crearPrismaFake([usuario({ email: 'otro@x.com', tenant: { id: 't1', slug: 'empresa-uno', nombreFantasia: 'Empresa Uno', activo: true } })]), jwt);
      const res = await service.registrar({ nombreEmpresa: 'Empresa Uno', email: 'nueva@x.com', password: 'una-clave-larga' });
      expect(res.tenant.slug).toMatch(/^empresa-uno-[0-9a-f]{6}$/);
    });

    it('rechaza un email que ya tiene cuenta', async () => {
      const service = new AuthService(crearPrismaFake([usuario()]), jwt);
      await expect(
        service.registrar({ nombreEmpresa: 'Otra', email: 'ANA@empresa.com', password: 'una-clave-larga' }),
      ).rejects.toThrow(ConflictException);
    });

    it('deja registrarse a un email que solo existe como usuario de integración (sin contraseña)', async () => {
      const usuarios = [usuario({ passwordHash: null })];
      const service = new AuthService(crearPrismaFake(usuarios), jwt);
      const res = await service.registrar({ nombreEmpresa: 'Su Empresa', email: 'ana@empresa.com', password: 'una-clave-larga' });
      expect(res.tenant.slug).toBe('su-empresa');

      // El login con contraseña encuentra solo la empresa nueva (la otra no tiene contraseña).
      const login = await service.login({ email: 'ana@empresa.com', password: 'una-clave-larga' });
      expect(login.tenant.id).toBe(res.tenant.id);
    });

    it('rechaza contraseñas cortas y nombres vacíos', async () => {
      const service = new AuthService(crearPrismaFake([]), jwt);
      await expect(service.registrar({ nombreEmpresa: 'X SA', email: 'a@b.com', password: 'corta' })).rejects.toThrow(BadRequestException);
      await expect(service.registrar({ nombreEmpresa: '   ', email: 'a@b.com', password: 'una-clave-larga' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('perfil', () => {
    const sesion = { tenantId: 't1', tipo: 'usuario' as const, usuarioId: 'u1', scopes: [] };

    it('actualiza el nombre (vacío lo borra)', async () => {
      const usuarios = [usuario()];
      const service = new AuthService(crearPrismaFake(usuarios), jwt);
      await service.actualizarPerfil(sesion, { nombre: '  Ana Pérez ' });
      expect(usuarios[0].nombre).toBe('Ana Pérez');
      await service.actualizarPerfil(sesion, { nombre: '   ' });
      expect(usuarios[0].nombre).toBeNull();
    });

    it('cambia la contraseña con la actual correcta, cierra las otras sesiones y devuelve una nueva', async () => {
      const usuarios = [usuario()];
      const service = new AuthService(crearPrismaFake(usuarios), jwt);
      const vieja = await jwt.signAsync({ sub: 'u1', tid: 't1', tv: 0 });

      const res = await service.cambiarPassword(sesion, { passwordActual: 'clave-correcta-123', passwordNueva: 'otra-clave-larga' });

      await expect(service.validarSesion(vieja)).rejects.toThrow(UnauthorizedException);
      await expect(service.validarSesion(res.accessToken)).resolves.toMatchObject({ usuarioId: 'u1' });
      await expect(service.login({ email: 'ana@empresa.com', password: 'otra-clave-larga' })).resolves.toBeDefined();
    });

    it('rechaza el cambio si la contraseña actual falta o no coincide', async () => {
      const service = new AuthService(crearPrismaFake([usuario()]), jwt);
      await expect(service.cambiarPassword(sesion, { passwordNueva: 'otra-clave-larga' })).rejects.toThrow(BadRequestException);
      await expect(
        service.cambiarPassword(sesion, { passwordActual: 'equivocada-123', passwordNueva: 'otra-clave-larga' }),
      ).rejects.toThrow('La contraseña actual no es correcta.');
    });

    it('un usuario de integración (sin contraseña) puede crear una sin pedir la actual', async () => {
      const usuarios = [usuario({ passwordHash: null })];
      const service = new AuthService(crearPrismaFake(usuarios), jwt);
      expect((await service.perfil(sesion)).usuario.tienePassword).toBe(false);
      await service.cambiarPassword(sesion, { passwordNueva: 'otra-clave-larga' });
      expect((await service.perfil(sesion)).usuario.tienePassword).toBe(true);
    });

    it('no acepta el contexto de una API key', async () => {
      const service = new AuthService(crearPrismaFake([usuario()]), jwt);
      const integracion = { tenantId: 't1', tipo: 'integracion' as const, scopes: [] };
      await expect(service.actualizarPerfil(integracion, { nombre: 'X' })).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('slugDeNombre', () => {
    it.each([
      ['Estudio Pérez & Asoc.', 'estudio-perez-asoc'],
      ['  ÑANDÚ  S.R.L. ', 'nandu-s-r-l'],
      ['!!', 'empresa'],
      ['a'.repeat(80), 'a'.repeat(50)],
    ])('%s → %s', (nombre, esperado) => {
      expect(slugDeNombre(nombre)).toBe(esperado);
    });
  });

  describe('validarSesion', () => {
    it('arma el AuthContext para un token vigente', async () => {
      const service = new AuthService(crearPrismaFake([usuario()]), jwt);
      const token = await jwt.signAsync({ sub: 'u1', tid: 't1', tv: 0 });
      await expect(service.validarSesion(token)).resolves.toEqual({
        tenantId: 't1',
        tipo: 'usuario',
        usuarioId: 'u1',
        scopes: [],
      });
    });

    it('rechaza un token revocado (tokenVersion distinto)', async () => {
      const service = new AuthService(crearPrismaFake([usuario({ tokenVersion: 1 })]), jwt);
      const token = await jwt.signAsync({ sub: 'u1', tid: 't1', tv: 0 });
      await expect(service.validarSesion(token)).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza si el tenant fue desactivado', async () => {
      const u = usuario();
      u.tenant.activo = false;
      const service = new AuthService(crearPrismaFake([u]), jwt);
      const token = await jwt.signAsync({ sub: 'u1', tid: 't1', tv: 0 });
      await expect(service.validarSesion(token)).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza un token de otro tenant aunque el usuario exista', async () => {
      const service = new AuthService(crearPrismaFake([usuario()]), jwt);
      const token = await jwt.signAsync({ sub: 'u1', tid: 'otro-tenant', tv: 0 });
      await expect(service.validarSesion(token)).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza un token firmado con otro secreto', async () => {
      const service = new AuthService(crearPrismaFake([usuario()]), jwt);
      const falso = await new JwtService({ secret: 'otro-secreto-de-mas-de-32-caracteres!!' }).signAsync({
        sub: 'u1',
        tid: 't1',
        tv: 0,
      });
      await expect(service.validarSesion(falso)).rejects.toThrow(UnauthorizedException);
    });
  });
});
