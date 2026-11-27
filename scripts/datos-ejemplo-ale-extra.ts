import type { INestApplicationContext } from '@nestjs/common';
import type { AuthContext } from '../src/modules/auth';
import { PresupuestosService } from '../src/modules/presupuestos';
import type { PrismaService } from '../src/shared/prisma/prisma.service';
import { cargarEjemploMateriales } from './datos-ejemplo-ale-materiales';

/** Presupuestos (y materiales) de ejemplo con los casos del doc. */
export async function cargarEjemploPresupuestosYMateriales(
  app: INestApplicationContext,
  auth: AuthContext,
  ids: { lar: string; muni: string; diego: string; costaDoll: string },
): Promise<void> {
  const presupuestos = app.get(PresupuestosService);
  await presupuestos.cargarBibliotecaInicial(auth.tenantId);
  const diego = await presupuestos.crear(auth, {
    clienteId: ids.diego,
    fecha: '2026-11-20',
    titulo: 'Portón corredizo y rejas',
    lugar: 'General Ramírez',
    moneda: 'ARS',
    formaCotizar: 'POR_ITEM',
    ivaModo: 'SIN_IVA',
    items: [
      { cantidad: '1', descripcion: '<b>Portón corredizo</b> de 4 m de caño estructural, con revestimiento de chapa, guía inferior y rodamientos.', importe: '850000' },
      { cantidad: '4', descripcion: '<b>Rejas</b> de hierro macizo para ventanas, con amurado.', importe: '620000' },
      { cantidad: '1', descripcion: '<b>Pintura</b>: dos manos de antióxido y dos de esmalte sintético.', importe: '380000' },
    ],
    observaciones: [{ texto: 'Materiales incluidos.' }, { texto: 'Plazo de obra: {valor}.', valor: '20 días hábiles' }],
  });
  await presupuestos.cambiarEstado(auth.tenantId, diego.id, 'ENVIADO');
  await presupuestos.crear(auth, {
    clienteId: ids.muni,
    fecha: '2026-11-26',
    titulo: 'Reparación de techos del corralón',
    lugar: 'Corralón municipal',
    moneda: 'ARS',
    formaCotizar: 'GLOBAL',
    importeGlobal: '4200000',
    ivaModo: 'DISCRIMINADO',
    alicuotaIva: '21',
    items: [{ descripcion: '<b>Desmontaje</b> de chapas dañadas.' }, { cantidad: '320 m²', descripcion: '<b>Techado</b> con chapa trapezoidal galvanizada calibre 25.' }, { cantidad: '60 m', descripcion: '<b>Canaletas</b> con bajadas.' }],
    observaciones: [{ texto: 'Materiales incluidos.' }, { texto: 'Plazo de obra: {valor}.', valor: '30 días hábiles' }],
  });
  const lar = await presupuestos.crear(auth, {
    clienteId: ids.lar,
    fecha: '2026-10-01',
    fechaVencimiento: '2026-10-16',
    titulo: 'Galpón sucursal Costa Doll',
    lugar: 'Costa Doll, Entre Ríos',
    moneda: 'ARS',
    formaCotizar: 'SUPERFICIE',
    superficie: { ancho: '20', largo: '45', alturaLateral: '6', alturaCumbrera: '8' },
    importeGlobal: '17300000',
    ivaModo: 'NO_INCLUYE',
    items: [{ descripcion: 'Estructura metálica con <b>columnas de perfil C</b> y <b>vigas reticuladas</b>, techado y cerramiento lateral con chapa trapezoidal.' }],
    observaciones: [
      { texto: 'Plazo de obra: {valor}.', valor: '120 días hábiles' },
      { texto: 'Condición de pago: {valor}.', valor: '15% de anticipo, $ 13.385.000 según avance de obra y $ 1.320.000 al terminar' },
    ],
  });
  await presupuestos.cambiarEstado(auth.tenantId, lar.id, 'ACEPTADO');
  await app.get<PrismaService>((await import('../src/shared/prisma/prisma.service')).PrismaService).presupuesto.update({
    where: { tenantId_id: { tenantId: auth.tenantId, id: lar.id } },
    data: { proyectoId: ids.costaDoll },
  });
  await cargarEjemploMateriales(app, auth, ids);
}

export async function borrarEjemploPresupuestosYMateriales(prisma: PrismaService, tenantId: string): Promise<void> {
  await prisma.presupuesto.deleteMany({ where: { tenantId } });
  const { borrarEjemploMateriales } = await import('./datos-ejemplo-ale-materiales');
  await borrarEjemploMateriales(prisma, tenantId);
}
