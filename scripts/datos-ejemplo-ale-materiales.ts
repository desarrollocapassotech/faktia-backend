import type { INestApplicationContext } from '@nestjs/common';
import type { AuthContext } from '../src/modules/auth';
import { MaterialesService } from '../src/modules/materiales';
import type { PrismaService } from '../src/shared/prisma/prisma.service';
import { MATERIALES_GALPON, OBSERVACIONES_GALPON } from './datos-galpon';

/** Proveedores, catálogo y el listado del galpón de Costa Doll. */
export async function cargarEjemploMateriales(app: INestApplicationContext, auth: AuthContext, ids: { costaDoll: string }): Promise<void> {
  const materiales = app.get(MaterialesService);
  const hierros = await materiales.crearProveedor(auth.tenantId, { nombre: 'Hierros del Litoral SRL', contacto: 'Marcelo', telefono: '343 455-0000', email: 'ventas@hierroslitoral.ejemplo' });
  await materiales.crearProveedor(auth.tenantId, { nombre: 'Pinturería Ramírez', telefono: '343 400-1111' });
  const catalogo: Array<{ id: string }> = [];
  for (const m of MATERIALES_GALPON) {
    catalogo.push(
      await materiales.crearMaterial(auth.tenantId, {
        nombre: m.nombre,
        unidad: m.unidad,
        categoria: m.categoria,
        precioCosto: m.costo?.[0] ?? null,
        monedaCosto: m.costo?.[1],
        precioVenta: m.venta?.[0] ?? null,
        monedaVenta: m.venta?.[1],
        proveedorId: ['Hierros', 'Perfiles', 'Chapas'].includes(m.categoria) ? hierros.id : null,
      }),
    );
  }
  await materiales.crearListado(auth, {
    titulo: 'Cálculo aproximado de materiales para galpón',
    fecha: '2026-10-05',
    proyectoId: ids.costaDoll,
    proveedorId: hierros.id,
    destino: 'Ruta 131 km 4, Costa Doll',
    observaciones: OBSERVACIONES_GALPON,
    precios: 'NINGUNO',
    renglones: MATERIALES_GALPON.map((m, i) => ({ cantidad: m.cantidad, materialId: catalogo[i].id })),
  });
}

export async function borrarEjemploMateriales(prisma: PrismaService, tenantId: string): Promise<void> {
  await prisma.listadoMateriales.deleteMany({ where: { tenantId } });
  await prisma.material.deleteMany({ where: { tenantId } });
  await prisma.proveedor.deleteMany({ where: { tenantId } });
}
