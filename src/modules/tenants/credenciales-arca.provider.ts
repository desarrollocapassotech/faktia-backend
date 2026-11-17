import { BadRequestException, Injectable } from '@nestjs/common';
import type { AmbienteArca } from '@prisma/client';
import type { CredencialesArca } from '../arca';
import { CUIT_PRUEBA_AFIPSDK, FALTAN_DATOS_FISCALES, TenantsService } from './tenants.service';

/**
 * Arma las credenciales ARCA del tenant para su ambiente actual.
 * - Producción: CUIT real + certificado (el gateway exige que exista).
 * - Homologación con certificado: CUIT real + certificado de homologación.
 * - Homologación sin certificado: CUIT de prueba de AfipSDK, sin certificado (como Vialto).
 */
@Injectable()
export class CredencialesArcaProvider {
  constructor(private readonly tenants: TenantsService) {}

  async obtener(tenantId: string): Promise<CredencialesArca> {
    const emisor = await this.tenants.obtenerEmisor(tenantId);
    return this.paraAmbiente(tenantId, emisor.ambienteArca);
  }

  /** Credenciales de un ambiente puntual (ej. probar producción antes de activarla). */
  async paraAmbiente(tenantId: string, ambiente: AmbienteArca): Promise<CredencialesArca> {
    const emisor = await this.tenants.obtenerEmisor(tenantId);
    const cert = await this.tenants.certificadoActivo(tenantId, ambiente);
    const usaCuitPrueba = ambiente === 'HOMOLOGACION' && !cert;
    // Sin CUIT no hay certificado (cargarCertificado lo exige), así que esto solo pasa con datos inconsistentes.
    if (!usaCuitPrueba && !emisor.cuit) throw new BadRequestException(FALTAN_DATOS_FISCALES);
    return {
      tenantId,
      ambiente,
      cuit: usaCuitPrueba ? CUIT_PRUEBA_AFIPSDK : (emisor.cuit as string),
      certPem: cert?.certPem ?? null,
      keyPem: cert?.keyPem ?? null,
      usaCuitPrueba,
    };
  }
}
