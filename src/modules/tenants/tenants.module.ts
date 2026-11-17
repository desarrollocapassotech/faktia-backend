import { Module } from '@nestjs/common';
import { ArcaModule } from '../arca';
import { CredencialesArcaProvider } from './credenciales-arca.provider';
import { PadronEmisorService } from './padron-emisor.service';
import { TarifasController } from './tarifas.controller';
import { TarifasService } from './tarifas.service';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [ArcaModule],
  controllers: [TenantsController, TarifasController],
  providers: [TenantsService, CredencialesArcaProvider, TarifasService, PadronEmisorService],
  exports: [TenantsService, CredencialesArcaProvider, TarifasService],
})
export class TenantsModule {}
