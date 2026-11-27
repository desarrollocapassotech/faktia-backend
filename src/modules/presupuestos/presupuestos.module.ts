import { Module } from '@nestjs/common';
import { ClientesModule } from '../clientes';
import { CuentaCorrienteModule } from '../cuenta-corriente';
import { TenantsModule } from '../tenants';
import { PresupuestosController } from './presupuestos.controller';
import { PresupuestosService } from './presupuestos.service';

@Module({
  imports: [ClientesModule, CuentaCorrienteModule, TenantsModule],
  controllers: [PresupuestosController],
  providers: [PresupuestosService],
  exports: [PresupuestosService],
})
export class PresupuestosModule {}
