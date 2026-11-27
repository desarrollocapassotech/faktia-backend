import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Moneda, type Proyecto } from '@prisma/client';
import Decimal from 'decimal.js';
import type { AuthContext } from '../../auth';
import { ClientesService } from '../../clientes';
import { RecibosService, type EstadoProyectoRecibo } from '../../recibos';
import { TenantsService } from '../../tenants';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { formatearCuit } from '../../../shared/util/cuit';
import { aYmd, CuentaCorrienteService, deYmd, dinero, hoyAr, TX } from '../cuenta-corriente.service';
import { pendientePorCertificacion, pendientesDe, planEfectivo, errorDePlan, saldosProyecto } from '../domain/proyecto';
import type { ActualizarProyectoDto, AdicionalDto, CertificacionDto, CrearProyectoDto, EntregaDto, ListarProyectosQuery, PlanDto } from './proyectos.dto';

const cero = () => new Decimal(0);

/** Movimientos de un proyecto con lo necesario para saldos, plan, entregas y el estado del recibo. */
const SELECT_MOVIMIENTO = {
  id: true,
  tipo: true,
  origen: true,
  concepto: true,
  numero: true,
  moneda: true,
  importe: true,
  fecha: true,
  fechaVencimiento: true,
  orden: true,
  porCertificacion: true,
  observaciones: true,
  comprobanteId: true,
  reciboId: true,
  monedaOrigen: true,
  importeOrigen: true,
  tipoCambio: true,
  anulaId: true,
  createdAt: true,
  imputacionesComoDebe: { select: { importe: true } },
  imputacionesComoHaber: { select: { importe: true } },
  certificaciones: {
    select: { id: true, fecha: true, descripcion: true, importe: true, fechaVencimiento: true, createdAt: true },
    orderBy: [{ fecha: 'asc' as const }, { createdAt: 'asc' as const }],
  },
} satisfies Prisma.MovimientoCuentaCorrienteSelect;

type MovimientoProyecto = Prisma.MovimientoCuentaCorrienteGetPayload<{ select: typeof SELECT_MOVIMIENTO }>;

const suma = (xs: Array<{ importe: Prisma.Decimal }>) => xs.reduce((acc, x) => acc.plus(x.importe.toString()), cero());

/**
 * Proyectos (en pantalla, con la etiqueta de la empresa: "Obra"). Viven en la cuenta corriente porque
 * no guardan saldos propios: el acordado se divide en hitos (DEBE origen ACUERDO), los adicionales son
 * DEBE manuales y las entregas, HABER (recibos o pagos manuales). Todo lo que cambia la plata pasa por
 * CuentaCorrienteService (imputación, IVA de facturas, tipo de cambio).
 */
