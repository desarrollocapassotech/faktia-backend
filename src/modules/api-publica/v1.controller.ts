import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UnprocessableEntityException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOkResponse, ApiOperation, ApiProduces, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { ApiKey, CurrentAuth, type AuthContext } from '../auth';
import { ActualizarClienteDto, ClientesService } from '../clientes';
import {
  ActualizarBorradorDto,
  ComprobantePdfService,
  ComprobantesService,
  CrearBorradorDto,
  CrearNotaDto,
  EmisionService,
} from '../comprobantes';
import { ImportacionesService, type ItemFacturableInput } from '../importaciones';
import { GenerarReciboDto, RecibosService } from '../recibos';
import { TenantsService } from '../tenants';
import {
  BorradoresGeneradosDto,
  CargarItemsDto,
  ClientePublicoDto,
  ComprobantePublicoDto,
  ClienteVinculadoDto,
  ComprobantesPaginadosDto,
  ConfiguracionPublicaDto,
  CrearClienteApiDto,
  EmitirApiDto,
  GenerarBorradoresApiDto,
  ItemPublicoDto,
  ListarComprobantesApiQuery,
  PadronDto,
  ResultadoCargaDto,
  VincularReferenciaDto,
} from './dto/api-publica.dto';
import { Idempotente, IdempotenciaInterceptor } from './idempotencia/idempotencia.interceptor';
import {
  clientePublico,
  comprobantePublico,
  configuracionPublica,
  importacionPublica,
  itemPublico,
  type ComprobanteInterno,
} from './representaciones';

const CLAVE_IDEMPOTENCIA = {
  name: 'Idempotency-Key',
  required: false,
  description: 'Opcional (obligatoria para emitir). 8 a 100 caracteres. Reintentar con la misma clave devuelve la misma respuesta durante 24 h.',
};

const USUARIO = {
  name: 'X-Usuario-Email',
  required: false,
  description: 'Opcional: email de la persona que hace la acción en tu sistema. Queda en la auditoría de Faktia.',
};

const comprobante = (c: unknown) => comprobantePublico(c as ComprobanteInterno);

/** API pública para sistemas integrados: todas las rutas exigen `X-Api-Key` con el scope indicado. */
@ApiTags('API pública')
@ApiSecurity('api-key')
@ApiHeader(USUARIO)
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 300, ttl: 60_000 } })
@UseInterceptors(IdempotenciaInterceptor)
@Controller('v1')
export class V1Controller {
  constructor(
    private readonly importaciones: ImportacionesService,
    private readonly comprobantes: ComprobantesService,
    private readonly emision: EmisionService,
    private readonly pdf: ComprobantePdfService,
    private readonly clientes: ClientesService,
    private readonly tenants: TenantsService,
    private readonly recibos: RecibosService,
  ) {}

  // ── Configuración (solo lectura) ─────────────────────────────────────────

  @ApiOperation({
    summary: 'Ver emisor y puntos de venta',
    description: 'Datos para armar comprobantes. La configuración se edita solo desde Faktia. Scope `comprobantes:read`.',
  })
  @ApiOkResponse({ type: ConfiguracionPublicaDto })
  @ApiKey('comprobantes:read')
  @Get('configuracion')
  async configuracion(@CurrentAuth() auth: AuthContext): Promise<ConfiguracionPublicaDto> {
    // Con datos fiscales incompletos responde 400: el contrato público siempre los trae.
    const emisor = await this.tenants.obtenerEmisorCompleto(auth.tenantId);
    await this.tenants.asegurarPuntoVentaHomologacion(auth.tenantId, emisor.ambienteArca);
    const puntosVenta = await this.tenants.listarPuntosVenta(auth.tenantId);
    return configuracionPublica({ emisor, puntosVenta });
  }

  // ── Ítems ────────────────────────────────────────────────────────────────

