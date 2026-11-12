/**
 * Flujo completo de un sistema integrado por la API pública (sin tocar la UI de Faktia):
 * leer la configuración, dar de alta un cliente con el padrón, cargar ítems, armar y editar
 * borradores, emitir, hacer una nota de crédito y bajar el PDF. Con `X-Usuario-Email` queda
 * registrado quién hizo cada cosa. Levanta la app completa con ARCA falso; corre contra una base
 * real (DATABASE_URL ya migrada) y sin ella se saltea.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import type { AddressInfo } from 'net';
import { AppModule } from './app.module';
import {
  ARCA_GATEWAY,
  type ArcaGateway,
  type CredencialesArca,
  type SolicitudCae,
} from './modules/arca';
import { sha256Hex } from './modules/auth/claves';
import { PrismaService } from './shared/prisma/prisma.service';
import { cuitDePrueba } from './shared/testing/datos';

class ArcaFalso implements ArcaGateway {
  n = 0;
  async ultimoAutorizado() {
    return this.n;
  }
  async autorizar(_c: CredencialesArca, s: SolicitudCae) {
    this.n = s.cbteNro;
    return {
      cae: `7${String(s.cbteNro).padStart(13, '0')}`,
      caeVto: '20261231',
      observaciones: [],
    };
  }
  async consultar() {
    return null;
  }
  async cotizacionDolar() {
    return '1000';
  }
  async consultarPadron(_c: CredencialesArca, cuit: string) {
    return {
      cuit,
      razonSocial: 'Cliente Padrón SA',
      domicilio: 'Av. Siempre Viva 742',
      condicionIva: 'RESPONSABLE_INSCRIPTO' as const,
      crudo: {},
    };
  }
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const hayBase = Boolean(process.env.DATABASE_URL);
(hayBase ? describe : describe.skip)('API pública v1 (e2e)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let base: string;
  const prisma = new PrismaService();
  let tenantId: string;
  let key: string;
  const EMAIL = 'Contable@Sistema.test';

  async function api(
    metodo: string,
    ruta: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const res = await fetch(`${base}/v1${ruta}`, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': key,
        'X-Usuario-Email': EMAIL,
        ...(metodo === 'POST' ? { 'Idempotency-Key': `e2e-${randomUUID()}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const tipo = res.headers.get('content-type') ?? '';
    const cuerpo = tipo.includes('json')
      ? ((await res.json()) as Json)
      : { bytes: (await res.arrayBuffer()).byteLength, tipo };
    return { status: res.status, body: cuerpo };
  }

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ARCA_GATEWAY)
      .useValue(new ArcaFalso())
      .compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`;

    const t = await prisma.tenant.create({
      data: {
        slug: `e2e-v1-${randomUUID().slice(0, 8)}`,
        nombreFantasia: 'E2E V1',
        razonSocial: 'E2E V1 SA',
        cuit: cuitDePrueba(),
        condicionIva: 'RESPONSABLE_INSCRIPTO',
        domicilioFiscal: 'Calle 1',
        inicioActividades: new Date('2020-01-01'),
      },
    });
    tenantId = t.id;
    await prisma.puntoVenta.createMany({
      data: [
        { tenantId, numero: 3, ambiente: 'HOMOLOGACION' },
        { tenantId, numero: 9, ambiente: 'PRODUCCION' },
      ],
    });
    key = `fct_${randomUUID().replace(/-/g, '').slice(0, 8)}_${randomUUID().replace(/-/g, '')}`;
    await prisma.integracion.create({
      data: {
        tenantId,
        nombre: 'Sistema',
        origen: 'TRACKER',
        keyPrefijo: key.slice(0, 12),
        keyHash: sha256Hex(key),
        scopes: ['items:write', 'comprobantes:write', 'comprobantes:read'],
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    if (tenantId) {
      await prisma.arcaLog.deleteMany({ where: { tenantId } });
      await prisma.comprobanteLinea.deleteMany({ where: { tenantId } });
      await prisma.itemFacturable.deleteMany({ where: { tenantId } });
      await prisma.comprobante.updateMany({ where: { tenantId }, data: { asociadoId: null } });
      await prisma.comprobante.deleteMany({ where: { tenantId } });
      await prisma.importacion.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
  });

  let puntoVentaId: string;
  let clienteId: string;

  it('configuración: emisor y solo los puntos de venta del ambiente actual', async () => {
    const r = await api('GET', '/configuracion');
    expect(r.status).toBe(200);
    expect(r.body.emisor).toMatchObject({
      razonSocial: 'E2E V1 SA',
      condicionIva: 'RESPONSABLE_INSCRIPTO',
      ambiente: 'HOMOLOGACION',
    });
    expect(r.body.puntosVenta).toHaveLength(1);
    expect(r.body.puntosVenta[0]).toMatchObject({ numero: 3 });
    puntoVentaId = r.body.puntosVenta[0].id;
  });

  it('cliente: padrón, alta, lectura y modificación', async () => {
    const padron = await api('GET', '/clientes/padron/30-66834690-8');
    expect(padron).toMatchObject({
      status: 200,
      body: {
        cuit: '30668346908',
        razonSocial: 'Cliente Padrón SA',
        condicionIva: 'RESPONSABLE_INSCRIPTO',
      },
    });
    expect((await api('GET', '/clientes/padron/123')).status).toBe(400);

    const alta = await api('POST', '/clientes', {
      razonSocial: padron.body.razonSocial,
      tipoDocumento: 'CUIT',
      numeroDocumento: padron.body.cuit,
      condicionIva: padron.body.condicionIva,
      domicilio: padron.body.domicilio,
      referenciaExterna: 'cli-42',
    });
    expect(alta.status).toBe(201);
    clienteId = alta.body.id;
    const vinculados = await api('GET', '/clientes/referencias?referencia=cli-42&referencia=cli-sin-alta');
    expect(vinculados.body).toEqual([{ referenciaExterna: 'cli-42', cliente: expect.objectContaining({ id: clienteId }) }]);
    const revinculado = await api('POST', `/clientes/${clienteId}/referencias`, { referenciaExterna: 'cli-43' });
    expect(revinculado).toMatchObject({ status: 200, body: { referenciaExterna: 'cli-43', cliente: { id: clienteId } } });
    expect((await api('POST', '/clientes/no-existe/referencias', { referenciaExterna: 'x' })).status).toBe(404);
    expect(
      (
        await api('POST', '/clientes', {
          razonSocial: 'X',
          tipoDocumento: 'CUIT',
          numeroDocumento: '30668346908',
          condicionIva: 'RESPONSABLE_INSCRIPTO',
        })
      ).status,
    ).toBe(409);

    const editado = await api('PATCH', `/clientes/${clienteId}`, { email: 'pagos@cliente.test' });
    expect(editado).toMatchObject({
      status: 200,
      body: { email: 'pagos@cliente.test', domicilio: 'Av. Siempre Viva 742' },
    });
    expect((await api('GET', `/clientes/${clienteId}`)).body.razonSocial).toBe('Cliente Padrón SA');
    expect((await api('GET', '/clientes')).body.map((c: Json) => c.id)).toEqual([clienteId]);
  });

  it('borrador a mano: se crea con la letra correcta, se edita con lock optimista y se elimina', async () => {
    const creado = await api('POST', '/comprobantes', {
      clienteId,
      puntoVentaId,
      fechaEmision: '2026-09-30',
      concepto: 'SERVICIOS',
      fechaServicioDesde: '2026-09-01',
      fechaServicioHasta: '2026-09-30',
      fechaVtoPago: '2026-10-15',
      lineas: [
        {
          descripcion: 'Consultoría',
          cantidad: '10',
          unidad: 'HORA',
          precioUnitario: '100',
          alicuotaIva: '21',
        },
      ],
    });
    expect(creado.status).toBe(201);
    expect(creado.body).toMatchObject({
      tipo: 'FACTURA_A',
      estado: 'BORRADOR',
      puntoVentaId,
      importes: { total: '1210' },
      advertenciaLetra: null,
      notas: [],
    });

    const editado = await api('PATCH', `/comprobantes/${creado.body.id}`, {
      version: creado.body.version,
      observaciones: 'Orden de compra 55',
      lineas: [
        {
          descripcion: 'Consultoría',
          cantidad: '12',
          unidad: 'HORA',
          precioUnitario: '100',
          bonificacionPct: '10',
          alicuotaIva: '21',
        },
      ],
    });
    expect(editado.status).toBe(200);
    expect(editado.body).toMatchObject({
      observaciones: 'Orden de compra 55',
      importes: { netoGravado: '1080' },
      lineas: [{ bonificacionPct: '10' }],
    });
    expect(
      (
        await api('PATCH', `/comprobantes/${creado.body.id}`, {
          version: creado.body.version,
          observaciones: 'viejo',
        })
      ).status,
    ).toBe(409);

    // Quién lo creó queda registrado (usuario sin contraseña, creado por la integración).
    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { tenantId_email: { tenantId, email: 'contable@sistema.test' } },
    });
    expect(usuario.passwordHash).toBeNull();
    expect(
      (await prisma.comprobante.findUniqueOrThrow({ where: { id: creado.body.id } })).creadoPorId,
    ).toBe(usuario.id);

    expect((await api('DELETE', `/comprobantes/${creado.body.id}`)).status).toBe(204);
    expect((await api('GET', `/comprobantes/${creado.body.id}`)).status).toBe(404);
  });

  it('ítems → borrador → emitir → nota de crédito → PDF', async () => {
    const carga = await api('POST', '/items', {
      confirmar: true,
      items: [
        {
          referenciaExterna: `sistema:cli:web:2026-09`,
          cliente: { clienteId },
          descripcion: 'Desarrollo Web - Septiembre 2026',
          cantidad: '7.5',
          unidad: 'HORA',
          precioUnitario: '40',
          moneda: 'USD',
          alicuotaIva: '21',
          periodo: { desde: '2026-09-01', hasta: '2026-09-30' },
          metadatos: { proyectoId: 'web', tipoCambio: 1540 },
        },
      ],
    });
    expect(carga.status).toBe(200);
    expect(carga.body.items[0]).toMatchObject({ estado: 'VALIDO' });

    const borradores = await api('POST', '/comprobantes/borradores', {
      referencias: ['sistema:cli:web:2026-09'],
    });
    expect(borradores.status).toBe(201);
    const factura = borradores.body.comprobantes[0];
    expect(factura).toMatchObject({ moneda: 'USD', importes: { total: '363' } });
    // El comprobante devuelve los metadatos del integrador, sin las claves internas del staging.
    const detalle = (await api('GET', `/comprobantes/${factura.id}`)).body;
    expect(detalle.items).toEqual([
      { referenciaExterna: 'sistema:cli:web:2026-09', metadatos: { proyectoId: 'web', tipoCambio: 1540 } },
    ]);

    const emitida = await api('POST', `/comprobantes/${factura.id}/emitir`, {
      version: factura.version,
    });
    expect(emitida.body).toMatchObject({ estado: 'EMITIDO', numero: 1 });
    expect(
      (await prisma.comprobante.findUniqueOrThrow({ where: { id: factura.id } })).emitidoPorId,
    ).toBeTruthy();
    expect((await api('GET', '/items?referencia=sistema:cli:web:2026-09')).body[0].estado).toBe(
      'FACTURADO',
    );
    expect((await api('DELETE', `/comprobantes/${factura.id}`)).status).toBe(409);

    const nota = await api('POST', `/comprobantes/${factura.id}/notas`, {
      clase: 'NOTA_CREDITO',
      motivo: 'Error en horas',
    });
    expect(nota.status).toBe(201);
    expect(nota.body).toMatchObject({
      tipo: 'NOTA_CREDITO_A',
      estado: 'BORRADOR',
      asociado: { id: factura.id },
    });
    const notaEmitida = await api('POST', `/comprobantes/${nota.body.id}/emitir`, {});
    expect(notaEmitida.body).toMatchObject({ estado: 'EMITIDO' });

    const conNotas = await api('GET', `/comprobantes/${factura.id}`);
    expect(conNotas.body.notas).toEqual([
      {
        id: nota.body.id,
        tipo: 'NOTA_CREDITO_A',
        numero: notaEmitida.body.numero,
        estado: 'EMITIDO',
      },
    ]);
    // La nota por el total anula la factura; verificar la devuelve sin consultar a ARCA.
    expect(conNotas.body.estado).toBe('ANULADO');
    expect((await api('POST', `/comprobantes/${factura.id}/verificar`)).body.estado).toBe(
      'ANULADO',
    );

    const pdf = await api('GET', `/comprobantes/${factura.id}/pdf`);
    expect(pdf).toMatchObject({ status: 200, body: { tipo: 'application/pdf' } });
    expect(pdf.body.bytes).toBeGreaterThan(1000);

    const listado = await api('GET', `/comprobantes?clienteId=${clienteId}`);
    expect(listado.body.total).toBe(2);

    // Filtro por período de servicio (factura y nota son de septiembre 2026).
    expect((await api('GET', `/comprobantes?clienteId=${clienteId}&periodo=2026-09`)).body.total).toBe(2);
    expect((await api('GET', `/comprobantes?clienteId=${clienteId}&periodo=2026-10`)).body.total).toBe(0);
    expect((await api('GET', '/comprobantes?periodo=2026-13')).status).toBe(400);
  });

  it('recibo sin validez fiscal: devuelve el PDF y no guarda nada', async () => {
    const antes = await prisma.comprobante.count({ where: { tenantId } });
    const recibo = await api('POST', '/recibos/pdf', {
      tipo: 'COBRO',
      fecha: '2026-10-26',
      moneda: 'ARS',
      contraparte: { nombre: 'Cliente del Exterior LLC' },
      items: [{ descripcion: 'Horas de septiembre 2026', cantidad: '10 h', importe: '308000.00' }],
      total: '308000.00',
    });
    expect(recibo).toMatchObject({ status: 200, body: { tipo: 'application/pdf' } });
    expect(recibo.body.bytes).toBeGreaterThan(1000);
    expect(await prisma.comprobante.count({ where: { tenantId } })).toBe(antes);

    // Total que no coincide con los conceptos → 400.
    const mal = await api('POST', '/recibos/pdf', {
      tipo: 'COBRO',
      fecha: '2026-10-26',
      moneda: 'ARS',
      contraparte: { nombre: 'X' },
      items: [{ descripcion: 'x', importe: '10.00' }],
      total: '11.00',
    });
    expect(mal.status).toBe(400);
  });

  it('X-Usuario-Email inválido se rechaza', async () => {
    expect(
      (await api('GET', '/configuracion', undefined, { 'X-Usuario-Email': 'no-es-email' })).status,
    ).toBe(400);
  });
});
