import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AmbienteArca, CondicionIva, Prisma } from '@prisma/client';
import { cifrar, descifrar } from '../../shared/crypto/cifrado';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { esCuitValido, normalizarCuit } from '../../shared/util/cuit';
import { analizarCertificado, CertificadoInvalidoError, normalizarPem } from './certificado.util';
import {
  ActualizarEmisorDto,
  ActualizarPlantillaPdfDto,
  ActualizarPuntoVentaDto,
  CargarCertificadoDto,
  CrearPuntoVentaDto,
} from './dto/tenants.dto';

/** CUIT de prueba de AfipSDK: en homologación sin certificado propio se emite con este CUIT (como Vialto). */
export const CUIT_PRUEBA_AFIPSDK = '20409378472';

const LOGO_MAX_BYTES = 300 * 1024;

/** Datos del emisor tal como están: una empresa recién registrada todavía no tiene los fiscales. */
export interface EmisorDatos {
  id: string;
  slug: string;
  nombreFantasia: string;
  razonSocial: string | null;
  cuit: string | null;
  condicionIva: CondicionIva | null;
  domicilioFiscal: string | null;
  ingresosBrutos: string | null;
  inicioActividades: Date | null;
  ambienteArca: AmbienteArca;
  /** true cuando razón social, CUIT, condición IVA y domicilio están cargados (alcanza para facturar). */
  datosFiscalesCompletos: boolean;
}

/** Emisor con los datos fiscales obligatorios: lo que necesita todo lo que factura o arma documentos. */
export type EmisorCompleto = EmisorDatos & {
  razonSocial: string;
  cuit: string;
  condicionIva: CondicionIva;
  domicilioFiscal: string;
  datosFiscalesCompletos: true;
};

export const FALTAN_DATOS_FISCALES =
  'Antes de facturar completá los datos fiscales de tu empresa (razón social, CUIT, condición IVA y domicilio) en Configuración.';

function esCompleto(e: EmisorDatos): e is EmisorCompleto {
  return e.datosFiscalesCompletos;
}

export interface PlantillaPdfDatos {
  logo: Buffer | null;
  logoMime: string | null;
  colorPrimario: string;
  colorSecundario: string;
  textoPie: string | null;
  mostrarDuplicado: boolean;
}

