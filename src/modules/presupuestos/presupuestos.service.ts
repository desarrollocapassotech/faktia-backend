import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, type EstadoPresupuesto, type Presupuesto, type PresupuestoItem } from '@prisma/client';
import type { AuthContext } from '../auth';
import { ClientesService } from '../clientes';
import { ProyectosService } from '../cuenta-corriente';
import { TenantsService } from '../tenants';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { formatearCuit } from '../../shared/util/cuit';
import { ITEMS_INICIALES, OBSERVACIONES_INICIALES } from './biblioteca-inicial';
import { sanearFormato, textoPlano } from './domain/formato';
import {
  acordadoDesdePresupuesto,
  calcularTotales,
  estadoVigente,
  numeroPresupuesto,
  PresupuestoInvalidoError,
  puedePasar,
  vencimientoPorValidez,
  type Superficie,
} from './domain/presupuesto';
import type {
  CrearProyectoDesdePresupuestoDto,
  GuardarPresupuestoDto,
  ItemBibliotecaDto,
  ListarPresupuestosQuery,
  ObservacionCatalogoDto,
} from './dto/presupuestos.dto';
import { generarPdfPresupuesto } from './pdf-presupuesto';

const ZONA = 'America/Argentina/Buenos_Aires';
const deYmd = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const aYmd = (d: Date) => d.toISOString().slice(0, 10);
const hoyAr = () => deYmd(new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date()));
const TX = { timeout: 20_000, maxWait: 10_000 } as const;

/** Copia de los datos del cliente que van en el presupuesto. */
export interface ClienteSnapshot {
  razonSocial: string;
  documento: string | null;
  domicilio: string | null;
  condicionIva: string;
}

/** Copia de los datos de la empresa que van en el encabezado. */
export interface EmisorSnapshot {
  nombre: string;
  cuit: string | null;
  domicilio: string | null;
  telefono: string | null;
  email: string | null;
  ingresosBrutos: string | null;
  inicioActividades: string | null;
  condicionIva: string | null;
}

type PresupuestoConItems = Presupuesto & { items: PresupuestoItem[] };

/**
 * Presupuestos: numeración automática por empresa (P-0000001), biblioteca de ítems y catálogo de
 * observaciones, tres formas de cotizar, IVA configurable, vencimiento automático, duplicar, estados,
 * PDF y crear el proyecto desde un presupuesto aceptado. No es comprobante fiscal: no va a ARCA ni
 * genera deuda.
 */
