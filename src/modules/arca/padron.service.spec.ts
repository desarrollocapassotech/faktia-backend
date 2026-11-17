import { ConfigService } from '@nestjs/config';
import { PadronService } from './padron.service';

const getTaxpayerDetails = jest.fn();
jest.mock('@afipsdk/afip.js', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ RegisterInscriptionProof: { getTaxpayerDetails } })),
}));

const CUIT = '30546689979';
const ENV = { PADRON_AFIP_SDK_API_KEY: 'k', PADRON_CUIT: '20111111112', PADRON_CERT: 'c', PADRON_KEY: 'k' };

function servicio(env: Record<string, string> = ENV) {
  return new PadronService(new ConfigService(env));
}

const constancia = {
  datosGenerales: {
    razonSocial: 'PE&#209;A SA',
    domicilioFiscal: { direccion: 'Calle 1', localidad: 'CABA', descripcionProvincia: 'CIUDAD AUTONOMA BUENOS AIRES' },
  },
  datosRegimenGeneral: { impuesto: [{ idImpuesto: 30, periodo: 201803 }, { idImpuesto: 10, periodo: 200001 }] },
};

describe('PadronService', () => {
  // ConfigService también lee process.env: que no se cuelen las PADRON_* del .env local.
  const envOriginal = { ...process.env };
  beforeAll(() => {
    for (const n of Object.keys(ENV)) delete process.env[n];
  });
  afterAll(() => {
    process.env = envOriginal;
  });
  beforeEach(() => getTaxpayerDetails.mockReset());

  it('sin las variables PADRON_* no está configurado y responde 503 sin llamar a ARCA', async () => {
    const s = servicio({});
    expect(s.configurado()).toBe(false);
    await expect(s.consultar(CUIT, 't1')).rejects.toMatchObject({ status: 503 });
    expect(getTaxpayerDetails).not.toHaveBeenCalled();
  });

  it('mapea la constancia (decodifica entidades HTML) y la guarda en caché', async () => {
    getTaxpayerDetails.mockResolvedValue(constancia);
    const s = servicio();
    const datos = await s.consultar('30-54668997-9', 't1');
    expect(datos).toMatchObject({ cuit: CUIT, razonSocial: 'PEÑA SA', condicionIva: 'RESPONSABLE_INSCRIPTO' });
    expect(datos?.domicilio).toBe('Calle 1, CABA, CIUDAD AUTONOMA BUENOS AIRES');
    // Inicio de actividades sugerido: el alta del impuesto más antiguo.
    expect(datos?.inicioActividadesSugerido).toBe('2000-01-01');
    await s.consultar(CUIT, 't2');
    expect(getTaxpayerDetails).toHaveBeenCalledTimes(1);
  });

  it('monotributista: toma el alta de los impuestos del monotributo e ignora períodos inválidos', async () => {
    getTaxpayerDetails.mockResolvedValue({
      datosGenerales: { apellido: 'PEREZ', nombre: 'ANA' },
      datosMonotributo: { impuesto: { idImpuesto: 20, periodo: 202501 } },
      datosRegimenGeneral: { impuesto: [{ idImpuesto: 11, periodo: 202607 }, { idImpuesto: 99, periodo: 'x' }] },
    });
    const datos = await servicio().consultar(CUIT, 't1');
    expect(datos).toMatchObject({ condicionIva: 'MONOTRIBUTO', inicioActividadesSugerido: '2025-01-01' });
  });

  it('CUIT inexistente → null; otra falla → 503', async () => {
    getTaxpayerDetails.mockRejectedValueOnce(Object.assign(new Error('x'), { data: { message: 'soap:Server: No existe persona con ese Id' } }));
    await expect(servicio().consultar(CUIT, 't1')).resolves.toBeNull();
    getTaxpayerDetails.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 502, data: 'Bad Gateway' }));
    await expect(servicio().consultar(CUIT, 't1')).rejects.toMatchObject({ status: 503 });
  });

  it('rechaza un dígito verificador inválido sin gastar consulta', async () => {
    await expect(servicio().consultar('30546689970', 't1')).rejects.toMatchObject({ status: 400 });
    expect(getTaxpayerDetails).not.toHaveBeenCalled();
  });

  it('corta en 100 consultas reales por tenant por día (429)', async () => {
    getTaxpayerDetails.mockResolvedValue(null);
    const s = servicio();
    // CUITs distintos con dígito válido, para no pegarle a la caché.
    const cuits: string[] = [];
    for (let n = 10000000; cuits.length < 101; n++) {
      const base = `20${n}`;
      const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
      const resto = 11 - (base.split('').reduce((a, d, i) => a + Number(d) * pesos[i], 0) % 11);
      if (resto === 10) continue;
      cuits.push(base + (resto === 11 ? 0 : resto));
    }
    for (const c of cuits.slice(0, 100)) await s.consultar(c, 't1');
    await expect(s.consultar(cuits[100], 't1')).rejects.toMatchObject({ status: 429 });
    await expect(s.consultar(cuits[100], 'otro-tenant')).resolves.toBeNull();
  });
});