  @ApiOperation({
    summary: 'Cargar ítems a facturar',
    description:
      'Ingresa los ítems al staging (scope `items:write`). Es idempotente por `referenciaExterna`: reenviar un ítem igual no lo duplica y uno distinto lo actualiza (si todavía no se facturó). Cada ítem vuelve con su estado y sus errores.',
  })
  @ApiHeader(CLAVE_IDEMPOTENCIA)
  @ApiOkResponse({ type: ResultadoCargaDto })
  @ApiKey('items:write')
  @Idempotente()
  @Post('items')
  @HttpCode(200)
  async cargarItems(@CurrentAuth() auth: AuthContext, @Body() dto: CargarItemsDto): Promise<ResultadoCargaDto> {
    const imp = await this.importaciones.importarApi(auth, dto.items as ItemFacturableInput[], { descripcion: dto.descripcion, confirmar: dto.confirmar });
    const refs = dto.items.map((i) => i.referenciaExterna.trim());
    const items = await this.importaciones.itemsPorReferencia(auth.tenantId, auth.origenIntegracion ?? 'API', refs);
    const porRef = new Map(items.map((i) => [i.referenciaExterna, i]));
    return {
      importacion: importacionPublica(imp),
      items: refs.map((r) => porRef.get(r)).filter((i): i is NonNullable<typeof i> => Boolean(i)).map(itemPublico),
    };
  }

  @ApiOperation({ summary: 'Consultar ítems por tu referencia', description: 'Hasta 200 referencias (`?referencia=a&referencia=b`). Scope `items:write`.' })
  @ApiOkResponse({ type: [ItemPublicoDto] })
  @ApiKey('items:write')
  @Get('items')
  async items(@CurrentAuth() auth: AuthContext, @Query('referencia') referencia?: string | string[]): Promise<ItemPublicoDto[]> {
    const refs = (Array.isArray(referencia) ? referencia : referencia ? [referencia] : []).slice(0, 200);
    if (!refs.length) throw new BadRequestException('Indicá al menos una referencia (?referencia=…).');
    return (await this.importaciones.itemsPorReferencia(auth.tenantId, auth.origenIntegracion ?? 'API', refs)).map(itemPublico);
  }

  @ApiOperation({ summary: 'Ver una importación y sus ítems' })
  @ApiOkResponse({ type: ResultadoCargaDto })
  @ApiKey('items:write')
  @Get('importaciones/:id')
  async importacion(@CurrentAuth() auth: AuthContext, @Param('id') id: string): Promise<ResultadoCargaDto> {
    const [imp, items] = await Promise.all([this.importaciones.obtener(auth.tenantId, id), this.importaciones.itemsDe(auth.tenantId, id)]);
    return { importacion: importacionPublica(imp), items: items.map(itemPublico) };
  }

  @ApiOperation({ summary: 'Confirmar una importación', description: 'Deja sus ítems válidos listos para generar borradores.' })
  @ApiHeader(CLAVE_IDEMPOTENCIA)
  @ApiOkResponse({ type: ResultadoCargaDto })
  @ApiKey('items:write')
  @Idempotente()
  @Post('importaciones/:id/confirmar')
  @HttpCode(200)
  async confirmar(@CurrentAuth() auth: AuthContext, @Param('id') id: string): Promise<ResultadoCargaDto> {
    const imp = await this.importaciones.confirmar(auth.tenantId, id);
    return { importacion: importacionPublica(imp), items: (await this.importaciones.itemsDe(auth.tenantId, id)).map(itemPublico) };
  }

  // ── Clientes ─────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Listar o buscar clientes', description: 'Activos, por documento o nombre (`?q=`), hasta 200. Scope `items:write`.' })
  @ApiOkResponse({ type: [ClientePublicoDto] })
  @ApiKey('items:write')
  @Get('clientes')
  async buscarClientes(@CurrentAuth() auth: AuthContext, @Query('q') q?: string): Promise<ClientePublicoDto[]> {
    return (await this.clientes.listar(auth.tenantId, { q: q?.slice(0, 100) })).map(clientePublico);
  }

  @ApiOperation({
    summary: 'Consultar un CUIT en el padrón de ARCA',
    description: 'Razón social, domicilio y condición de IVA para dar de alta al cliente. No guarda nada. Scope `items:write`.',
  })
  @ApiOkResponse({ type: PadronDto })
  @ApiKey('items:write')
  @Get('clientes/padron/:cuit')
  padron(@CurrentAuth() auth: AuthContext, @Param('cuit') cuit: string): Promise<PadronDto> {
    return this.clientes.consultarPadron(auth.tenantId, cuit);
  }

