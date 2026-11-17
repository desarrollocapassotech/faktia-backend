import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { DatosPadron, PadronService } from '../arca';
import { PadronEmisorService } from './padron-emisor.service';

const CUIT = '30546689979';
const YPF: DatosPadron = { cuit: CUIT, razonSocial: 'YPF SA', domicilio: 'Macacha Güemes 515', condicionIva: 'RESPONSABLE_INSCRIPTO', crudo: {} };

function servicio(consultar: () => Promise<DatosPadron | null>, configurado = true) {
  return new PadronEmisorService({ configurado: () => configurado, consultar: jest.fn(consultar) } as unknown as PadronService);
}

const caido = async (): Promise<never> => {
  throw new ServiceUnavailableException('ARCA caído');
};

describe('PadronEmisorService', () => {
  it('devuelve los datos de la constancia para autocompletar', async () => {
    await expect(servicio(async () => YPF).consultar('t1', CUIT)).resolves.toEqual({
      cuit: CUIT,
      razonSocial: 'YPF SA',
      domicilio: 'Macacha Güemes 515',
      condicionIva: 'RESPONSABLE_INSCRIPTO',
      inicioActividadesSugerido: null,
    });
  });

  it('404 si ARCA no lo conoce', async () => {
    await expect(servicio(async () => null).consultar('t1', CUIT)).rejects.toThrow(NotFoundException);
  });

  it('al guardar, frena si no existe o el CUIT es inválido; si ARCA no responde, deja seguir', async () => {
    await expect(servicio(async () => null).verificarExiste('t1', CUIT)).rejects.toThrow(NotFoundException);
    await expect(
      servicio(async () => {
        throw new BadRequestException('inválido');
      }).verificarExiste('t1', CUIT),
    ).rejects.toThrow(BadRequestException);
    await expect(servicio(caido).verificarExiste('t1', CUIT)).resolves.toBeUndefined();
  });

  it('sin padrón configurado no consulta ni frena', async () => {
    const s = servicio(async () => null, false);
    expect(s.disponible()).toBe(false);
    await expect(s.verificarExiste('t1', CUIT)).resolves.toBeUndefined();
  });
});
