import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentAuth, type AuthContext } from '../auth';
import type { ReciboOutput } from './core';
import { CrearReciboDto, GenerarReciboDto, SiguienteNumeroQuery } from './dto/recibos.dto';
import { RecibosService } from './recibos.service';

function enviarPdf(res: Response, { pdf, filename }: ReciboOutput) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(pdf);
}

@Controller('recibos')
export class RecibosController {
  constructor(private readonly recibos: RecibosService) {}

  /** Guarda el recibo: aparece en el listado de comprobantes. El PDF se pide con GET :id/pdf. */
  @Post()
  crear(@CurrentAuth() auth: AuthContext, @Body() dto: CrearReciboDto) {
    return this.recibos.crear(auth, dto);
  }

  /** Arma el PDF sin guardar nada (vista previa). */
  @Post('pdf')
  @HttpCode(200)
  async pdf(@CurrentAuth() auth: AuthContext, @Body() dto: GenerarReciboDto, @Res() res: Response) {
    enviarPdf(res, await this.recibos.generar(auth.tenantId, dto));
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

  @Get(':id/pdf')
  async pdfGuardado(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Res() res: Response) {
    enviarPdf(res, await this.recibos.pdf(auth.tenantId, id));
  }
}