  @ApiOperation({
    summary: 'Clientes asociados a tus ids',
    description: 'Hasta 200 (`?referencia=a&referencia=b`). Solo vuelven los que ya están asociados. Scope `items:write`.',
  })
  @ApiOkResponse({ type: [ClienteVinculadoDto] })
  @ApiKey('items:write')
  @Get('clientes/referencias')
  async clientesPorReferencia(@CurrentAuth() auth: AuthContext, @Query('referencia') referencia?: string | string[]): Promise<ClienteVinculadoDto[]> {
    const refs = (Array.isArray(referencia) ? referencia : referencia ? [referencia] : []).slice(0, 200);
    if (!refs.length) throw new BadRequestException('Indicá al menos una referencia (?referencia=…).');
    const mapa = await this.clientes.porReferencias(auth.tenantId, auth.origenIntegracion ?? 'API', refs);
    const clientes = await Promise.all([...new Set(mapa.values())].map((id) => this.clientes.obtener(auth.tenantId, id)));
    const porId = new Map(clientes.map((c) => [c.id, c]));
    return [...mapa].map(([referenciaExterna, id]) => ({ referenciaExterna, cliente: clientePublico(porId.get(id)!) }));
  }

  @ApiOperation({ summary: 'Asociar un cliente a tu id', description: 'Para usar un cliente que ya existe en Faktia. Scope `items:write`.' })
  @ApiOkResponse({ type: ClienteVinculadoDto })
  @ApiKey('items:write')
  @Post('clientes/:id/referencias')
  @HttpCode(200)
  async vincularCliente(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: VincularReferenciaDto): Promise<ClienteVinculadoDto> {
    const cliente = await this.clientes.obtener(auth.tenantId, id);
    const referenciaExterna = dto.referenciaExterna.trim();
    await this.clientes.vincularReferencia(auth.tenantId, auth.origenIntegracion ?? 'API', referenciaExterna, cliente.id);
    return { referenciaExterna, cliente: clientePublico(cliente) };
  }

  @ApiOperation({ summary: 'Ver un cliente', description: 'Scope `items:write`.' })
  @ApiOkResponse({ type: ClientePublicoDto })
  @ApiKey('items:write')
  @Get('clientes/:id')
  async cliente(@CurrentAuth() auth: AuthContext, @Param('id') id: string): Promise<ClientePublicoDto> {
    return clientePublico(await this.clientes.obtener(auth.tenantId, id));
  }

  @ApiOperation({
    summary: 'Dar de alta un cliente',
    description: 'Valida el documento (dígito verificador del CUIT). `409` si ya existe. Con `referenciaExterna` queda asociado a tu id. Scope `items:write`.',
  })
  @ApiHeader(CLAVE_IDEMPOTENCIA)
  @ApiOkResponse({ type: ClientePublicoDto })
  @ApiKey('items:write')
  @Idempotente()
  @Post('clientes')
  async crearCliente(@CurrentAuth() auth: AuthContext, @Body() dto: CrearClienteApiDto): Promise<ClientePublicoDto> {
    const { referenciaExterna, ...datos } = dto;
    const cliente = await this.clientes.crear(auth.tenantId, datos);
    if (referenciaExterna?.trim()) {
      await this.clientes.vincularReferencia(auth.tenantId, auth.origenIntegracion ?? 'API', referenciaExterna.trim(), cliente.id);
    }
    return clientePublico(cliente);
  }

  @ApiOperation({ summary: 'Modificar un cliente', description: 'Scope `items:write`.' })
  @ApiOkResponse({ type: ClientePublicoDto })
  @ApiKey('items:write')
  @Patch('clientes/:id')
  async actualizarCliente(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: ActualizarClienteDto): Promise<ClientePublicoDto> {
    return clientePublico(await this.clientes.actualizar(auth.tenantId, id, dto));
  }

  // ── Comprobantes ─────────────────────────────────────────────────────────

  @ApiOperation({
    summary: 'Crear un borrador a mano',
    description:
      'Factura con sus líneas (precios sin IVA). Si se omite `tipo`, se usa la letra que corresponde al emisor y al cliente. `puntoVentaId` sale de `GET /configuracion`. Scope `comprobantes:write`.',
  })
  @ApiHeader(CLAVE_IDEMPOTENCIA)
  @ApiOkResponse({ type: ComprobantePublicoDto })
  @ApiKey('comprobantes:write')
  @Idempotente()
  @Post('comprobantes')
  async crearBorrador(@CurrentAuth() auth: AuthContext, @Body() dto: CrearBorradorDto): Promise<ComprobantePublicoDto> {
    return comprobante(await this.comprobantes.crearBorrador(auth, dto));
  }

