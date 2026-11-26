/**
 * Fase Ale Herrería 3 (e2e): resumen diario de vencimientos por email. Con el adaptador que solo
 * registra (EmailLog). Corre contra una base real (DATABASE_URL ya migrada); sin DATABASE_URL se saltea.
 */
import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import type { INestApplicationContext } from '@nestjs/common';
import { AppModule } from './app.module';
import { AvisosService } from './modules/avisos';
import { ProyectosService } from './modules/cuenta-corriente';
import { TenantsService } from './modules/tenants';
import { EMAIL_PORT, EmailLog } from './shared/email/email';
import { PrismaService } from './shared/prisma/prisma.service';
import { cuitDePrueba } from './shared/testing/datos';

const hayBase = Boolean(process.env.DATABASE_URL);
const ymd = (dias: number) => {
  const d = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date()) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

(hayBase ? describe : describe.skip)('Ale Herrería: avisos por email (e2e)', () => {
  jest.setTimeout(60_000);
  let app: INestApplicationContext;
  const email = new EmailLog();
  const prisma = new PrismaService();
  const tenants: string[] = [];

  async function empresa(avisos: boolean) {
    const t = await prisma.tenant.create({
      data: {
        slug: `e2e-avisos-${randomUUID().slice(0, 8)}`,
        nombreFantasia: 'E2E Avisos',
        razonSocial: 'E2E Avisos SA',
        cuit: cuitDePrueba(),
        condicionIva: 'RESPONSABLE_INSCRIPTO',
        domicilioFiscal: 'Calle 1',
        avisosEmail: avisos,
        etiquetaProyecto: 'Obra',
      },
    });
    tenants.push(t.id);
    await prisma.usuario.createMany({ data: [{ tenantId: t.id, email: `ale@${t.slug}.test` }, { tenantId: t.id, email: `rocio@${t.slug}.test` }] });
    const cliente = await prisma.cliente.create({ data: { tenantId: t.id, razonSocial: 'La Agrícola Regional', tipoDocumento: 'CONSUMIDOR_FINAL', numeroDocumento: '0', condicionIva: 'CONSUMIDOR_FINAL' } });
    const auth = { tenantId: t.id, tipo: 'usuario' as const, scopes: [] };
    const obra = await app.get(ProyectosService).crear(auth, {
      clienteId: cliente.id,
      nombre: 'Galpón Costa Doll',
      montoAcordado: '17300000',
      hitos: [
        { descripcion: 'Anticipo', importe: '2595000', fechaVencimiento: ymd(-5) },
        { descripcion: 'Según avance de obra', importe: '13385000', porCertificacion: true },
        { descripcion: 'Al terminar', importe: '1320000', fechaVencimiento: ymd(30) },
      ],
    });
    const avance = obra.hitos.find((h) => h.porCertificacion)!;
    await app.get(ProyectosService).certificar(auth, obra.id, avance.id, { fecha: ymd(-1), descripcion: 'Estructura', importe: '5000000', fechaVencimiento: ymd(2) });
    return t;
  }

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(EMAIL_PORT).useValue(email).compile();
    app = await modulo.init();
  });

  afterAll(async () => {
    for (const id of tenants) {
      await prisma.movimientoCuentaCorriente.deleteMany({ where: { tenantId: id } });
      await prisma.proyecto.deleteMany({ where: { tenantId: id } });
      await prisma.tenant.delete({ where: { id } });
    }
    await app?.close();
    await prisma.$disconnect();
  });

  it('manda a todos los usuarios lo vencido y lo que vence en 3 días, una sola vez por día', async () => {
    const t = await empresa(true);
    const avisos = app.get(AvisosService);
    const r = await avisos.enviar(t.id);
    expect(r).toMatchObject({ enviado: true, transporte: 'log' });
    const mail = email.enviados.at(-1)!;
    expect(mail.para.sort()).toEqual([`ale@${t.slug}.test`, `rocio@${t.slug}.test`]);
    expect(mail.asunto).toBe('Faktia · E2E Avisos: 1 vencido y 1 por vencer');
    expect(mail.texto).toContain('Anticipo · Obra: Galpón Costa Doll · $ 2.595.000,00');
    expect(mail.texto).toContain('Según avance de obra: Estructura');
    // Lo que falta certificar y el hito a 30 días no entran.
    expect(mail.texto).not.toContain('Al terminar');
    expect(await avisos.enviar(t.id)).toEqual({ enviado: false, motivo: 'ya-enviado' });
  });

  it('el job solo recorre las empresas con avisos activos', async () => {
    const apagada = await empresa(false);
    const conAvisos = (await app.get(TenantsService).empresasConAvisos()).map((x) => x.id);
    expect(conAvisos).toContain(tenants[0]);
    expect(conAvisos).not.toContain(apagada.id);
  });
});
