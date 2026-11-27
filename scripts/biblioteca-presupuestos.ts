/**
 * Carga la biblioteca inicial de presupuestos (ítems frecuentes de herrería y catálogo de
 * observaciones) en una empresa. No pisa lo que ya exista (por título o texto).
 *
 *   npm run biblioteca-presupuestos -- --slug ale-herreria
 *
 * Los textos están en src/modules/presupuestos/biblioteca-inicial.ts: ajustalos con los
 * presupuestos que entregue el cliente antes de cargarlos.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PresupuestosService } from '../src/modules/presupuestos';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { leerArgs, requerido } from './args';

async function main() {
  const slug = requerido(leerArgs(), 'slug', '  npm run biblioteca-presupuestos -- --slug ale-herreria').toLowerCase();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const t = await app.get(PrismaService).tenant.findUnique({ where: { slug } });
    if (!t) throw new Error(`No existe una empresa con slug ${slug}.`);
    const r = await app.get(PresupuestosService).cargarBibliotecaInicial(t.id);
    console.log(`${t.nombreFantasia}: ${r.items} ítems y ${r.observaciones} observaciones nuevos.`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error((err as Error).message ?? err);
  process.exit(1);
});
