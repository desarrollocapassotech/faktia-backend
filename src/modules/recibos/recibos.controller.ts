import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentAuth, Modulo, Public, type AuthContext } from '../auth';
import { MODULO_DESHABILITADO } from '../../shared/modulos/modulos';
import type { ReciboOutput } from './core';
import { AnularReciboDto, CrearReciboDto, GenerarReciboDto, SiguienteNumeroQuery, VerificarReciboQuery } from './dto/recibos.dto';
import { RecibosService } from './recibos.service';

function enviarPdf(res: Response, { pdf, filename }: ReciboOutput) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(pdf);
}

/** Los recibos de pago se ocultan por empresa (módulo recibos-pago). */
function exigirTipoHabilitado(auth: AuthContext, tipo: 'COBRO' | 'PAGO') {
  if (tipo === 'PAGO' && !(auth.modulos ?? []).includes('recibos-pago')) throw new ForbiddenException(MODULO_DESHABILITADO);
}

@Modulo('recibos')
@Controller('recibos')
export class RecibosController {
  constructor(private readonly recibos: RecibosService) {}

  /** Guarda el recibo: aparece en el listado de comprobantes. El PDF se pide con GET :id/pdf. */
  @Post()
  crear(@CurrentAuth() auth: AuthContext, @Body() dto: CrearReciboDto) {
    exigirTipoHabilitado(auth, dto.tipo);
    return this.recibos.crear(auth, dto);
  }

  /** Arma el PDF sin guardar nada (vista previa). */
  @Post('pdf')
  @HttpCode(200)
  async pdf(@CurrentAuth() auth: AuthContext, @Body() dto: GenerarReciboDto, @Res() res: Response) {
    exigirTipoHabilitado(auth, dto.tipo);
    enviarPdf(res, await this.recibos.generar(auth.tenantId, dto));
  }

  /**
   * Pública (sin sesión): la usa la página a la que lleva el QR del recibo. La credencial es la firma
   * del link (`c`); sin ella o con otra, 404.
   */
  @Public()
  @Get('verificar/:id')
  verificar(@Param('id') id: string, @Query() q: VerificarReciboQuery) {
    return this.recibos.verificar(id, q.c);
  }

  /** Número sugerido para el próximo recibo de ese tipo. */
  @Get('siguiente-numero')
  siguienteNumero(@CurrentAuth() auth: AuthContext, @Query() q: SiguienteNumeroQuery) {
    return this.recibos.siguienteNumero(auth.tenantId, q.tipo);
  }

  @Get(':id')
  obtener(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.recibos.obtener(auth.tenantId, id);
  }

  /** Anula el recibo: queda guardado y la cuenta corriente revierte su cobro. */
  @Post(':id/anular')
  @HttpCode(200)
  anular(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: AnularReciboDto) {
    return this.recibos.anular(auth.tenantId, id, dto.motivo);
  }

  @Get(':id/pdf')
  async pdfGuardado(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Res() res: Response) {
    enviarPdf(res, await this.recibos.pdf(auth.tenantId, id));
  }
}
