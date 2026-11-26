import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentAuth, Modulo, type AuthContext } from '../../auth';
import {
  ActualizarProyectoDto,
  AdicionalDto,
  CertificacionDto,
  CotizacionQuery,
  CrearProyectoDto,
  EntregaDto,
  ListarProyectosQuery,
  PlanDto,
} from './proyectos.dto';
import { ProyectosService } from './proyectos.service';

/** Proyectos (obras): plan de pagos, certificaciones, adicionales y entregas. */
@Modulo('proyectos')
@Controller('proyectos')
export class ProyectosController {
  constructor(private readonly proyectos: ProyectosService) {}

  @Get()
  listar(@CurrentAuth() auth: AuthContext, @Query() q: ListarProyectosQuery) {
    return this.proyectos.listar(auth.tenantId, q);
  }

  /** Tipo de cambio sugerido para una entrega en otra moneda (fijo del proyecto o ARCA). */
  @Get('cotizacion-dolar')
  cotizacion(@CurrentAuth() auth: AuthContext, @Query() q: CotizacionQuery) {
    return this.proyectos.cotizacion(auth.tenantId, q.proyectoId);
  }

  @Post()
  crear(@CurrentAuth() auth: AuthContext, @Body() dto: CrearProyectoDto) {
    return this.proyectos.crear(auth, dto);
  }

  @Get(':id')
  obtener(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.proyectos.obtener(auth.tenantId, id);
  }

  @Patch(':id')
  actualizar(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: ActualizarProyectoDto) {
    return this.proyectos.actualizar(auth, id, dto);
  }

  @Delete(':id')
  eliminar(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.proyectos.eliminar(auth.tenantId, id);
  }

  /** Monto acordado y plan de pagos (hitos). */
  @Put(':id/plan')
  guardarPlan(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: PlanDto) {
    return this.proyectos.guardarPlan(auth, id, dto);
  }

  @Post(':id/hitos/:hitoId/certificaciones')
  certificar(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Param('hitoId') hitoId: string, @Body() dto: CertificacionDto) {
    return this.proyectos.certificar(auth, id, hitoId, dto);
  }

  @Delete(':id/certificaciones/:certificacionId')
  eliminarCertificacion(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Param('certificacionId') certificacionId: string) {
    return this.proyectos.eliminarCertificacion(auth, id, certificacionId);
  }

  @Post(':id/adicionales')
  adicional(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: AdicionalDto) {
    return this.proyectos.agregarAdicional(auth, id, dto);
  }

  /** Entrega del cliente, con recibo (por defecto) o sin recibo (pagos viejos). */
  @Post(':id/entregas')
  entrega(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: EntregaDto) {
    return this.proyectos.registrarEntrega(auth, id, dto);
  }
}
