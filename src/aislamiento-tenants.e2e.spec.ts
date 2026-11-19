/**
 * Aislamiento entre tenants (ARCHITECTURE.md §9, punto 4): levanta la app completa y, con la
 * sesión (o la API key) de la empresa B, intenta leer, modificar y borrar recursos de la empresa A
 * en cada endpoint con id. Todo tiene que fallar y los datos de A no pueden cambiar.
 * Corre contra una base real (DATABASE_URL ya migrada); sin DATABASE_URL se saltea.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'crypto';
import type { AddressInfo } from 'net';
import { AppModule } from './app.module';
import { hashPassword } from './modules/auth/password';
import { sha256Hex } from './modules/auth/claves';
import { PadronEmisorService } from './modules/tenants/padron-emisor.service';
import { PrismaService } from './shared/prisma/prisma.service';
import { cuitDePrueba } from './shared/testing/datos';
import { esCuitValido } from './shared/util/cuit';

const PASSWORD = 'clave-de-prueba-e2e-1';

/** CUIT aleatorio con dígito verificador correcto (PATCH /configuracion/emisor lo valida). */
function cuitValidoDePrueba(): string {
  // Algunas bases no tienen dígito válido (el verificador daría 10): se prueba con otra.
  for (;;) {
    const base = cuitDePrueba().slice(0, 10);
    for (let d = 0; d <= 9; d++) if (esCuitValido(`${base}${d}`)) return `${base}${d}`;
  }
}

