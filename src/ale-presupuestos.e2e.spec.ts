/**
 * Fase Ale Herrería 4 (e2e): presupuestos con los casos del doc (Diego Streck por ítem, Municipalidad
 * global, La Agrícola Regional por superficie), numeración, estados, vencimiento, duplicar, PDF,
 * biblioteca y crear la obra desde un presupuesto aceptado.
 * Corre contra una base real (DATABASE_URL ya migrada); sin DATABASE_URL se saltea.
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

(hayBase ? describe : describe.skip)('Ale Herrería: presupuestos (e2e)', () => {
  jest.setTimeout(90_000);
  let app: INestApplication;
  let base: string;
  let token: string;
  let tenantId: string;
  const prisma = new PrismaService();
  const ids: Record<string, string> = {};

  async function http(metodo: string, ruta: string, body?: unknown): Promise<{ status: number; body: Json; crudo: Buffer }> {
    const res = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
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
      data: {
        slug: `e2e-presu-${randomUUID().slice(0, 8)}`,
        nombreFantasia: 'E2E Ale Herrería',
        razonSocial: 'E2E HERMAN ALEXIS NAHUEL',
        cuit: cuitDePrueba(),
        condicionIva: 'RESPONSABLE_INSCRIPTO',
        domicilioFiscal: 'General Ramírez',
        etiquetaProyecto: 'Obra',
      },
    });
    tenantId = t.id;
    await prisma.usuario.create({ data: { tenantId, email: `ale@${t.slug}.test`, passwordHash: await hashPassword(PASSWORD) } });
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `ale@${t.slug}.test`, password: PASSWORD }) });
    token = ((await login.json()) as { accessToken: string }).accessToken;
    ids.diego = (await ok('POST', '/clientes', { razonSocial: 'Diego Streck', tipoDocumento: 'CONSUMIDOR_FINAL', numeroDocumento: '', condicionIva: 'CONSUMIDOR_FINAL' })).id;
    ids.muni = (await ok('POST', '/clientes', { razonSocial: 'Municipalidad de General Ramírez', tipoDocumento: 'CONSUMIDOR_FINAL', numeroDocumento: '', condicionIva: 'EXENTO' })).id;
    ids.lar = (await ok('POST', '/clientes', { razonSocial: 'La Agrícola Regional', tipoDocumento: 'CUIT', numeroDocumento: '30668346908', condicionIva: 'RESPONSABLE_INSCRIPTO' })).id;
  });

  afterAll(async () => {
    await app?.close();
    await prisma.presupuesto.deleteMany({ where: { tenantId } });
    await prisma.movimientoCuentaCorriente.deleteMany({ where: { tenantId } });
    await prisma.proyecto.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('la biblioteca inicial se carga una vez y no se duplica', async () => {
    const r = await ok('POST', '/presupuestos/biblioteca/cargar-inicial');
    expect(r.items).toBeGreaterThan(10);
    expect(await ok('POST', '/presupuestos/biblioteca/cargar-inicial')).toEqual({ items: 0, observaciones: 0 });
    const obs = await ok('GET', '/presupuestos/biblioteca/observaciones');
    expect(obs.some((o: Json) => o.texto === 'Plazo de obra: {valor}.' && o.llevaValor)).toBe(true);
  });

  it('Diego Streck, por ítem: P-0000001, vence a los 15 días, el formato se sanea', async () => {
    const p = await ok('POST', '/presupuestos', {
      clienteId: ids.diego,
      fecha: '2026-11-26',
      titulo: 'Portón y rejas',
      lugar: 'General Ramírez',
      moneda: 'ARS',
      formaCotizar: 'POR_ITEM',
      ivaModo: 'NO_INCLUYE',
      items: [
        { cantidad: '1', descripcion: '<b>Portón corredizo</b> de caño <script>x</script>estructural', importe: '850000' },
        { cantidad: '4', descripcion: 'Rejas de <span style="color:#ff0000">hierro macizo</span>', importe: '620000' },
        { cantidad: '1', descripcion: 'Pintura', importe: '380000' },
      ],
      observaciones: [{ texto: 'Plazo de obra: {valor}.', valor: '20 días hábiles' }],
    });
    ids.diegoP = p.id;
    expect(p).toMatchObject({ numero: 'P-0000001', fechaVencimiento: '2026-12-11', estado: 'BORRADOR', subtotal: '1850000.00', total: '1850000.00' });
    expect(p.items[0].descripcion).toBe('<p><b>Portón corredizo</b> de caño estructural</p>');
    expect(p.items[1].descripcion).toContain('<span style="color:#ff0000">hierro macizo</span>');
    expect(p.cliente).toMatchObject({ razonSocial: 'Diego Streck', documento: null });
    const pdf = await http('GET', `/presupuestos/${p.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.crudo.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('Municipalidad, total global con IVA discriminado al 21%', async () => {
    const p = await ok('POST', '/presupuestos', {
      clienteId: ids.muni,
      fecha: '2026-11-26',
      titulo: 'Reparación de techos del corralón',
      moneda: 'ARS',
      formaCotizar: 'GLOBAL',
      importeGlobal: '4200000',
      ivaModo: 'DISCRIMINADO',
      alicuotaIva: '21',
      items: [{ descripcion: 'Desmontaje de chapas dañadas' }, { descripcion: 'Techado con chapa trapezoidal' }, { descripcion: 'Canaletas y bajadas' }],
    });
    expect(p).toMatchObject({ numero: 'P-0000002', subtotal: '4200000.00', iva: '882000.00', total: '5082000.00' });
  });

  it('LAR por superficie; aceptado crea la obra con el acordado y los hitos', async () => {
    const p = await ok('POST', '/presupuestos', {
      clienteId: ids.lar,
      fecha: '2026-10-01',
      fechaVencimiento: '2026-12-31',
      titulo: 'Galpón sucursal Costa Doll',
      lugar: 'Costa Doll',
      moneda: 'ARS',
      formaCotizar: 'SUPERFICIE',
      superficie: { ancho: '20', largo: '45', alturaLateral: '6', alturaCumbrera: '8' },
      importeGlobal: '17300000',
      ivaModo: 'NO_INCLUYE',
      items: [{ descripcion: 'Estructura metálica con columnas de perfil C y vigas reticuladas' }],
    });
    expect(p).toMatchObject({ numero: 'P-0000003', subtotal: '17300000.00' });
    expect((await http('POST', `/presupuestos/${p.id}/proyecto`, {})).status).toBe(400); // todavía no está aceptado
    await ok('PATCH', `/presupuestos/${p.id}/estado`, { estado: 'ENVIADO' });
    const cambio = { clienteId: ids.lar, fecha: '2026-10-01', moneda: 'ARS', formaCotizar: 'GLOBAL', importeGlobal: '1', ivaModo: 'SIN_IVA', items: [{ descripcion: 'x' }] };
    expect((await http('PUT', `/presupuestos/${p.id}`, cambio)).status).toBe(409); // enviado no se edita
    await ok('PATCH', `/presupuestos/${p.id}/estado`, { estado: 'ACEPTADO' });
    const r = await ok('POST', `/presupuestos/${p.id}/proyecto`, {
      hitos: [
        { descripcion: 'Anticipo', importe: '2595000' },
        { descripcion: 'Según avance de obra', importe: '13385000', porCertificacion: true },
        { descripcion: 'Al terminar', importe: '1320000' },
      ],
    });
    const obra = await ok('GET', `/proyectos/${r.proyectoId}`);
    expect(obra).toMatchObject({ nombre: 'Galpón sucursal Costa Doll', ubicacion: 'Costa Doll', montoAcordado: '17300000.00', modoIva: 'MAS_IVA' });
    expect(obra.hitos).toHaveLength(3);
    expect((await http('POST', `/presupuestos/${p.id}/proyecto`, {})).status).toBe(409);
  });

  it('duplicar con reemplazo: número nuevo y el original queda rechazado', async () => {
    const dup = await ok('POST', `/presupuestos/${ids.diegoP}/duplicar`, { reemplaza: true });
    expect(dup).toMatchObject({ numero: 'P-0000004', estado: 'BORRADOR', total: '1850000.00', duplicadoDeId: ids.diegoP });
    expect((await ok('GET', `/presupuestos/${ids.diegoP}`)).estado).toBe('RECHAZADO');
  });

  it('pasa solo a vencido; uno vencido se duplica con fecha nueva', async () => {
    const p = await ok('POST', '/presupuestos', {
      clienteId: ids.diego,
      fecha: '2026-01-01',
      moneda: 'USD',
      formaCotizar: 'GLOBAL',
      importeGlobal: '1000',
      ivaModo: 'SIN_IVA',
      items: [{ descripcion: 'Escalera caracol' }],
    });
    expect((await ok('GET', `/presupuestos/${p.id}`)).estado).toBe('VENCIDO');
    const lista = await ok('GET', '/presupuestos?estado=VENCIDO');
    expect(lista.map((x: Json) => x.id)).toContain(p.id);
    expect((await http('PATCH', `/presupuestos/${p.id}/estado`, { estado: 'BORRADOR' })).status).toBe(400);
    const dup = await ok('POST', `/presupuestos/${p.id}/duplicar`, {});
    expect(dup.estado).toBe('BORRADOR');
  });

  it('errores de validación claros y solo se borra un borrador', async () => {
    const r = await http('POST', '/presupuestos', { clienteId: ids.diego, fecha: '2026-11-26', moneda: 'ARS', formaCotizar: 'POR_ITEM', ivaModo: 'SIN_IVA', items: [{ descripcion: 'Sin importe' }] });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/cada ítem/);
    expect((await http('DELETE', `/presupuestos/${ids.diegoP}`)).status).toBe(400);
  });
});
