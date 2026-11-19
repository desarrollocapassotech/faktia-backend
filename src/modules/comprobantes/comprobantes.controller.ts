import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentAuth, type AuthContext } from '../auth';
import { RecibosService } from '../recibos';
import { ComprobantePdfService } from './comprobante-pdf.service';
import { ComprobantesService } from './comprobantes.service';
import {
  ActualizarBorradorDto,
  CrearBorradorDto,
  CrearNotaDto,
  EmitirDto,
  GenerarBorradoresDto,
  ListarComprobantesQuery,
} from './dto/comprobantes.dto';
import { EmisionService } from './emision.service';
import { filaDeComprobante, filaDeRecibo, paginaUnificada } from './listado-unificado';

@Controller('comprobantes')
export class ComprobantesController {
  constructor(
    private readonly comprobantes: ComprobantesService,
    private readonly emision: EmisionService,
    private readonly pdf: ComprobantePdfService,
    private readonly recibos: RecibosService,
  ) {}

  /**
   * Con `incluirRecibos` (el listado de la app), suma los recibos guardados: se traen las primeras
   * pagina × porPagina filas de cada lado, se mezclan con el mismo orden y se pagina.
   */
  @Get()
  async listar(@CurrentAuth() auth: AuthContext, @Query() q: ListarComprobantesQuery) {
    const conRecibos = q.incluirRecibos && (!q.clase || q.clase === 'RECIBO') && (!q.estado || q.estado === 'EMITIDO') && !q.periodo;
    if (!conRecibos) return this.comprobantes.listar(auth.tenantId, q);

    const porPagina = q.porPagina ?? 25;
    const pagina = q.pagina ?? 1;
    const limite = pagina * porPagina;
    const [comprobantes, recibos] = await Promise.all([
      q.clase === 'RECIBO' ? { total: 0, items: [] } : this.comprobantes.ventanaListado(auth.tenantId, q, limite),
      this.recibos.listarParaListado(
        auth.tenantId,
        { numero: q.numero, clienteId: q.clienteId, fechaDesde: q.fechaDesde, fechaHasta: q.fechaHasta, ordenarPor: q.ordenarPor, dir: q.dir },
        limite,
      ),
    ]);
    return {
      total: comprobantes.total + recibos.total,
      pagina,
      porPagina,
      items: paginaUnificada(
        comprobantes.items.map(filaDeComprobante),
        recibos.items.map(filaDeRecibo),
        { por: q.ordenarPor, dir: q.dir },
        pagina,
        porPagina,
      ),
    };
  }

  @Post()
  crear(@CurrentAuth() auth: AuthContext, @Body() dto: CrearBorradorDto) {
    return this.comprobantes.crearBorrador(auth, dto);
  }

  /** Un borrador por cliente (y moneda / mes) a partir de ítems importados y confirmados. */
  @Post('generar')
  generar(@CurrentAuth() auth: AuthContext, @Body() dto: GenerarBorradoresDto) {
    return this.comprobantes.generarDesdeItems(auth, dto);
  }

  @Get(':id')
  obtener(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.comprobantes.obtener(auth.tenantId, id);
  }

  @Patch(':id')
  actualizar(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: ActualizarBorradorDto) {
    return this.comprobantes.actualizarBorrador(auth, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  eliminar(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.comprobantes.eliminar(auth.tenantId, id);
  }

  /** Requiere header Idempotency-Key (uno por clic en "Emitir"): reintentar no duplica. */
  @Post(':id/emitir')
  @HttpCode(200)
  emitir(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: EmitirDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey)) {
      throw new BadRequestException('Falta el header Idempotency-Key (8 a 100 caracteres alfanuméricos).');
    }
    return this.emision.emitir(auth, id, dto.version, idempotencyKey);
  }

  @Post(':id/verificar')
  @HttpCode(200)
  verificar(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.emision.verificar(auth.tenantId, id);
  }

  @Post(':id/notas')
  crearNota(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: CrearNotaDto) {
    return this.comprobantes.crearNota(auth, id, dto);
  }

  @Get(':id/pdf')
  async descargarPdf(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Res() res: Response) {
    const { buffer, filename } = await this.pdf.generar(auth.tenantId, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  }
}
