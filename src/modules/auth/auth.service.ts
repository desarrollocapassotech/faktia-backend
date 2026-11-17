import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { AuthContext, SesionJwtPayload } from './auth-context';
import { LoginDto } from './dto/login.dto';
import { ActualizarPerfilDto, CambiarPasswordDto } from './dto/perfil.dto';
import { RegistroDto } from './dto/registro.dto';
import { hashPassword, normalizarEmail, validarPassword, verificarPassword } from './password';

const CREDENCIALES_INVALIDAS = 'Email o contraseña incorrectos.';

/** "Estudio Pérez & Asoc." → "estudio-perez-asoc" (mismo formato que acepta el login: [a-z0-9-]{2,60}). */
export function slugDeNombre(nombre: string): string {
  const slug = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');
  return slug.length >= 2 ? slug : 'empresa';
}

function esConflictoDeSlug(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  const target = (err.meta as { target?: unknown } | undefined)?.target;
  return Array.isArray(target) ? target.includes('slug') : String(target ?? '').includes('slug');
}

export interface SesionResponse {
  accessToken: string;
  usuario: { id: string; email: string; nombre: string | null };
  tenant: { id: string; slug: string; nombre: string };
}

@Injectable()
export class AuthService {
  /** Hash de relleno: se compara igual cuando no hay usuarios, para no filtrar por tiempo qué emails existen. */
  private hashRelleno?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<SesionResponse> {
    const email = normalizarEmail(dto.email);

    const candidatos = await this.prisma.usuario.findMany({
      where: {
        email,
        activo: true,
        passwordHash: { not: null },
        tenant: { activo: true, ...(dto.tenantSlug ? { slug: dto.tenantSlug } : {}) },
      },
      include: { tenant: { select: { id: true, slug: true, nombreFantasia: true } } },
    });

    if (candidatos.length === 0) {
      this.hashRelleno ??= hashPassword('relleno-que-nunca-coincide');
      await verificarPassword(dto.password, await this.hashRelleno);
      throw new UnauthorizedException(CREDENCIALES_INVALIDAS);
    }

    const coincidencias: typeof candidatos = [];
    for (const u of candidatos) {
      if (await verificarPassword(dto.password, u.passwordHash as string)) {
        coincidencias.push(u);
      }
    }

    if (coincidencias.length === 0) {
      throw new UnauthorizedException(CREDENCIALES_INVALIDAS);
    }

    if (coincidencias.length > 1) {
      throw new ConflictException({
        message: 'Tu email tiene cuenta en más de una empresa. Elegí con cuál ingresar.',
        tenants: coincidencias.map((u) => ({ slug: u.tenant.slug, nombre: u.tenant.nombreFantasia })),
      });
    }

    return this.sesionPara(coincidencias[0].tenantId, coincidencias[0].id);
  }

  /**
   * Registro por autoservicio: crea una empresa nueva con su primer usuario y abre la sesión.
   * La empresa nace solo con el nombre (en homologación); los datos fiscales se piden después.
   * Usuario y empresa se crean en un solo INSERT anidado, así que no queda ninguno huérfano.
   */
  async registrar(dto: RegistroDto): Promise<SesionResponse> {
    const email = normalizarEmail(dto.email);
    const nombreEmpresa = dto.nombreEmpresa.trim();
    if (!nombreEmpresa) throw new BadRequestException('Falta el nombre de la empresa.');
    const errorPassword = validarPassword(dto.password);
    if (errorPassword) throw new BadRequestException(errorPassword);

    // Solo bloquea si ya puede entrar con contraseña. Los usuarios que creó una integración (entran
    // por token de acceso, sin contraseña) pueden registrar su propia empresa: el login con
    // contraseña solo va a encontrar la nueva.
    if (await this.prisma.usuario.findFirst({ where: { email, passwordHash: { not: null } }, select: { id: true } })) {
      throw new ConflictException('Ya hay una cuenta con ese email. Ingresá con tu contraseña.');
    }

    const passwordHash = await hashPassword(dto.password);
    const base = slugDeNombre(nombreEmpresa);
    for (let intento = 0; intento < 5; intento++) {
      const slug = intento === 0 ? base : `${base.slice(0, 50)}-${randomBytes(3).toString('hex')}`;
      try {
        const usuario = await this.prisma.usuario.create({
          data: {
            email,
            passwordHash,
            creadoPor: 'registro',
            tenant: { create: { slug, nombreFantasia: nombreEmpresa } },
          },
          select: { id: true, tenantId: true },
        });
        return this.sesionPara(usuario.tenantId, usuario.id);
      } catch (err) {
        if (!esConflictoDeSlug(err)) throw err;
      }
    }
    throw new ConflictException('No pudimos crear la empresa. Probá de nuevo en unos segundos.');
  }