function detectarMimeImagen(buf: Buffer): 'image/png' | 'image/jpeg' | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Emisor ───────────────────────────────────────────────────────────────

  async obtenerEmisor(tenantId: string): Promise<EmisorDatos> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException('Empresa no encontrada.');
    return {
      id: t.id,
      slug: t.slug,
      nombreFantasia: t.nombreFantasia,
      razonSocial: t.razonSocial,
      cuit: t.cuit,
      condicionIva: t.condicionIva,
      domicilioFiscal: t.domicilioFiscal,
      ingresosBrutos: t.ingresosBrutos,
      inicioActividades: t.inicioActividades,
      ambienteArca: t.ambienteArca,
      datosFiscalesCompletos: Boolean(t.razonSocial?.trim() && t.cuit && t.condicionIva && t.domicilioFiscal?.trim()),
    };
  }

  /** Para facturar, emitir o armar documentos: falla con un mensaje claro si faltan datos fiscales. */
  async obtenerEmisorCompleto(tenantId: string): Promise<EmisorCompleto> {
    const emisor = await this.obtenerEmisor(tenantId);
    if (!esCompleto(emisor)) throw new BadRequestException(FALTAN_DATOS_FISCALES);
    return emisor;
  }

  async actualizarEmisor(tenantId: string, dto: ActualizarEmisorDto): Promise<EmisorDatos> {
    let cuit: string | undefined;
    if (dto.cuit !== undefined) {
      cuit = normalizarCuit(dto.cuit);
      if (!esCuitValido(cuit)) throw new BadRequestException(`El CUIT ${dto.cuit} no es válido (revisá el dígito verificador).`);
      const actual = await this.obtenerEmisor(tenantId);
      // El CUIT se carga una sola vez: cambiarlo después dejaría comprobantes y certificados de otro CUIT.
      if (actual.cuit && actual.cuit !== cuit) {
        throw new BadRequestException('El CUIT de la empresa ya está cargado y no se puede cambiar. Escribinos si necesitás corregirlo.');
      }
      if (actual.cuit === cuit) cuit = undefined;
    }
    try {
      await this.actualizarDatosEmisor(tenantId, dto, cuit);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Ya hay otra empresa registrada con ese CUIT.');
      }
      throw err;
    }
    return this.obtenerEmisor(tenantId);
  }

  private async actualizarDatosEmisor(tenantId: string, dto: ActualizarEmisorDto, cuit: string | undefined) {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        cuit,
        nombreFantasia: dto.nombreFantasia?.trim(),
        razonSocial: dto.razonSocial?.trim(),
        condicionIva: dto.condicionIva,
        domicilioFiscal: dto.domicilioFiscal?.trim(),
        ingresosBrutos: dto.ingresosBrutos === undefined ? undefined : dto.ingresosBrutos?.trim() || null,
        inicioActividades:
          dto.inicioActividades === undefined
            ? undefined
            : dto.inicioActividades
              ? new Date(`${dto.inicioActividades}T00:00:00Z`)
              : null,
      },
    });
  }

  // ── Puntos de venta ──────────────────────────────────────────────────────

  listarPuntosVenta(tenantId: string) {
    return this.prisma.puntoVenta.findMany({
      where: { tenantId },
      orderBy: [{ ambiente: 'asc' }, { numero: 'asc' }],
    });
  }

  /**
   * En homologación, si no hay ningún punto de venta activo para ese ambiente, se crea el 1
   * (ARCA homologación acepta cualquier número): así se puede probar sin configurar nada.
   * En producción no se toca: el punto de venta tiene que estar dado de alta en ARCA.
   */
  async asegurarPuntoVentaHomologacion(tenantId: string, ambiente: 'HOMOLOGACION' | 'PRODUCCION') {
    if (ambiente !== 'HOMOLOGACION') return;
    const activos = await this.prisma.puntoVenta.count({ where: { tenantId, ambiente: 'HOMOLOGACION', activo: true } });
    if (activos) return;
    // upsert: si dos pedidos llegan juntos no choca con el unique (tenantId, ambiente, numero).
    // Si el 1 existe pero alguien lo desactivó, se respeta y no se crea otro.
    await this.prisma.puntoVenta.upsert({
      where: { tenantId_ambiente_numero: { tenantId, ambiente: 'HOMOLOGACION', numero: 1 } },
      create: { tenantId, ambiente: 'HOMOLOGACION', numero: 1, descripcion: 'Homologación (por defecto)' },
      update: {},
    });
  }

  async crearPuntoVenta(tenantId: string, dto: CrearPuntoVentaDto) {
    try {
      return await this.prisma.puntoVenta.create({
        data: { tenantId, numero: dto.numero, ambiente: dto.ambiente, descripcion: dto.descripcion?.trim() || null },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Ya existe el punto de venta ${dto.numero} en ${dto.ambiente === 'PRODUCCION' ? 'producción' : 'homologación'}.`);
      }
      throw err;
    }
  }

  async actualizarPuntoVenta(tenantId: string, id: string, dto: ActualizarPuntoVentaDto) {
    const { count } = await this.prisma.puntoVenta.updateMany({
      where: { tenantId, id },
      data: { descripcion: dto.descripcion?.trim(), activo: dto.activo },
    });
    if (!count) throw new NotFoundException('Punto de venta no encontrado.');
    return this.prisma.puntoVenta.findUniqueOrThrow({ where: { tenantId_id: { tenantId, id } } });
  }

  // ── Certificados ─────────────────────────────────────────────────────────

  /** Solo metadatos: el contenido nunca sale del servidor. */
  async listarCertificados(tenantId: string) {
    return this.prisma.certificadoArca.findMany({
      where: { tenantId, activo: true },
      select: { id: true, ambiente: true, alias: true, huellaSha256: true, venceEl: true, createdAt: true },
      orderBy: { ambiente: 'asc' },
    });
  }

  async cargarCertificado(tenantId: string, usuarioId: string | undefined, dto: CargarCertificadoDto) {
    const tenant = await this.obtenerEmisor(tenantId);
    if (!tenant.cuit) {
      throw new BadRequestException('Antes de cargar el certificado completá el CUIT de la empresa en Configuración.');
    }
    let info;
    try {
      info = analizarCertificado(dto.certificadoPem, dto.clavePrivadaPem);
    } catch (err) {
      if (err instanceof CertificadoInvalidoError) throw new BadRequestException(err.message);
      throw err;
    }
    if (info.cuitDelCertificado && info.cuitDelCertificado !== tenant.cuit) {
      throw new BadRequestException(
        `El certificado es del CUIT ${info.cuitDelCertificado} y la empresa tiene CUIT ${tenant.cuit}.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.certificadoArca.updateMany({
        where: { tenantId, ambiente: dto.ambiente, activo: true },
        data: { activo: false },
      });
      return tx.certificadoArca.create({
        data: {
          tenantId,
          ambiente: dto.ambiente,
          certCifrado: cifrar(normalizarPem(dto.certificadoPem)),
          claveCifrada: cifrar(normalizarPem(dto.clavePrivadaPem)),
          alias: info.alias,
          huellaSha256: info.huellaSha256,
          venceEl: info.venceEl,
          cargadoPorId: usuarioId ?? null,
        },
        select: { id: true, ambiente: true, alias: true, huellaSha256: true, venceEl: true, createdAt: true },
      });
    });
  }

  /** Para el módulo arca: credenciales descifradas del ambiente actual (solo en memoria). */
  /** Solo lo usa el pase a producción (módulo `produccion`), que valida antes todas las condiciones. */
  async cambiarAmbiente(tenantId: string, ambiente: AmbienteArca): Promise<EmisorDatos> {
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { ambienteArca: ambiente } });
    return this.obtenerEmisor(tenantId);
  }

  /** Metadatos del certificado activo de un ambiente (nunca el contenido). */
  certificadoVigente(tenantId: string, ambiente: AmbienteArca) {
    return this.prisma.certificadoArca.findFirst({
      where: { tenantId, ambiente, activo: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true, alias: true, huellaSha256: true, venceEl: true },
    });
  }

  async certificadoActivo(tenantId: string, ambiente: AmbienteArca): Promise<{ certPem: string; keyPem: string } | null> {
    const c = await this.prisma.certificadoArca.findFirst({
      where: { tenantId, ambiente, activo: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!c) return null;
    return { certPem: descifrar(c.certCifrado), keyPem: descifrar(c.claveCifrada) };
  }

  // ── Plantilla PDF ────────────────────────────────────────────────────────

  async obtenerPlantilla(tenantId: string): Promise<PlantillaPdfDatos> {
    const p = await this.prisma.plantillaPdf.findUnique({ where: { tenantId } });
    return {
      logo: p?.logo ? Buffer.from(p.logo) : null,
      logoMime: p?.logoMime ?? null,
      colorPrimario: p?.colorPrimario ?? '#111827',
      colorSecundario: p?.colorSecundario ?? '#6B7280',
      textoPie: p?.textoPie ?? null,
      mostrarDuplicado: p?.mostrarDuplicado ?? true,
    };
  }

  async obtenerPlantillaPublica(tenantId: string) {
    const { logo, ...resto } = await this.obtenerPlantilla(tenantId);
    return { ...resto, tieneLogo: Boolean(logo) };
  }

  async actualizarPlantilla(tenantId: string, dto: ActualizarPlantillaPdfDto) {
    const data = {
      colorPrimario: dto.colorPrimario,
      colorSecundario: dto.colorSecundario,
      textoPie: dto.textoPie === undefined ? undefined : dto.textoPie?.trim() || null,
      mostrarDuplicado: dto.mostrarDuplicado,
    };
    await this.prisma.plantillaPdf.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
    return this.obtenerPlantillaPublica(tenantId);
  }

  async guardarLogo(tenantId: string, archivo: Buffer | undefined) {
    if (!archivo?.length) throw new BadRequestException('Falta el archivo del logo.');
    if (archivo.length > LOGO_MAX_BYTES) throw new BadRequestException('El logo no puede pesar más de 300 KB.');
    const mime = detectarMimeImagen(archivo);
    if (!mime) throw new BadRequestException('El logo tiene que ser PNG o JPG.');
    const logo = Uint8Array.from(archivo);
    await this.prisma.plantillaPdf.upsert({
      where: { tenantId },
      create: { tenantId, logo, logoMime: mime },
      update: { logo, logoMime: mime },
    });
    return this.obtenerPlantillaPublica(tenantId);
  }

  async borrarLogo(tenantId: string) {
    await this.prisma.plantillaPdf.updateMany({ where: { tenantId }, data: { logo: null, logoMime: null } });
    return this.obtenerPlantillaPublica(tenantId);
  }

  // ── Estado de ARCA ───────────────────────────────────────────────────────

  async estadoArca(tenantId: string, afipSdkConfigurado: boolean) {
    const tenant = await this.obtenerEmisor(tenantId);
    const certs = await this.listarCertificados(tenantId);
    const cert = certs.find((c) => c.ambiente === tenant.ambienteArca) ?? null;
    const usaCuitPrueba = tenant.ambienteArca === 'HOMOLOGACION' && !cert;
    return {
      ambiente: tenant.ambienteArca,
      afipSdkConfigurado,
      certificado: cert,
      usaCuitPrueba,
      cuitEmision: usaCuitPrueba ? CUIT_PRUEBA_AFIPSDK : tenant.cuit,
    };
  }
}
