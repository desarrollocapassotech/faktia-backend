import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentAuth, Modulo, type AuthContext } from '../../auth';
import { WebhooksService } from './webhooks.service';

export class CrearWebhookDto {
  @IsString()
  @MaxLength(500)
  url: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1, { message: 'Elegí al menos un evento.' })
  @ArrayMaxSize(10)
  eventos: string[];

  @IsOptional()
  @IsString()
  integracionId?: string;
}

export class ActualizarWebhookDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  eventos?: string[];

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}

/** Configuración de webhooks (usuario logueado). No forma parte de la API pública. */
@ApiExcludeController()
@Modulo('webhooks')
@Controller('configuracion/webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  listar(@CurrentAuth() auth: AuthContext) {
    return this.webhooks.listar(auth.tenantId);
  }

  /** Devuelve el secreto de firma una sola vez. */
  @Post()
  crear(@CurrentAuth() auth: AuthContext, @Body() dto: CrearWebhookDto) {
    return this.webhooks.crear(auth.tenantId, dto);
  }

  @Patch(':id')
  actualizar(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() dto: ActualizarWebhookDto) {
    return this.webhooks.actualizar(auth.tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  eliminar(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.webhooks.eliminar(auth.tenantId, id);
  }

  @Post(':id/rotar-secreto')
  @HttpCode(200)
  rotar(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.webhooks.rotarSecreto(auth.tenantId, id);
  }

  @Post(':id/probar')
  @HttpCode(200)
  probar(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.webhooks.probar(auth.tenantId, id);
  }

  @Get(':id/entregas')
  entregas(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.webhooks.entregas(auth.tenantId, id);
  }

  @Post('entregas/:entregaId/reenviar')
  @HttpCode(200)
  reenviar(@CurrentAuth() auth: AuthContext, @Param('entregaId') entregaId: string) {
    return this.webhooks.reenviar(auth.tenantId, entregaId);
  }
}
