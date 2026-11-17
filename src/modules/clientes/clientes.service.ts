import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Cliente, type OrigenItem, type TipoDocumento } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { esCuitValido, normalizarCuit } from '../../shared/util/cuit';
import { ARCA_GATEWAY, ArcaError, PadronService, type ArcaGateway } from '../arca';
import { CredencialesArcaProvider } from '../tenants';
import { normalizarDocumento } from './documento';
import { ActualizarClienteDto, CrearClienteDto, ListarClientesQuery } from './dto/clientes.dto';

@Injectable()
export class ClientesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credenciales: CredencialesArcaProvider,
    @Inject(ARCA_GATEWAY) private readonly arca: ArcaGateway,
    private readonly padron: PadronService,
  ) {}

  listar(tenantId: string, query: ListarClientesQuery) {
    const q = query.q?.trim();
    return this.prisma.cliente.findMany({
      where: {
        tenantId,
        ...(query.incluirInactivos ? {} : { activo: true }),
        ...(q
          ? {
              OR: [
                { razonSocial: { contains: q, mode: 'insensitive' } },
                { numeroDocumento: { contains: q.replace(/[-.\s]/g, '') } },
              ],
            }
          : {}),
      },
      orderBy: { razonSocial: 'asc' },
      take: 200,
    });
  }

  async obtener(tenantId: string, id: string): Promise<Cliente> {
    const c = await this.prisma.cliente.findUnique({ where: { tenantId_id: { tenantId, id } } });
    if (!c) throw new NotFoundException('Cliente no encontrado.');
    return c;
  }

  async crear(tenantId: string, dto: CrearClienteDto) {
    const doc = normalizarDocumento(dto.tipoDocumento, dto.numeroDocumento);
    if (!doc.ok) throw new BadRequestException(doc.error);
    return this.guardar(() =>
      this.prisma.cliente.create({
        data: {
          tenantId,
          razonSocial: dto.razonSocial,
          tipoDocumento: dto.tipoDocumento,
          numeroDocumento: doc.numero,
          condicionIva: dto.condicionIva,
          domicilio: dto.domicilio || null,
          email: dto.email || null,
          pais: dto.pais ?? 'AR',
          monedaPreferida: dto.monedaPreferida ?? 'ARS',
          diasVencimiento: dto.diasVencimiento ?? null,
        },
      }),
    );
  }

  async actualizar(tenantId: string, id: string, dto: ActualizarClienteDto) {
    const actual = await this.obtener(tenantId, id);
    const tipo = dto.tipoDocumento ?? actual.tipoDocumento;
    let numero: string | undefined;
    if (dto.tipoDocumento !== undefined || dto.numeroDocumento !== undefined) {
      const doc = normalizarDocumento(tipo, dto.numeroDocumento ?? actual.numeroDocumento);
      if (!doc.ok) throw new BadRequestException(doc.error);
      numero = doc.numero;
    }
    return this.guardar(() =>
      this.prisma.cliente.update({
        where: { tenantId_id: { tenantId, id } },
        data: {
          razonSocial: dto.razonSocial,
          tipoDocumento: dto.tipoDocumento,
          numeroDocumento: numero,
          condicionIva: dto.condicionIva,
          domicilio: dto.domicilio === undefined ? undefined : dto.domicilio || null,
          email: dto.email === undefined ? undefined : dto.email || null,
          pais: dto.pais,
          monedaPreferida: dto.monedaPreferida,
          diasVencimiento: dto.diasVencimiento,
          activo: dto.activo,
        },
      }),
    );
  }

  /**
   * Consulta la constancia de inscripción en ARCA. Con el padrón de plataforma configurado
   * (PADRON_*) usa datos reales para todas las empresas; si no, consulta con las credenciales de la
   * empresa (en homologación ese padrón es ficticio).
   */
  async consultarPadron(tenantId: string, cuitCrudo: string) {
    const cuit = normalizarCuit(cuitCrudo);
    if (!esCuitValido(cuit)) throw new BadRequestException('El CUIT no es válido.');
    if (this.padron.configurado()) {
      const datos = await this.padron.consultar(cuit, tenantId);
      if (!datos) throw new NotFoundException('ARCA no tiene datos para ese CUIT.');
      return {
        cuit: datos.cuit,
        razonSocial: datos.razonSocial,
        domicilio: datos.domicilio,
        condicionIva: datos.condicionIva,
        ambiente: 'PRODUCCION' as const,
      };
    }
    const cred = await this.credenciales.obtener(tenantId);
    try {
      const datos = await this.arca.consultarPadron(cred, cuit);
      if (!datos) throw new NotFoundException('ARCA no tiene datos para ese CUIT.');
      return {
        cuit: datos.cuit,
        razonSocial: datos.razonSocial,
        domicilio: datos.domicilio,
        condicionIva: datos.condicionIva,
        ambiente: cred.ambiente,
      };
    } catch (err) {
      if (err instanceof ArcaError) {
        throw new BadGatewayException({
          message: `No se pudo consultar el padrón de ARCA: ${err.message}`,
          detalle: err.detalle,
        });
      }
      throw err;
    }
  }

  // ── Resolución en lote (importaciones) ───────────────────────────────────

  /** Ids que existen en el tenant (y están activos si `soloActivos`). */
  async existentes(tenantId: string, ids: string[], soloActivos = false): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const filas = await this.prisma.cliente.findMany({
      where: { tenantId, id: { in: [...new Set(ids)] }, ...(soloActivos ? { activo: true } : {}) },
      select: { id: true },
    });
    return new Set(filas.map((f) => f.id));
  }

  /** referenciaExterna (del sistema de origen) → clienteId. */
  async porReferencias(tenantId: string, origen: OrigenItem, refs: string[]): Promise<Map<string, string>> {
    if (!refs.length) return new Map();
    const filas = await this.prisma.clienteReferenciaExterna.findMany({
      where: { tenantId, origen, referenciaExterna: { in: [...new Set(refs)] } },
      select: { referenciaExterna: true, clienteId: true },
    });
    return new Map(filas.map((f) => [f.referenciaExterna, f.clienteId]));
  }

  /**
   * `${tipo}:${numero}` → clienteId, con el número normalizado. Un CUIT también encuentra
   * al cliente cargado como CUIL con el mismo número (y al revés).
   */
  async porDocumentos(tenantId: string, docs: Array<{ tipo: TipoDocumento; numero: string }>): Promise<Map<string, string>> {
    const normalizados = docs
      .map((d) => ({ d, n: normalizarDocumento(d.tipo, d.numero) }))
      .filter((x): x is { d: { tipo: TipoDocumento; numero: string }; n: { ok: true; numero: string } } => x.n.ok && x.d.tipo !== 'CONSUMIDOR_FINAL');
    if (!normalizados.length) return new Map();
    const filas = await this.prisma.cliente.findMany({
      where: { tenantId, activo: true, numeroDocumento: { in: [...new Set(normalizados.map((x) => x.n.numero))] } },
      select: { id: true, tipoDocumento: true, numeroDocumento: true },
    });
    const clave = (tipo: TipoDocumento) => (tipo === 'CUIL' ? 'CUIT' : tipo);
    const mapa = new Map<string, string>();
    for (const { d, n } of normalizados) {
      const f = filas.find((x) => x.numeroDocumento === n.numero && clave(x.tipoDocumento) === clave(d.tipo));
      if (f) mapa.set(`${d.tipo}:${d.numero}`, f.id);
    }
    return mapa;
  }

  /** Recuerda que la referencia externa corresponde a este cliente (para próximas importaciones). */
  async vincularReferencia(tenantId: string, origen: OrigenItem, referenciaExterna: string, clienteId: string) {
    await this.prisma.clienteReferenciaExterna.upsert({
      where: { tenantId_origen_referenciaExterna: { tenantId, origen, referenciaExterna } },
      create: { tenantId, origen, referenciaExterna, clienteId },
      update: { clienteId },
    });
  }

  private async guardar<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Ya existe un cliente con ese documento.');
      }
      throw err;
    }
  }
}
