/**
 * Fase Ale Herrería 5 (e2e): proveedores, catálogo de materiales y listados por obra con copia de
 * precios, totales por moneda y PDF. Corre contra una base real; sin DATABASE_URL se saltea.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'crypto';
import type { AddressInfo } from 'net';
import { AppModule } from './app.module';
import { hashPassword } from './modules/auth/password';
import { PrismaService } from './shared/prisma/prisma.service';
import { cuitDePrueba } from './shared/testing/datos';

const PASSWORD = 'clave-de-prueba-e2e-1';
const hayBase = Boolean(process.env.DATABASE_URL);
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

(hayBase ? describe : describe.skip)('Ale Herrería: materiales y proveedores (e2e)', () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let base: string;
  let token: string;
  let tenantId: string;
  const prisma = new PrismaService();
  const ids: Record<string, string> = {};

  async function http(metodo: string, ruta: string, body?: unknown) {
    const res = await fetch(`${base}${ruta}`, { method: metodo, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const crudo = Buffer.from(await res.arrayBuffer());
    let datos: Json = {};
    try {
      datos = JSON.parse(crudo.toString('utf8')) as Json;
    } catch {
      datos = {};
    }
    return { status: res.status, body: datos, crudo };
  }
  async function ok(metodo: string, ruta: string, body?: unknown): Promise<Json> {
    const r = await http(metodo, ruta, body);
    if (r.status >= 400) throw new Error(`${metodo} ${ruta} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`;
    const t = await prisma.tenant.create({
      data: { slug: `e2e-mat-${randomUUID().slice(0, 8)}`, nombreFantasia: 'E2E Materiales', razonSocial: 'E2E SA', cuit: cuitDePrueba(), condicionIva: 'RESPONSABLE_INSCRIPTO', domicilioFiscal: 'Calle 1' },
    });
    tenantId = t.id;
    await prisma.usuario.create({ data: { tenantId, email: `ale@${t.slug}.test`, passwordHash: await hashPassword(PASSWORD) } });
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `ale@${t.slug}.test`, password: PASSWORD }) });
    token = ((await login.json()) as { accessToken: string }).accessToken;
    const cliente = await ok('POST', '/clientes', { razonSocial: 'La Agrícola Regional', tipoDocumento: 'CUIT', numeroDocumento: '30668346908', condicionIva: 'RESPONSABLE_INSCRIPTO' });
    ids.obra = (await ok('POST', '/proyectos', { clienteId: cliente.id, nombre: 'Galpón Costa Doll' })).id;
  });

  afterAll(async () => {
    await app?.close();
    await prisma.listadoMateriales.deleteMany({ where: { tenantId } });
    await prisma.material.deleteMany({ where: { tenantId } });
    await prisma.proveedor.deleteMany({ where: { tenantId } });
    await prisma.proyecto.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('proveedores: CUIT opcional validado y nombre único', async () => {
    ids.proveedor = (await ok('POST', '/proveedores', { nombre: 'Hierros del Litoral SRL', telefono: '343 455-0000', cuit: '' })).id;
    expect((await http('POST', '/proveedores', { nombre: 'Hierros del Litoral SRL' })).status).toBe(409);
    expect((await http('POST', '/proveedores', { nombre: 'Otro', cuit: '30-66834690-7' })).status).toBe(400);
  });

  it('catálogo con costo y venta en monedas distintas; la fecha se actualiza al cambiar precios', async () => {
    const perfil = await ok('POST', '/materiales', { nombre: 'Perfil C 160', unidad: 'barras', categoria: 'Perfiles', precioCosto: '61400', monedaCosto: 'ARS', precioVenta: '73700', monedaVenta: 'ARS', proveedorId: ids.proveedor });
    const chapa = await ok('POST', '/materiales', { nombre: 'Chapa trapezoidal C25', unidad: 'metros', precioCosto: '15', monedaCosto: 'USD', precioVenta: '18', monedaVenta: 'USD' });
    ids.perfil = perfil.id;
    ids.chapa = chapa.id;
    expect(perfil.preciosActualizadosEn).toBeTruthy();
    const antes = perfil.preciosActualizadosEn as string;
    await new Promise((r) => setTimeout(r, 10));
    const sinCambio = await ok('PATCH', `/materiales/${perfil.id}`, { nombre: 'Perfil C 160 x 60', unidad: 'barras' });
    expect(sinCambio.preciosActualizadosEn).toBe(antes);
  });

  it('listado por obra: copia precios, totales por moneda, y el catálogo nuevo no lo cambia', async () => {
    const l = await ok('POST', '/listados-materiales', {
      titulo: 'Cálculo aproximado de materiales para galpón',
      fecha: '2026-10-05',
      proyectoId: ids.obra,
      proveedorId: ids.proveedor,
      destino: 'Costa Doll',
      precios: 'VENTA',
      renglones: [
        { cantidad: '24', materialId: ids.perfil },
        { cantidad: '540', materialId: ids.chapa },
        { cantidad: '3', nombre: 'Flete', unidad: 'viajes' },
      ],
    });
    ids.listado = l.id;
    expect(l.totales).toEqual([
      { moneda: 'ARS', total: '1768800.00' },
      { moneda: 'USD', total: '9720.00' },
    ]);
    expect(l.renglonesSinPrecio).toBe(1);
    expect(l.proyecto.nombre).toBe('Galpón Costa Doll');

    await ok('PATCH', `/materiales/${ids.perfil}`, { nombre: 'Perfil C 160 x 60', unidad: 'barras', precioVenta: '80000' });
    expect((await ok('GET', `/listados-materiales/${l.id}`)).totales[0].total).toBe('1768800.00');
    // Editar el listado conserva los precios copiados.
    const editado = await ok('PUT', `/listados-materiales/${l.id}`, {
      titulo: l.titulo,
      fecha: l.fecha,
      proyectoId: ids.obra,
      precios: 'VENTA',
      renglones: l.renglones.map((r: Json) => ({ renglonId: r.id, cantidad: r.cantidad, materialId: r.materialId ?? undefined, nombre: r.nombre, unidad: r.unidad })),
    });
    expect(editado.totales[0].total).toBe('1768800.00');
    // A pedido, se actualizan con el catálogo.
    expect((await ok('POST', `/listados-materiales/${l.id}/actualizar-precios`)).totales[0].total).toBe('1920000.00');

    const pdf = await http('GET', `/listados-materiales/${l.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.crudo.subarray(0, 4).toString()).toBe('%PDF');
    expect((await ok('GET', `/listados-materiales?proyectoId=${ids.obra}`)).map((x: Json) => x.id)).toEqual([l.id]);
  });

  it('usados en listados no se borran: se desactivan', async () => {
    expect((await http('DELETE', `/materiales/${ids.perfil}`)).status).toBe(400);
    expect((await http('DELETE', `/proveedores/${ids.proveedor}`)).status).toBe(400);
    await ok('PATCH', `/materiales/${ids.perfil}`, { nombre: 'Perfil C 160 x 60', unidad: 'barras', activo: false });
    expect((await ok('GET', '/materiales')).map((m: Json) => m.id)).not.toContain(ids.perfil);
    expect((await ok('GET', '/materiales?inactivos=true')).map((m: Json) => m.id)).toContain(ids.perfil);
  });
});
