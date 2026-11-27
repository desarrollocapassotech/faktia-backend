import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants';
import { ListadosController, MaterialesController, ProveedoresController } from './materiales.controller';
import { MaterialesService } from './materiales.service';

@Module({
  imports: [TenantsModule],
  controllers: [ProveedoresController, MaterialesController, ListadosController],
  providers: [MaterialesService],
  exports: [MaterialesService],
})
export class MaterialesModule {}
