/**
 * Integración de la API pública contra una base real (DATABASE_URL ya migrada): idempotencia
 * y webhooks con un receptor HTTP local. Sin DATABASE_URL se saltea. ARCA es falso.
 */
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { createServer, type IncomingMessage, type Server } from 'http';
import type { AddressInfo } from 'net';
import { EVENTOS } from '../../shared/eventos/eventos';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { cuitDePrueba } from '../../shared/testing/datos';
import type { ArcaGateway, CredencialesArca, SolicitudCae } from '../arca';
import type { AuthContext } from '../auth';
import { ClientesService } from '../clientes';
import { ComprobantesService, EmisionService } from '../comprobantes';
import { ImportacionesService, ItemsFacturablesService } from '../importaciones';
import { TenantsService, type CredencialesArcaProvider } from '../tenants';
import { hashSolicitud, IdempotenciaService } from './idempotencia/idempotencia.service';
import { verificarFirma } from './webhooks/firma';
import { WebhooksService } from './webhooks/webhooks.service';

class ArcaOk implements ArcaGateway {
  n = 0;
  async ultimoAutorizado() {
    return this.n;
  }
  async autorizar(_c: CredencialesArca, s: SolicitudCae) {
    this.n = s.cbteNro;
    return { cae: `7${String(s.cbteNro).padStart(13, '0')}`, caeVto: '20261231', observaciones: [] };
  }
  async consultar() {
    return null;
  }
  async cotizacionDolar() {
    return '1000';
  }
  async consultarPadron() {
    return null;
  }
}

interface Recibido {
  headers: IncomingMessage['headers'];
  cuerpo: string;
}

