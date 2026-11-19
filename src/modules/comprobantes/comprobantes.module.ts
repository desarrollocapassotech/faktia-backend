import { Module } from '@nestjs/common';
import { ArcaModule } from '../arca';
import { ClientesModule } from '../clientes';
import { ImportacionesModule } from '../importaciones';
import { PdfModule } from '../pdf';
import { RecibosModule } from '../recibos';
import { TenantsModule } from '../tenants';
import { ComprobantePdfService } from './comprobante-pdf.service';
import { ComprobantesController } from './comprobantes.controller';
import { ComprobantesService } from './comprobantes.service';
import { EmisionService } from './emision.service';

@Module({
  imports: [ClientesModule, TenantsModule, ArcaModule, PdfModule, ImportacionesModule, RecibosModule],
  controllers: [ComprobantesController],
  providers: [ComprobantesService, EmisionService, ComprobantePdfService],
  exports: [ComprobantesService, EmisionService, ComprobantePdfService],
})
export class ComprobantesModule {}