  @ApiOperation({
    summary: 'Generar borradores desde ítems',
    description:
      'Un borrador por cliente y moneda (o también por mes). Solo toma ítems VALIDO de importaciones confirmadas. La letra se sugiere según las condiciones de IVA. Scope `comprobantes:write`.',
  })
  @ApiHeader(CLAVE_IDEMPOTENCIA)
  @ApiOkResponse({ type: BorradoresGeneradosDto })
  @ApiKey('comprobantes:write')
  @Idempotente()
  @Post('comprobantes/borradores')
  async generar(@CurrentAuth() auth: AuthContext, @Body() dto: GenerarBorradoresApiDto): Promise<BorradoresGeneradosDto> {
    let itemIds = dto.itemIds;
    if (dto.referencias?.length) {
      const encontrados = await this.importaciones.itemsPorReferencia(auth.tenantId, auth.origenIntegracion ?? 'API', dto.referencias);
      const faltan = dto.referencias.filter((r) => !encontrados.some((i) => i.referenciaExterna === r));
      if (faltan.length) throw new BadRequestException(`No existen ítems con estas referencias: ${faltan.slice(0, 20).join(', ')}.`);
      itemIds = [...(itemIds ?? []), ...encontrados.map((i) => i.id)];
    }
    const r = await this.comprobantes.generarDesdeItems(auth, {
      itemIds,
      importacionId: dto.importacionId,
      agrupacion: dto.agrupacion,
      fechaEmision: dto.fechaEmision,
    });
    const completos = await Promise.all(r.comprobantes.map((c) => this.comprobantes.obtener(auth.tenantId, c.id)));
    return { comprobantes: completos.map(comprobante) };
  }

  @ApiOperation({ summary: 'Listar comprobantes', description: 'Scope `comprobantes:read`.' })
  @ApiOkResponse({ type: ComprobantesPaginadosDto })
  @ApiKey('comprobantes:read')
  @Get('comprobantes')
  async listar(@CurrentAuth() auth: AuthContext, @Query() q: ListarComprobantesApiQuery): Promise<ComprobantesPaginadosDto> {
    const r = await this.comprobantes.listar(auth.tenantId, q);
    const completos = await Promise.all(r.items.map((c) => this.comprobantes.obtener(auth.tenantId, c.id)));
    return { total: r.total, pagina: r.pagina, porPagina: r.porPagina, items: completos.map(comprobante) };
  }

  @ApiOperation({ summary: 'Ver un comprobante', description: 'Scope `comprobantes:read`.' })
  @ApiOkResponse({ type: ComprobantePublicoDto })
  @ApiKey('comprobantes:read')
  @Get('comprobantes/:id')
  async obtener(@CurrentAuth() auth: AuthContext, @Param('id') id: string): Promise<ComprobantePublicoDto> {
    return comprobante(await this.comprobantes.obtener(auth.tenantId, id));
  }

  @ApiOperation({
    summary: 'Modificar un borrador',
    description:
      'Solo borradores o rechazados. `version` es obligatoria (lock optimista: `409` si cambió). Mandar `lineas` las reemplaza todas. Scope `comprobantes:write`.',
  })
  @ApiOkResponse({ type: ComprobantePublicoDto })
  @ApiKey('comprobantes:write')
  @Patch('comprobantes/:id')
  async actualizarBorrador(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: ActualizarBorradorDto): Promise<ComprobantePublicoDto> {
    return comprobante(await this.comprobantes.actualizarBorrador(auth, id, dto));
  }

  @ApiOperation({
    summary: 'Eliminar un borrador',
    description: 'Solo borradores que nunca llegaron a ARCA. Sus ítems vuelven a estar disponibles para facturar. Scope `comprobantes:write`.',
  })
  @ApiKey('comprobantes:write')
  @Delete('comprobantes/:id')
  @HttpCode(204)
  async eliminarBorrador(@CurrentAuth() auth: AuthContext, @Param('id') id: string): Promise<void> {
    await this.comprobantes.eliminar(auth.tenantId, id);
  }