@Injectable()
export class PresupuestosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientes: ClientesService,
    private readonly tenants: TenantsService,
    private readonly proyectos: ProyectosService,
  ) {}

  // ───────────────────────────── Lectura ─────────────────────────────

  /** Pasa a vencido lo que llegó a su fecha sin aceptarse ni rechazarse. */
  private async vencer(tenantId?: string) {
    await this.prisma.presupuesto.updateMany({
      where: { ...(tenantId ? { tenantId } : {}), estado: { in: ['BORRADOR', 'ENVIADO'] }, fechaVencimiento: { lt: hoyAr() } },
      data: { estado: 'VENCIDO' },
    });
  }

  /** Todos los días a la medianoche (además de al consultar). */
  @Cron('5 0 * * *', { name: 'presupuestos-vencidos', timeZone: ZONA })
  async vencerTodos() {
    await this.vencer();
  }

  async listar(tenantId: string, q: ListarPresupuestosQuery) {
    await this.vencer(tenantId);
    const texto = q.q?.trim();
    const numero = texto && /^(p-?)?\d+$/i.test(texto) ? Number(texto.replace(/\D/g, '')) : null;
    const filas = await this.prisma.presupuesto.findMany({
      where: {
        tenantId,
        ...(q.estado ? { estado: q.estado } : {}),
        ...(q.clienteId ? { clienteId: q.clienteId } : {}),
        ...(texto
          ? {
              OR: [
                ...(numero ? [{ numero }] : []),
                { titulo: { contains: texto, mode: 'insensitive' as const } },
                { lugar: { contains: texto, mode: 'insensitive' as const } },
                { cliente: { razonSocial: { contains: texto, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      include: { cliente: { select: { id: true, razonSocial: true } } },
      orderBy: { numero: 'desc' },
      take: 300,
    });
    return filas.map((p) => ({
      id: p.id,
      numero: numeroPresupuesto(p.numero),
      fecha: aYmd(p.fecha),
      fechaVencimiento: aYmd(p.fechaVencimiento),
      estado: p.estado,
      titulo: p.titulo,
      lugar: p.lugar,
      moneda: p.moneda,
      total: p.total.toFixed(2),
      cliente: p.cliente,
      proyectoId: p.proyectoId,
    }));
  }

  private async buscar(tenantId: string, id: string): Promise<PresupuestoConItems> {
    const p = await this.prisma.presupuesto.findUnique({ where: { tenantId_id: { tenantId, id } }, include: { items: { orderBy: { orden: 'asc' } } } });
    if (!p) throw new NotFoundException('No encontramos ese presupuesto.');
    const vigente = estadoVigente(p.estado, p.fechaVencimiento, hoyAr());
    if (vigente !== p.estado) {
      await this.prisma.presupuesto.update({ where: { tenantId_id: { tenantId, id } }, data: { estado: vigente } });
      p.estado = vigente;
    }
    return p;
  }

  private vista(p: PresupuestoConItems & { cliente?: { id: string; razonSocial: string } }) {
    return {
      id: p.id,
      numero: numeroPresupuesto(p.numero),
      fecha: aYmd(p.fecha),
      fechaVencimiento: aYmd(p.fechaVencimiento),
      estado: p.estado,
      clienteId: p.clienteId,
      titulo: p.titulo,
      lugar: p.lugar,
      moneda: p.moneda,
      formaCotizar: p.formaCotizar,
      superficie: p.superficie as Superficie | null,
      importeGlobal: p.importeGlobal?.toFixed(2) ?? null,
      ivaModo: p.ivaModo,
      alicuotaIva: p.alicuotaIva.toString(),
      subtotal: p.subtotal.toFixed(2),
      iva: p.iva.toFixed(2),
      total: p.total.toFixed(2),
      observaciones: p.observaciones as Array<{ texto: string; valor?: string }>,
      notas: p.notas,
      cliente: p.clienteSnapshot as unknown as ClienteSnapshot,
      emisor: p.emisorSnapshot as unknown as EmisorSnapshot,
      proyectoId: p.proyectoId,
      duplicadoDeId: p.duplicadoDeId,
      editable: p.estado === 'BORRADOR',
      items: p.items.map((i) => ({ id: i.id, orden: i.orden, cantidad: i.cantidad, descripcion: i.descripcion, importe: i.importe?.toFixed(2) ?? null })),
      createdAt: p.createdAt,
    };
  }

  async obtener(tenantId: string, id: string) {
    return this.vista(await this.buscar(tenantId, id));
  }

  // ───────────────────────────── Escritura ─────────────────────────────

  private async snapshots(tenantId: string, clienteId: string): Promise<{ cliente: ClienteSnapshot; emisor: EmisorSnapshot }> {
    const [c, e] = await Promise.all([this.clientes.obtener(tenantId, clienteId), this.tenants.obtenerEmisor(tenantId)]);
    return {
      cliente: {
        razonSocial: c.razonSocial,
        documento:
          c.tipoDocumento === 'CONSUMIDOR_FINAL'
            ? null
            : `${c.tipoDocumento} ${c.tipoDocumento === 'CUIT' || c.tipoDocumento === 'CUIL' ? formatearCuit(c.numeroDocumento) : c.numeroDocumento}`,
        domicilio: c.domicilio,
        condicionIva: c.condicionIva,
      },
      emisor: {
        nombre: e.razonSocial ?? e.nombreFantasia,
        cuit: e.cuit,
        domicilio: e.domicilioFiscal,
        telefono: e.telefono,
        email: e.emailContacto,
        ingresosBrutos: e.ingresosBrutos,
        inicioActividades: e.inicioActividades ? aYmd(e.inicioActividades) : null,
        condicionIva: e.condicionIva,
      },
    };
  }

  /** Valida, sanea el formato y calcula los totales. */
  private async datos(tenantId: string, dto: GuardarPresupuestoDto) {
    const { diasValidezPresupuesto } = await this.tenants.obtenerPreferencias(tenantId);
    const fechaVencimiento = dto.fechaVencimiento ?? vencimientoPorValidez(dto.fecha, diasValidezPresupuesto);
    if (fechaVencimiento < dto.fecha) throw new BadRequestException('El vencimiento no puede ser anterior a la fecha.');
    const items = dto.items
      .map((i, n) => ({
        orden: n + 1,
        cantidad: i.cantidad?.trim() || null,
        descripcion: sanearFormato(i.descripcion),
        importe: dto.formaCotizar === 'POR_ITEM' ? (i.importe ?? null) : null,
      }))
      .filter((i) => textoPlano(i.descripcion));
    const superficie = dto.formaCotizar === 'SUPERFICIE' ? (dto.superficie ?? null) : null;
    let totales;
    try {
      totales = calcularTotales({
        formaCotizar: dto.formaCotizar,
        items,
        importeGlobal: dto.importeGlobal,
        superficie,
        ivaModo: dto.ivaModo,
        alicuotaIva: dto.alicuotaIva ?? '21',
      });
    } catch (err) {
      if (err instanceof PresupuestoInvalidoError) throw new BadRequestException(err.message);
      throw err;
    }
    const notas = dto.notas && textoPlano(dto.notas) ? sanearFormato(dto.notas) : null;
    return {
      fecha: deYmd(dto.fecha),
      fechaVencimiento: deYmd(fechaVencimiento),
      clienteId: dto.clienteId,
      titulo: dto.titulo || null,
      lugar: dto.lugar || null,
      moneda: dto.moneda,
      formaCotizar: dto.formaCotizar,
      superficie: superficie ? ({ ...superficie } as Prisma.InputJsonValue) : Prisma.DbNull,
      importeGlobal: dto.formaCotizar === 'POR_ITEM' ? null : (dto.importeGlobal ?? null),
      ivaModo: dto.ivaModo,
      alicuotaIva: dto.alicuotaIva ?? '21',
      subtotal: totales.subtotal.toFixed(2),
      iva: totales.iva.toFixed(2),
      total: totales.total.toFixed(2),
      observaciones: (dto.observaciones ?? []).map((o) => ({ texto: o.texto, ...(o.valor ? { valor: o.valor } : {}) })),
      notas,
      items,
    };
  }

  /** Número siguiente de la empresa (el lock evita que dos altas simultáneas tomen el mismo). */
  private async siguienteNumero(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`presupuestos:${tenantId}`}))`;
    const ultimo = await tx.presupuesto.aggregate({ where: { tenantId }, _max: { numero: true } });
    return (ultimo._max.numero ?? 0) + 1;
  }

  async crear(auth: AuthContext, dto: GuardarPresupuestoDto, duplicadoDeId?: string) {
    const tenantId = auth.tenantId;
    const { items, ...datos } = await this.datos(tenantId, dto);
    const snap = await this.snapshots(tenantId, dto.clienteId);
    const id = await this.prisma.$transaction(async (tx) => {
      const numero = await this.siguienteNumero(tx, tenantId);
      const p = await tx.presupuesto.create({
        data: {
          tenantId,
          numero,
          ...datos,
          clienteSnapshot: { ...snap.cliente },
          emisorSnapshot: { ...snap.emisor },
          duplicadoDeId: duplicadoDeId ?? null,
          creadoPorId: auth.usuarioId ?? null,
          items: { create: items },
        },
      });
      return p.id;
    }, TX);
    return this.obtener(tenantId, id);
  }

  async actualizar(auth: AuthContext, id: string, dto: GuardarPresupuestoDto) {
    const tenantId = auth.tenantId;
    const actual = await this.buscar(tenantId, id);
    if (actual.estado !== 'BORRADOR') throw new ConflictException('Solo se edita un borrador. Para cambiarlo, duplicalo.');
    const { items, ...datos } = await this.datos(tenantId, dto);
    const snap = await this.snapshots(tenantId, dto.clienteId);
    await this.prisma.$transaction(async (tx) => {
      await tx.presupuestoItem.deleteMany({ where: { tenantId, presupuestoId: id } });
      await tx.presupuesto.update({
        where: { tenantId_id: { tenantId, id } },
        data: { ...datos, clienteSnapshot: { ...snap.cliente }, emisorSnapshot: { ...snap.emisor }, items: { create: items } },
      });
    }, TX);
    return this.obtener(tenantId, id);
  }

  async eliminar(tenantId: string, id: string) {
    const p = await this.buscar(tenantId, id);
    if (p.estado !== 'BORRADOR') throw new BadRequestException('Solo se elimina un borrador: los enviados quedan en el historial (se pueden rechazar).');
    await this.prisma.presupuesto.delete({ where: { tenantId_id: { tenantId, id } } });
    return { id };
  }

  async cambiarEstado(tenantId: string, id: string, estado: Exclude<EstadoPresupuesto, 'VENCIDO'>) {
    const p = await this.buscar(tenantId, id);
    if (p.estado === estado) return this.vista(p);
    if (!puedePasar(p.estado, estado)) throw new BadRequestException(`Un presupuesto ${p.estado.toLowerCase()} no puede pasar a ${estado.toLowerCase()}.`);
    if (estado === 'BORRADOR' && p.fechaVencimiento < hoyAr()) throw new BadRequestException('Está vencido: duplicalo con fecha nueva.');
    if (p.proyectoId && estado !== 'ACEPTADO') throw new BadRequestException('Ya tiene un proyecto creado: no cambia de estado.');
    await this.prisma.presupuesto.update({ where: { tenantId_id: { tenantId, id } }, data: { estado } });
    return this.obtener(tenantId, id);
  }

  /** Copia con número nuevo, fecha de hoy y vencimiento nuevo. Con `reemplaza`, el original queda rechazado. */
  async duplicar(auth: AuthContext, id: string, reemplaza = false) {
    const p = await this.buscar(auth.tenantId, id);
    const nuevo = await this.crear(
      auth,
      {
        clienteId: p.clienteId,
        fecha: aYmd(hoyAr()),
        titulo: p.titulo ?? undefined,
        lugar: p.lugar ?? undefined,
        moneda: p.moneda,
        formaCotizar: p.formaCotizar,
        superficie: (p.superficie as Superficie | null) ?? null,
        importeGlobal: p.importeGlobal?.toFixed(2) ?? null,
        ivaModo: p.ivaModo,
        alicuotaIva: p.alicuotaIva.toString(),
        items: p.items.map((i) => ({ cantidad: i.cantidad ?? undefined, descripcion: i.descripcion, importe: i.importe?.toFixed(2) ?? null })),
        observaciones: p.observaciones as Array<{ texto: string; valor?: string }>,
        notas: p.notas ?? undefined,
      },
      p.id,
    );
    if (reemplaza && p.estado !== 'RECHAZADO' && !p.proyectoId) {
      await this.prisma.presupuesto.update({ where: { tenantId_id: { tenantId: auth.tenantId, id } }, data: { estado: 'RECHAZADO' } });
    }
    return nuevo;
  }

  /**
   * Proyecto desde un presupuesto aceptado: cliente, nombre del trabajo, lugar, moneda y el total
   * como monto acordado (el neto si "no incluye IVA"). Los hitos vienen de la condición de pago.
   */
  async crearProyecto(auth: AuthContext, id: string, dto: CrearProyectoDesdePresupuestoDto) {
    const p = await this.buscar(auth.tenantId, id);
    if (p.estado !== 'ACEPTADO') throw new BadRequestException('Solo un presupuesto aceptado crea un proyecto.');
    if (p.proyectoId) throw new ConflictException('Este presupuesto ya tiene su proyecto.');
    const { montoAcordado, modoIva } = acordadoDesdePresupuesto({ ivaModo: p.ivaModo, subtotal: p.subtotal.toString(), total: p.total.toString() });
    const proyecto = await this.proyectos.crear(auth, {
      clienteId: p.clienteId,
      nombre: dto.nombre || p.titulo || p.lugar || `Presupuesto ${numeroPresupuesto(p.numero)}`,
      ubicacion: p.lugar ?? undefined,
      moneda: p.moneda,
      modoIva,
      montoAcordado,
      hitos: dto.hitos ?? [],
      observaciones: `Creado desde el presupuesto ${numeroPresupuesto(p.numero)}.`,
    });
    await this.prisma.presupuesto.update({ where: { tenantId_id: { tenantId: auth.tenantId, id } }, data: { proyectoId: proyecto.id } });
    return { proyectoId: proyecto.id };
  }

  async pdf(tenantId: string, id: string) {
    const p = await this.buscar(tenantId, id);
    const [plantilla, { etiquetaProyecto }] = await Promise.all([this.tenants.obtenerPlantilla(tenantId), this.tenants.obtenerPreferencias(tenantId)]);
    const pdf = await generarPdfPresupuesto(this.vista(p), { colorPrimario: plantilla.colorPrimario, logo: plantilla.logo, firmaTexto: plantilla.firmaTexto }, etiquetaProyecto);
    const cliente = (p.clienteSnapshot as unknown as ClienteSnapshot).razonSocial;
    const slug = cliente.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    return { pdf, filename: `Presupuesto_${numeroPresupuesto(p.numero)}_${slug || 'cliente'}.pdf` };
  }

  // ───────────────────────────── Biblioteca ─────────────────────────────

  private conflicto<T>(fn: () => Promise<T>, mensaje: string): Promise<T> {
    return fn().catch((err: unknown) => {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException(mensaje);
      throw err;
    });
  }

  listarItems(tenantId: string, incluirInactivos = false) {
    return this.prisma.itemBiblioteca.findMany({
      where: { tenantId, ...(incluirInactivos ? {} : { activo: true }) },
      orderBy: [{ categoria: 'asc' }, { titulo: 'asc' }],
    });
  }

  crearItem(tenantId: string, dto: ItemBibliotecaDto) {
    return this.conflicto(
      () => this.prisma.itemBiblioteca.create({ data: { tenantId, titulo: dto.titulo, descripcion: sanearFormato(dto.descripcion), categoria: dto.categoria || null, activo: dto.activo ?? true } }),
      'Ya hay un ítem con ese título.',
    );
  }

  async actualizarItem(tenantId: string, id: string, dto: Partial<ItemBibliotecaDto>) {
    const { count } = await this.conflicto(
      () =>
        this.prisma.itemBiblioteca.updateMany({
          where: { tenantId, id },
          data: {
            titulo: dto.titulo,
            descripcion: dto.descripcion === undefined ? undefined : sanearFormato(dto.descripcion),
            categoria: dto.categoria === undefined ? undefined : dto.categoria || null,
            activo: dto.activo,
          },
        }),
      'Ya hay un ítem con ese título.',
    );
    if (!count) throw new NotFoundException('No encontramos ese ítem.');
    return this.prisma.itemBiblioteca.findUniqueOrThrow({ where: { tenantId_id: { tenantId, id } } });
  }

  async eliminarItem(tenantId: string, id: string) {
    const { count } = await this.prisma.itemBiblioteca.deleteMany({ where: { tenantId, id } });
    if (!count) throw new NotFoundException('No encontramos ese ítem.');
    return { id };
  }

  listarObservaciones(tenantId: string, incluirInactivas = false) {
    return this.prisma.observacionCatalogo.findMany({
      where: { tenantId, ...(incluirInactivas ? {} : { activo: true }) },
      orderBy: [{ orden: 'asc' }, { createdAt: 'asc' }],
    });
  }

  crearObservacion(tenantId: string, dto: ObservacionCatalogoDto) {
    return this.conflicto(
      () =>
        this.prisma.observacionCatalogo.create({
          data: {
            tenantId,
            texto: dto.texto,
            llevaValor: dto.llevaValor ?? dto.texto.includes('{valor}'),
            valorSugerido: dto.valorSugerido || null,
            porDefecto: dto.porDefecto ?? false,
            orden: dto.orden ?? 0,
            activo: dto.activo ?? true,
          },
        }),
      'Ya hay una observación con ese texto.',
    );
  }

  async actualizarObservacion(tenantId: string, id: string, dto: Partial<ObservacionCatalogoDto>) {
    const { count } = await this.conflicto(
      () =>
        this.prisma.observacionCatalogo.updateMany({
          where: { tenantId, id },
          data: {
            texto: dto.texto,
            llevaValor: dto.llevaValor,
            valorSugerido: dto.valorSugerido === undefined ? undefined : dto.valorSugerido || null,
            porDefecto: dto.porDefecto,
            orden: dto.orden,
            activo: dto.activo,
          },
        }),
      'Ya hay una observación con ese texto.',
    );
    if (!count) throw new NotFoundException('No encontramos esa observación.');
    return this.prisma.observacionCatalogo.findUniqueOrThrow({ where: { tenantId_id: { tenantId, id } } });
  }

  async eliminarObservacion(tenantId: string, id: string) {
    const { count } = await this.prisma.observacionCatalogo.deleteMany({ where: { tenantId, id } });
    if (!count) throw new NotFoundException('No encontramos esa observación.');
    return { id };
  }

  /** Carga la biblioteca inicial de herrería sin pisar lo que ya exista (por título o texto). */
  async cargarBibliotecaInicial(tenantId: string) {
    const items = await this.prisma.itemBiblioteca.createMany({
      data: ITEMS_INICIALES.map((i) => ({ tenantId, ...i, descripcion: sanearFormato(i.descripcion) })),
      skipDuplicates: true,
    });
    const observaciones = await this.prisma.observacionCatalogo.createMany({
      data: OBSERVACIONES_INICIALES.map((o, n) => ({
        tenantId,
        texto: o.texto,
        llevaValor: o.llevaValor ?? false,
        valorSugerido: o.valorSugerido ?? null,
        porDefecto: o.porDefecto ?? false,
        orden: (n + 1) * 10,
      })),
      skipDuplicates: true,
    });
    return { items: items.count, observaciones: observaciones.count };
  }
}
