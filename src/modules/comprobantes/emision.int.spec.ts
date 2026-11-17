/**
 * Test de integración de la emisión: corre contra una base real (DATABASE_URL, ya migrada).
 * Si no hay DATABASE_URL se saltea. Simula ARCA en memoria para provocar cortes de red
 * antes y después de que ARCA autorice, y verifica que nunca se dupliquen comprobantes.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { cuitDePrueba } from '../../shared/testing/datos';
import { ArcaError, type ArcaGateway, type CredencialesArca, type SolicitudCae } from '../arca';
import type { AuthContext } from '../auth';
import { ClientesService } from '../clientes';
import { ItemsFacturablesService } from '../importaciones';
import { TenantsService } from '../tenants';
import type { CredencialesArcaProvider } from '../tenants';
import { ComprobantesService } from './comprobantes.service';
import { EmisionService } from './emision.service';

type Modo = 'ok' | 'corte-despues' | 'corte-antes' | 'rechazo';

/** ARCA en memoria: numeración estricta por (pv, tipo), como WSFE. */
class ArcaFalso implements ArcaGateway {
  modo: Modo = 'ok';
  autorizaciones = 0;
  readonly emitidos = new Map<string, Array<{ nro: number; docNro: number; impTotal: number; cbteFch: string }>>();

  private lista(pv: number, tipo: number) {
    const k = `${pv}-${tipo}`;
    if (!this.emitidos.has(k)) this.emitidos.set(k, []);
    return this.emitidos.get(k)!;
  }
  async ultimoAutorizado(_c: CredencialesArca, pv: number, tipo: number) {
    return this.lista(pv, tipo).length;
  }
  async autorizar(_c: CredencialesArca, s: SolicitudCae) {
    const lista = this.lista(s.ptoVta, s.cbteTipo);
    if (this.modo === 'corte-antes') throw new ArcaError('INCIERTO', 'timeout of 30000ms exceeded');
    if (this.modo === 'rechazo') throw new ArcaError('RECHAZO', 'Rechazado por ARCA: (10015) datos inválidos', undefined, 10015);
    if (s.cbteNro !== lista.length + 1) throw new ArcaError('RECHAZO', '(10016) número no correlativo', undefined, 10016);
    lista.push({ nro: s.cbteNro, docNro: s.docNro, impTotal: Number(s.impTotal), cbteFch: s.cbteFch });
    this.autorizaciones++;
    if (this.modo === 'corte-despues') throw new ArcaError('INCIERTO', 'socket hang up');
    return { cae: `7${String(s.cbteNro).padStart(13, '0')}`, caeVto: '20261231', observaciones: [] };
  }
  async consultar(_c: CredencialesArca, pv: number, tipo: number, nro: number) {
    const e = this.lista(pv, tipo).find((x) => x.nro === nro);
    return e
      ? { cae: `7${String(nro).padStart(13, '0')}`, caeVto: '20261231', cbteFch: e.cbteFch, docTipo: 80, docNro: e.docNro, impTotal: e.impTotal, resultado: 'A' }
      : null;
  }
  async cotizacionDolar() {
    return '1000';
  }
  async consultarPadron() {
    return null;
  }
}

