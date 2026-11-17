import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { DatosPadron, PadronService } from '../arca';
import { PadronEmisorService } from './padron-emisor.service';
import type { CampoArca, EmisorDatos, TenantsService } from './tenants.service';

const CUIT = '27390336530';
const PADRON: DatosPadron = {
  cuit: CUIT,
  razonSocial: 'FOOS FLORENCIA MABEL',
  domicilio: 'D. FRENCH 668, GENERAL RAMIREZ, ENTRE RIOS',
  condicionIva: 'MONOTRIBUTO',
  inicioActividadesSugerido: '2025-01-01',
  crudo: {},
};

function emisor(over: Partial<EmisorDatos> = {}): EmisorDatos {
  return {
    id: 't1',
    slug: 'efe',
    nombreFantasia: 'EFE Capital',
    razonSocial: 'Foos Florencia Mabel',
    cuit: CUIT,
    condicionIva: 'MONOTRIBUTO',
    domicilioFiscal: 'D French 668 - General Ramírez, Entre Ríos',
    ingresosBrutos: null,
    inicioActividades: null,
    ambienteArca: 'HOMOLOGACION',
    camposDeArca: [],
    datosFiscalesCompletos: true,
    ...over,
  };
}

function servicio(consultar: () => Promise<DatosPadron | null>, opciones: { configurado?: boolean; emisor?: EmisorDatos } = {}) {
  const marcar = jest.fn(async (_t: string, campos: CampoArca[]) => campos);
  const tenants = { obtenerEmisor: jest.fn(async () => opciones.emisor ?? emisor()), marcarCamposDeArca: marcar } as unknown as TenantsService;
  const padron = { configurado: () => opciones.configurado ?? true, consultar: jest.fn(consultar) } as unknown as PadronService;
  return { s: new PadronEmisorService(padron, tenants), marcar };
}

const caido = async (): Promise<never> => {
  throw new ServiceUnavailableException('ARCA caído');
};

describe('PadronEmisorService', () => {
  it('consultar devuelve los datos para autocompletar; 404 si ARCA no lo conoce', async () => {
    await expect(servicio(async () => PADRON).s.consultar('t1', CUIT)).resolves.toMatchObject({
      razonSocial: 'FOOS FLORENCIA MABEL',
      inicioActividadesSugerido: '2025-01-01',
    });
    await expect(servicio(async () => null).s.consultar('t1', CUIT)).rejects.toThrow(NotFoundException);
  });

  describe('datosParaAlta', () => {
    it('devuelve lo que informó ARCA (eso se guarda y queda bloqueado)', async () => {
      await expect(servicio(async () => ({ ...PADRON, condicionIva: null })).s.datosParaAlta('t1', CUIT)).resolves.toEqual({
        razonSocial: 'FOOS FLORENCIA MABEL',
        domicilioFiscal: 'D. FRENCH 668, GENERAL RAMIREZ, ENTRE RIOS',
      });
    });

    it('frena si no existe o el CUIT es inválido', async () => {
      await expect(servicio(async () => null).s.datosParaAlta('t1', CUIT)).rejects.toThrow(NotFoundException);
      await expect(
        servicio(async () => {
          throw new BadRequestException('inválido');
        }).s.datosParaAlta('t1', CUIT),
      ).rejects.toThrow(BadRequestException);
    });

    it('si ARCA no responde o no está configurado, deja seguir sin datos de ARCA', async () => {
      await expect(servicio(caido).s.datosParaAlta('t1', CUIT)).resolves.toBeUndefined();
      await expect(servicio(async () => PADRON, { configurado: false }).s.datosParaAlta('t1', CUIT)).resolves.toBeUndefined();
    });
  });

  describe('sincronizar', () => {
    it('bloquea los campos guardados que coinciden con ARCA (domicilio escrito distinto incluido)', async () => {
      const { s, marcar } = servicio(async () => PADRON);
      await expect(s.sincronizar('t1')).resolves.toEqual({
        camposDeArca: ['razonSocial', 'condicionIva', 'domicilioFiscal'],
        inicioActividadesSugerido: '2025-01-01',
      });
      expect(marcar).toHaveBeenCalledWith('t1', ['razonSocial', 'condicionIva', 'domicilioFiscal']);
    });

    it('no bloquea lo que difiere y no vuelve a marcar lo ya bloqueado', async () => {
      const { s, marcar } = servicio(async () => PADRON, {
        emisor: emisor({ razonSocial: 'Otra SA', camposDeArca: ['condicionIva'] }),
      });
      await s.sincronizar('t1');
      expect(marcar).toHaveBeenCalledWith('t1', ['domicilioFiscal']);
    });

    it('sin CUIT guardado no consulta', async () => {
      const { s } = servicio(async () => PADRON, { emisor: emisor({ cuit: null }) });
      await expect(s.sincronizar('t1')).rejects.toThrow(BadRequestException);
    });
  });
});
