import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { OrigenItem } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { AuthContext } from './auth-context';
import { generarApiKey, hashesIguales, prefijoDeApiKey, sha256Hex, type Scope } from './claves';
import { normalizarEmail } from './password';

const SELECT_PUBLICO = {
  id: true,
  nombre: true,
  origen: true,
  keyPrefijo: true,
  scopes: true,
  ultimoUsoEn: true,
  revocadaEn: true,
  createdAt: true,
} as const;

const CLAVE_INVALIDA = 'API key inválida o revocada.';
const UN_MINUTO = 60_000;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

@Injectable()
export class IntegracionesService {
  constructor(private readonly prisma: PrismaService) {}

  listar(tenantId: string) {
    return this.prisma.integracion.findMany({ where: { tenantId }, select: SELECT_PUBLICO, orderBy: { createdAt: 'desc' } });
  }

  /** Crea la integración y devuelve la clave completa UNA sola vez (solo se guarda su hash). */
  async crear(auth: AuthContext, datos: { nombre: string; origen: OrigenItem; scopes: Scope[] }) {
    const { clave, prefijo, hash } = generarApiKey();
    const integracion = await this.prisma.integracion.create({
      data: {
        tenantId: auth.tenantId,
        nombre: datos.nombre.trim(),
        origen: datos.origen,
        scopes: [...new Set(datos.scopes)],
        keyPrefijo: prefijo,
        keyHash: hash,
        creadaPorId: auth.usuarioId ?? null,
      },
      select: SELECT_PUBLICO,
    });
    return { integracion, clave };
  }

  async revocar(tenantId: string, id: string) {
    const { count } = await this.prisma.integracion.updateMany({
      where: { tenantId, id, revocadaEn: null },
      data: { revocadaEn: new Date() },
    });
    if (!count) {
      const existe = await this.prisma.integracion.count({ where: { tenantId, id } });
      if (!existe) throw new NotFoundException('Integración no encontrada.');
    }
    return this.prisma.integracion.findUniqueOrThrow({ where: { tenantId_id: { tenantId, id } }, select: SELECT_PUBLICO });
  }

  /**
   * `X-Usuario-Email`: la integración indica qué persona de su sistema hace la acción, para la
   * auditoría (creadoPor/emitidoPor). Si el usuario no existe en el tenant, se crea sin contraseña.
   */
  async actuarComo(auth: AuthContext, emailCrudo: string): Promise<AuthContext> {
    const email = normalizarEmail(emailCrudo);
    if (!EMAIL.test(email)) throw new BadRequestException('X-Usuario-Email no es un email válido.');
    const usuario = await this.prisma.usuario.upsert({
      where: { tenantId_email: { tenantId: auth.tenantId, email } },
      create: { tenantId: auth.tenantId, email, creadoPor: `integracion:${auth.integracionId}` },
      update: {},
      select: { id: true, activo: true },
    });
    if (!usuario.activo) throw new ForbiddenException('El usuario está desactivado en Faktia.');
    return { ...auth, usuarioId: usuario.id };
  }

  /**
   * AuthContext de una integración por id (federación Firebase: el token ya se verificó).
   * Mismas reglas que una API key: revocada o tenant inactivo → no autorizado.
   */
  async contextoDeIntegracion(id: string): Promise<AuthContext> {
    const integracion = await this.prisma.integracion.findUnique({
      where: { id },
      select: { id: true, tenantId: true, origen: true, scopes: true, revocadaEn: true, ultimoUsoEn: true, tenant: { select: { activo: true } } },
    });
    if (!integracion || integracion.revocadaEn || !integracion.tenant.activo) {
      throw new UnauthorizedException(CLAVE_INVALIDA);
    }
    if (!integracion.ultimoUsoEn || Date.now() - integracion.ultimoUsoEn.getTime() > UN_MINUTO) {
      await this.prisma.integracion.update({ where: { id: integracion.id }, data: { ultimoUsoEn: new Date() } });
    }
    return {
      tenantId: integracion.tenantId,
      tipo: 'integracion',
      integracionId: integracion.id,
      origenIntegracion: integracion.origen,
      scopes: integracion.scopes,
    };
  }

  /** Valida `X-Api-Key` y arma el AuthContext de la integración. */
  async validarApiKey(clave: string): Promise<AuthContext> {
    const prefijo = prefijoDeApiKey(clave);
    if (!prefijo) throw new UnauthorizedException(CLAVE_INVALIDA);
    const integracion = await this.prisma.integracion.findUnique({
      where: { keyPrefijo: prefijo },
      select: {
        id: true,
        tenantId: true,
        origen: true,
        keyHash: true,
        scopes: true,
        revocadaEn: true,
        ultimoUsoEn: true,
        tenant: { select: { activo: true } },
      },
    });
    // Se compara el hash aunque no exista, para no revelar por tiempo qué prefijos son válidos.
    const coincide = hashesIguales(sha256Hex(clave), integracion?.keyHash ?? sha256Hex(`${prefijo}-inexistente`));
    if (!integracion || !coincide || integracion.revocadaEn || !integracion.tenant.activo) {
      throw new UnauthorizedException(CLAVE_INVALIDA);
    }
    if (!integracion.ultimoUsoEn || Date.now() - integracion.ultimoUsoEn.getTime() > UN_MINUTO) {
      await this.prisma.integracion.update({ where: { id: integracion.id }, data: { ultimoUsoEn: new Date() } });
    }
    return {
      tenantId: integracion.tenantId,
      tipo: 'integracion',
      integracionId: integracion.id,
      origenIntegracion: integracion.origen,
      scopes: integracion.scopes,
    };
  }
}