const hayBase = Boolean(process.env.DATABASE_URL);
(hayBase ? describe : describe.skip)('EmisionService (integración)', () => {
  jest.setTimeout(60_000);
  const prisma = new PrismaService();
  const arca = new ArcaFalso();
  let tenantId: string;
  let auth: AuthContext;
  let clienteId: string;
  let puntoVentaId: string;
  let comprobantes: ComprobantesService;
  let emision: EmisionService;

  beforeAll(async () => {
    const sufijo = randomUUID().slice(0, 8);
    const tenant = await prisma.tenant.create({
      data: {
        slug: `test-emision-${sufijo}`,
        nombreFantasia: 'Test emisión',
        razonSocial: 'Test Emisión SA',
        cuit: cuitDePrueba(),
        condicionIva: 'RESPONSABLE_INSCRIPTO',
        domicilioFiscal: 'Calle 1',
        inicioActividades: new Date('2020-01-01'),
      },
    });
    tenantId = tenant.id;
    auth = { tenantId, tipo: 'usuario', usuarioId: undefined, scopes: [] };
    clienteId = (
      await prisma.cliente.create({
        data: { tenantId, razonSocial: 'Cliente RI', tipoDocumento: 'CUIT', numeroDocumento: '30668346908', condicionIva: 'RESPONSABLE_INSCRIPTO' },
      })
    ).id;
    puntoVentaId = (await prisma.puntoVenta.create({ data: { tenantId, numero: 1, ambiente: 'HOMOLOGACION' } })).id;

    const tenants = new TenantsService(prisma);
    const cred = {
      obtener: async (): Promise<CredencialesArca> => ({
        tenantId,
        ambiente: 'HOMOLOGACION',
        cuit: '20409378472',
        certPem: null,
        keyPem: null,
        usaCuitPrueba: true,
      }),
    } as unknown as CredencialesArcaProvider;
    const clientes = new ClientesService(prisma, cred, arca, { configurado: () => false } as never); // sin padrón de plataforma
    const items = new ItemsFacturablesService(prisma);
    comprobantes = new ComprobantesService(prisma, clientes, tenants, items);
    emision = new EmisionService(prisma, comprobantes, tenants, cred, arca, items, new EventEmitter2());
  });

  afterAll(async () => {
    if (tenantId) {
      await prisma.arcaLog.deleteMany({ where: { tenantId } });
      await prisma.comprobante.deleteMany({ where: { tenantId, asociadoId: { not: null } } });
      await prisma.comprobante.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
  });

  beforeEach(() => {
    arca.modo = 'ok';
  });

  async function borrador() {
    return comprobantes.crearBorrador(auth, {
      clienteId,
      puntoVentaId,
      fechaEmision: '2026-09-25',
      concepto: 'SERVICIOS',
      fechaServicioDesde: '2026-09-01',
      fechaServicioHasta: '2026-09-30',
      fechaVtoPago: '2099-10-10',
      lineas: [{ descripcion: 'Desarrollo', cantidad: '10', unidad: 'HORA', precioUnitario: '1000', alicuotaIva: '21' }],
    });
  }

  function totalArca() {
    return [...arca.emitidos.values()].reduce((s, l) => s + l.length, 0);
  }

  it('emite una Factura A y guarda número y CAE', async () => {
    const b = await borrador();
    expect(b.tipo).toBe('FACTURA_A');
    const r = await emision.emitir(auth, b.id, b.version, `k-${randomUUID()}`);
    expect(r.estado).toBe('EMITIDO');
    expect(r.numero).toBe(1);
    expect(r.cae).toBeTruthy();
    expect(r.importeTotal.toString()).toBe('12100');
  });

  it('reintentar con la misma Idempotency-Key no vuelve a emitir', async () => {
    const b = await borrador();
    const clave = `k-${randomUUID()}`;
    const antes = arca.autorizaciones;
    const r1 = await emision.emitir(auth, b.id, b.version, clave);
    const r2 = await emision.emitir(auth, b.id, b.version, clave);
    expect(r2.numero).toBe(r1.numero);
    expect(arca.autorizaciones - antes).toBe(1);
  });

  it('corte DESPUÉS de autorizar: queda pendiente y la verificación recupera el CAE sin duplicar', async () => {
    const b = await borrador();
    const antes = totalArca();
    arca.modo = 'corte-despues';
    const r = await emision.emitir(auth, b.id, b.version, `k-${randomUUID()}`);
    expect(r.estado).toBe('PENDIENTE_VERIFICACION');
    expect(r.numeroReservado).not.toBeNull();

    arca.modo = 'ok';
    // Un segundo clic en "Emitir" no pide otro CAE: verifica.
    const v = await emision.emitir(auth, b.id, r.version, `k-${randomUUID()}`);
    expect(v.estado).toBe('EMITIDO');
    expect(v.numero).toBe(r.numeroReservado);
    expect(totalArca() - antes).toBe(1);
  });

  it('corte ANTES de llegar a ARCA: la verificación lo pasa a rechazado y se puede reemitir', async () => {
    const b = await borrador();
    const antes = totalArca();
    arca.modo = 'corte-antes';
    const r = await emision.emitir(auth, b.id, b.version, `k-${randomUUID()}`);
    expect(r.estado).toBe('PENDIENTE_VERIFICACION');

    arca.modo = 'ok';
    const v = await emision.verificar(tenantId, b.id);
    expect(v.estado).toBe('RECHAZADO');
    expect(v.numeroReservado).toBeNull();

    const e = await emision.emitir(auth, b.id, v.version, `k-${randomUUID()}`);
    expect(e.estado).toBe('EMITIDO');
    expect(totalArca() - antes).toBe(1);
  });

  it('rechazo de ARCA: queda RECHAZADO con el mensaje y sin número', async () => {
    const b = await borrador();
    arca.modo = 'rechazo';
    await expect(emision.emitir(auth, b.id, b.version, `k-${randomUUID()}`)).rejects.toMatchObject({ status: 422 });
    const c = await comprobantes.obtener(tenantId, b.id);
    expect(c.estado).toBe('RECHAZADO');
    expect(c.numero).toBeNull();
    expect(c.numeroReservado).toBeNull();
    expect(c.errorMensaje).toContain('10015');
  });

  it('dos emisiones en paralelo del mismo punto de venta obtienen números distintos y correlativos', async () => {
    const [a, b] = await Promise.all([borrador(), borrador()]);
    const [ra, rb] = await Promise.all([
      emision.emitir(auth, a.id, a.version, `k-${randomUUID()}`),
      emision.emitir(auth, b.id, b.version, `k-${randomUUID()}`),
    ]);
    expect(ra.estado).toBe('EMITIDO');
    expect(rb.estado).toBe('EMITIDO');
    expect(Math.abs((ra.numero ?? 0) - (rb.numero ?? 0))).toBe(1);
  });

  it('nota de crédito por el total anula la factura', async () => {
    const b = await borrador();
    const f = await emision.emitir(auth, b.id, b.version, `k-${randomUUID()}`);
    const nc = await comprobantes.crearNota(auth, f.id, { clase: 'NOTA_CREDITO', motivo: 'Error de facturación' });
    expect(nc.tipo).toBe('NOTA_CREDITO_A');
    const e = await emision.emitir(auth, nc.id, nc.version, `k-${randomUUID()}`);
    expect(e.estado).toBe('EMITIDO');
    expect((await comprobantes.obtener(tenantId, f.id)).estado).toBe('ANULADO');
  });

  it('al anular la factura sus ítems quedan libres para volver a facturarlos', async () => {
    const b = await borrador();
    const item = await prisma.itemFacturable.create({
      data: {
        tenantId,
        origen: 'TRACKER',
        referenciaExterna: `tracker:${randomUUID()}`,
        clienteId,
        descripcion: 'Desarrollo',
        cantidad: '10',
        unidad: 'HORA',
        precioUnitario: '1000',
        alicuotaIva: '21',
        hashContenido: 'x',
        estado: 'EN_BORRADOR',
        comprobanteId: b.id,
      },
    });
    const f = await emision.emitir(auth, b.id, b.version, `k-${randomUUID()}`);
    expect((await prisma.itemFacturable.findUniqueOrThrow({ where: { id: item.id } })).estado).toBe('FACTURADO');
    const nc = await comprobantes.crearNota(auth, f.id, { clase: 'NOTA_CREDITO', motivo: 'Error de facturación' });
    await emision.emitir(auth, nc.id, nc.version, `k-${randomUUID()}`);
    expect(await prisma.itemFacturable.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ estado: 'VALIDO', comprobanteId: null });
  });
});
