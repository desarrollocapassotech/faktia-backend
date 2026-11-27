import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ARCA_GATEWAY, type ArcaGateway } from '../arca';
import { CredencialesArcaProvider } from '../tenants';

/** Puerto de la cotización oficial del dólar (pesos por dólar). En los tests se reemplaza por un fake. */
export const PROVEEDOR_COTIZACION = Symbol('PROVEEDOR_COTIZACION');

export interface ProveedorCotizacion {
  /** Cotización del día, como string decimal. Lanza si no se puede obtener. */
  cotizacionDolar(tenantId: string): Promise<string>;
}

/**
 * Cotización de ARCA (FEParamGetCotizacion vía AfipSDK) con las credenciales de la empresa: en
 * homologación sin certificado usa el CUIT de prueba, igual que la emisión.
 */
@Injectable()
export class CotizacionArca implements ProveedorCotizacion {
  constructor(
    @Inject(ARCA_GATEWAY) private readonly arca: ArcaGateway,
    private readonly credenciales: CredencialesArcaProvider,
  ) {}

  async cotizacionDolar(tenantId: string): Promise<string> {
    try {
      return await this.arca.cotizacionDolar(await this.credenciales.obtener(tenantId));
    } catch {
      throw new ServiceUnavailableException('No se pudo obtener la cotización del dólar de ARCA. Cargá el tipo de cambio a mano.');
    }
  }
}