  @ApiOperation({
    summary: 'Crear una nota de crédito o débito',
    description:
      'Sobre una factura emitida: crea el borrador de la nota con las mismas líneas (editables), asociado a la factura. Después se emite como cualquier comprobante. Scope `comprobantes:write`.',
  })
  @ApiHeader(CLAVE_IDEMPOTENCIA)
  @ApiOkResponse({ type: ComprobantePublicoDto })
  @ApiKey('comprobantes:write')
  @Idempotente()
  @Post('comprobantes/:id/notas')
  async crearNota(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: CrearNotaDto): Promise<ComprobantePublicoDto> {
    return comprobante(await this.comprobantes.crearNota(auth, id, dto));
  }

  @ApiOperation({
    summary: 'Verificar un comprobante pendiente',
    description:
      'Consulta en ARCA un comprobante PENDIENTE_VERIFICACION (también se hace solo, cada pocos minutos). En otro estado lo devuelve igual. Scope `comprobantes:write`.',
  })
  @ApiOkResponse({ type: ComprobantePublicoDto })
  @ApiKey('comprobantes:write')
  @Post('comprobantes/:id/verificar')
  @HttpCode(200)
  async verificar(@CurrentAuth() auth: AuthContext, @Param('id') id: string): Promise<ComprobantePublicoDto> {
    return comprobante(await this.emision.verificar(auth.tenantId, id));
  }

  @ApiOperation({
    summary: 'Emitir un comprobante en ARCA',
    description:
      '`Idempotency-Key` obligatoria: reintentar con la misma clave nunca emite dos veces. Responde EMITIDO, `422` si ARCA rechaza (con el motivo) o PENDIENTE_VERIFICACION si no se supo el resultado (se verifica solo; te llega el webhook). Scope `comprobantes:write`.',
  })
  @ApiHeader({ ...CLAVE_IDEMPOTENCIA, required: true, description: 'Obligatoria. 8 a 100 caracteres (letras, números, - o _).' })
  @ApiOkResponse({ type: ComprobantePublicoDto })
  @ApiBody({ type: EmitirApiDto, required: false })
  @ApiKey('comprobantes:write')
  @Idempotente({ obligatoria: true })
  @Post('comprobantes/:id/emitir')
  @HttpCode(200)
  async emitir(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: EmitirApiDto, @Res({ passthrough: true }) res: Response): Promise<ComprobantePublicoDto> {
    const clave = String(res.req.headers['idempotency-key']);
    const version = dto.version ?? (await this.comprobantes.obtener(auth.tenantId, id)).version;
    try {
      return comprobante(await this.emision.emitir(auth, id, version, clave));
    } catch (err) {
      // El rechazo de ARCA trae el comprobante en su forma interna: hacia afuera va la pública.
      if (err instanceof UnprocessableEntityException) {
        const cuerpo = err.getResponse() as { message?: string; detalle?: string | null; comprobante?: unknown };
        if (cuerpo?.comprobante) {
          throw new UnprocessableEntityException({ message: cuerpo.message, detalle: cuerpo.detalle ?? null, comprobante: comprobante(cuerpo.comprobante) });
        }
      }
      throw err;
    }
  }

  @ApiOperation({ summary: 'Descargar el PDF', description: 'Solo comprobantes con CAE. Scope `comprobantes:read`.' })
  @ApiProduces('application/pdf')
  @ApiKey('comprobantes:read')
  @Get('comprobantes/:id/pdf')
  async descargarPdf(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Res() res: Response) {
    const { buffer, filename } = await this.pdf.generar(auth.tenantId, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  }

  // ── Recibos ──────────────────────────────────────────────────────────────

  @ApiOperation({
    summary: 'Generar un recibo (sin validez fiscal)',
    description:
      'Devuelve el PDF de un recibo de cobro o de pago con los datos y el logo del emisor y la leyenda "Documento no válido como factura". No pasa por ARCA ni se guarda: sirve, por ejemplo, para clientes del exterior. Scope `comprobantes:write`.',
  })
  @ApiProduces('application/pdf')
  @ApiBody({ type: GenerarReciboDto })
  @ApiKey('comprobantes:write')
  @Post('recibos/pdf')
  @HttpCode(200)
  async recibo(@CurrentAuth() auth: AuthContext, @Body() dto: GenerarReciboDto, @Res() res: Response) {
    const { pdf, filename } = await this.recibos.generar(auth.tenantId, dto);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  }
}