const hayBase = Boolean(process.env.DATABASE_URL);
(hayBase ? describe : describe.skip)('API pública (integración)', () => {
  jest.setTimeout(90_000);
  const prisma = new PrismaService();
  const eventos = new EventEmitter2();
  let tenantId: string;
  let integracionId: string;
  let auth: AuthContext;
  let servidor: Server;
  let url: string;
  let respuestas: number[] = [];
  const recibidos: Recibido[] = [];
  let idem: IdempotenciaService;
  let webhooks: WebhooksService;
  let comprobantes: ComprobantesService;
  let emision: EmisionService;
  let clienteId: string;
  let puntoVentaId: string;

  beforeAll(async () => {
    servidor = createServer((req, res) => {
      let cuerpo = '';
      req.on('data', (c) => (cuerpo += c));
      req.on('end', () => {
        recibidos.push({ headers: req.headers, cuerpo });
        res.writeHead(respuestas.shift() ?? 200).end('ok');
      });
    });
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/hook`;

    const t = await prisma.tenant.create({
      data: {
        slug: `test-api-${randomUUID().slice(0, 8)}`,
        nombreFantasia: 'Test API',
        razonSocial: 'Test API SA',
        cuit: cuitDePrueba(),
        condicionIva: 'RESPONSABLE_INSCRIPTO',
        domicilioFiscal: 'Calle 1',
        inicioActividades: new Date('2020-01-01'),
      },
    });
    tenantId = t.id;
    integracionId = (
      await prisma.integracion.create({
        data: { tenantId, nombre: 'ERP', keyPrefijo: `fct_${randomUUID().slice(0, 8)}`, keyHash: 'x', scopes: ['items:write', 'comprobantes:write'] },
      })
    ).id;
    auth = { tenantId, tipo: 'integracion', integracionId, origenIntegracion: 'API', scopes: ['items:write', 'comprobantes:write'] };
    clienteId = (
      await prisma.cliente.create({
        data: { tenantId, razonSocial: 'Cliente RI', tipoDocumento: 'CUIT', numeroDocumento: '30668346908', condicionIva: 'RESPONSABLE_INSCRIPTO' },
      })
    ).id;
    puntoVentaId = (await prisma.puntoVenta.create({ data: { tenantId, numero: 1, ambiente: 'HOMOLOGACION' } })).id;

    const cred = {
      obtener: async (): Promise<CredencialesArca> => ({ tenantId, ambiente: 'HOMOLOGACION', cuit: '20409378472', certPem: null, keyPem: null, usaCuitPrueba: true }),
    } as unknown as CredencialesArcaProvider;
    const arca = new ArcaOk();
    const tenants = new TenantsService(prisma);
    const clientes = new ClientesService(prisma, cred, arca, { configurado: () => false } as never); // sin padrón de plataforma
    const items = new ItemsFacturablesService(prisma);
    comprobantes = new ComprobantesService(prisma, clientes, tenants, items);
    emision = new EmisionService(prisma, comprobantes, tenants, cred, arca, items, eventos);
    const importaciones = { obtener: async () => null } as unknown as ImportacionesService;
    idem = new IdempotenciaService(prisma);
    webhooks = new WebhooksService(prisma, comprobantes, importaciones, items, { get: () => 'test' } as unknown as ConfigService);
    // En la app esto lo hace @OnEvent; acá se conecta a mano.
    eventos.on(EVENTOS.COMPROBANTE_EMITIDO, (e) => webhooks.alEmitir(e));
  });

  afterAll(async () => {
    servidor?.close();
    if (tenantId) {
      await prisma.arcaLog.deleteMany({ where: { tenantId } });
      await prisma.comprobante.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
  });

  describe('idempotencia', () => {
    const hash = hashSolicitud('POST', '/api/v1/items', { a: 1 });

    it('la misma clave con el mismo request repite la respuesta guardada', async () => {
      const inicio = await idem.iniciar(tenantId, integracionId, 'clave-0001', hash);
      expect(inicio.tipo).toBe('nueva');
      await expect(idem.iniciar(tenantId, integracionId, 'clave-0001', hash)).rejects.toThrow(ConflictException); // en curso
      await idem.completar((inicio as { id: string }).id, 201, { ok: true });
      await expect(idem.iniciar(tenantId, integracionId, 'clave-0001', hash)).resolves.toEqual({ tipo: 'repetida', estadoHttp: 201, respuesta: { ok: true } });
    });

    it('la misma clave con otro request da 422', async () => {
      await expect(idem.iniciar(tenantId, integracionId, 'clave-0001', hashSolicitud('POST', '/api/v1/items', { a: 2 }))).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('un error del servidor no se guarda: se puede reintentar con la misma clave', async () => {
      const inicio = await idem.iniciar(tenantId, integracionId, 'clave-0002', hash);
      await idem.descartar((inicio as { id: string }).id);
      expect((await idem.iniciar(tenantId, integracionId, 'clave-0002', hash)).tipo).toBe('nueva');
    });

    it('las claves son por integración', async () => {
      const otra = (await prisma.integracion.create({ data: { tenantId, nombre: 'Otra', keyPrefijo: `fct_${randomUUID().slice(0, 8)}`, keyHash: 'y', scopes: [] } })).id;
      expect((await idem.iniciar(tenantId, otra, 'clave-0001', hashSolicitud('GET', '/x', null))).tipo).toBe('nueva');
    });
  });

  describe('webhooks', () => {
    let secreto: string;
    let suscripcionId: string;

    beforeAll(async () => {
      const r = await webhooks.crear(tenantId, { url, eventos: [EVENTOS.COMPROBANTE_EMITIDO, EVENTOS.IMPORTACION_CONFIRMADA] });
      secreto = r.secreto;
      suscripcionId = r.suscripcion.id;
      const guardado = await prisma.webhookSuscripcion.findUniqueOrThrow({ where: { id: suscripcionId } });
      expect(guardado.secretoCifrado).not.toContain(secreto);
    });

    it('rechaza eventos inexistentes', async () => {
      await expect(webhooks.crear(tenantId, { url, eventos: ['comprobante.borrado'] })).rejects.toThrow(/Eventos válidos/);
    });

    it('entrega firmado; si el receptor falla, reintenta con backoff', async () => {
      await webhooks.encolar(tenantId, EVENTOS.IMPORTACION_CONFIRMADA, 'evt_prueba_1', { importacion: { id: 'x' } });
      expect(await webhooks.encolar(tenantId, EVENTOS.IMPORTACION_CONFIRMADA, 'evt_prueba_1', { importacion: { id: 'x' } })).toBe(0); // sin duplicar
      const entrega = await prisma.webhookEntrega.findFirstOrThrow({ where: { tenantId, eventoId: 'evt_prueba_1' } });

      respuestas = [500];
      const antes = Date.now();
      expect(await webhooks.entregarUna(entrega.id)).toMatchObject({ ok: false, status: 500 });
      const fallida = await prisma.webhookEntrega.findUniqueOrThrow({ where: { id: entrega.id } });
      expect(fallida).toMatchObject({ estado: 'PENDIENTE', intentos: 1, ultimoStatus: 500 });
      expect(fallida.proximoIntento.getTime() - antes).toBeGreaterThanOrEqual(59_000);

      await prisma.webhookEntrega.update({ where: { id: entrega.id }, data: { proximoIntento: new Date() } });
      respuestas = [200];
      expect(await webhooks.entregarUna(entrega.id)).toMatchObject({ ok: true, status: 200 });
      expect(await prisma.webhookEntrega.findUniqueOrThrow({ where: { id: entrega.id } })).toMatchObject({ estado: 'ENTREGADA', intentos: 2 });

      const ultimo = recibidos[recibidos.length - 1];
      expect(ultimo.headers['x-faktia-evento']).toBe(EVENTOS.IMPORTACION_CONFIRMADA);
      expect(ultimo.headers['x-facturador-evento']).toBe(EVENTOS.IMPORTACION_CONFIRMADA); // nombre viejo, por compatibilidad
      expect(ultimo.headers['x-faktia-evento-id']).toBe('evt_prueba_1');
      expect(verificarFirma(secreto, ultimo.cuerpo, String(ultimo.headers['x-faktia-firma']))).toBe(true);
      expect(JSON.parse(ultimo.cuerpo)).toMatchObject({ id: 'evt_prueba_1', evento: EVENTOS.IMPORTACION_CONFIRMADA, datos: { importacion: { id: 'x' } } });
    });

    it('después de 6 intentos queda FALLIDA', async () => {
      await webhooks.encolar(tenantId, EVENTOS.IMPORTACION_CONFIRMADA, 'evt_prueba_2', {});
      const entrega = await prisma.webhookEntrega.findFirstOrThrow({ where: { tenantId, eventoId: 'evt_prueba_2' } });
      await prisma.webhookEntrega.update({ where: { id: entrega.id }, data: { intentos: 5 } });
      respuestas = [503];
      await webhooks.entregarUna(entrega.id);
      expect(await prisma.webhookEntrega.findUniqueOrThrow({ where: { id: entrega.id } })).toMatchObject({ estado: 'FALLIDA', intentos: 6, ultimoStatus: 503 });
      // Reenviar manualmente vuelve a intentar.
      respuestas = [200];
      expect(await webhooks.reenviar(tenantId, entrega.id)).toMatchObject({ ok: true });
    });

    it('emitir un comprobante encola comprobante.emitido con los datos públicos', async () => {
      const b = await comprobantes.crearBorrador(auth, {
        clienteId,
        puntoVentaId,
        fechaEmision: '2026-09-29',
        concepto: 'PRODUCTOS',
        lineas: [{ descripcion: 'Licencia', cantidad: '1', unidad: 'UNIDAD', precioUnitario: '1000', alicuotaIva: '21' }],
      });
      await emision.emitir(auth, b.id, b.version, randomUUID());
      await new Promise((r) => setTimeout(r, 1500)); // el listener es asíncrono
      const entrega = await prisma.webhookEntrega.findFirstOrThrow({ where: { tenantId, suscripcionId, evento: EVENTOS.COMPROBANTE_EMITIDO } });
      const datos = entrega.payload as { comprobante: Record<string, unknown> };
      expect(datos.comprobante).toMatchObject({ id: b.id, estado: 'EMITIDO', tipo: 'FACTURA_A', importes: { total: '1210' } });
      expect(datos.comprobante).not.toHaveProperty('emisorSnapshot');
      expect(entrega.eventoId).toMatch(/^evt_[0-9a-f]{24}$/);
    });

    it('un webhook de otro tenant no se puede tocar', async () => {
      await expect(webhooks.rotarSecreto('otro-tenant', suscripcionId)).rejects.toThrow(/no encontrado/);
      await expect(webhooks.entregas('otro-tenant', suscripcionId)).resolves.toEqual([]);
    });
  });
});
