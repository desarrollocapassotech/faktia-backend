import type { INestApplicationContext } from '@nestjs/common';
import type { AuthContext } from '../src/modules/auth';
import type { PrismaService } from '../src/shared/prisma/prisma.service';

/** Materiales de ejemplo (se completa en la fase de materiales). */
export async function cargarEjemploMateriales(_app: INestApplicationContext, _auth: AuthContext, _ids: { costaDoll: string }): Promise<void> {}

export async function borrarEjemploMateriales(_prisma: PrismaService, _tenantId: string): Promise<void> {}
