import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentAuth, Modulo, type AuthContext } from '../auth';
import {
  CambiarEstadoDto,
  CrearProyectoDesdePresupuestoDto,
  DuplicarDto,
  GuardarPresupuestoDto,
  ItemBibliotecaDto,
  ListarPresupuestosQuery,
  ObservacionCatalogoDto,
} from './dto/presupuestos.dto';
import { PresupuestosService } from './presupuestos.service';

@Modulo('presupuestos')
@Controller('presupuestos')
export class PresupuestosController {
  constructor(private readonly presupuestos: PresupuestosService) {}

  @Get()
  listar(@CurrentAuth() auth: AuthContext, @Query() q: ListarPresupuestosQuery) {
    return this.presupuestos.listar(auth.tenantId, q);
  }

  @Post()
  crear(@CurrentAuth() auth: AuthContext, @Body() dto: GuardarPresupuestoDto) {
    return this.presupuestos.crear(auth, dto);
  }

  // ── Biblioteca (antes de :id para que no la tome como id) ──

  @Get('biblioteca/items')
  items(@CurrentAuth() auth: AuthContext, @Query('inactivos') inactivos?: string) {
    return this.presupuestos.listarItems(auth.tenantId, inactivos === 'true');
  }

  @Post('biblioteca/items')
  crearItem(@CurrentAuth() auth: AuthContext, @Body() dto: ItemBibliotecaDto) {
    return this.presupuestos.crearItem(auth.tenantId, dto);
  }

  @Put('biblioteca/items/:id')
  actualizarItem(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: ItemBibliotecaDto) {
    return this.presupuestos.actualizarItem(auth.tenantId, id, dto);
  }

  @Delete('biblioteca/items/:id')
  eliminarItem(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.presupuestos.eliminarItem(auth.tenantId, id);
  }

  @Get('biblioteca/observaciones')
  observaciones(@CurrentAuth() auth: AuthContext, @Query('inactivas') inactivas?: string) {
    return this.presupuestos.listarObservaciones(auth.tenantId, inactivas === 'true');
  }

  @Post('biblioteca/observaciones')
  crearObservacion(@CurrentAuth() auth: AuthContext, @Body() dto: ObservacionCatalogoDto) {
    return this.presupuestos.crearObservacion(auth.tenantId, dto);
  }

  @Put('biblioteca/observaciones/:id')
  actualizarObservacion(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: ObservacionCatalogoDto) {
    return this.presupuestos.actualizarObservacion(auth.tenantId, id, dto);
  }

  @Delete('biblioteca/observaciones/:id')
  eliminarObservacion(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.presupuestos.eliminarObservacion(auth.tenantId, id);
  }

  /** Carga los ítems y observaciones iniciales de herrería (no pisa lo que ya exista). */
  @Post('biblioteca/cargar-inicial')
  @HttpCode(200)
  cargarInicial(@CurrentAuth() auth: AuthContext) {
    return this.presupuestos.cargarBibliotecaInicial(auth.tenantId);
  }

  // ── Presupuesto ──

  @Get(':id')
  obtener(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.presupuestos.obtener(auth.tenantId, id);
  }

  @Put(':id')
  actualizar(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: GuardarPresupuestoDto) {
    return this.presupuestos.actualizar(auth, id, dto);
  }

  @Delete(':id')
  eliminar(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.presupuestos.eliminar(auth.tenantId, id);
  }

  @Patch(':id/estado')
  estado(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: CambiarEstadoDto) {
    return this.presupuestos.cambiarEstado(auth.tenantId, id, dto.estado);
  }

  @Post(':id/duplicar')
  duplicar(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: DuplicarDto) {
    return this.presupuestos.duplicar(auth, id, dto.reemplaza);
  }

  @Post(':id/proyecto')
  crearProyecto(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: CrearProyectoDesdePresupuestoDto) {
    return this.presupuestos.crearProyecto(auth, id, dto);
  }

  @Get(':id/pdf')
  async pdf(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Res() res: Response) {
    const { pdf, filename } = await this.presupuestos.pdf(auth.tenantId, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  }
}
