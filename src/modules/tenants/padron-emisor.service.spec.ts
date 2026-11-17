import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common';
import { ArcaError, type ArcaGateway } from '../arca';
import type { CredencialesArcaProvider } from './credenciales-arca.provider';
import { PadronEmisorService } from './padron-emisor.service';

const CUIT = '30546689979';

function servicio(consultarPadron: ArcaGateway['consultarPadron'], ambiente: 'HOMOLOGACION' | 'PRODUCCION' = 'PRODUCCION') {
  const credenciales = { obtener: jest.fn(async () => ({ tenantId: 't1', ambiente })) } as unknown as CredencialesArcaProvider;
  return new PadronEmisorService(credenciales, { consultarPadron } as unknown as ArcaGateway);
}

const caido = async () => {
  throw new ArcaError('INCIERTO', 'timeout');
};

describe('PadronEmisorService', () => {
  it('devuelve los datos de la constancia para autocompletar', async () => {
    const s = servicio(async () => ({ cuit: CUIT, razonSocial: 'YPF SA', domicilio: 'Macacha Güemes 515', condicionIva: 'RESPONSABLE_INSCRIPTO', crudo: {} }));
    await expect(s.consultar('t1', '30-54668997-9')).resolves.toEqual({
      cuit: CUIT,
      razonSocial: 'YPF SA',
      domicilio: 'Macacha Güemes 515',
      condicionIva: 'RESPONSABLE_INSCRIPTO',
    });
  });

  it('rechaza un CUIT con dígito verificador inválido sin consultar a ARCA', async () => {
    const consultar = jest.fn();
    await expect(servicio(consultar).consultar('t1', '30546689970')).rejects.toThrow(BadRequestException);
    expect(consultar).not.toHaveBeenCalled();
  });

  it('404 si ARCA no lo conoce, 502 si no se pudo consultar', async () => {
    await expect(servicio(async () => null).consultar('t1', CUIT)).rejects.toThrow(NotFoundException);
    await expect(servicio(caido).consultar('t1', CUIT)).rejects.toThrow(BadGatewayException);
  });

  it('al guardar, frena solo si ARCA dice que no existe', async () => {
    await expect(servicio(async () => null).verificarExiste('t1', CUIT)).rejects.toThrow(NotFoundException);
    await expect(servicio(caido).verificarExiste('t1', CUIT)).resolves.toBeUndefined();
  });

  it('en homologación no consulta: el padrón de pruebas es ficticio', async () => {
    const consultar = jest.fn(async () => null);
    const s = servicio(consultar, 'HOMOLOGACION');
    await expect(s.consultar('t1', CUIT)).rejects.toThrow(BadRequestException);
    await expect(s.verificarExiste('t1', CUIT)).resolves.toBeUndefined();
    expect(consultar).not.toHaveBeenCalled();
  });
});
