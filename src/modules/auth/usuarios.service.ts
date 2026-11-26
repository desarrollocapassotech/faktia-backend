import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

/** Lo que otros módulos pueden saber de los usuarios de una empresa (sin datos de acceso). */
@Injectable()
export class UsuariosService {
  constructor(private readonly prisma: PrismaService) {}

  /** Emails de los usuarios activos de la empresa (destinatarios de los avisos). */
  async emailsActivos(tenantId: string): Promise<string[]> {
    const filas = await this.prisma.usuario.findMany({ where: { tenantId, activo: true }, select: { email: true }, orderBy: { createdAt: 'asc' } });
    return filas.map((f) => f.email);
  }

  /** Email de un usuario de la empresa (por ejemplo, quien pide un aviso de prueba). */
  async email(tenantId: string, usuarioId: string): Promise<string | null> {
    const u = await this.prisma.usuario.findUnique({ where: { tenantId_id: { tenantId, id: usuarioId } }, select: { email: true } });
    return u?.email ?? null;
  }
}