const hayBase = Boolean(process.env.DATABASE_URL);
(hayBase ? describe : describe.skip)('Aislamiento entre tenants (e2e)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let base: string;
  const prisma = new PrismaService();
  const tenants: string[] = [];
  let tokenB: string;
  let keyB: string;
  const a: Record<string, string> = {};

  async function crearTenant(nombre: string) {
    const t = await prisma.tenant.create({
      data: {
        slug: `e2e-${nombre}-${randomUUID().slice(0, 8)}`,
        nombreFantasia: `E2E ${nombre}`,
        razonSocial: `E2E ${nombre} SA`,
        cuit: cuitDePrueba(),
        condicionIva: 'RESPONSABLE_INSCRIPTO',
        domicilioFiscal: 'Calle 1',
        inicioActividades: new Date('2020-01-01'),
      },
    });
    tenants.push(t.id);
    await prisma.usuario.create({ data: { tenantId: t.id, email: `usuario@${t.slug}.test`, passwordHash: await hashPassword(PASSWORD) } });
    return t;
  }

  async function http(metodo: string, ruta: string, opciones: { token?: string; key?: string; body?: unknown } = {}) {
    const res = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        ...(opciones.token ? { Authorization: `Bearer ${opciones.token}` } : {}),
        ...(opciones.key ? { 'X-Api-Key': opciones.key } : {}),
        ...(metodo === 'POST' ? { 'Idempotency-Key': `e2e-${randomUUID()}` } : {}),
      },
      body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
    });
    const texto = await res.text();
    return { status: res.status, body: texto };
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    // Los CUIT de prueba son inventados: no consultar el padrón real de ARCA al guardarlos.
    jest.spyOn(app.get(PadronEmisorService), 'datosParaAlta').mockResolvedValue(undefined);
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`;

    // Empresa A con un recurso de cada tipo.
    const ta = await crearTenant('a');
    const t = ta.id;
    a.cliente = (await prisma.cliente.create({ data: { tenantId: t, razonSocial: 'Cliente A', tipoDocumento: 'CUIT', numeroDocumento: '30668346908', condicionIva: 'RESPONSABLE_INSCRIPTO' } })).id;
    a.puntoVenta = (await prisma.puntoVenta.create({ data: { tenantId: t, numero: 7, ambiente: 'HOMOLOGACION' } })).id;
    a.comprobante = (
      await prisma.comprobante.create({
        data: { tenantId: t, tipo: 'FACTURA_A', ambiente: 'HOMOLOGACION', clienteId: a.cliente, puntoVentaId: a.puntoVenta, fechaEmision: new Date('2026-09-29'), concepto: 'PRODUCTOS', importeTotal: '100' },
      })
    ).id;
    a.importacion = (await prisma.importacion.create({ data: { tenantId: t, origen: 'MANUAL' } })).id;
    a.item = (
      await prisma.itemFacturable.create({
        data: {
          tenantId: t,
          importacionId: a.importacion,
          origen: 'MANUAL',
          referenciaExterna: 'ref-a',
          descripcion: 'Item A',
          cantidad: '1',
          unidad: 'UNIDAD',
          precioUnitario: '100',
          alicuotaIva: '21',
          hashContenido: 'h',
        },
      })
    ).id;
    a.tarifa = (
      await prisma.tarifa.create({
        data: { tenantId: t, clienteId: a.cliente, unidad: 'HORA', precioUnitario: '10', moneda: 'ARS', alicuotaIva: '21', vigenteDesde: new Date('2026-01-01') },
      })
    ).id;
    a.plantilla = (await prisma.plantillaMapeo.create({ data: { tenantId: t, nombre: 'P', formato: 'csv', config: {} } })).id;
    a.integracion = (await prisma.integracion.create({ data: { tenantId: t, nombre: 'I', keyPrefijo: `fct_${randomUUID().slice(0, 8)}`, keyHash: 'x', scopes: [] } })).id;
    a.webhook = (await prisma.webhookSuscripcion.create({ data: { tenantId: t, url: 'https://a.example.com/h', eventos: ['comprobante.emitido'], secretoCifrado: 'v1:x:x:x' } })).id;
    a.entrega = (await prisma.webhookEntrega.create({ data: { tenantId: t, suscripcionId: a.webhook, eventoId: 'evt_a', evento: 'comprobante.emitido', payload: {} } })).id;
    a.recibo = (
      await prisma.recibo.create({
        data: {
          tenantId: t,
          tipo: 'COBRO',
          numero: '0001-00000001',
          fecha: new Date('2026-09-29'),
          total: '100',
          clienteId: a.cliente,
          contraparteNombre: 'Cliente A',
          contraparte: { nombre: 'Cliente A' },
          items: [{ descripcion: 'x', cantidad: '1', importe: '100' }],
        },
      })
    ).id;

    // Empresa B: sesión de usuario y API key con todos los permisos.
    const tb = await crearTenant('b');
    const login = await http('POST', '/auth/login', { body: { email: `usuario@${tb.slug}.test`, password: PASSWORD } });
    tokenB = (JSON.parse(login.body) as { accessToken: string }).accessToken;
    keyB = `fct_${randomUUID().replace(/-/g, '').slice(0, 8)}_${randomUUID().replace(/-/g, '')}`;
    await prisma.integracion.create({
      data: {
        tenantId: tb.id,
        nombre: 'B',
        keyPrefijo: keyB.slice(0, 12),
        keyHash: sha256Hex(keyB),
        scopes: ['items:write', 'comprobantes:write', 'comprobantes:read', 'acceso:emitir'],
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    for (const id of tenants) {
      await prisma.webhookEntrega.deleteMany({ where: { tenantId: id } });
      await prisma.itemFacturable.deleteMany({ where: { tenantId: id } });
      await prisma.comprobante.deleteMany({ where: { tenantId: id } });
      await prisma.recibo.deleteMany({ where: { tenantId: id } });
      await prisma.importacion.deleteMany({ where: { tenantId: id } });
      await prisma.tenant.delete({ where: { id } });
    }
    await prisma.$disconnect();
  });

  // [método, ruta, body] con la sesión de B sobre recursos de A.
  const conSesion = (): Array<[string, string, unknown?]> => [
    ['GET', `/clientes/${a.cliente}`],
    ['PATCH', `/clientes/${a.cliente}`, { razonSocial: 'Hackeado' }],
    ['GET', `/comprobantes/${a.comprobante}`],
    ['PATCH', `/comprobantes/${a.comprobante}`, { version: 0, observaciones: 'x' }],
    ['DELETE', `/comprobantes/${a.comprobante}`],
    ['POST', `/comprobantes/${a.comprobante}/emitir`, { version: 0 }],
    ['POST', `/comprobantes/${a.comprobante}/verificar`],
    ['POST', `/comprobantes/${a.comprobante}/notas`, { clase: 'NOTA_CREDITO', motivo: 'x' }],
    ['GET', `/comprobantes/${a.comprobante}/pdf`],
    ['POST', '/comprobantes/generar', { itemIds: [a.item] }],
    ['POST', '/comprobantes', { clienteId: a.cliente, puntoVentaId: a.puntoVenta, fechaEmision: '2026-09-29', concepto: 'PRODUCTOS', lineas: [{ descripcion: 'x', cantidad: '1', unidad: 'UNIDAD', precioUnitario: '1', alicuotaIva: '21' }] }],
    ['PATCH', `/configuracion/puntos-venta/${a.puntoVenta}`, { activo: false }],
    ['GET', `/importaciones/${a.importacion}`],
    ['POST', `/importaciones/${a.importacion}/confirmar`],
    ['POST', `/importaciones/${a.importacion}/descartar`],
    ['PATCH', `/importaciones/items/${a.item}`, { descripcion: 'Hackeado' }],
    ['POST', `/importaciones/items/${a.item}/descartar`],
    ['POST', `/importaciones/items/${a.item}/restaurar`],
    ['PATCH', `/configuracion/tarifas/${a.tarifa}`, { precioUnitario: '1' }],
    ['DELETE', `/configuracion/tarifas/${a.tarifa}`],
    ['POST', '/configuracion/tarifas', { clienteId: a.cliente, unidad: 'HORA', precioUnitario: '1', moneda: 'ARS', alicuotaIva: '21', vigenteDesde: '2026-01-01' }],
    ['PATCH', `/configuracion/plantillas-mapeo/${a.plantilla}`, { nombre: 'Hackeada' }],
    ['DELETE', `/integraciones/${a.integracion}`],
    ['PATCH', `/configuracion/webhooks/${a.webhook}`, { activa: false }],
    ['DELETE', `/configuracion/webhooks/${a.webhook}`],
    ['POST', `/configuracion/webhooks/${a.webhook}/rotar-secreto`],
    ['POST', `/configuracion/webhooks/${a.webhook}/probar`],
    ['POST', `/configuracion/webhooks/entregas/${a.entrega}/reenviar`],
    ['GET', `/recibos/${a.recibo}`],
    ['GET', `/recibos/${a.recibo}/pdf`],
    // Un recibo de B no puede apuntar a un cliente de A (FK compuesta).
    ['POST', '/recibos', { tipo: 'COBRO', fecha: '2026-09-29', moneda: 'ARS', clienteId: a.cliente, contraparte: { nombre: 'x' }, items: [{ descripcion: 'x', importe: '1' }], total: '1' }],
  ];

  it('con la sesión de otra empresa, ningún endpoint con id toca recursos ajenos', async () => {
    const pasaron: string[] = [];
    for (const [metodo, ruta, body] of conSesion()) {
      const r = await http(metodo, ruta, { token: tokenB, body });
      if (r.status < 400) pasaron.push(`${metodo} ${ruta} → ${r.status}`);
    }
    expect(pasaron).toEqual([]);
  });

  it('con la API key de otra empresa, tampoco', async () => {
    const intentos: Array<[string, string, unknown?]> = [
      ['GET', `/v1/comprobantes/${a.comprobante}`],
      ['POST', `/v1/comprobantes/${a.comprobante}/emitir`, {}],
      ['GET', `/v1/comprobantes/${a.comprobante}/pdf`],
      ['GET', `/v1/importaciones/${a.importacion}`],
      ['POST', `/v1/importaciones/${a.importacion}/confirmar`],
      ['POST', '/v1/comprobantes/borradores', { itemIds: [a.item] }],
      ['POST', '/v1/comprobantes/borradores', { referencias: ['ref-a'] }],
      ['PATCH', `/v1/comprobantes/${a.comprobante}`, { version: 0, observaciones: 'x' }],
      ['DELETE', `/v1/comprobantes/${a.comprobante}`],
      ['POST', `/v1/comprobantes/${a.comprobante}/notas`, { clase: 'NOTA_CREDITO', motivo: 'x' }],
      ['POST', `/v1/comprobantes/${a.comprobante}/verificar`],
      ['POST', '/v1/comprobantes', { clienteId: a.cliente, puntoVentaId: a.puntoVenta, fechaEmision: '2026-09-29', concepto: 'PRODUCTOS', lineas: [{ descripcion: 'x', cantidad: '1', unidad: 'UNIDAD', precioUnitario: '1', alicuotaIva: '21' }] }],
      ['GET', `/v1/clientes/${a.cliente}`],
      ['POST', `/v1/clientes/${a.cliente}/referencias`, { referenciaExterna: 'robada' }],
      ['PATCH', `/v1/clientes/${a.cliente}`, { razonSocial: 'Hackeado' }],
    ];
    const pasaron: string[] = [];
    for (const [metodo, ruta, body] of intentos) {
      const r = await http(metodo, ruta, { key: keyB, body });
      if (r.status < 400) pasaron.push(`${metodo} ${ruta} → ${r.status}`);
    }
    expect(pasaron).toEqual([]);
  });

  it('los listados de B no muestran nada de A', async () => {
    const rutas = ['/clientes', '/comprobantes', '/comprobantes?incluirRecibos=true', '/recibos/siguiente-numero?tipo=COBRO', '/importaciones', '/importaciones/items', '/configuracion/tarifas', '/configuracion/plantillas-mapeo', '/integraciones', '/configuracion/webhooks', '/configuracion/puntos-venta'];
    const idsA = Object.values(a);
    const filtrados: string[] = [];
    for (const ruta of rutas) {
      const r = await http('GET', ruta, { token: tokenB });
      expect(r.status).toBe(200);
      if (idsA.some((id) => r.body.includes(id))) filtrados.push(ruta);
    }
    for (const ruta of ['/v1/items?referencia=ref-a', '/v1/clientes', '/v1/comprobantes', '/v1/configuracion']) {
      const v1 = await http('GET', ruta, { key: keyB });
      expect(v1.status).toBe(200);
      if (idsA.some((id) => v1.body.includes(id))) filtrados.push(ruta);
    }
    expect(filtrados).toEqual([]);
  });

  it('una empresa recién registrada por /auth/registro no ve ni toca nada de A', async () => {
    const email = `registro-${randomUUID().slice(0, 8)}@e2e.test`;
    const reg = await http('POST', '/auth/registro', { body: { nombreEmpresa: 'E2E Registro', email, password: PASSWORD } });
    expect(reg.status).toBe(201);
    const sesion = JSON.parse(reg.body) as { accessToken: string; tenant: { id: string } };
    tenants.push(sesion.tenant.id);
    const token = sesion.accessToken;

    // Mismo email otra vez: no crea una segunda empresa.
    expect((await http('POST', '/auth/registro', { body: { nombreEmpresa: 'Otra', email, password: PASSWORD } })).status).toBe(409);
    // Puede volver a entrar con su contraseña.
    expect((await http('POST', '/auth/login', { body: { email, password: PASSWORD } })).status).toBe(200);

    const me = JSON.parse((await http('GET', '/auth/me', { token })).body) as { tenant: { datosFiscalesCompletos: boolean } };
    expect(me.tenant.datosFiscalesCompletos).toBe(false);

    const pasaron: string[] = [];
    for (const [metodo, ruta, body] of conSesion()) {
      const r = await http(metodo, ruta, { token, body });
      if (r.status < 400) pasaron.push(`${metodo} ${ruta} → ${r.status}`);
    }
    expect(pasaron).toEqual([]);

    const idsA = Object.values(a);
    for (const ruta of ['/clientes', '/comprobantes', '/importaciones', '/configuracion/puntos-venta', '/configuracion/emisor']) {
      const r = await http('GET', ruta, { token });
      expect(r.status).toBe(200);
      expect(idsA.some((id) => r.body.includes(id))).toBe(false);
    }

    // Completa los datos fiscales en Configuración (paso posterior al registro).
    const emisor = await http('PATCH', '/configuracion/emisor', {
      token,
      body: { razonSocial: 'E2E Registro SA', cuit: cuitValidoDePrueba(), condicionIva: 'MONOTRIBUTO', domicilioFiscal: 'Calle 2' },
    });
    expect(emisor.status).toBe(200);
    expect(JSON.parse(emisor.body)).toMatchObject({ datosFiscalesCompletos: true });
  });

  it('los datos de A quedaron intactos', async () => {
    const [cliente, comprobante, item, tarifa, integracion, webhook, pv, imp] = await Promise.all([
      prisma.cliente.findUniqueOrThrow({ where: { id: a.cliente } }),
      prisma.comprobante.findUniqueOrThrow({ where: { id: a.comprobante } }),
      prisma.itemFacturable.findUniqueOrThrow({ where: { id: a.item } }),
      prisma.tarifa.findUniqueOrThrow({ where: { id: a.tarifa } }),
      prisma.integracion.findUniqueOrThrow({ where: { id: a.integracion } }),
      prisma.webhookSuscripcion.findUniqueOrThrow({ where: { id: a.webhook } }),
      prisma.puntoVenta.findUniqueOrThrow({ where: { id: a.puntoVenta } }),
      prisma.importacion.findUniqueOrThrow({ where: { id: a.importacion } }),
    ]);
    expect(cliente.razonSocial).toBe('Cliente A');
    expect(comprobante).toMatchObject({ estado: 'BORRADOR', version: 0, observaciones: null });
    expect(item).toMatchObject({ descripcion: 'Item A', estado: 'VALIDO' });
    expect(tarifa.precioUnitario.toString()).toBe('10');
    expect(integracion.revocadaEn).toBeNull();
    expect(webhook).toMatchObject({ activa: true, secretoCifrado: 'v1:x:x:x' });
    expect(pv.activo).toBe(true);
    expect(imp.estado).toBe('EN_STAGING');
    expect(await prisma.comprobante.count({ where: { tenantId: { in: tenants.slice(1) } } })).toBe(0);
  });

  // Va último: cambiar la contraseña invalida tokenB.
  it('perfil y contraseña solo tocan al usuario de la sesión', async () => {
    const usuarioA = await prisma.usuario.findFirstOrThrow({ where: { tenantId: tenants[0] } });

    // La API key no sirve para estas rutas.
    expect((await http('PATCH', '/auth/me', { key: keyB, body: { nombre: 'X' } })).status).toBe(401);

    const perfil = await http('PATCH', '/auth/me', { token: tokenB, body: { nombre: 'Usuario B' } });
    expect(perfil.status).toBe(200);
    expect(JSON.parse(perfil.body)).toMatchObject({ usuario: { nombre: 'Usuario B', tienePassword: true } });

    const cambio = await http('POST', '/auth/password', { token: tokenB, body: { passwordActual: PASSWORD, passwordNueva: 'otra-clave-e2e-123' } });
    expect(cambio.status).toBe(200);
    // La sesión vieja quedó revocada; la nueva funciona.
    expect((await http('GET', '/auth/me', { token: tokenB })).status).toBe(401);
    const nuevo = (JSON.parse(cambio.body) as { accessToken: string }).accessToken;
    expect((await http('GET', '/auth/me', { token: nuevo })).status).toBe(200);

    const usuarioADespues = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioA.id } });
    expect(usuarioADespues).toMatchObject({ nombre: usuarioA.nombre, passwordHash: usuarioA.passwordHash, tokenVersion: usuarioA.tokenVersion });
  });
});
