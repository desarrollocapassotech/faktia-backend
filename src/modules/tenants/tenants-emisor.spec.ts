import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { TenantsService } from './tenants.service';

function crear(tenant: Record<string, unknown>) {
  const fila = {
    id: 't1',
    slug: 'efe',
    nombreFantasia: 'EFE',
    razonSocial: null,
    cuit: null,
    condicionIva: null,
    domicilioFiscal: null,
    ingresosBrutos: null,
    inicioActividades: null,
    ambienteArca: 'HOMOLOGACION',
    camposDeArca: [] as string[],
    ...tenant,
  };
  const prisma = {
    tenant: {
      findUnique: jest.fn(async () => ({ ...fila })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        for (const [k, v] of Object.entries(data)) if (v !== undefined) Object.assign(fila, { [k]: v });
        return fila;
      }),
    },
  } as unknown as PrismaService;
  return { service: new TenantsService(prisma), fila };
}

describe('TenantsService.actualizarEmisor y los campos de ARCA', () => {
  it('al cargar el CUIT, lo que vino de ARCA pisa al formulario y queda bloqueado', async () => {
    const { service, fila } = crear({});
    const emisor = await service.actualizarEmisor(
      't1',
      { cuit: '27390336530', razonSocial: 'escrito a mano', domicilioFiscal: 'Calle 1', condicionIva: 'MONOTRIBUTO' },
      { razonSocial: 'FOOS FLORENCIA MABEL', domicilioFiscal: 'D. FRENCH 668' },
    );
    expect(fila).toMatchObject({ razonSocial: 'FOOS FLORENCIA MABEL', domicilioFiscal: 'D. FRENCH 668', condicionIva: 'MONOTRIBUTO' });
    expect(emisor.camposDeArca).toEqual(['razonSocial', 'domicilioFiscal']);
  });

  it('rechaza cambiar un campo bloqueado; mandar el mismo valor o editar otro campo sí se puede', async () => {
    const { service, fila } = crear({ cuit: '27390336530', razonSocial: 'FOOS FLORENCIA MABEL', camposDeArca: ['razonSocial'] });
    await expect(service.actualizarEmisor('t1', { razonSocial: 'Otra' })).rejects.toThrow(BadRequestException);
    await expect(service.actualizarEmisor('t1', { razonSocial: ' FOOS FLORENCIA MABEL ', nombreFantasia: 'Nuevo' })).resolves.toBeDefined();
    expect(fila.nombreFantasia).toBe('Nuevo');
  });
});
