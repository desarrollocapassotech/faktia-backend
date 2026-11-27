import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentAuth, Modulo, type AuthContext } from '../auth';
import { ListadoDto, ListarListadosQuery, ListarQuery, MaterialDto, ProveedorDto } from './dto/materiales.dto';
import { MaterialesService } from './materiales.service';

@Modulo('materiales')
@Controller('proveedores')
export class ProveedoresController {
  constructor(private readonly materiales: MaterialesService) {}

  @Get()
  listar(@CurrentAuth() auth: AuthContext, @Query() q: ListarQuery) {
    return this.materiales.listarProveedores(auth.tenantId, q);
  }

  @Post()
  crear(@CurrentAuth() auth: AuthContext, @Body() dto: ProveedorDto) {
    return this.materiales.crearProveedor(auth.tenantId, dto);
  }

  @Patch(':id')
  actualizar(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: ProveedorDto) {
    return this.materiales.actualizarProveedor(auth.tenantId, id, dto);
  }

  @Delete(':id')
  eliminar(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.materiales.eliminarProveedor(auth.tenantId, id);
  }
}

@Modulo('materiales')
@Controller('materiales')
export class MaterialesController {
  constructor(private readonly materiales: MaterialesService) {}

  @Get()
  listar(@CurrentAuth() auth: AuthContext, @Query() q: ListarQuery) {
    return this.materiales.listarMateriales(auth.tenantId, q);
  }

  @Post()
  crear(@CurrentAuth() auth: AuthContext, @Body() dto: MaterialDto) {
    return this.materiales.crearMaterial(auth.tenantId, dto);
  }

  @Patch(':id')
  actualizar(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: MaterialDto) {
    return this.materiales.actualizarMaterial(auth.tenantId, id, dto);
  }

  @Delete(':id')
  eliminar(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.materiales.eliminarMaterial(auth.tenantId, id);
  }
}

@Modulo('materiales')
@Controller('listados-materiales')
export class ListadosController {
  constructor(private readonly materiales: MaterialesService) {}

  @Get()
  listar(@CurrentAuth() auth: AuthContext, @Query() q: ListarListadosQuery) {
    return this.materiales.listarListados(auth.tenantId, q);
  }

  @Post()
  crear(@CurrentAuth() auth: AuthContext, @Body() dto: ListadoDto) {
    return this.materiales.crearListado(auth, dto);
  }

  @Get(':id')
  obtener(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.materiales.obtenerListado(auth.tenantId, id);
  }

  @Put(':id')
  actualizar(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: ListadoDto) {
    return this.materiales.actualizarListado(auth.tenantId, id, dto);
  }

  @Delete(':id')
  eliminar(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.materiales.eliminarListado(auth.tenantId, id);
  }

  /** Copia los precios vigentes del catálogo (los guardados no cambian solos). */
  @Post(':id/actualizar-precios')
  @HttpCode(200)
  actualizarPrecios(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.materiales.actualizarPrecios(auth.tenantId, id);
  }

  @Post(':id/duplicar')
  duplicar(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.materiales.duplicarListado(auth, id);
  }

  @Get(':id/pdf')
  async pdf(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Res() res: Response) {
    const { pdf, filename } = await this.materiales.pdf(auth.tenantId, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  }
}
