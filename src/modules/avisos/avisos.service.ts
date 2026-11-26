import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { UsuariosService } from '../auth';
import { ClientesService } from '../clientes';
import { CuentaCorrienteService } from '../cuenta-corriente';
import { TenantsService } from '../tenants';
import { EMAIL_PORT, type EmailPort } from '../../shared/email/email';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { asuntoAviso, htmlAviso, textoAviso, type ItemAviso, type ResumenAviso } from './domain/correo';

const ZONA = 'America/Argentina/Buenos_Aires';
const deYmd = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const hoyAr = () => deYmd(new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date()));
const aYmd = (d: Date) => d.toISOString().slice(0, 10);

export type ResultadoAviso = { enviado: false; motivo: 'sin-vencimientos' | 'sin-destinatarios' | 'ya-enviado' } | { enviado: true; destinatarios: string[]; transporte: 'smtp' | 'log' };

/**
 * Resumen diario por email a los usuarios de la empresa: lo vencido y lo que vence en los próximos
 * días (`Tenant.diasAvisoVencimiento`). Trabaja sobre lo exigible: lo que falta certificar de una
 * obra no vence ni se avisa. Uno por empresa y día (`AvisoEmail`), aunque el servidor se reinicie.
 *
 * Ojo: en el plan free de Render el servidor se duerme sin tráfico y el cron no corre. Ver REVISION.md.
 */
@Injectable()
export class AvisosService {
  private readonly logger = new Logger(AvisosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cc: CuentaCorrienteService,
    private readonly clientes: ClientesService,
    private readonly tenants: TenantsService,
    private readonly usuarios: UsuariosService,
    private readonly config: ConfigService,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
  ) {}

  /** Lo que diría el aviso de hoy (también para la vista previa en pantalla). */
  async armar(tenantId: string): Promise<ResumenAviso> {
    const [emisor, preferencias, clientes] = await Promise.all([
      this.tenants.obtenerEmisor(tenantId),
      this.tenants.obtenerPreferencias(tenantId),
      this.clientes.todosParaCuentas(tenantId),
    ]);
    await this.cc.sincronizar(tenantId);
    const abiertos = await this.cc.debesAbiertos(tenantId, new Map(clientes.map((c) => [c.id, c.razonSocial])));
    const hoy = hoyAr();
    const limite = new Date(hoy.getTime() + preferencias.diasAvisoVencimiento * 86_400_000);
    const item = (d: (typeof abiertos)[number]): ItemAviso => ({
      cliente: d.razonSocial,
      proyecto: d.proyecto,
      concepto: d.concepto,
      numero: d.numero,
      moneda: d.moneda,
      pendiente: d.pendiente.toFixed(2),
      fechaVencimiento: aYmd(d.fechaVencimiento!),
    });
    const conVto = abiertos.filter((d) => d.fechaVencimiento).sort((a, b) => a.fechaVencimiento!.getTime() - b.fechaVencimiento!.getTime());
    const front = (this.config.get<string>('FRONTEND_URL') ?? '').split(',')[0].trim().replace(/\/+$/, '');
    return {
      empresa: emisor.nombreFantasia,
      etiquetaProyecto: preferencias.etiquetaProyecto,
      dias: preferencias.diasAvisoVencimiento,
      vencidos: conVto.filter((d) => d.fechaVencimiento! < hoy).map(item),
      proximos: conVto.filter((d) => d.fechaVencimiento! >= hoy && d.fechaVencimiento! <= limite).map(item),
      url: `${front}/cuenta-corriente`,
    };
  }

  /**
   * Manda el aviso de hoy de una empresa. `para`: destinatarios puntuales (prueba desde la pantalla,
   * no cuenta como el envío del día); sin esto, todos los usuarios y una sola vez por día.
   */
  async enviar(tenantId: string, para?: string[]): Promise<ResultadoAviso> {
    const hoy = hoyAr();
    const prueba = Boolean(para);
    if (!prueba && (await this.prisma.avisoEmail.findUnique({ where: { tenantId_fecha: { tenantId, fecha: hoy } } }))) {
      return { enviado: false, motivo: 'ya-enviado' };
    }
    const resumen = await this.armar(tenantId);
    if (!prueba && resumen.vencidos.length + resumen.proximos.length === 0) return { enviado: false, motivo: 'sin-vencimientos' };
    const destinatarios = para ?? (await this.usuarios.emailsActivos(tenantId));
    if (destinatarios.length === 0) return { enviado: false, motivo: 'sin-destinatarios' };

    if (!prueba) {
      // Primero se reserva el día: si dos instancias corren el job a la vez, solo una manda.
      try {
        await this.prisma.avisoEmail.create({
          data: { tenantId, fecha: hoy, destinatarios, vencidos: resumen.vencidos.length, proximos: resumen.proximos.length, transporte: this.email.tipo },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { enviado: false, motivo: 'ya-enviado' };
        throw err;
      }
    }
    try {
      await this.email.enviar({ para: destinatarios, asunto: asuntoAviso(resumen), html: htmlAviso(resumen), texto: textoAviso(resumen) });
    } catch (err) {
      // Si falló el envío, se libera el día para reintentar.
      if (!prueba) await this.prisma.avisoEmail.deleteMany({ where: { tenantId, fecha: hoy } });
      throw err;
    }
    return { enviado: true, destinatarios, transporte: this.email.tipo };
  }

  /** Todos los días a las 8 (hora de Argentina): el resumen de cada empresa con avisos activos. */
  @Cron('0 8 * * *', { name: 'avisos-vencimientos', timeZone: ZONA })
  async enviarATodas(): Promise<void> {
    for (const t of await this.tenants.empresasConAvisos()) {
      try {
        const r = await this.enviar(t.id);
        if (r.enviado) this.logger.log(`Aviso de vencimientos de ${t.nombre}: ${r.destinatarios.length} destinatario(s) (${r.transporte}).`);
      } catch (err) {
        this.logger.error(`No se pudo mandar el aviso de ${t.nombre}: ${(err as Error).message}`);
      }
    }
  }

  /** Últimos envíos de la empresa (para mostrar en Configuración). */
  async historial(tenantId: string) {
    const filas = await this.prisma.avisoEmail.findMany({ where: { tenantId }, orderBy: { fecha: 'desc' }, take: 10 });
    return { transporte: this.email.tipo, envios: filas.map((f) => ({ fecha: aYmd(f.fecha), destinatarios: f.destinatarios, vencidos: f.vencidos, proximos: f.proximos, transporte: f.transporte })) };
  }
}
