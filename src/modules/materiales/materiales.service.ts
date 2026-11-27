import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ListadoMateriales, type RenglonListado } from '@prisma/client';
import Decimal from 'decimal.js';
import type { AuthContext } from '../auth';
import { TenantsService } from '../tenants';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { esCuitValido, normalizarCuit } from '../../shared/util/cuit';
import { subtotalDe, totalesPorMoneda } from './domain/listado';
import type { ListadoDto, ListarListadosQuery, ListarQuery, MaterialDto, ProveedorDto } from './dto/materiales.dto';
import { generarPdfListado } from './pdf-listado';

const deYmd = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const aYmd = (d: Date) => d.toISOString().slice(0, 10);
const TX = { timeout: 20_000, maxWait: 10_000 } as const;
const dec = (v: Prisma.Decimal | null) => (v === null ? null : v.toFixed(2));

type ListadoCompleto = ListadoMateriales & {
  renglones: RenglonListado[];
  proyecto: { id: string; nombre: string } | null;
  presupuesto: { id: string; numero: number } | null;
  proveedor: { id: string; nombre: string; telefono: string | null; email: string | null } | null;
};

/**
 * Proveedores, catálogo de materiales (costo y venta, cada uno en pesos o dólares) y listados por
 * obra con copia de nombre, unidad y precios. No maneja stock ni calcula cantidades.
 */
