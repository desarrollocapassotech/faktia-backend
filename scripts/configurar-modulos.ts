import { PrismaClient } from '@prisma/client';
import { esModulo, MODULOS } from '../src/shared/modulos/modulos';
import { leerArgs, requerido } from './args';

const USO = `  npm run configurar-modulos -- --slug ale-herreria \\
    [--ocultar importaciones,integraciones,webhooks,recibos-pago] \\
    [--habilitar presupuestos,materiales] [--solo comprobantes,recibos,...] \\
    [--etiqueta Obra --etiqueta-plural Obras]

  Módulos: ${MODULOS.join(', ')}
  Sin opciones, muestra cómo está la empresa.`;

function lista(valor: string | undefined): string[] {
  if (!valor) return [];
  const items = valor.split(',').map((m) => m.trim()).filter(Boolean);
  const malos = items.filter((m) => !esModulo(m));
  if (malos.length) throw new Error(`Módulos desconocidos: ${malos.join(', ')}. Opciones: ${MODULOS.join(', ')}`);
  return items;
}

/** Lo usa el administrador de Faktia: habilita u oculta módulos de una empresa y cambia la etiqueta de Proyecto. */
async function main() {
  const args = leerArgs();
  const slug = requerido(args, 'slug', USO).toLowerCase();
  const prisma = new PrismaClient();
  try {
    const t = await prisma.tenant.findUnique({ where: { slug } });
    if (!t) throw new Error(`No existe una empresa con slug ${slug}.`);
    let modulos = args.solo ? lista(args.solo) : t.modulosHabilitados;
    const habilitar = lista(args.habilitar);
    const ocultar = new Set(lista(args.ocultar));
    modulos = [...new Set([...modulos, ...habilitar])].filter((m) => !ocultar.has(m));
    // Orden estable, el de MODULOS.
    modulos = MODULOS.filter((m) => modulos.includes(m));
    const actualizado = await prisma.tenant.update({
      where: { id: t.id },
      data: {
        modulosHabilitados: modulos,
        etiquetaProyecto: args.etiqueta?.trim() || undefined,
        etiquetaProyectoPlural: args['etiqueta-plural']?.trim() || undefined,
      },
    });
    console.log(`${actualizado.nombreFantasia} (${actualizado.slug})`);
    console.log(`  Módulos: ${actualizado.modulosHabilitados.join(', ') || '(ninguno)'}`);
    console.log(`  Etiqueta: ${actualizado.etiquetaProyecto} / ${actualizado.etiquetaProyectoPlural}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error((err as Error).message ?? err);
  process.exit(1);
});
