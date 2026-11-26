import type { INestApplicationContext } from '@nestjs/common';
import type { AuthContext } from '../src/modules/auth';
import type { PrismaService } from '../src/shared/prisma/prisma.service';

/** Presupuestos y materiales de ejemplo (fases 4 y 5). */
export async function cargarEjemploPresupuestosYMateriales(
  _app: INestApplicationContext,
  _auth: AuthContext,
  _ids: { lar: string; muni: string; diego: string; costaDoll: string },
): Promise<void> {
  // Se completa en las fases de presupuestos y materiales.
}

export async function borrarEjemploPresupuestosYMateriales(_prisma: PrismaService, _tenantId: string): Promise<void> {
  // Se completa en las fases de presupuestos y materiales.
}
