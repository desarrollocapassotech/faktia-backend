import { Module } from '@nestjs/common';
import { ClientesModule } from '../clientes';
import { ComprobantesModule } from '../comprobantes';
import { RecibosModule } from '../recibos';
import { TenantsModule } from '../tenants';
import { CuentaCorrienteController } from './cuenta-corriente.controller';
import { CuentaCorrienteService } from './cuenta-corriente.service';

@Module({
  imports: [ClientesModule, ComprobantesModule, RecibosModule, TenantsModule],
  controllers: [CuentaCorrienteController],
  providers: [CuentaCorrienteService],
  exports: [CuentaCorrienteService],
})
export class CuentaCorrienteModule {}
