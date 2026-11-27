import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentAuth, type AuthContext } from '../auth';
import {
  ActualizarEmisorDto,
  ActualizarPlantillaPdfDto,
  ActualizarPreferenciasDto,
  ActualizarPuntoVentaDto,
  CargarCertificadoDto,
  CrearPuntoVentaDto,
} from './dto/tenants.dto';
import { PadronEmisorService } from './padron-emisor.service';
import { TenantsService } from './tenants.service';

@Controller('configuracion')
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly padron: PadronEmisorService,
    private readonly config: ConfigService,
  ) {}

  @Get('emisor')
  async emisor(@CurrentAuth() auth: AuthContext) {
    // padronDisponible: si al cargar el CUIT se puede validar y autocompletar con el padrón real de ARCA.
    return { ...(await this.tenants.obtenerEmisor(auth.tenantId)), padronDisponible: this.padron.disponible() };
  }

  @Patch('emisor')
  async actualizarEmisor(@CurrentAuth() auth: AuthContext, @Body() dto: ActualizarEmisorDto) {
    // El CUIT se carga una sola vez: en ese momento se valida en ARCA y razón social, condición IVA
    // y domicilio se toman del padrón (y quedan bloqueados).
    const deArca =
      dto.cuit !== undefined && !(await this.tenants.obtenerEmisor(auth.tenantId)).cuit
        ? await this.padron.datosParaAlta(auth.tenantId, dto.cuit)
        : undefined;
    return this.tenants.actualizarEmisor(auth.tenantId, dto, deArca);
  }

  /** Módulos habilitados y etiquetas (Proyecto / Obra…). */
  @Get('preferencias')
  preferencias(@CurrentAuth() auth: AuthContext) {
    return this.tenants.obtenerPreferencias(auth.tenantId);
  }

  @Patch('preferencias')
  actualizarPreferencias(@CurrentAuth() auth: AuthContext, @Body() dto: ActualizarPreferenciasDto) {
    return this.tenants.actualizarPreferencias(auth.tenantId, dto);
  }

  /** Empresa con CUIT ya guardado: bloquea lo que coincide con ARCA y sugiere el inicio de actividades. */
  @Post('emisor/sincronizar-arca')
  @HttpCode(200)
  sincronizarArca(@CurrentAuth() auth: AuthContext) {
    return this.padron.sincronizar(auth.tenantId);
  }

  /** Datos de la constancia de inscripción, para autocompletar el emisor al cargar el CUIT. */
  @Get('emisor/padron/:cuit')
  padronEmisor(@CurrentAuth() auth: AuthContext, @Param('cuit') cuit: string) {
    return this.padron.consultar(auth.tenantId, cuit);
  }

  @Get('arca')
  estadoArca(@CurrentAuth() auth: AuthContext) {
    return this.tenants.estadoArca(auth.tenantId, Boolean(this.config.get('AFIP_SDK_API_KEY')));
  }

  @Get('puntos-venta')
  async puntosVenta(@CurrentAuth() auth: AuthContext) {
    // Igual que la API pública: en homologación siempre hay un punto de venta para probar.
    const emisor = await this.tenants.obtenerEmisor(auth.tenantId);
    await this.tenants.asegurarPuntoVentaHomologacion(auth.tenantId, emisor.ambienteArca);
    return this.tenants.listarPuntosVenta(auth.tenantId);
  }

  @Post('puntos-venta')
  crearPuntoVenta(@CurrentAuth() auth: AuthContext, @Body() dto: CrearPuntoVentaDto) {
    return this.tenants.crearPuntoVenta(auth.tenantId, dto);
  }

  @Patch('puntos-venta/:id')
  actualizarPuntoVenta(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: ActualizarPuntoVentaDto) {
    return this.tenants.actualizarPuntoVenta(auth.tenantId, id, dto);
  }

  @Get('certificados')
  certificados(@CurrentAuth() auth: AuthContext) {
    return this.tenants.listarCertificados(auth.tenantId);
  }

  @Post('certificados')
  cargarCertificado(@CurrentAuth() auth: AuthContext, @Body() dto: CargarCertificadoDto) {
    return this.tenants.cargarCertificado(auth.tenantId, auth.usuarioId, dto);
  }

  @Get('plantilla-pdf')
  plantilla(@CurrentAuth() auth: AuthContext) {
    return this.tenants.obtenerPlantillaPublica(auth.tenantId);
  }

  @Patch('plantilla-pdf')
  actualizarPlantilla(@CurrentAuth() auth: AuthContext, @Body() dto: ActualizarPlantillaPdfDto) {
    return this.tenants.actualizarPlantilla(auth.tenantId, dto);
  }

  @Put('plantilla-pdf/logo')
  @UseInterceptors(FileInterceptor('logo', { limits: { fileSize: 310 * 1024, files: 1 } }))
  subirLogo(@CurrentAuth() auth: AuthContext, @UploadedFile() archivo?: Express.Multer.File) {
    return this.tenants.guardarLogo(auth.tenantId, archivo?.buffer);
  }

  @Delete('plantilla-pdf/logo')
  borrarLogo(@CurrentAuth() auth: AuthContext) {
    return this.tenants.borrarLogo(auth.tenantId);
  }

  @Get('plantilla-pdf/logo')
  async logo(@CurrentAuth() auth: AuthContext, @Res() res: Response) {
    const p = await this.tenants.obtenerPlantilla(auth.tenantId);
    if (!p.logo || !p.logoMime) {
      res.status(404).json({ statusCode: 404, message: 'La empresa no tiene logo.' });
      return;
    }
    res.setHeader('Content-Type', p.logoMime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(p.logo);
  }
}