@Injectable()
export class MaterialesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
  ) {}

  /** Traduce los errores de la base a mensajes para el usuario. */
  private async guardar<T>(fn: () => Promise<T>, repetido: string): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') throw new ConflictException(repetido);
        if (err.code === 'P2003') {
          const campo = String(err.meta?.field_name ?? '');
          if (campo.includes('proyecto')) throw new BadRequestException('La obra no existe.');
          if (campo.includes('presupuesto')) throw new BadRequestException('El presupuesto no existe.');
          if (campo.includes('proveedor')) throw new BadRequestException('El proveedor no existe.');
          if (campo.includes('material')) throw new BadRequestException('El material no existe.');
          throw new BadRequestException('Está en uso: desactivalo en lugar de borrarlo.');
        }
      }
      throw err;
    }
  }

  // ───────────────────────────── Proveedores ─────────────────────────────

  listarProveedores(tenantId: string, q: ListarQuery) {
    const texto = q.q?.trim();
    return this.prisma.proveedor.findMany({
      where: {
        tenantId,
        ...(q.inactivos === 'true' ? {} : { activo: true }),
        ...(texto ? { OR: [{ nombre: { contains: texto, mode: 'insensitive' } }, { contacto: { contains: texto, mode: 'insensitive' } }] } : {}),
      },
      orderBy: { nombre: 'asc' },
    });
  }

  private cuit(v: string | null | undefined): string | null | undefined {
    if (v === undefined || v === null) return v;
    const c = normalizarCuit(v);
    if (!esCuitValido(c)) throw new BadRequestException(`El CUIT ${v} no es válido (revisá el dígito verificador).`);
    return c;
  }

  crearProveedor(tenantId: string, dto: ProveedorDto) {
    const cuit = this.cuit(dto.cuit);
    return this.guardar(
      () =>
        this.prisma.proveedor.create({
          data: { tenantId, nombre: dto.nombre, cuit: cuit ?? null, contacto: dto.contacto ?? null, telefono: dto.telefono ?? null, email: dto.email ?? null, notas: dto.notas ?? null, activo: dto.activo ?? true },
        }),
      'Ya hay un proveedor con ese nombre.',
    );
  }

  async actualizarProveedor(tenantId: string, id: string, dto: Partial<ProveedorDto>) {
    const cuit = this.cuit(dto.cuit);
    const { count } = await this.guardar(
      () => this.prisma.proveedor.updateMany({ where: { tenantId, id }, data: { nombre: dto.nombre, cuit, contacto: dto.contacto, telefono: dto.telefono, email: dto.email, notas: dto.notas, activo: dto.activo } }),
      'Ya hay un proveedor con ese nombre.',
    );
    if (!count) throw new NotFoundException('No encontramos ese proveedor.');
    return this.prisma.proveedor.findUniqueOrThrow({ where: { tenantId_id: { tenantId, id } } });
  }

  /** Solo sin materiales ni listados: si no, se desactiva. */
  async eliminarProveedor(tenantId: string, id: string) {
    const p = await this.prisma.proveedor.findUnique({ where: { tenantId_id: { tenantId, id } }, include: { _count: { select: { materiales: true, listados: true } } } });
    if (!p) throw new NotFoundException('No encontramos ese proveedor.');
    if (p._count.materiales || p._count.listados) throw new BadRequestException('El proveedor tiene materiales o listados: desactivalo en lugar de borrarlo.');
    await this.prisma.proveedor.delete({ where: { tenantId_id: { tenantId, id } } });
    return { id };
  }

  // ───────────────────────────── Materiales ─────────────────────────────

  listarMateriales(tenantId: string, q: ListarQuery) {
    const texto = q.q?.trim();
    return this.prisma.material.findMany({
      where: {
        tenantId,
        ...(q.inactivos === 'true' ? {} : { activo: true }),
        ...(texto ? { OR: [{ nombre: { contains: texto, mode: 'insensitive' } }, { categoria: { contains: texto, mode: 'insensitive' } }] } : {}),
      },
      include: { proveedor: { select: { id: true, nombre: true } } },
      orderBy: [{ categoria: 'asc' }, { nombre: 'asc' }],
    });
  }

  crearMaterial(tenantId: string, dto: MaterialDto) {
    return this.guardar(
      () =>
        this.prisma.material.create({
          data: {
            tenantId,
            nombre: dto.nombre,
            unidad: dto.unidad,
            categoria: dto.categoria ?? null,
            precioCosto: dto.precioCosto ?? null,
            monedaCosto: dto.monedaCosto ?? 'ARS',
            precioVenta: dto.precioVenta ?? null,
            monedaVenta: dto.monedaVenta ?? 'ARS',
            proveedorId: dto.proveedorId || null,
            preciosActualizadosEn: dto.precioCosto || dto.precioVenta ? new Date() : null,
            activo: dto.activo ?? true,
          },
          include: { proveedor: { select: { id: true, nombre: true } } },
        }),
      'Ya hay un material con ese nombre.',
    );
  }

  /** Si cambia algún precio o moneda, se guarda la fecha de actualización. */
  async actualizarMaterial(tenantId: string, id: string, dto: Partial<MaterialDto>) {
    const actual = await this.prisma.material.findUnique({ where: { tenantId_id: { tenantId, id } } });
    if (!actual) throw new NotFoundException('No encontramos ese material.');
    const igual = (a: Prisma.Decimal | null, b: string | null | undefined) => b === undefined || (a === null ? b === null : b !== null && a.eq(b));
    const cambiaPrecio =
      !igual(actual.precioCosto, dto.precioCosto) ||
      !igual(actual.precioVenta, dto.precioVenta) ||
      (dto.monedaCosto !== undefined && dto.monedaCosto !== actual.monedaCosto) ||
      (dto.monedaVenta !== undefined && dto.monedaVenta !== actual.monedaVenta);
    return this.guardar(
      () =>
        this.prisma.material.update({
          where: { tenantId_id: { tenantId, id } },
          data: {
            nombre: dto.nombre,
            unidad: dto.unidad,
            categoria: dto.categoria,
            precioCosto: dto.precioCosto,
            monedaCosto: dto.monedaCosto,
            precioVenta: dto.precioVenta,
            monedaVenta: dto.monedaVenta,
            proveedorId: dto.proveedorId === undefined ? undefined : dto.proveedorId || null,
            activo: dto.activo,
            ...(cambiaPrecio ? { preciosActualizadosEn: new Date() } : {}),
          },
          include: { proveedor: { select: { id: true, nombre: true } } },
        }),
      'Ya hay un material con ese nombre.',
    );
  }

  /** Solo si no está en ningún listado: si no, se desactiva. */
  async eliminarMaterial(tenantId: string, id: string) {
    const m = await this.prisma.material.findUnique({ where: { tenantId_id: { tenantId, id } }, include: { _count: { select: { renglones: true } } } });
    if (!m) throw new NotFoundException('No encontramos ese material.');
    if (m._count.renglones) throw new BadRequestException('El material está en listados: desactivalo en lugar de borrarlo.');
    await this.prisma.material.delete({ where: { tenantId_id: { tenantId, id } } });
    return { id };
  }

  // ───────────────────────────── Listados ─────────────────────────────

  private incluir = {
    renglones: { orderBy: { orden: 'asc' as const } },
    proyecto: { select: { id: true, nombre: true } },
    presupuesto: { select: { id: true, numero: true } },
    proveedor: { select: { id: true, nombre: true, telefono: true, email: true } },
  };

  private vista(l: ListadoCompleto) {
    const renglones = l.renglones.map((r) => ({
      id: r.id,
      orden: r.orden,
      cantidad: r.cantidad.toString(),
      materialId: r.materialId,
      nombre: r.nombre,
      unidad: r.unidad,
      precioCosto: dec(r.precioCosto),
      monedaCosto: r.monedaCosto,
      precioVenta: dec(r.precioVenta),
      monedaVenta: r.monedaVenta,
      subtotal: subtotalDe(r, l.precios)?.importe.toFixed(2) ?? null,
    }));
    const t = totalesPorMoneda(l.renglones, l.precios);
    return {
      id: l.id,
      titulo: l.titulo,
      fecha: aYmd(l.fecha),
      proyecto: l.proyecto,
      presupuesto: l.presupuesto ? { id: l.presupuesto.id, numero: `P-${String(l.presupuesto.numero).padStart(7, '0')}` } : null,
      proveedor: l.proveedor,
      destino: l.destino,
      observaciones: l.observaciones,
      precios: l.precios,
      renglones,
      totales: t.totales.map((x) => ({ moneda: x.moneda, total: x.total.toFixed(2) })),
      renglonesSinPrecio: t.sinPrecio,
      updatedAt: l.updatedAt,
    };
  }

  private async buscar(tenantId: string, id: string): Promise<ListadoCompleto> {
    const l = await this.prisma.listadoMateriales.findUnique({ where: { tenantId_id: { tenantId, id } }, include: this.incluir });
    if (!l) throw new NotFoundException('No encontramos ese listado.');
    return l;
  }

  async listarListados(tenantId: string, q: ListarListadosQuery) {
    const texto = q.q?.trim();
    const filas = await this.prisma.listadoMateriales.findMany({
      where: {
        tenantId,
        ...(q.proyectoId ? { proyectoId: q.proyectoId } : {}),
        ...(texto ? { OR: [{ titulo: { contains: texto, mode: 'insensitive' } }, { destino: { contains: texto, mode: 'insensitive' } }] } : {}),
      },
      include: { ...this.incluir },
      orderBy: [{ fecha: 'desc' }, { createdAt: 'desc' }],
      take: 300,
    });
    return filas.map((l) => {
      const v = this.vista(l);
      return { id: v.id, titulo: v.titulo, fecha: v.fecha, proyecto: v.proyecto, proveedor: v.proveedor, precios: v.precios, renglones: v.renglones.length, totales: v.totales };
    });
  }

  async obtenerListado(tenantId: string, id: string) {
    return this.vista(await this.buscar(tenantId, id));
  }

  /**
   * Arma los renglones: los del catálogo copian nombre, unidad y precios del momento; los que ya
   * estaban en el listado (mismo renglón y material) conservan sus precios copiados.
   */
  private async renglones(tx: Prisma.TransactionClient, tenantId: string, dto: ListadoDto, anteriores: RenglonListado[]) {
    const ids = [...new Set(dto.renglones.map((r) => r.materialId).filter((x): x is string => Boolean(x)))];
    const materiales = ids.length ? await tx.material.findMany({ where: { tenantId, id: { in: ids } } }) : [];
    if (materiales.length !== ids.length) throw new BadRequestException('Uno de los materiales no existe.');
    const porId = new Map(materiales.map((m) => [m.id, m]));
    return dto.renglones.map((r, i) => {
      if (!new Decimal(r.cantidad).gt(0)) throw new BadRequestException(`Renglón ${i + 1}: la cantidad tiene que ser mayor a 0.`);
      const previo = r.renglonId ? anteriores.find((a) => a.id === r.renglonId && a.materialId === (r.materialId ?? null)) : undefined;
      const m = r.materialId ? porId.get(r.materialId)! : null;
      const nombre = r.nombre || m?.nombre;
      const unidad = r.unidad || m?.unidad;
      if (!nombre) throw new BadRequestException(`Renglón ${i + 1}: elegí un material o escribí qué es.`);
      if (!unidad) throw new BadRequestException(`Renglón ${i + 1}: falta la unidad.`);
      const precios = previo
        ? { precioCosto: previo.precioCosto, monedaCosto: previo.monedaCosto, precioVenta: previo.precioVenta, monedaVenta: previo.monedaVenta }
        : m
          ? { precioCosto: m.precioCosto, monedaCosto: m.precioCosto ? m.monedaCosto : null, precioVenta: m.precioVenta, monedaVenta: m.precioVenta ? m.monedaVenta : null }
          : { precioCosto: null, monedaCosto: null, precioVenta: null, monedaVenta: null };
      return { orden: i + 1, cantidad: r.cantidad, materialId: m?.id ?? null, nombre, unidad, ...precios };
    });
  }

  private datos(dto: ListadoDto) {
    return {
      titulo: dto.titulo,
      fecha: deYmd(dto.fecha),
      proyectoId: dto.proyectoId || null,
      presupuestoId: dto.presupuestoId || null,
      proveedorId: dto.proveedorId || null,
      destino: dto.destino ?? null,
      observaciones: dto.observaciones ?? null,
      precios: dto.precios,
    };
  }

  async crearListado(auth: AuthContext, dto: ListadoDto) {
    const tenantId = auth.tenantId;
    const id = await this.guardar(
      () =>
        this.prisma.$transaction(async (tx) => {
          const renglones = await this.renglones(tx, tenantId, dto, []);
          const l = await tx.listadoMateriales.create({ data: { tenantId, ...this.datos(dto), creadoPorId: auth.usuarioId ?? null, renglones: { create: renglones } } });
          return l.id;
        }, TX),
      'Ya existe.',
    );
    return this.obtenerListado(tenantId, id);
  }

  async actualizarListado(tenantId: string, id: string, dto: ListadoDto) {
    const actual = await this.buscar(tenantId, id);
    await this.guardar(
      () =>
        this.prisma.$transaction(async (tx) => {
          const renglones = await this.renglones(tx, tenantId, dto, actual.renglones);
          await tx.renglonListado.deleteMany({ where: { tenantId, listadoId: id } });
          await tx.listadoMateriales.update({ where: { tenantId_id: { tenantId, id } }, data: { ...this.datos(dto), renglones: { create: renglones } } });
        }, TX),
      'Ya existe.',
    );
    return this.obtenerListado(tenantId, id);
  }

  /** Vuelve a copiar los precios vigentes del catálogo en los renglones de materiales (a pedido). */
  async actualizarPrecios(tenantId: string, id: string) {
    const l = await this.buscar(tenantId, id);
    const ids = l.renglones.map((r) => r.materialId).filter((x): x is string => Boolean(x));
    const materiales = new Map((await this.prisma.material.findMany({ where: { tenantId, id: { in: ids } } })).map((m) => [m.id, m]));
    await this.prisma.$transaction(
      l.renglones
        .filter((r) => r.materialId && materiales.has(r.materialId))
        .map((r) => {
          const m = materiales.get(r.materialId!)!;
          return this.prisma.renglonListado.update({
            where: { id: r.id },
            data: { precioCosto: m.precioCosto, monedaCosto: m.precioCosto ? m.monedaCosto : null, precioVenta: m.precioVenta, monedaVenta: m.precioVenta ? m.monedaVenta : null },
          });
        }),
    );
    return this.obtenerListado(tenantId, id);
  }

  async duplicarListado(auth: AuthContext, id: string) {
    const l = await this.buscar(auth.tenantId, id);
    const nuevo = await this.prisma.listadoMateriales.create({
      data: {
        tenantId: auth.tenantId,
        titulo: `${l.titulo} (copia)`.slice(0, 200),
        fecha: deYmd(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())),
        proyectoId: l.proyectoId,
        presupuestoId: l.presupuestoId,
        proveedorId: l.proveedorId,
        destino: l.destino,
        observaciones: l.observaciones,
        precios: l.precios,
        creadoPorId: auth.usuarioId ?? null,
        renglones: {
          create: l.renglones.map((r) => ({
            orden: r.orden,
            cantidad: r.cantidad,
            materialId: r.materialId,
            nombre: r.nombre,
            unidad: r.unidad,
            precioCosto: r.precioCosto,
            monedaCosto: r.monedaCosto,
            precioVenta: r.precioVenta,
            monedaVenta: r.monedaVenta,
          })),
        },
      },
    });
    return this.obtenerListado(auth.tenantId, nuevo.id);
  }

  async eliminarListado(tenantId: string, id: string) {
    const { count } = await this.prisma.listadoMateriales.deleteMany({ where: { tenantId, id } });
    if (!count) throw new NotFoundException('No encontramos ese listado.');
    return { id };
  }

  async pdf(tenantId: string, id: string) {
    const l = await this.obtenerListado(tenantId, id);
    const [emisor, plantilla, { etiquetaProyecto }] = await Promise.all([
      this.tenants.obtenerEmisor(tenantId),
      this.tenants.obtenerPlantilla(tenantId),
      this.tenants.obtenerPreferencias(tenantId),
    ]);
    const pdf = await generarPdfListado(
      l,
      {
        nombre: emisor.razonSocial ?? emisor.nombreFantasia,
        lineas: [emisor.cuit ? `CUIT ${emisor.cuit.slice(0, 2)}-${emisor.cuit.slice(2, 10)}-${emisor.cuit.slice(10)}` : '', emisor.domicilioFiscal ?? '', emisor.telefono ? `Tel. ${emisor.telefono}` : '', emisor.emailContacto ?? ''].filter(Boolean),
      },
      { colorPrimario: plantilla.colorPrimario, logo: plantilla.logo, firmaTexto: plantilla.firmaTexto },
      etiquetaProyecto,
    );
    const slug = l.titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    return { pdf, filename: `Listado_${slug || 'materiales'}.pdf` };
  }
}
