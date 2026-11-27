import { writeFileSync } from 'fs';
import { join } from 'path';
import Decimal from 'decimal.js';
import { generarPdfListado, type ListadoParaPdf } from '../src/modules/materiales';
import { subtotalDe, totalesPorMoneda } from '../src/modules/materiales/domain/listado';
import { MATERIALES_GALPON, OBSERVACIONES_GALPON } from './datos-galpon';

/** Listado del galpón: sin precios (para el proveedor) y con precios de venta (para el cliente). */
export async function muestraListado(dir: string, estilo: { colorPrimario: string; firmaTexto: string }): Promise<void> {
  const renglones = MATERIALES_GALPON.map((m) => ({
    cantidad: m.cantidad,
    nombre: m.nombre,
    unidad: m.unidad,
    precioCosto: m.costo?.[0] ?? null,
    monedaCosto: m.costo?.[1] ?? null,
    precioVenta: m.venta?.[0] ?? null,
    monedaVenta: m.venta?.[1] ?? null,
    subtotal: null as string | null,
  }));
  const emisor = { nombre: 'HERMAN ALEXIS NAHUEL', lineas: ['CUIT 20-11111111-2', 'Calle Falsa 123, General Ramírez, Entre Ríos', 'Tel. 343 400-0000'] };
  for (const precios of ['NINGUNO', 'VENTA'] as const) {
    const filas = renglones.map((r) => ({ ...r, subtotal: subtotalDe(r, precios)?.importe.toFixed(2) ?? null }));
    const listado: ListadoParaPdf = {
      titulo: 'Cálculo aproximado de materiales para galpón',
      fecha: '2026-10-05',
      proyecto: { nombre: 'Galpón sucursal Costa Doll' },
      presupuesto: { numero: 'P-0000003' },
      proveedor: precios === 'NINGUNO' ? { nombre: 'Hierros del Litoral SRL', telefono: '343 455-0000', email: null } : null,
      destino: 'Ruta 131 km 4, Costa Doll',
      observaciones: OBSERVACIONES_GALPON,
      precios,
      renglones: filas,
      totales: totalesPorMoneda(filas, precios).totales.map((t) => ({ moneda: t.moneda, total: new Decimal(t.total).toFixed(2) })),
    };
    const pdf = await generarPdfListado(listado, emisor, estilo, 'Obra');
    writeFileSync(join(dir, precios === 'NINGUNO' ? 'listado-galpon-para-proveedor.pdf' : 'listado-galpon-precios-venta.pdf'), pdf);
  }
}