@Injectable()
export class ProyectosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cc: CuentaCorrienteService,
    private readonly clientes: ClientesService,
    private readonly recibos: RecibosService,
    private readonly tenants: TenantsService,
  ) {}

  // ───────────────────────────── Lectura ─────────────────────────────

  private async buscar(tenantId: string, id: string): Promise<Proyecto> {
    const p = await this.prisma.proyecto.findUnique({ where: { tenantId_id: { tenantId, id } } });
    if (!p) throw new NotFoundException('No encontramos ese proyecto.');
    return p;
  }

  private movimientos(tenantId: string, proyectoIds: string[]) {
    return this.prisma.movimientoCuentaCorriente.findMany({
      where: { tenantId, proyectoId: { in: proyectoIds } },
      select: { ...SELECT_MOVIMIENTO, proyectoId: true },
      orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** Saldos y listas de un proyecto, a partir de sus movimientos (en su moneda). */
  private calcular(p: Pick<Proyecto, 'montoAcordado' | 'moneda'>, movs: MovimientoProyecto[]) {
    const hoy = hoyAr();
    const debes = movs.filter((m) => m.tipo === 'DEBE');
    const habers = movs.filter((m) => m.tipo === 'HABER');
    const anulados = new Set(debes.filter((m) => m.origen === 'ANULACION').map((m) => m.anulaId));
    const vistaDebe = (m: MovimientoProyecto) => {
      const imputado = suma(m.imputacionesComoDebe);
      const certificado = suma(m.certificaciones);
      const pend = pendientesDe({ importe: m.importe.toString(), imputado, porCertificacion: m.porCertificacion, certificado });
      return { m, imputado, certificado, ...pend };
    };
    const vistas = debes.map(vistaDebe);
    const s = saldosProyecto(
      vistas.map((v) => ({ importe: v.m.importe.toString(), imputado: v.imputado, porCertificacion: v.m.porCertificacion, certificado: v.certificado })),
      suma(habers),
    );

    const hitos = vistas
      .filter((v) => v.m.origen === 'ACUERDO')
      .sort((a, b) => (a.m.orden ?? 0) - (b.m.orden ?? 0))
      .map((v) => {
        const porCert = new Map(
          pendientePorCertificacion(
            v.imputado,
            v.m.certificaciones.map((c) => ({ id: c.id, importe: c.importe.toString(), fecha: c.fecha, fechaVencimiento: c.fechaVencimiento })),
          ).map((x) => [x.id, x.pendiente]),
        );
        return {
          id: v.m.id,
          orden: v.m.orden,
          descripcion: v.m.concepto,
          importe: dinero(v.m.importe.toString()),
          fechaVencimiento: aYmd(v.m.fechaVencimiento),
          porCertificacion: v.m.porCertificacion,
          cobrado: dinero(v.imputado),
          pendiente: dinero(v.total),
          exigible: dinero(v.exigible),
          certificado: dinero(v.certificado),
          aCertificar: dinero(v.aCertificar),
          vencido: v.exigible.gt(0) && !v.m.porCertificacion && v.m.fechaVencimiento !== null && v.m.fechaVencimiento < hoy,
          editable: v.imputado.lte(0) && v.m.certificaciones.length === 0,
          certificaciones: v.m.certificaciones.map((c) => ({
            id: c.id,
            fecha: aYmd(c.fecha),
            descripcion: c.descripcion,
            importe: dinero(c.importe.toString()),
            fechaVencimiento: aYmd(c.fechaVencimiento),
            pendiente: dinero(porCert.get(c.id) ?? 0),
            vencido: (porCert.get(c.id) ?? cero()).gt(0) && c.fechaVencimiento !== null && c.fechaVencimiento < hoy,
          })),
        };
      });

    // Cargos que no son hitos: adicionales, IVA de facturas, notas de débito (sin las anulaciones).
    const cargos = vistas
      .filter((v) => v.m.origen !== 'ACUERDO' && v.m.origen !== 'ANULACION')
      .map((v) => ({
        id: v.m.id,
        origen: v.m.origen,
        concepto: v.m.concepto,
        numero: v.m.numero,
        comprobanteId: v.m.comprobanteId,
        fecha: aYmd(v.m.fecha),
        fechaVencimiento: aYmd(v.m.fechaVencimiento),
        importe: dinero(v.m.importe.toString()),
        pendiente: dinero(v.total),
        observaciones: v.m.observaciones,
        vencido: v.total.gt(0) && v.m.fechaVencimiento !== null && v.m.fechaVencimiento < hoy,
      }));

    const entregas = habers
      .filter((m) => m.origen !== 'COMPROBANTE')
      .map((m) => ({
        id: m.id,
        origen: m.origen,
        reciboId: m.reciboId,
        concepto: m.concepto,
        numero: m.numero,
        fecha: aYmd(m.fecha),
        importe: dinero(m.importe.toString()),
        monedaOrigen: m.monedaOrigen,
        importeOrigen: m.importeOrigen ? dinero(m.importeOrigen.toString()) : null,
        tipoCambio: m.tipoCambio?.toString() ?? null,
        observaciones: m.observaciones,
        anulado: anulados.has(m.id),
        aCuenta: dinero(Decimal.max(new Decimal(m.importe.toString()).minus(suma(m.imputacionesComoHaber)), 0)),
      }));
    const notasCredito = habers
      .filter((m) => m.origen === 'COMPROBANTE')
      .map((m) => ({ id: m.id, concepto: m.concepto, numero: m.numero, comprobanteId: m.comprobanteId, fecha: aYmd(m.fecha), importe: dinero(m.importe.toString()) }));
    const totalEntregado = entregas.filter((e) => !e.anulado).reduce((acc, e) => acc.plus(e.importe), cero());
    const adicionales = cargos.reduce((acc, c) => acc.plus(c.importe), cero());

    return {
      saldos: {
        montoAcordado: p.montoAcordado ? dinero(p.montoAcordado.toString()) : null,
        adicionales: dinero(adicionales),
        totalEntregado: dinero(totalEntregado),
        saldo: dinero(s.saldo),
        saldoExigible: dinero(s.saldoExigible),
        aCertificar: dinero(s.aCertificar),
        vencido: dinero(
          hitos
            .flatMap((h) => (h.porCertificacion ? h.certificaciones.filter((c) => c.vencido).map((c) => c.pendiente) : h.vencido ? [h.exigible] : []))
            .concat(cargos.filter((c) => c.vencido).map((c) => c.pendiente))
            .reduce((acc, x) => acc.plus(x), cero()),
        ),
      },
      hitos,
      cargos,
      entregas,
      notasCredito,
    };
  }

  async listar(tenantId: string, q: ListarProyectosQuery) {
    await this.cc.sincronizar(tenantId);
    const proyectos = await this.prisma.proyecto.findMany({
      where: {
        tenantId,
        ...(q.clienteId ? { clienteId: q.clienteId } : {}),
        ...(q.estado ? { estado: q.estado } : {}),
        ...(q.q?.trim()
          ? {
              OR: [
                { nombre: { contains: q.q.trim(), mode: 'insensitive' } },
                { ubicacion: { contains: q.q.trim(), mode: 'insensitive' } },
                { cliente: { razonSocial: { contains: q.q.trim(), mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: { cliente: { select: { id: true, razonSocial: true } } },
      orderBy: [{ estado: 'asc' }, { updatedAt: 'desc' }],
    });
    const movs = await this.movimientos(tenantId, proyectos.map((p) => p.id));
    return proyectos.map((p) => ({
      ...this.vistaProyecto(p),
      cliente: p.cliente,
      saldos: this.calcular(p, movs.filter((m) => m.proyectoId === p.id)).saldos,
    }));
  }

  private vistaProyecto(p: Proyecto) {
    return {
      id: p.id,
      clienteId: p.clienteId,
      nombre: p.nombre,
      ubicacion: p.ubicacion,
      estado: p.estado,
      moneda: p.moneda,
      montoAcordado: p.montoAcordado ? dinero(p.montoAcordado.toString()) : null,
      modoIva: p.modoIva,
      tipoCambioFijo: p.tipoCambioFijo?.toString() ?? null,
      fechaInicio: aYmd(p.fechaInicio),
      fechaFin: aYmd(p.fechaFin),
      observaciones: p.observaciones,
      createdAt: p.createdAt,
    };
  }

  /** Todo el proyecto: plan con certificaciones, cargos, entregas, saldos y recibos. */
  async obtener(tenantId: string, id: string) {
    const p = await this.buscar(tenantId, id);
    await this.cc.sincronizar(tenantId);
    const [cliente, movs, recibos] = await Promise.all([
      this.clientes.obtener(tenantId, p.clienteId),
      this.movimientos(tenantId, [p.id]),
      this.recibos.listarDeProyecto(tenantId, p.id),
    ]);
    return {
      ...this.vistaProyecto(p),
      cliente: { id: cliente.id, razonSocial: cliente.razonSocial, tipoDocumento: cliente.tipoDocumento, numeroDocumento: cliente.numeroDocumento },
      ...this.calcular(p, movs),
      recibos: recibos.map((r) => ({ ...r, fecha: aYmd(r.fecha), total: dinero(r.total.toString()), anulado: Boolean(r.anuladoEn) })),
    };
  }

  // ───────────────────────────── Escritura ─────────────────────────────

  private conflictoNombre<T>(fn: () => Promise<T>): Promise<T> {
    return fn().catch((err: unknown) => {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Ese cliente ya tiene un proyecto con ese nombre.');
      }
      throw err;
    });
  }

  async crear(auth: AuthContext, dto: CrearProyectoDto) {
    const tenantId = auth.tenantId;
    if (!(await this.clientes.existentes(tenantId, [dto.clienteId])).has(dto.clienteId)) throw new BadRequestException('El cliente no existe.');
    const montoAcordado = dto.montoAcordado ?? null;
    const hitos = dto.hitos ?? [];
    const error = errorDePlan(montoAcordado, hitos);
    if (error) throw new BadRequestException(error);
    const id = await this.conflictoNombre(() =>
      this.prisma.$transaction(async (tx) => {
        await this.cc.bloquearEmpresa(tx, tenantId);
        const p = await tx.proyecto.create({
          data: {
            tenantId,
            clienteId: dto.clienteId,
            nombre: dto.nombre,
            ubicacion: dto.ubicacion || null,
            moneda: dto.moneda ?? 'ARS',
            modoIva: dto.modoIva ?? 'MAS_IVA',
            montoAcordado,
            tipoCambioFijo: dto.tipoCambioFijo ?? null,
            fechaInicio: dto.fechaInicio ? deYmd(dto.fechaInicio) : null,
            observaciones: dto.observaciones || null,
            creadoPorId: auth.usuarioId ?? null,
          },
        });
        await this.escribirPlan(tx, auth, p, montoAcordado, hitos);
        return p.id;
      }, TX),
    );
    return this.obtener(tenantId, id);
  }

  async actualizar(auth: AuthContext, id: string, dto: ActualizarProyectoDto) {
    const tenantId = auth.tenantId;
    const p = await this.buscar(tenantId, id);
    await this.conflictoNombre(() =>
      this.prisma.$transaction(async (tx) => {
        await this.cc.bloquearEmpresa(tx, tenantId);
        if (dto.moneda && dto.moneda !== p.moneda) {
          const usados = await tx.movimientoCuentaCorriente.count({ where: { tenantId, proyectoId: id } });
          if (usados) throw new BadRequestException('La moneda no se puede cambiar: el proyecto ya tiene movimientos.');
        }
        await tx.proyecto.update({
          where: { tenantId_id: { tenantId, id } },
          data: {
            nombre: dto.nombre,
            ubicacion: dto.ubicacion === undefined ? undefined : dto.ubicacion || null,
            estado: dto.estado,
            moneda: dto.moneda,
            modoIva: dto.modoIva,
            tipoCambioFijo: dto.tipoCambioFijo === undefined ? undefined : dto.tipoCambioFijo,
            fechaInicio: dto.fechaInicio === undefined ? undefined : dto.fechaInicio ? deYmd(dto.fechaInicio) : null,
            fechaFin: dto.fechaFin === undefined ? undefined : dto.fechaFin ? deYmd(dto.fechaFin) : null,
            observaciones: dto.observaciones === undefined ? undefined : dto.observaciones || null,
          },
        });
        // Cambiar el modo de IVA cambia cuánto suma cada factura: se desimputa y se vuelve a imputar.
        if (dto.modoIva && dto.modoIva !== p.modoIva) await this.cc.recalcularComprobantesDeProyecto(tx, tenantId, id);
      }, TX),
    );
    return this.obtener(tenantId, id);
  }

  /** Solo sin movimientos, comprobantes ni recibos: si no, se finaliza o se cancela. */
  async eliminar(tenantId: string, id: string) {
    await this.buscar(tenantId, id);
    try {
      await this.prisma.$transaction(async (tx) => {
        const hitosSinUso = await tx.movimientoCuentaCorriente.findMany({
          where: { tenantId, proyectoId: id },
          select: { id: true, origen: true, _count: { select: { imputacionesComoDebe: true, certificaciones: true } } },
        });
        if (hitosSinUso.some((m) => m.origen !== 'ACUERDO' || m._count.imputacionesComoDebe || m._count.certificaciones)) {
          throw new BadRequestException('El proyecto tiene movimientos: no se elimina, finalizalo o cancelalo.');
        }
        await tx.movimientoCuentaCorriente.deleteMany({ where: { tenantId, proyectoId: id, origen: 'ACUERDO' } });
        await tx.proyecto.delete({ where: { tenantId_id: { tenantId, id } } });
      }, TX);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new BadRequestException('El proyecto tiene comprobantes o recibos: no se elimina, finalizalo o cancelalo.');
      }
      throw err;
    }
    return { id };
  }

  /**
   * Reemplaza el monto acordado y su plan. Los hitos con cobros o certificaciones se conservan como
   * están (solo cambian descripción y vencimiento); el resto se crea, se edita o se borra. Si cambia
   * si hay acordado o no, se recalculan las facturas del proyecto.
   */
  async guardarPlan(auth: AuthContext, id: string, dto: PlanDto) {
    const p = await this.buscar(auth.tenantId, id);
    const error = errorDePlan(dto.montoAcordado, dto.hitos);
    if (error) throw new BadRequestException(error);
    await this.prisma.$transaction(async (tx) => {
      await this.cc.bloquearEmpresa(tx, auth.tenantId);
      await tx.proyecto.update({ where: { tenantId_id: { tenantId: auth.tenantId, id } }, data: { montoAcordado: dto.montoAcordado } });
      await this.escribirPlan(tx, auth, p, dto.montoAcordado, dto.hitos);
      if ((p.montoAcordado === null) !== (dto.montoAcordado === null)) await this.cc.recalcularComprobantesDeProyecto(tx, auth.tenantId, id);
    }, TX);
    return this.obtener(auth.tenantId, id);
  }

  private async escribirPlan(tx: Prisma.TransactionClient, auth: AuthContext, p: Proyecto, montoAcordado: string | null, pedidos: PlanDto['hitos']) {
    const tenantId = auth.tenantId;
    const hitos = planEfectivo(montoAcordado, pedidos) as PlanDto['hitos'];
    const actuales = await tx.movimientoCuentaCorriente.findMany({
      where: { tenantId, proyectoId: p.id, origen: 'ACUERDO' },
      select: { id: true, importe: true, porCertificacion: true, _count: { select: { imputacionesComoDebe: true, certificaciones: true } } },
    });
    const porId = new Map(actuales.map((h) => [h.id, h]));
    const usados = (h: (typeof actuales)[number]) => h._count.imputacionesComoDebe > 0 || h._count.certificaciones > 0;

    for (const h of hitos) if (h.id && !porId.has(h.id)) throw new BadRequestException('Uno de los hitos no es de este proyecto.');
    const conservados = new Set(hitos.map((h) => h.id).filter(Boolean));
    for (const h of actuales) {
      if (conservados.has(h.id)) continue;
      if (usados(h)) throw new BadRequestException('Un hito con cobros o certificaciones no se puede quitar: ajustá con un adicional.');
      await tx.movimientoCuentaCorriente.delete({ where: { tenantId_id: { tenantId, id: h.id } } });
    }
    let orden = 0;
    for (const h of hitos) {
      orden += 1;
      const vencimiento = h.fechaVencimiento ? deYmd(h.fechaVencimiento) : null;
      const actual = h.id ? porId.get(h.id) : undefined;
      if (actual) {
        if (usados(actual) && (!new Decimal(actual.importe.toString()).eq(h.importe) || actual.porCertificacion !== Boolean(h.porCertificacion))) {
          throw new BadRequestException(`El hito "${h.descripcion}" ya tiene cobros o certificaciones: no se puede cambiar su importe.`);
        }
        await tx.movimientoCuentaCorriente.update({
          where: { tenantId_id: { tenantId, id: actual.id } },
          data: { concepto: h.descripcion, importe: h.importe, porCertificacion: Boolean(h.porCertificacion), orden, fechaVencimiento: vencimiento },
        });
        continue;
      }
      await tx.movimientoCuentaCorriente.create({
        data: {
          tenantId,
          clienteId: p.clienteId,
          proyectoId: p.id,
          tipo: 'DEBE',
          origen: 'ACUERDO',
          concepto: h.descripcion,
          moneda: p.moneda,
          importe: h.importe,
          orden,
          porCertificacion: Boolean(h.porCertificacion),
          fecha: p.fechaInicio ?? hoyAr(),
          fechaVencimiento: vencimiento,
          creadoPorId: auth.usuarioId ?? null,
        },
      });
    }
    await this.cc.imputarProyecto(tx, tenantId, p.id);
  }

  private async hitoDe(tenantId: string, proyectoId: string, hitoId: string) {
    const h = await this.prisma.movimientoCuentaCorriente.findUnique({ where: { tenantId_id: { tenantId, id: hitoId } }, include: { certificaciones: true } });
    if (!h || h.proyectoId !== proyectoId || h.origen !== 'ACUERDO') throw new NotFoundException('No encontramos ese hito.');
    return h;
  }

  /** Certifica un avance de un hito por certificación: esa parte pasa a ser exigible. */
  async certificar(auth: AuthContext, proyectoId: string, hitoId: string, dto: CertificacionDto) {
    const tenantId = auth.tenantId;
    const h = await this.hitoDe(tenantId, proyectoId, hitoId);
    if (!h.porCertificacion) throw new BadRequestException('Ese hito no se cobra por certificación.');
    if (dto.fechaVencimiento && dto.fechaVencimiento < dto.fecha) throw new BadRequestException('El vencimiento no puede ser anterior a la fecha.');
    if (!new Decimal(dto.importe).gt(0)) throw new BadRequestException('El importe tiene que ser mayor a 0.');
    await this.prisma.$transaction(async (tx) => {
      await this.cc.bloquearEmpresa(tx, tenantId);
      const ya = await tx.certificacionHito.aggregate({ where: { tenantId, hitoId }, _sum: { importe: true } });
      const total = new Decimal(ya._sum.importe?.toString() ?? '0').plus(dto.importe);
      if (total.gt(h.importe.toString())) {
        const resta = new Decimal(h.importe.toString()).minus(ya._sum.importe?.toString() ?? '0');
        throw new BadRequestException(`Las certificaciones no pueden superar el hito: quedan ${dinero(resta)} por certificar. Si el trabajo creció, cargá un adicional.`);
      }
      await tx.certificacionHito.create({
        data: {
          tenantId,
          hitoId,
          fecha: deYmd(dto.fecha),
          descripcion: dto.descripcion,
          importe: dto.importe,
          fechaVencimiento: dto.fechaVencimiento ? deYmd(dto.fechaVencimiento) : null,
          creadoPorId: auth.usuarioId ?? null,
        },
      });
      // Lo que el cliente tenía a cuenta cubre la certificación nueva.
      await this.cc.imputarProyecto(tx, tenantId, proyectoId);
    }, TX);
    return this.obtener(tenantId, proyectoId);
  }

  /** Borra una certificación si lo que queda certificado sigue cubriendo lo ya cobrado del hito. */
  async eliminarCertificacion(auth: AuthContext, proyectoId: string, certificacionId: string) {
    const tenantId = auth.tenantId;
    const c = await this.prisma.certificacionHito.findUnique({ where: { tenantId_id: { tenantId, id: certificacionId } } });
    if (!c) throw new NotFoundException('No encontramos esa certificación.');
    await this.hitoDe(tenantId, proyectoId, c.hitoId);
    await this.prisma.$transaction(async (tx) => {
      await this.cc.bloquearEmpresa(tx, tenantId);
      const [certificado, imputado] = await Promise.all([
        tx.certificacionHito.aggregate({ where: { tenantId, hitoId: c.hitoId }, _sum: { importe: true } }),
        tx.imputacionCuentaCorriente.aggregate({ where: { tenantId, debeId: c.hitoId }, _sum: { importe: true } }),
      ]);
      const queda = new Decimal(certificado._sum.importe?.toString() ?? '0').minus(c.importe.toString());
      if (queda.lt(imputado._sum.importe?.toString() ?? '0')) {
        throw new BadRequestException('Esa certificación ya está cobrada: primero deshacé la imputación del pago.');
      }
      await tx.certificacionHito.delete({ where: { tenantId_id: { tenantId, id: certificacionId } } });
    }, TX);
    return this.obtener(tenantId, proyectoId);
  }

  /** Trabajo adicional: un cargo (DEBE) aparte del acordado, asociado al proyecto. */
  async agregarAdicional(auth: AuthContext, proyectoId: string, dto: AdicionalDto) {
    const p = await this.buscar(auth.tenantId, proyectoId);
    await this.cc.crearMovimiento(auth, {
      clienteId: p.clienteId,
      proyectoId,
      tipo: 'DEBE',
      concepto: dto.concepto,
      fecha: dto.fecha,
      fechaVencimiento: dto.fechaVencimiento ?? null,
      moneda: p.moneda,
      importe: dto.importe,
      observaciones: dto.observaciones,
    });
    return this.obtener(auth.tenantId, proyectoId);
  }

  /**
   * Entrega del cliente. Con recibo: se guarda el recibo de cobro (en la moneda en que pagó), la cuenta
   * lo imputa a las deudas del proyecto y el recibo guarda una copia del estado del proyecto. Sin
   * recibo: un pago manual con su fecha (por ejemplo, entregas de 2024 de una obra en curso).
   */
  async registrarEntrega(auth: AuthContext, proyectoId: string, dto: EntregaDto) {
    const tenantId = auth.tenantId;
    const p = await this.buscar(tenantId, proyectoId);
    if (p.estado === 'CANCELADO') throw new BadRequestException('El proyecto está cancelado.');
    if (!new Decimal(dto.importe).gt(0)) throw new BadRequestException('El importe tiene que ser mayor a 0.');
    const { etiquetaProyecto } = await this.tenants.obtenerPreferencias(tenantId);

    if (dto.conRecibo === false) {
      const mov = await this.cc.crearMovimiento(auth, {
        clienteId: p.clienteId,
        proyectoId,
        tipo: 'HABER',
        concepto: dto.concepto || 'Entrega sin recibo',
        fecha: dto.fecha,
        moneda: dto.moneda,
        importe: dto.importe,
        tipoCambio: dto.tipoCambio,
        observaciones: [dto.medioPago, dto.observaciones].filter(Boolean).join(' · ') || undefined,
      });
      return { movimientoId: mov.id, reciboId: null };
    }

    let conversion: { monedaImputacion: Moneda; importeImputacion: string; tipoCambio: string } | undefined;
    if (dto.moneda !== p.moneda) {
      const tc = await this.cc.tipoCambioPara(tenantId, dto.tipoCambio, p.tipoCambioFijo);
      conversion = {
        monedaImputacion: p.moneda,
        importeImputacion: this.cc.convertirPago(dto.importe, dto.moneda, p.moneda, tc.valor).toFixed(2),
        tipoCambio: tc.valor.toString(),
      };
    }
    const cliente = await this.clientes.obtener(tenantId, p.clienteId);
    const documento =
      cliente.tipoDocumento === 'CONSUMIDOR_FINAL'
        ? undefined
        : `${cliente.tipoDocumento} ${cliente.tipoDocumento === 'CUIT' || cliente.tipoDocumento === 'CUIL' ? formatearCuit(cliente.numeroDocumento) : cliente.numeroDocumento}`;
    const numero = dto.numero || (await this.recibos.siguienteNumero(tenantId, 'COBRO')).numero || undefined;
    const recibo = await this.recibos.crear(
      auth,
      {
        tipo: 'COBRO',
        numero,
        fecha: dto.fecha,
        moneda: dto.moneda,
        clienteId: cliente.id,
        contraparte: { nombre: cliente.razonSocial, documento, domicilio: cliente.domicilio ?? undefined },
        items: [{ descripcion: dto.concepto || `Entrega a cuenta de ${etiquetaProyecto.toLowerCase()} ${p.nombre}`, importe: dto.importe }],
        total: dto.importe,
        medioPago: dto.medioPago,
        observaciones: dto.observaciones,
      },
      { proyectoId, ...conversion },
    );
    // La sincronización registra el cobro y lo imputa; después se copia el estado con ese cobro aplicado.
    await this.cc.sincronizar(tenantId);
    await this.recibos.guardarEstadoProyecto(tenantId, recibo.id, await this.estadoParaRecibo(tenantId, proyectoId, recibo.id));
    return { movimientoId: null, reciboId: recibo.id };
  }

  /** Copia del estado del proyecto para el PDF de un recibo (acordado, entregas, saldo y lo que falta). */
  async estadoParaRecibo(tenantId: string, proyectoId: string, reciboId: string | null): Promise<EstadoProyectoRecibo> {
    const p = await this.buscar(tenantId, proyectoId);
    const [{ etiquetaProyecto }, movs] = await Promise.all([this.tenants.obtenerPreferencias(tenantId), this.movimientos(tenantId, [p.id])]);
    const c = this.calcular(p, movs);
    const pendientes: EstadoProyectoRecibo['pendientes'] = [];
    for (const h of c.hitos) {
      if (Number(h.pendiente) <= 0) continue;
      if (!h.porCertificacion) {
        pendientes.push({ descripcion: h.descripcion, importe: h.pendiente, vencimiento: h.fechaVencimiento });
        continue;
      }
      for (const cert of h.certificaciones.filter((x) => Number(x.pendiente) > 0)) {
        pendientes.push({ descripcion: `${h.descripcion}: ${cert.descripcion}`, importe: cert.pendiente, vencimiento: cert.fechaVencimiento });
      }
      if (Number(h.aCertificar) > 0) pendientes.push({ descripcion: h.descripcion, importe: h.aCertificar, vencimiento: null, aCertificar: true });
    }
    for (const x of c.cargos.filter((y) => Number(y.pendiente) > 0)) {
      pendientes.push({ descripcion: x.numero ? `${x.concepto} ${x.numero}` : x.concepto, importe: x.pendiente, vencimiento: x.fechaVencimiento });
    }
    return {
      etiqueta: etiquetaProyecto,
      nombre: p.nombre,
      ubicacion: p.ubicacion,
      moneda: p.moneda,
      montoAcordado: c.saldos.montoAcordado,
      modoIva: p.modoIva,
      adicionales: c.saldos.adicionales,
      entregas: c.entregas
        .filter((e) => !e.anulado)
        .map((e) => ({
          fecha: e.fecha!,
          descripcion: e.origen === 'RECIBO' ? `Recibo${e.numero ? ` N° ${e.numero}` : ''}` : e.concepto,
          importe: e.importe,
          esEsta: reciboId !== null && e.reciboId === reciboId,
        })),
      totalEntregado: c.saldos.totalEntregado,
      saldo: c.saldos.saldo,
      saldoExigible: c.saldos.saldoExigible,
      pendientes,
      calculadoEn: new Date().toISOString(),
    };
  }

  /** Tipo de cambio sugerido para una entrega: el fijo del proyecto o la cotización de ARCA del día. */
  async cotizacion(tenantId: string, proyectoId?: string) {
    const fijo = proyectoId ? (await this.buscar(tenantId, proyectoId)).tipoCambioFijo : null;
    const tc = await this.cc.tipoCambioPara(tenantId, null, fijo);
    return { tipoCambio: tc.valor.toString(), fuente: tc.fuente };
  }
}
