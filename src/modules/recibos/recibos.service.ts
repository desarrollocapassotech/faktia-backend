import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Recibo, type TipoRecibo } from '@prisma/client';
import * as QRCode from 'qrcode';
import type { AuthContext } from '../auth';
import { firmaValida, firmar } from '../../shared/crypto/cifrado';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { dibujarGeneradoCon, fuentesPdf } from '../../shared/pdf/marca-pdf';
import { formatearCuit } from '../../shared/util/cuit';
import { TenantsService } from '../tenants';
import { generarRecibo, ReciboInvalidoError, type Parte, type ReciboEstilo, type ReciboInput, type ReciboOutput, type SeccionRecibo } from './core';
import { formatearImporte, seccionesDeEstado, type EstadoProyectoRecibo } from './estado-proyecto';

const CONDICION_IVA_TEXTO: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: 'IVA Responsable Inscripto',
  EXENTO: 'IVA Exento',
  MONOTRIBUTO: 'Responsable Monotributo',
  MONOTRIBUTO_SOCIAL: 'Monotributista Social',
  MONOTRIBUTO_TIP: 'Monotributista Trabajador Independiente Promovido',
};

/** Lo que agrega la cuenta corriente al guardar un recibo de una entrega de un proyecto. */
export interface ExtrasReciboProyecto {
  proyectoId: string;
  /** Pago en otra moneda que el proyecto: lo que cancela en la moneda del proyecto. */
  monedaImputacion?: 'ARS' | 'USD';
  importeImputacion?: string;
  tipoCambio?: string;
}

/** Datos que no van en el dto del PDF: equivalencia, estado del proyecto y anulación. */
interface ExtrasPdf {
  qr?: ReciboEstilo['qr'];
  secciones?: SeccionRecibo[];
  datosExtra?: Array<[string, string]>;
  anulado?: boolean;
}

/** Propósito de la firma del link de verificación (no sirve para otros usos). */
const PROPOSITO_VERIFICACION = 'recibo.verificar';

/** Lo que muestra la página pública de verificación: lo que ya está impreso en el recibo, nada más. */
export interface ReciboVerificado {
  valido: true;
  emisor: string;
  tipo: TipoRecibo;
  numero: string | null;
  fecha: string;
  moneda: Recibo['moneda'];
  total: string;
  contraparte: string;
  creadoEn: string;
}
import { CrearReciboDto, GenerarReciboDto } from './dto/recibos.dto';

/** Columnas por las que se puede ordenar el listado unificado de comprobantes. */
export type OrdenListadoRecibos = 'comprobante' | 'numero' | 'fecha' | 'cliente' | 'total' | 'estado';

/** Filtros del listado de comprobantes que aplican a los recibos. */
export interface FiltroListadoRecibos {
  numero?: string;
  clienteId?: string;
  fechaDesde?: string; // YYYY-MM-DD, inclusive
  fechaHasta?: string;
  ordenarPor?: OrdenListadoRecibos;
  dir?: 'asc' | 'desc';
  /** true: solo anulados; false: solo vigentes; sin esto, todos. */
  anulados?: boolean;
}

/** Lo que el listado de comprobantes necesita de un recibo. */
export interface ReciboResumen {
  id: string;
  tipo: TipoRecibo;
  numero: string | null;
  fecha: Date;
  moneda: Recibo['moneda'];
  total: Prisma.Decimal;
  createdAt: Date;
  clienteId: string | null;
  contraparteNombre: string;
  anuladoEn: Date | null;
}

/** Recibo de cobro visto desde la cuenta corriente. `comprobantesAplicados`: [{ descripcion, importe, comprobanteId? }]. */
export interface ReciboParaCuentaCorriente {
  id: string;
  clienteId: string | null;
  proyectoId: string | null;
  monedaImputacion: Recibo['moneda'] | null;
  importeImputacion: Prisma.Decimal | null;
  tipoCambio: Prisma.Decimal | null;
  numero: string | null;
  fecha: Date;
  moneda: Recibo['moneda'];
  total: Prisma.Decimal;
  medioPago: string | null;
  comprobantesAplicados: Prisma.JsonValue;
}

const deYmd = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

/**
 * "0001-00000041" → "0001-00000042"; "R-7" → "R-8". Sin recibos anteriores, el primero
 * (0001-00000001). Si el último no termina en número, no sugiere.
 */
export function siguienteNumeroRecibo(ultimo: string | null | undefined): string {
  if (!ultimo?.trim()) return '0001-00000001';
  const m = /^(.*?)(\d+)$/.exec(ultimo.trim());
  if (!m) return '';
  return `${m[1]}${String(Number(m[2]) + 1).padStart(m[2].length, '0')}`;
}

