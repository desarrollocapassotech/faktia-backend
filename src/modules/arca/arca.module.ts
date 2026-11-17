import { Module } from '@nestjs/common';
import { AfipSdkGateway } from './afip-sdk.gateway';
import { ArcaAuditService } from './arca-audit.service';
import { ARCA_GATEWAY } from './arca.gateway';
import { PadronService } from './padron.service';

@Module({
  providers: [ArcaAuditService, AfipSdkGateway, { provide: ARCA_GATEWAY, useExisting: AfipSdkGateway }, PadronService],
  exports: [ARCA_GATEWAY, PadronService],
})
export class ArcaModule {}
