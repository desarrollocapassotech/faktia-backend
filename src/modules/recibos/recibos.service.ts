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
import { generarRecibo, ReciboInvalidoError, type Parte, type ReciboEstilo, type ReciboInput, type ReciboOutput } from './core';

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
  async generar(tenantId: string, dto: GenerarReciboDto, qr?: ReciboEstilo['qr']): Promise<ReciboOutput> {
    const [emisor, plantilla] = await Promise.all([this.tenants.obtenerEmisorCompleto(tenantId), this.tenants.obtenerPlantilla(tenantId)]);
    const tenant: Parte = {
      nombre: emisor.razonSocial,
      documento: `CUIT ${formatearCuit(emisor.cuit)}`,
      domicilio: emisor.domicilioFiscal,
    };
    const base = {
      numero: dto.numero,
      fecha: dto.fecha,
      moneda: dto.moneda,
      items: dto.items,
      total: dto.total,
      medioPago: dto.medioPago,
      observaciones: dto.observaciones,
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
        qr,
      });
    } catch (err) {
      if (err instanceof ReciboInvalidoError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  /** Guarda el recibo. Antes arma el PDF: si el contenido no es válido, no se guarda nada. */
  async crear(auth: AuthContext, dto: CrearReciboDto): Promise<Recibo> {
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
    }, qr);
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

  /**
   * Los primeros `limite` recibos del listado unificado de comprobantes, en su orden, y el total que
   * cumple los filtros. Comprobantes los mezcla con los suyos y pagina.
   */
  async listarParaListado(tenantId: string, f: FiltroListadoRecibos, limite: number): Promise<{ total: number; items: ReciboResumen[] }> {
    const where: Prisma.ReciboWhereInput = {
      tenantId,
      ...(f.clienteId ? { clienteId: f.clienteId } : {}),
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
        select: { id: true, tipo: true, numero: true, fecha: true, moneda: true, total: true, createdAt: true, clienteId: true, contraparteNombre: true },
      }),
    ]);
    return { total, items };
  }
}
