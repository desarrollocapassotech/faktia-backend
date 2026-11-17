import { BadGatewayException, BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { esCuitValido, normalizarCuit } from '../../shared/util/cuit';
import { ARCA_GATEWAY, ArcaError, type ArcaGateway, type DatosPadron } from '../arca';
import { CredencialesArcaProvider } from './credenciales-arca.provider';

export const CUIT_NO_REGISTRADO = 'ARCA no tiene registrado ese CUIT. Revisá que esté bien escrito.';
export const PADRON_SOLO_PRODUCCION =
  'En el ambiente de pruebas el padrón de ARCA es ficticio: el CUIT se valida al pasar a producción, con el certificado.';

/**
 * Consulta en el padrón de ARCA el CUIT con el que la empresa se da de alta.
 * Solo en producción: el padrón de homologación es una base de prueba (faltan personas reales y
 * las que están tienen datos alterados), así que ni sirve para validar ni para autocompletar.
 * En pruebas el CUIT queda validado igual al pasar a producción: el certificado tiene que ser de ese CUIT.
 */
@Injectable()
export class PadronEmisorService {
  private readonly logger = new Logger(PadronEmisorService.name);

  constructor(
    private readonly credenciales: CredencialesArcaProvider,
    @Inject(ARCA_GATEWAY) private readonly arca: ArcaGateway,
  ) {}

  /** Para autocompletar el formulario: 404 si ARCA no lo conoce, 502 si no se pudo consultar. */
  async consultar(tenantId: string, cuitCrudo: string) {
    const cuit = normalizarCuit(cuitCrudo);
    if (!esCuitValido(cuit)) throw new BadRequestException('El CUIT no es válido (revisá el dígito verificador).');
    const cred = await this.credenciales.obtener(tenantId);
    if (cred.ambiente !== 'PRODUCCION') throw new BadRequestException(PADRON_SOLO_PRODUCCION);
    let datos: DatosPadron | null;
    try {
      datos = await this.arca.consultarPadron(cred, cuit);
    } catch (err) {
      if (err instanceof ArcaError) {
        throw new BadGatewayException({ message: `No se pudo consultar el padrón de ARCA: ${err.message}`, detalle: err.detalle });
      }
      throw err;
    }
    if (!datos) throw new NotFoundException(CUIT_NO_REGISTRADO);
    return { cuit: datos.cuit, razonSocial: datos.razonSocial, domicilio: datos.domicilio, condicionIva: datos.condicionIva };
  }

  /**
   * Al guardar el CUIT: lo rechaza solo si ARCA responde que no existe. Si el padrón no está
   * disponible, deja seguir (no frenar el alta por una caída de ARCA): el certificado y la
   * primera emisión lo vuelven a validar.
   */
  async verificarExiste(tenantId: string, cuit: string): Promise<void> {
    const cred = await this.credenciales.obtener(tenantId);
    if (cred.ambiente !== 'PRODUCCION') return;
    try {
      await this.consultar(tenantId, cuit);
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      this.logger.warn(`No se pudo verificar el CUIT del tenant ${tenantId} en el padrón: ${(err as Error).message}`);
    }
  }
}