/** Orden en la base. Desempata por creación, más nuevo primero (igual que comprobantes). */
export function ordenRecibos(por: OrdenListadoRecibos | undefined, dir: 'asc' | 'desc'): Prisma.ReciboOrderByWithRelationInput[] {
  const desempate: Prisma.ReciboOrderByWithRelationInput[] = [{ createdAt: 'desc' }, { id: 'desc' }];
  switch (por) {
    case 'comprobante':
      return [{ tipo: dir }, ...desempate];
    case 'numero':
      return [{ numero: { sort: dir, nulls: 'last' } }, ...desempate];
    case 'fecha':
      return [{ fecha: dir }, ...desempate];
    case 'cliente':
      return [{ contraparteNombre: dir }, ...desempate];
    case 'total':
      return [{ total: dir }, ...desempate];
    default:
      // "estado": todos los recibos están emitidos.
      return desempate;
  }
}

/** Adapta el generador puro a Faktia y guarda los recibos (la parte del tenant y el estilo salen de su configuración). */
@Injectable()
export class RecibosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Link público que verifica un recibo guardado (lo lleva el QR del PDF). La firma impide armar
   * links válidos para otros ids.
   */
  urlVerificacion(id: string): string {
    const front = (this.config.getOrThrow<string>('FRONTEND_URL').split(',')[0] ?? '').trim().replace(/\/+$/, '');
    return `${front}/verificar/recibo/${encodeURIComponent(id)}?c=${firmar(PROPOSITO_VERIFICACION, id)}`;
  }

  /**
   * Datos mínimos de un recibo para la página pública de verificación. Sin sesión: el id y la firma
   * del QR son la credencial. Cualquier falla responde lo mismo (no se distingue id inexistente de firma mala).
   */
  async verificar(id: string, firma: string): Promise<ReciboVerificado> {
    const r = firmaValida(PROPOSITO_VERIFICACION, id, firma)
      ? await this.prisma.recibo.findUnique({
          where: { id },
          select: {
            tipo: true,
            numero: true,
            fecha: true,
            moneda: true,
            total: true,
            contraparteNombre: true,
            createdAt: true,
            tenant: { select: { razonSocial: true, nombreFantasia: true } },
          },
        })
      : null;
    if (!r) throw new NotFoundException('No encontramos este recibo.');
    return {
      valido: true,
      emisor: r.tenant.razonSocial ?? r.tenant.nombreFantasia,
      tipo: r.tipo,
      numero: r.numero,
      fecha: r.fecha.toISOString().slice(0, 10),
      moneda: r.moneda,
      total: r.total.toFixed(2),
      contraparte: r.contraparteNombre,
      creadoEn: r.createdAt.toISOString(),
    };
  }

  /** Arma el PDF (valida el contenido: total = suma de los conceptos). Con `qr`, lo dibuja al pie. */
  async generar(tenantId: string, dto: GenerarReciboDto, extras: ExtrasPdf = {}): Promise<ReciboOutput> {
    const [emisor, plantilla] = await Promise.all([this.tenants.obtenerEmisorCompleto(tenantId), this.tenants.obtenerPlantilla(tenantId)]);
    const detalle = [
      emisor.telefono ? `Tel. ${emisor.telefono}` : '',
      emisor.emailContacto ?? '',
      emisor.ingresosBrutos ? `Ingresos Brutos: ${emisor.ingresosBrutos}` : '',
      emisor.inicioActividades ? `Inicio de actividades: ${emisor.inicioActividades.toISOString().slice(0, 10).split('-').reverse().join('/')}` : '',
      CONDICION_IVA_TEXTO[emisor.condicionIva] ?? '',
    ].filter(Boolean);
    const tenant: Parte = {
      nombre: emisor.razonSocial,
      documento: `CUIT ${formatearCuit(emisor.cuit)}`,
      domicilio: emisor.domicilioFiscal,
      detalle,
    };
    const base = {
      numero: dto.numero,
      fecha: dto.fecha,
      moneda: dto.moneda,
      items: dto.items,
      total: dto.total,
      medioPago: dto.medioPago,
      observaciones: dto.observaciones,
      datosExtra: extras.datosExtra,
      secciones: extras.secciones,
    };
    const input: ReciboInput =
      dto.tipo === 'COBRO'
        ? { ...base, tipo: 'COBRO', emisor: tenant, pagador: dto.contraparte, comprobantesAplicados: dto.comprobantesAplicados }
        : { ...base, tipo: 'PAGO', pagador: tenant, beneficiario: dto.contraparte, periodo: dto.periodo };

    const fuentes = fuentesPdf();
    try {
      return await generarRecibo(input, {
        logo: plantilla.logo ?? undefined,
        logoMime: plantilla.logoMime ?? undefined,
        colorPrimario: plantilla.colorPrimario,
        colorSecundario: plantilla.colorSecundario,
        // El pie de la plantilla (datos para el pago) es para las facturas: en el recibo no va.
        // En el de cobro no se firma: quedan el nombre y el CUIT de quien cobra.
        lineaFirma: dto.tipo !== 'COBRO',
        fuentes: { normal: fuentes.normal, seminegrita: fuentes.seminegrita, italica: fuentes.italica },
        marcaPie: dibujarGeneradoCon,
        qr: extras.qr,
        firmaTexto: plantilla.firmaTexto ?? undefined,
        anulado: extras.anulado,
      });
    } catch (err) {
      if (err instanceof ReciboInvalidoError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  /** Guarda el recibo. Antes arma el PDF: si el contenido no es válido, no se guarda nada. */
  async crear(auth: AuthContext, dto: CrearReciboDto, proyecto?: ExtrasReciboProyecto): Promise<Recibo> {
    await this.generar(auth.tenantId, dto);
    const numero = dto.numero?.trim() || null;
    try {
      return await this.prisma.recibo.create({
        data: {
          tenantId: auth.tenantId,
          tipo: dto.tipo,
          numero,
          fecha: deYmd(dto.fecha),
          moneda: dto.moneda,
          total: dto.total,
          clienteId: dto.tipo === 'COBRO' ? dto.clienteId || null : null,
          contraparteNombre: dto.contraparte.nombre.trim(),
          contraparte: { ...dto.contraparte },
          items: dto.items.map((i) => ({ ...i })),
          comprobantesAplicados: dto.tipo === 'COBRO' && dto.comprobantesAplicados?.length ? dto.comprobantesAplicados.map((c) => ({ ...c })) : Prisma.DbNull,
          periodo: dto.tipo === 'PAGO' ? dto.periodo?.trim() || null : null,
          medioPago: dto.medioPago?.trim() || null,
          observaciones: dto.observaciones?.trim() || null,
          proyectoId: proyecto?.proyectoId ?? null,
          monedaImputacion: proyecto?.monedaImputacion ?? null,
          importeImputacion: proyecto?.importeImputacion ?? null,
          tipoCambio: proyecto?.tipoCambio ?? null,
          creadoPorId: auth.usuarioId ?? null,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') {
          throw new ConflictException(`Ya hay un recibo de ${dto.tipo === 'COBRO' ? 'cobro' : 'pago'} con el número ${numero}.`);
        }
        // FK compuesta (tenantId, clienteId): el cliente no existe en esta empresa.
        if (err.code === 'P2003') throw new BadRequestException('El cliente no existe.');
      }
      throw err;
    }
  }

  async obtener(tenantId: string, id: string): Promise<Recibo> {
    const r = await this.prisma.recibo.findUnique({ where: { tenantId_id: { tenantId, id } } });
    if (!r) throw new NotFoundException('Recibo no encontrado.');
    return r;
  }

  /** PDF de un recibo guardado, con la plantilla vigente y el QR que lo verifica. */
  async pdf(tenantId: string, id: string): Promise<ReciboOutput> {
    const r = await this.obtener(tenantId, id);
    const contraparte = r.contraparte as unknown as Parte;
    const imagen = await QRCode.toBuffer(this.urlVerificacion(r.id), { width: 240, margin: 1 });
    const qr = { imagen, leyenda: 'Escaneá el código para verificar que este recibo es válido y fue emitido con Faktia.' };
    const estado = r.estadoProyecto as unknown as EstadoProyectoRecibo | null;
    const datosExtra: Array<[string, string]> = [];
    if (r.tipoCambio && r.monedaImputacion && r.importeImputacion && r.monedaImputacion !== r.moneda) {
      datosExtra.push([
        'Equivalencia',
        `${formatearImporte(r.importeImputacion.toFixed(2), r.monedaImputacion)} al tipo de cambio ${formatearImporte(r.tipoCambio.toFixed(2), 'ARS')} por dólar`,
      ]);
    }
    if (r.anuladoEn) datosExtra.push(['Anulado', `${r.anuladoEn.toISOString().slice(0, 10).split('-').reverse().join('/')}${r.motivoAnulacion ? `: ${r.motivoAnulacion}` : ''}`]);
    return this.generar(tenantId, {
      tipo: r.tipo,
      numero: r.numero ?? undefined,
      fecha: r.fecha.toISOString().slice(0, 10),
      moneda: r.moneda,
      contraparte,
      items: r.items as unknown as GenerarReciboDto['items'],
      total: r.total.toFixed(2),
      medioPago: r.medioPago ?? undefined,
      observaciones: r.observaciones ?? undefined,
      comprobantesAplicados: (r.comprobantesAplicados as unknown as GenerarReciboDto['comprobantesAplicados']) ?? undefined,
      periodo: r.periodo ?? undefined,
    }, { qr, datosExtra, secciones: estado ? seccionesDeEstado(estado) : undefined, anulado: Boolean(r.anuladoEn) });
  }

  /** Guarda la copia del estado del proyecto (la arma la cuenta corriente después de imputar el cobro). */
  async guardarEstadoProyecto(tenantId: string, id: string, estado: EstadoProyectoRecibo): Promise<void> {
    await this.prisma.recibo.update({ where: { tenantId_id: { tenantId, id } }, data: { estadoProyecto: { ...estado } } });
  }

  /**
   * Anula un recibo: queda guardado con la marca y el motivo, y la cuenta corriente revierte su cobro
   * con un movimiento de anulación (no se borra nada).
   */
  async anular(tenantId: string, id: string, motivo: string): Promise<Recibo> {
    const r = await this.obtener(tenantId, id);
    if (r.anuladoEn) throw new BadRequestException('El recibo ya está anulado.');
    return this.prisma.recibo.update({
      where: { tenantId_id: { tenantId, id } },
      data: { anuladoEn: new Date(), motivoAnulacion: motivo.trim() || null },
    });
  }

  /** Para la cuenta corriente: recibos de cobro anulados (su cobro se revierte). */
  async idsAnulados(tenantId: string): Promise<string[]> {
    const filas = await this.prisma.recibo.findMany({ where: { tenantId, tipo: 'COBRO', anuladoEn: { not: null } }, select: { id: true } });
    return filas.map((f) => f.id);
  }

  /** Recibos de un proyecto (para su pantalla), del más nuevo al más viejo. */
  listarDeProyecto(tenantId: string, proyectoId: string) {
    return this.prisma.recibo.findMany({
      where: { tenantId, proyectoId },
      orderBy: [{ fecha: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, numero: true, fecha: true, moneda: true, total: true, anuladoEn: true, medioPago: true },
    });
  }

  /** El número siguiente al del último recibo de ese tipo (numeraciones separadas por tipo). */
  async siguienteNumero(tenantId: string, tipo: TipoRecibo): Promise<{ numero: string }> {
    const ultimo = await this.prisma.recibo.findFirst({
      where: { tenantId, tipo, numero: { not: null } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { numero: true },
    });
    return { numero: siguienteNumeroRecibo(ultimo?.numero) };
  }

  /** Para la cuenta corriente: ids de los recibos de cobro guardados con un cliente de Faktia. */
  async idsCobrosConCliente(tenantId: string): Promise<string[]> {
    const filas = await this.prisma.recibo.findMany({ where: { tenantId, tipo: 'COBRO', clienteId: { not: null } }, select: { id: true } });
    return filas.map((f) => f.id);
  }

  /** Lo que la cuenta corriente necesita de cada recibo de cobro (incluye las facturas que cancela). */
  paraCuentaCorriente(tenantId: string, ids: string[]): Promise<ReciboParaCuentaCorriente[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.recibo.findMany({
      where: { tenantId, id: { in: ids }, tipo: 'COBRO', clienteId: { not: null } },
      select: {
        id: true,
        clienteId: true,
        proyectoId: true,
        numero: true,
        fecha: true,
        moneda: true,
        total: true,
        medioPago: true,
        comprobantesAplicados: true,
        monedaImputacion: true,
        importeImputacion: true,
        tipoCambio: true,
      },
      orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Los primeros `limite` recibos del listado unificado de comprobantes, en su orden, y el total que
   * cumple los filtros. Comprobantes los mezcla con los suyos y pagina.
   */
  async listarParaListado(tenantId: string, f: FiltroListadoRecibos, limite: number): Promise<{ total: number; items: ReciboResumen[] }> {
    const where: Prisma.ReciboWhereInput = {
      tenantId,
      ...(f.clienteId ? { clienteId: f.clienteId } : {}),
      ...(f.anulados === undefined ? {} : { anuladoEn: f.anulados ? { not: null } : null }),
      ...(f.numero ? { numero: { contains: f.numero.trim(), mode: 'insensitive' } } : {}),
      ...(f.fechaDesde || f.fechaHasta
        ? { fecha: { ...(f.fechaDesde ? { gte: deYmd(f.fechaDesde) } : {}), ...(f.fechaHasta ? { lte: deYmd(f.fechaHasta) } : {}) } }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.recibo.count({ where }),
      this.prisma.recibo.findMany({
        where,
        orderBy: ordenRecibos(f.ordenarPor, f.dir ?? 'asc'),
        take: limite,
        select: { id: true, tipo: true, numero: true, fecha: true, moneda: true, total: true, createdAt: true, clienteId: true, contraparteNombre: true, anuladoEn: true },
      }),
    ]);
    return { total, items };
  }
}