  /** Emite el JWT de sesión de un usuario activo (login con contraseña o canje de token de acceso). */
  async sesionPara(tenantId: string, usuarioId: string): Promise<SesionResponse> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { tenantId_id: { tenantId, id: usuarioId } },
      include: { tenant: { select: { id: true, slug: true, nombreFantasia: true, activo: true } } },
    });
    if (!usuario || !usuario.activo || !usuario.tenant.activo) {
      throw new UnauthorizedException('El usuario no tiene acceso.');
    }
    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: { ultimoAcceso: new Date() },
    });

    const payload: SesionJwtPayload = { sub: usuario.id, tid: usuario.tenantId, tv: usuario.tokenVersion };
    return {
      accessToken: await this.jwt.signAsync(payload),
      usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre },
      tenant: { id: usuario.tenant.id, slug: usuario.tenant.slug, nombre: usuario.tenant.nombreFantasia },
    };
  }

  /**
   * Valida un JWT de sesión y devuelve el AuthContext.
   * Revisa en DB que el usuario y el tenant sigan activos y que la sesión no haya sido revocada.
   */
  async validarSesion(token: string): Promise<AuthContext> {
    let payload: SesionJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<SesionJwtPayload>(token, { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('La sesión expiró o no es válida.');
    }

    const usuario = await this.prisma.usuario.findUnique({
      where: { tenantId_id: { tenantId: payload.tid, id: payload.sub } },
      select: { id: true, activo: true, tokenVersion: true, tenant: { select: { activo: true } } },
    });

    if (!usuario || !usuario.activo || !usuario.tenant.activo || usuario.tokenVersion !== payload.tv) {
      throw new UnauthorizedException('La sesión expiró o no es válida.');
    }

    return { tenantId: payload.tid, tipo: 'usuario', usuarioId: usuario.id, scopes: [] };
  }

  /** Cambia el nombre visible del usuario de la sesión. */
  async actualizarPerfil(auth: AuthContext, dto: ActualizarPerfilDto) {
    const usuarioId = this.usuarioDeSesion(auth);
    await this.prisma.usuario.update({
      where: { tenantId_id: { tenantId: auth.tenantId, id: usuarioId } },
      data: { nombre: dto.nombre.trim() || null },
    });
    return this.perfil(auth);
  }

  /**
   * Cambia (o crea, si vino de una integración) la contraseña del usuario de la sesión.
   * Cierra todas sus sesiones y devuelve una nueva para el navegador desde el que la cambió.
   */
  async cambiarPassword(auth: AuthContext, dto: CambiarPasswordDto): Promise<SesionResponse> {
    const usuarioId = this.usuarioDeSesion(auth);
    const errorPassword = validarPassword(dto.passwordNueva);
    if (errorPassword) throw new BadRequestException(errorPassword);

    const usuario = await this.prisma.usuario.findUniqueOrThrow({
      where: { tenantId_id: { tenantId: auth.tenantId, id: usuarioId } },
      select: { passwordHash: true },
    });
    if (usuario.passwordHash) {
      if (!dto.passwordActual || !(await verificarPassword(dto.passwordActual, usuario.passwordHash))) {
        throw new BadRequestException('La contraseña actual no es correcta.');
      }
    }

    await this.prisma.usuario.update({
      where: { tenantId_id: { tenantId: auth.tenantId, id: usuarioId } },
      data: { passwordHash: await hashPassword(dto.passwordNueva), tokenVersion: { increment: 1 } },
    });
    return this.sesionPara(auth.tenantId, usuarioId);
  }

  private usuarioDeSesion(auth: AuthContext): string {
    if (auth.tipo !== 'usuario' || !auth.usuarioId) throw new UnauthorizedException('Requiere la sesión de un usuario.');
    return auth.usuarioId;
  }

  async perfil(auth: AuthContext) {
    const usuario = await this.prisma.usuario.findUniqueOrThrow({
      where: { tenantId_id: { tenantId: auth.tenantId, id: this.usuarioDeSesion(auth) } },
      select: {
        id: true,
        email: true,
        nombre: true,
        passwordHash: true,
        tenant: {
          select: {
            id: true,
            slug: true,
            nombreFantasia: true,
            ambienteArca: true,
            razonSocial: true,
            cuit: true,
            condicionIva: true,
            domicilioFiscal: true,
          },
        },
      },
    });
    const t = usuario.tenant;
    return {
      // tienePassword: false en los usuarios que creó una integración (entran por token de acceso).
      usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre, tienePassword: usuario.passwordHash !== null },
      tenant: {
        id: t.id,
        slug: t.slug,
        nombre: t.nombreFantasia,
        ambienteArca: t.ambienteArca,
        // Mismo criterio que TenantsService.obtenerEmisor: sin esto no se puede facturar.
        datosFiscalesCompletos: Boolean(t.razonSocial?.trim() && t.cuit && t.condicionIva && t.domicilioFiscal?.trim()),
      },
    };
  }
}
