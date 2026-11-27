/**
 * Fase Ale Herrería 2 (e2e): proyectos (obras) con hitos, certificaciones, IVA de facturas, tipo de
 * cambio, entregas con recibo y sin recibo, snapshot del recibo y anulación. Casos reales del doc:
 * La Agrícola Regional (Costa Doll), Wilson Carrillo y la Municipalidad.
 * Corre contra una base real (DATABASE_URL ya migrada); sin DATABASE_URL se saltea.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import type { AddressInfo } from 'net';
import { AppModule } from './app.module';
import { hashPassword } from './modules/auth/password';
import { PROVEEDOR_COTIZACION } from './modules/cuenta-corriente';
import { PrismaService } from './shared/prisma/prisma.service';
import { cuitDePrueba } from './shared/testing/datos';

const PASSWORD = 'clave-de-prueba-e2e-1';
const hayBase = Boolean(process.env.DATABASE_URL);
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

(hayBase ? describe : describe.skip)('Ale Herrería: proyectos y cuenta corriente (e2e)', () => {
  jest.setTimeout(90_000);
  let app: INestApplication;
  let base: string;
  let token: string;
  let tenantId: string;
  let puntoVentaId: string;
  const prisma = new PrismaService();
  const cotizacion = { cotizacionDolar: jest.fn(async () => '1450') };
  const ids: Record<string, string> = {};

  async function http(metodo: string, ruta: string, body?: unknown): Promise<{ status: number; body: Json }> {
    const res = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const texto = await res.text();
    let datos: Json = {};
    try {
      datos = texto ? (JSON.parse(texto) as Json) : {};
    } catch {
      datos = { texto };
    }
    return { status: res.status, body: datos };
  }

  async function ok(metodo: string, ruta: string, body?: unknown): Promise<Json> {
    const r = await http(metodo, ruta, body);
    if (r.status >= 400) throw new Error(`${metodo} ${ruta} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }

  /** Factura emitida (sin pasar por ARCA): lo que la cuenta corriente lee de un comprobante con CAE. */
  async function facturaEmitida(clienteId: string, proyectoId: string | null, neto: string, iva: string, extra: Json = {}) {
    const numero = Math.floor(Math.random() * 1_000_000);
    const total = (Number(neto) + Number(iva)).toFixed(2);
    return prisma.comprobante.create({
      data: {
        tenantId,
        tipo: 'FACTURA_A',
        estado: 'EMITIDO',
        ambiente: 'HOMOLOGACION',
        clienteId,
        puntoVentaId,
        proyectoId,
        numero,
        fechaEmision: new Date('2026-11-20'),
        concepto: 'SERVICIOS',
        importeNetoGravado: neto,
        importeIva: iva,
        importeTotal: total,
        cae: '86400000000000',
        ...extra,
      },
    });
  }

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PROVEEDOR_COTIZACION).useValue(cotizacion).compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`;

    const t = await prisma.tenant.create({
      data: {
        slug: `e2e-obras-${randomUUID().slice(0, 8)}`,
        nombreFantasia: 'E2E Ale Herrería',
        razonSocial: 'E2E HERMAN ALEXIS NAHUEL',
        cuit: cuitDePrueba(),
        condicionIva: 'RESPONSABLE_INSCRIPTO',
        domicilioFiscal: 'General Ramírez, Entre Ríos',
        etiquetaProyecto: 'Obra',
        etiquetaProyectoPlural: 'Obras',
      },
    });
    tenantId = t.id;
    puntoVentaId = (await prisma.puntoVenta.create({ data: { tenantId, numero: 3, ambiente: 'HOMOLOGACION' } })).id;
    await prisma.usuario.create({ data: { tenantId, email: `rocio@${t.slug}.test`, passwordHash: await hashPassword(PASSWORD) } });
    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `rocio@${t.slug}.test`, password: PASSWORD }),
    });
    token = ((await login.json()) as { accessToken: string }).accessToken;

    ids.lar = (await ok('POST', '/clientes', { razonSocial: 'La Agrícola Regional Coop. Ltda.', tipoDocumento: 'CUIT', numeroDocumento: '30668346908', condicionIva: 'RESPONSABLE_INSCRIPTO' })).id;
    ids.wilson = (await ok('POST', '/clientes', { razonSocial: 'Wilson Carrillo', tipoDocumento: 'CONSUMIDOR_FINAL', numeroDocumento: '', condicionIva: 'CONSUMIDOR_FINAL' })).id;
    ids.muni = (await ok('POST', '/clientes', { razonSocial: 'Municipalidad de General Ramírez', tipoDocumento: 'CUIT', numeroDocumento: '30999999995', condicionIva: 'EXENTO' }).catch(() => ok('POST', '/clientes', { razonSocial: 'Municipalidad de General Ramírez', tipoDocumento: 'CONSUMIDOR_FINAL', numeroDocumento: '', condicionIva: 'EXENTO' }))).id;
  });

  afterAll(async () => {
    await app?.close();
    await prisma.movimientoCuentaCorriente.deleteMany({ where: { tenantId } });
    await prisma.comprobante.deleteMany({ where: { tenantId } });
    await prisma.recibo.deleteMany({ where: { tenantId } });
    await prisma.proyecto.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('LAR Costa Doll: plan con hito por certificación; con el anticipo cobrado el saldo es $14.705.000', async () => {
    const obra = await ok('POST', '/proyectos', {
      clienteId: ids.lar,
      nombre: 'Galpón sucursal Costa Doll',
      ubicacion: 'Costa Doll, Entre Ríos',
      moneda: 'ARS',
      modoIva: 'MAS_IVA',
      montoAcordado: '17300000',
      hitos: [
        { descripcion: 'Anticipo', importe: '2595000', fechaVencimiento: '2026-10-15' },
        { descripcion: 'Según avance de obra', importe: '13385000', porCertificacion: true },
        { descripcion: 'Al terminar (llenado de 4 columnas)', importe: '1320000' },
      ],
    });
    ids.costaDoll = obra.id;
    expect(obra.saldos).toMatchObject({ montoAcordado: '17300000.00', saldo: '17300000.00', aCertificar: '13385000.00', saldoExigible: '3915000.00' });

    const entrega = await ok('POST', `/proyectos/${obra.id}/entregas`, { fecha: '2026-10-14', moneda: 'ARS', importe: '2595000', medioPago: 'Transferencia' });
    ids.reciboAnticipo = entrega.reciboId;
    const despues = await ok('GET', `/proyectos/${obra.id}`);
    expect(despues.saldos.saldo).toBe('14705000.00');
    expect(despues.hitos[0]).toMatchObject({ descripcion: 'Anticipo', pendiente: '0.00' });

    // El recibo guardó el estado de esa fecha.
    const recibo = await prisma.recibo.findUniqueOrThrow({ where: { id: entrega.reciboId } });
    expect(recibo.numero).toBe('0001-00000001');
    expect(recibo.estadoProyecto).toMatchObject({ etiqueta: 'Obra', saldo: '14705000.00', totalEntregado: '2595000.00' });
  });

  it('certificar $5.000.000 lo hace exigible; quedan $8.385.000 a certificar y no se puede pasar del hito', async () => {
    const obra = await ok('GET', `/proyectos/${ids.costaDoll}`);
    const avance = obra.hitos.find((h: Json) => h.porCertificacion);
    const r = await ok('POST', `/proyectos/${ids.costaDoll}/hitos/${avance.id}/certificaciones`, {
      fecha: '2026-11-10',
      descripcion: 'Estructura y columnas',
      importe: '5000000',
      fechaVencimiento: '2026-11-20',
    });
    expect(r.saldos).toMatchObject({ aCertificar: '8385000.00', saldoExigible: '6320000.00', saldo: '14705000.00' });
    const demas = await http('POST', `/proyectos/${ids.costaDoll}/hitos/${avance.id}/certificaciones`, { fecha: '2026-11-11', descripcion: 'x', importe: '8385000.01' });
    expect(demas.status).toBe(400);

    // Vencida y exigible: aparece en el resumen; lo no certificado, no.
    const resumen = await ok('GET', '/cuenta-corriente/resumen');
    const vencidos = resumen.vencidos.filter((v: Json) => v.proyectoId === ids.costaDoll);
    expect(vencidos.map((v: Json) => [v.concepto, v.pendiente])).toEqual([['Según avance de obra: Estructura y columnas', '5000000.00']]);
    expect(resumen.aCertificar).toEqual([{ moneda: 'ARS', total: '8385000.00' }]);
  });

  it('una factura A por $5.000.000 + IVA suma solo el IVA ($1.050.000); cambiar a "acordado final" la saca', async () => {
    await facturaEmitida(ids.lar, ids.costaDoll, '5000000', '1050000');
    let obra = await ok('GET', `/proyectos/${ids.costaDoll}`);
    expect(obra.cargos.map((c: Json) => c.importe)).toEqual(['1050000.00']);
    expect(obra.saldos.saldo).toBe('15755000.00');

    obra = await ok('PATCH', `/proyectos/${ids.costaDoll}`, { modoIva: 'ACORDADO_FINAL' });
    expect(obra.cargos.map((c: Json) => c.importe)).toEqual(['0.00']);
    expect(obra.saldos.saldo).toBe('14705000.00');
    obra = await ok('PATCH', `/proyectos/${ids.costaDoll}`, { modoIva: 'MAS_IVA' });
    expect(obra.saldos.saldo).toBe('15755000.00');
  });

  it('un pago de la obra se imputa en orden: primero lo certificado, después el hito final y el IVA', async () => {
    await ok('POST', `/proyectos/${ids.costaDoll}/entregas`, { fecha: '2026-11-21', moneda: 'ARS', importe: '6000000', medioPago: 'Cheque' });
    const obra = await ok('GET', `/proyectos/${ids.costaDoll}`);
    const [anticipo, avance, final] = obra.hitos;
    expect(anticipo.pendiente).toBe('0.00');
    expect(avance).toMatchObject({ cobrado: '5000000.00', exigible: '0.00', aCertificar: '8385000.00' });
    expect(final).toMatchObject({ cobrado: '1000000.00', pendiente: '320000.00' });
    expect(obra.cargos[0].pendiente).toBe('1050000.00');
    expect(obra.saldos.saldo).toBe('9755000.00');
  });

  it('los hitos con cobros no cambian de importe; un adicional se carga aparte', async () => {
    const obra = await ok('GET', `/proyectos/${ids.costaDoll}`);
    const plan = obra.hitos.map((h: Json) => ({ id: h.id, descripcion: h.descripcion, importe: h.importe, porCertificacion: h.porCertificacion }));
    plan[2].importe = '1000000';
    plan[1].importe = '13705000';
    expect((await http('PUT', `/proyectos/${ids.costaDoll}/plan`, { montoAcordado: '17300000', hitos: plan })).status).toBe(400);
    const conAdicional = await ok('POST', `/proyectos/${ids.costaDoll}/adicionales`, { fecha: '2026-11-22', concepto: 'Canaleta adicional', importe: '450000' });
    expect(conAdicional.saldos.saldo).toBe('10205000.00');
  });

  it('anular un recibo revierte el cobro con un movimiento trazable', async () => {
    const antes = await ok('GET', `/proyectos/${ids.costaDoll}`);
    await ok('POST', `/recibos/${ids.reciboAnticipo}/anular`, { motivo: 'Cheque rechazado' });
    const obra = await ok('GET', `/proyectos/${ids.costaDoll}`);
    expect(Number(obra.saldos.saldo)).toBeCloseTo(Number(antes.saldos.saldo) + 2595000, 2);
    expect(obra.entregas.find((e: Json) => e.reciboId === ids.reciboAnticipo).anulado).toBe(true);
    const cuenta = await ok('GET', `/cuenta-corriente/cuentas/${ids.lar}`);
    expect(cuenta.movimientos.some((m: Json) => m.origen === 'ANULACION' && m.importe === '2595000.00')).toBe(true);
    const pdf = await fetch(`${base}/recibos/${ids.reciboAnticipo}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    expect(pdf.status).toBe(200);
  });

  it('Wilson Carrillo: obra en dólares con entregas viejas sin recibo y una entrega en pesos con TC', async () => {
    const obra = await ok('POST', '/proyectos', {
      clienteId: ids.wilson,
      nombre: 'Tinglado casa',
      moneda: 'USD',
      montoAcordado: '12000',
      hitos: [
        { descripcion: 'Anticipo', importe: '6000' },
        { descripcion: 'Saldo al terminar', importe: '6000' },
      ],
    });
    ids.wilsonObra = obra.id;
    // Entregas de 2024: pagos manuales con su fecha original, sin recibo.
    await ok('POST', `/proyectos/${obra.id}/entregas`, { fecha: '2024-03-10', moneda: 'USD', importe: '4000', conRecibo: false, medioPago: 'Efectivo' });
    await ok('POST', `/proyectos/${obra.id}/entregas`, { fecha: '2024-06-02', moneda: 'USD', importe: '2000', conRecibo: false });
    // Ahora paga en pesos: cotización de ARCA (fake: 1450). $2.900.000 = US$ 2.000.
    const r = await ok('POST', `/proyectos/${obra.id}/entregas`, { fecha: '2026-11-25', moneda: 'ARS', importe: '2900000', medioPago: 'Transferencia' });
    expect(cotizacion.cotizacionDolar).toHaveBeenCalled();
    const det = await ok('GET', `/proyectos/${obra.id}`);
    expect(det.saldos).toMatchObject({ totalEntregado: '8000.00', saldo: '4000.00' });
    const enPesos = det.entregas.find((e: Json) => e.reciboId === r.reciboId);
    expect(enPesos).toMatchObject({ importe: '2000.00', monedaOrigen: 'ARS', importeOrigen: '2900000.00', tipoCambio: '1450' });
    // El TC editado en el pago gana.
    await ok('POST', `/proyectos/${obra.id}/entregas`, { fecha: '2026-11-26', moneda: 'ARS', importe: '1500000', tipoCambio: '1500', conRecibo: false });
    expect((await ok('GET', `/proyectos/${obra.id}`)).saldos.saldo).toBe('3000.00');
    const recibo = await prisma.recibo.findUniqueOrThrow({ where: { id: r.reciboId } });
    expect(recibo).toMatchObject({ moneda: 'ARS', monedaImputacion: 'USD' });
    expect(recibo.estadoProyecto).toMatchObject({ moneda: 'USD', saldo: '4000.00' });
  });

  it('Municipalidad: obra sin acordado, la factura suma su total', async () => {
    const obra = await ok('POST', '/proyectos', { clienteId: ids.muni, nombre: 'Reparación de techos del corralón' });
    await facturaEmitida(ids.muni, obra.id, '1000000', '210000');
    const det = await ok('GET', `/proyectos/${obra.id}`);
    expect(det.saldos).toMatchObject({ montoAcordado: null, saldo: '1210000.00' });
  });

  it('un cobro sin proyecto no se imputa a deudas de un proyecto', async () => {
    const haber = await ok('POST', '/cuenta-corriente/movimientos', { clienteId: ids.lar, tipo: 'HABER', concepto: 'Cobro suelto', fecha: '2026-11-26', moneda: 'ARS', importe: '1000' });
    const obra = await ok('GET', `/proyectos/${ids.costaDoll}`);
    const r = await http('POST', '/cuenta-corriente/imputaciones', { haberId: haber.id, debeId: obra.hitos[2].id });
    expect(r.status).toBe(400);
  });

  it('una obra con movimientos no se elimina; sin movimientos, sí', async () => {
    expect((await http('DELETE', `/proyectos/${ids.costaDoll}`)).status).toBe(400);
    const vacia = await ok('POST', '/proyectos', { clienteId: ids.lar, nombre: 'Complejo Crespo', montoAcordado: '100', hitos: [] });
    expect((await http('DELETE', `/proyectos/${vacia.id}`)).status).toBe(200);
    expect((await http('POST', '/proyectos', { clienteId: ids.lar, nombre: 'Galpón sucursal Costa Doll' })).status).toBe(409);
  });
});
