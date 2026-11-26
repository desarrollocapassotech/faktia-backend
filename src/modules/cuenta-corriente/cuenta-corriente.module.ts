import { Module } from '@nestjs/common';
import { ArcaModule } from '../arca';
import { ClientesModule } from '../clientes';
import { ComprobantesModule } from '../comprobantes';
import { RecibosModule } from '../recibos';
import { TenantsModule } from '../tenants';
import { CotizacionArca, PROVEEDOR_COTIZACION } from './cotizacion';
import { CuentaCorrienteController } from './cuenta-corriente.controller';
import { CuentaCorrienteService } from './cuenta-corriente.service';
import { ProyectosController } from './proyectos/proyectos.controller';
import { ProyectosService } from './proyectos/proyectos.service';

@Module({
  imports: [ArcaModule, ClientesModule, ComprobantesModule, RecibosModule, TenantsModule],
  controllers: [CuentaCorrienteController, ProyectosController],
  providers: [CuentaCorrienteService, ProyectosService, { provide: PROVEEDOR_COTIZACION, useClass: CotizacionArca }],
  exports: [CuentaCorrienteService, ProyectosService],
})
export class CuentaCorrienteModule {}
