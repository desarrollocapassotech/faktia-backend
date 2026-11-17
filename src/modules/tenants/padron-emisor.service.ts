import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PadronService } from '../arca';

export const CUIT_NO_REGISTRADO = 'ARCA no tiene registrado ese CUIT. Revisá que esté bien escrito.';

/**
 * Valida en el padrón de ARCA el CUIT con el que la empresa se da de alta y trae sus datos para
 * autocompletar. Usa el certificado de plataforma (`PadronService`), así funciona también para
 * las empresas que están en homologación.
 */
@Injectable()
export class PadronEmisorService {
  private readonly logger = new Logger(PadronEmisorService.name);

  constructor(private readonly padron: PadronService) {}

  /** Si el servidor tiene configurado el padrón (para que el formulario sepa si validar). */
  disponible(): boolean {
    return this.padron.configurado();
  }

  /** Para autocompletar el formulario: 404 si ARCA no lo conoce; 503/429 si no se pudo consultar. */
  async consultar(tenantId: string, cuit: string) {
    const datos = await this.padron.consultar(cuit, tenantId);
    if (!datos) throw new NotFoundException(CUIT_NO_REGISTRADO);
    return {
      cuit: datos.cuit,
      razonSocial: datos.razonSocial,
      domicilio: datos.domicilio,
      condicionIva: datos.condicionIva,
      inicioActividadesSugerido: datos.inicioActividadesSugerido ?? null,
    };
  }

  /**
   * Al guardar el CUIT: lo rechaza solo si ARCA responde que no existe. Si el padrón no está
   * configurado o no responde, deja seguir (no frenar el alta): el certificado lo vuelve a validar.
   */
  async verificarExiste(tenantId: string, cuit: string): Promise<void> {
    if (!this.padron.configurado()) return;
    try {
      await this.consultar(tenantId, cuit);
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      if (err instanceof HttpException && err.getStatus() === HttpStatus.BAD_REQUEST) throw err;
      this.logger.warn(`No se pudo verificar el CUIT del tenant ${tenantId} en el padrón: ${(err as Error).message}`);
    }
  }
}
