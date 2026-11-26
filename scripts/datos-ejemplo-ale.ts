/**
 * Crea (o recrea) la empresa de ejemplo de Ale Herrería con datos del doc funcional: clientes,
 * obras con plan de pagos, certificaciones y entregas. Usa los servicios reales (no inserta a mano).
 *
 *   NUEVA_PASSWORD='…' npm run datos-ejemplo-ale -- --slug ale-herreria-demo --email rocio@ejemplo.com
 *
 * Con --reemplazar borra antes la empresa con ese slug (solo si su nombre empieza con "Ejemplo").
 * No apunta a ninguna base en particular: usa DATABASE_URL. No correrlo contra producción.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import type { AuthContext } from '../src/modules/auth';
import { ClientesService } from '../src/modules/clientes';
import { ProyectosService } from '../src/modules/cuenta-corriente';
import { hashPassword } from '../src/modules/auth/password';
import { MODULOS } from '../src/shared/modulos/modulos';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { leerArgs, requerido } from './args';
import { cargarEjemploPresupuestosYMateriales } from './datos-ejemplo-ale-extra';

const USO = `  NUEVA_PASSWORD='…' npm run datos-ejemplo-ale -- --slug ale-herreria-demo --email rocio@ejemplo.com [--reemplazar]`;

async function main() {
  const args = leerArgs();
  const slug = requerido(args, 'slug', USO).toLowerCase();
  const email = requerido(args, 'email', USO).toLowerCase();
  const password = process.env.NUEVA_PASSWORD;
  if (!password || password.length < 10) throw new Error('Definí NUEVA_PASSWORD (10 caracteres o más).');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  try {
    const existente = await prisma.tenant.findUnique({ where: { slug } });
    if (existente) {
      if (!args.reemplazar) throw new Error(`Ya existe la empresa ${slug}. Usá --reemplazar para recrearla.`);
      if (!existente.nombreFantasia.startsWith('Ejemplo')) throw new Error('Solo se reemplazan empresas de ejemplo (nombre "Ejemplo …").');
      const t = existente.id;
      await prisma.movimientoCuentaCorriente.deleteMany({ where: { tenantId: t } });
      await prisma.comprobante.deleteMany({ where: { tenantId: t } });
      await prisma.recibo.deleteMany({ where: { tenantId: t } });
      await borrarExtras(prisma, t);
      await prisma.proyecto.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.delete({ where: { id: t } });
    }

    const tenant = await prisma.tenant.create({
      data: {
        slug,
        nombreFantasia: 'Ejemplo Ale Herrería',
        razonSocial: 'HERMAN ALEXIS NAHUEL',
        // CUIT de ejemplo con dígito verificador válido (no es el real de Ale).
        cuit: '20111111112',
        condicionIva: 'RESPONSABLE_INSCRIPTO',
        domicilioFiscal: 'Calle Falsa 123, General Ramírez, Entre Ríos',
        ingresosBrutos: '20-11111111-2',
        inicioActividades: new Date('2018-03-01'),
        telefono: '343 400-0000',
        emailContacto: 'aleherreria@ejemplo.com',
        modulosHabilitados: MODULOS.filter((m) => !['importaciones', 'integraciones', 'webhooks', 'recibos-pago'].includes(m)),
        etiquetaProyecto: 'Obra',
        etiquetaProyectoPlural: 'Obras',
        plantillaPdf: { create: { firmaTexto: 'ATTE. ALEXIS NAHUEL HERMAN', colorPrimario: '#1E3A4C' } },
      },
    });
    const usuario = await prisma.usuario.create({ data: { tenantId: tenant.id, email, nombre: 'Rocío', passwordHash: await hashPassword(password) } });
    const auth: AuthContext = { tenantId: tenant.id, tipo: 'usuario', usuarioId: usuario.id, scopes: [], modulos: tenant.modulosHabilitados };

    const clientes = app.get(ClientesService);
    const lar = await clientes.crear(tenant.id, {
      razonSocial: 'La Agrícola Regional Coop. Ltda.',
      tipoDocumento: 'CUIT',
      numeroDocumento: '30668346908',
      condicionIva: 'RESPONSABLE_INSCRIPTO',
      domicilio: 'Crespo, Entre Ríos',
    });
    const muni = await clientes.crear(tenant.id, { razonSocial: 'Municipalidad de General Ramírez', tipoDocumento: 'CONSUMIDOR_FINAL', numeroDocumento: '', condicionIva: 'EXENTO', domicilio: 'General Ramírez' });
    const diego = await clientes.crear(tenant.id, { razonSocial: 'Diego Streck', tipoDocumento: 'CONSUMIDOR_FINAL', numeroDocumento: '', condicionIva: 'CONSUMIDOR_FINAL', domicilio: 'General Ramírez' });
    const wilson = await clientes.crear(tenant.id, { razonSocial: 'Wilson Carrillo', tipoDocumento: 'CONSUMIDOR_FINAL', numeroDocumento: '', condicionIva: 'CONSUMIDOR_FINAL' });

    const proyectos = app.get(ProyectosService);
    const costaDoll = await proyectos.crear(auth, {
      clienteId: lar.id,
      nombre: 'Galpón sucursal Costa Doll',
      ubicacion: 'Costa Doll, Entre Ríos',
      moneda: 'ARS',
      modoIva: 'MAS_IVA',
      fechaInicio: '2026-10-09',
      montoAcordado: '17300000',
      hitos: [
        { descripcion: 'Anticipo', importe: '2595000', fechaVencimiento: '2026-10-15' },
        { descripcion: 'Facturación según avance de obra', importe: '13385000', porCertificacion: true },
        { descripcion: 'Saldo al terminar (llenado de 4 columnas)', importe: '1320000' },
      ],
    });
    await proyectos.registrarEntrega(auth, costaDoll.id, { fecha: '2026-10-14', moneda: 'ARS', importe: '2595000', medioPago: 'Transferencia' });
    const avance = costaDoll.hitos.find((h) => h.porCertificacion)!;
    await proyectos.certificar(auth, costaDoll.id, avance.id, { fecha: '2026-11-10', descripcion: 'Estructura y columnas', importe: '5000000', fechaVencimiento: '2026-11-25' });

    await proyectos.crear(auth, {
      clienteId: lar.id,
      nombre: 'Complejo Crespo: cenefas y canaletas',
      ubicacion: 'Crespo, Entre Ríos',
      fechaInicio: '2026-11-02',
      montoAcordado: '3200000',
      hitos: [
        { descripcion: 'Anticipo 50%', importe: '1600000', fechaVencimiento: '2026-11-05' },
        { descripcion: 'Saldo al terminar', importe: '1600000', fechaVencimiento: '2026-12-15' },
      ],
    });

    const tinglado = await proyectos.crear(auth, {
      clienteId: wilson.id,
      nombre: 'Tinglado casa',
      moneda: 'USD',
      tipoCambioFijo: '1450',
      fechaInicio: '2024-02-15',
      montoAcordado: '12000',
      hitos: [
        { descripcion: 'Anticipo', importe: '6000' },
        { descripcion: 'Saldo al terminar', importe: '6000' },
      ],
    });
    // Entregas de 2024: sin recibo, con su fecha original.
    await proyectos.registrarEntrega(auth, tinglado.id, { fecha: '2024-03-10', moneda: 'USD', importe: '4000', conRecibo: false, medioPago: 'Efectivo' });
    await proyectos.registrarEntrega(auth, tinglado.id, { fecha: '2024-06-02', moneda: 'USD', importe: '2000', conRecibo: false, medioPago: 'Efectivo' });
    await proyectos.registrarEntrega(auth, tinglado.id, { fecha: '2026-11-20', moneda: 'ARS', importe: '2900000', medioPago: 'Transferencia' });

    await proyectos.crear(auth, { clienteId: muni.id, nombre: 'Reparación de techos del corralón', fechaInicio: '2026-11-15' });
    await proyectos.crear(auth, { clienteId: diego.id, nombre: 'Portón corredizo y rejas', montoAcordado: '1850000', hitos: [] });

    await cargarEjemploPresupuestosYMateriales(app, auth, { lar: lar.id, muni: muni.id, diego: diego.id, costaDoll: costaDoll.id });

    console.log(`Empresa de ejemplo creada: ${tenant.nombreFantasia} (slug=${slug}). Usuario: ${email}.`);
  } finally {
    await app.close();
  }
}

/** Lo que agregan las fases siguientes (presupuestos, materiales) antes de borrar la empresa. */
async function borrarExtras(prisma: PrismaService, tenantId: string) {
  const { borrarEjemploPresupuestosYMateriales } = await import('./datos-ejemplo-ale-extra');
  await borrarEjemploPresupuestosYMateriales(prisma, tenantId);
}

main().catch((err: unknown) => {
  console.error((err as Error).message ?? err);
  process.exit(1);
});
