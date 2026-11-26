/**
 * Fase Ale Herrería 1 (e2e): módulos por empresa, etiquetas de proyecto, firma y clientes sin
 * documento. Corre contra una base real (DATABASE_URL ya migrada); sin DATABASE_URL se saltea.
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

(hayBase ? describe : describe.skip)('Ale Herrería: base (e2e)', () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let base: string;
  let token: string;
  let tenantId: string;
  const prisma = new PrismaService();

  async function http(metodo: string, ruta: string, body?: unknown) {
    const res = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const texto = await res.text();
    return { status: res.status, body: texto ? (JSON.parse(texto) as Record<string, unknown>) : null };
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`;
    const t = await prisma.tenant.create({
      data: {
        slug: `e2e-ale-${randomUUID().slice(0, 8)}`,
        nombreFantasia: 'E2E Ale Herrería',
        razonSocial: 'E2E Herman Alexis Nahuel',
        cuit: cuitDePrueba(),
        condicionIva: 'RESPONSABLE_INSCRIPTO',
        domicilioFiscal: 'General Ramírez, Entre Ríos',
        // Como queda Ale: sin importaciones, integraciones, webhooks ni recibos de pago.
        modulosHabilitados: ['comprobantes', 'recibos', 'cuenta-corriente', 'proyectos', 'presupuestos', 'materiales'],
        etiquetaProyecto: 'Obra',
        etiquetaProyectoPlural: 'Obras',
      },
    });
    tenantId = t.id;
    await prisma.usuario.create({ data: { tenantId, email: `rocio@${t.slug}.test`, passwordHash: await hashPassword(PASSWORD) } });
    const login = await http('POST', '/auth/login', { email: `rocio@${t.slug}.test`, password: PASSWORD });
    token = login.body!.accessToken as string;
  });

  afterAll(async () => {
    await app?.close();
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('el perfil trae los módulos y la etiqueta de proyecto', async () => {
    const me = await http('GET', '/auth/me');
    expect(me.body!.tenant).toMatchObject({ etiquetaProyecto: 'Obra', etiquetaProyectoPlural: 'Obras' });
    expect((me.body!.tenant as { modulos: string[] }).modulos).not.toContain('importaciones');
  });

  it('los módulos ocultos responden 403', async () => {
    for (const ruta of ['/importaciones', '/integraciones', '/configuracion/webhooks', '/configuracion/plantillas-mapeo']) {
      expect([ruta, (await http('GET', ruta)).status]).toEqual([ruta, 403]);
    }
    const pago = await http('POST', '/recibos', {
      tipo: 'PAGO',
      fecha: '2026-11-26',
      moneda: 'ARS',
      contraparte: { nombre: 'Soldador' },
      items: [{ descripcion: 'Jornal', importe: '1000' }],
      total: '1000',
    });
    expect(pago.status).toBe(403);
    // Lo habilitado sigue andando.
    expect((await http('GET', '/cuenta-corriente/resumen')).status).toBe(200);
  });

  it('la etiqueta y la firma se configuran desde la empresa', async () => {
    const pref = await http('PATCH', '/configuracion/preferencias', { etiquetaProyecto: 'Trabajo', etiquetaProyectoPlural: 'Trabajos' });
    expect(pref.body).toMatchObject({ etiquetaProyecto: 'Trabajo', etiquetaProyectoPlural: 'Trabajos' });
    await http('PATCH', '/configuracion/preferencias', { etiquetaProyecto: 'Obra', etiquetaProyectoPlural: 'Obras' });
    const plantilla = await http('PATCH', '/configuracion/plantilla-pdf', { firmaTexto: 'ATTE. ALEXIS NAHUEL HERMAN' });
    expect(plantilla.body).toMatchObject({ firmaTexto: 'ATTE. ALEXIS NAHUEL HERMAN' });
    const emisor = await http('PATCH', '/configuracion/emisor', { telefono: '343 412-3456' });
    expect(emisor.body).toMatchObject({ telefono: '343 412-3456' });
  });

  it('puede haber varios clientes sin documento, pero no dos con el mismo CUIT', async () => {
    const sinDoc = (nombre: string) => http('POST', '/clientes', { razonSocial: nombre, tipoDocumento: 'CONSUMIDOR_FINAL', numeroDocumento: '', condicionIva: 'CONSUMIDOR_FINAL' });
    expect((await sinDoc('Diego Streck')).status).toBe(201);
    expect((await sinDoc('Wilson Carrillo')).status).toBe(201);
    const conCuit = { razonSocial: 'La Agrícola Regional Coop. Ltda.', tipoDocumento: 'CUIT', numeroDocumento: '30-66834690-8', condicionIva: 'RESPONSABLE_INSCRIPTO' };
    expect((await http('POST', '/clientes', conCuit)).status).toBe(201);
    expect((await http('POST', '/clientes', { ...conCuit, razonSocial: 'Duplicado' })).status).toBe(409);
  });
});
