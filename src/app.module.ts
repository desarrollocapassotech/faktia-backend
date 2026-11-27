import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { HealthController } from './health.controller';
import { ApiPublicaModule } from './modules/api-publica';
import { AvisosModule } from './modules/avisos';
import { AuthModule } from './modules/auth';
import { ClientesModule } from './modules/clientes';
import { ComprobantesModule } from './modules/comprobantes';
import { CuentaCorrienteModule } from './modules/cuenta-corriente';
import { ImportacionesModule } from './modules/importaciones';
import { PresupuestosModule } from './modules/presupuestos';
import { ProduccionModule } from './modules/produccion';
import { RecibosModule } from './modules/recibos';
import { TenantsModule } from './modules/tenants';
import { validateEnv } from './shared/config/env.validation';
import { EmailModule } from './shared/email/email';
import { PrismaModule } from './shared/prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Límite por defecto generoso; el login define uno propio más estricto.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    PrismaModule,
    EmailModule,
    AuthModule,
    TenantsModule,
    ClientesModule,
    ImportacionesModule,
    ComprobantesModule,
    RecibosModule,
    CuentaCorrienteModule,
    ApiPublicaModule,
    ProduccionModule,
    AvisosModule,
    PresupuestosModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
