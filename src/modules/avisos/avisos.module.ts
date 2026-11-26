import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { ClientesModule } from '../clientes';
import { CuentaCorrienteModule } from '../cuenta-corriente';
import { TenantsModule } from '../tenants';
import { AvisosController } from './avisos.controller';
import { AvisosService } from './avisos.service';

@Module({
  imports: [AuthModule, ClientesModule, CuentaCorrienteModule, TenantsModule],
  controllers: [AvisosController],
  providers: [AvisosService],
  exports: [AvisosService],
})
export class AvisosModule {}
