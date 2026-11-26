import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentAuth, Modulo, type AuthContext } from '../auth';
import { CuentaCorrienteService } from './cuenta-corriente.service';
import { ActualizarMovimientoDto, CrearImputacionDto, CrearMovimientoDto, ResumenQuery } from './dto/cuenta-corriente.dto';

@Modulo('cuenta-corriente')
@Controller('cuenta-corriente')
export class CuentaCorrienteController {
  constructor(private readonly cc: CuentaCorrienteService) {}

  /** Total por cobrar, vencidos y próximos a vencer. */
  @Get('resumen')
  resumen(@CurrentAuth() auth: AuthContext, @Query() q: ResumenQuery) {
    return this.cc.resumen(auth.tenantId, q.diasProximos);
  }

  /** Cada cliente con su saldo por moneda y su próximo vencimiento. */
  @Get('cuentas')
  cuentas(@CurrentAuth() auth: AuthContext) {
    return this.cc.cuentas(auth.tenantId);
  }

  /** La cuenta de un cliente con todos sus movimientos. */
  @Get('cuentas/:clienteId')
  cuenta(@CurrentAuth() auth: AuthContext, @Param('clienteId') clienteId: string) {
    return this.cc.cuenta(auth.tenantId, clienteId);
  }

  @Post('movimientos')
  crearMovimiento(@CurrentAuth() auth: AuthContext, @Body() dto: CrearMovimientoDto) {
    return this.cc.crearMovimiento(auth, dto);
  }

  @Patch('movimientos/:id')
  actualizarMovimiento(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: ActualizarMovimientoDto) {
    return this.cc.actualizarMovimiento(auth.tenantId, id, dto);
  }

  @Delete('movimientos/:id')
  eliminarMovimiento(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.cc.eliminarMovimiento(auth.tenantId, id);
  }

  @Post('imputaciones')
  crearImputacion(@CurrentAuth() auth: AuthContext, @Body() dto: CrearImputacionDto) {
    return this.cc.crearImputacion(auth, dto);
  }

  @Delete('imputaciones/:id')
  eliminarImputacion(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.cc.eliminarImputacion(auth.tenantId, id);
  }
}
