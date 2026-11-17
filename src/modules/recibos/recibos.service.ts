import { BadRequestException, Injectable } from '@nestjs/common';
import { dibujarGeneradoCon, fuentesPdf } from '../../shared/pdf/marca-pdf';
import { formatearCuit } from '../../shared/util/cuit';
import { TenantsService } from '../tenants';
import { generarRecibo, ReciboInvalidoError, type Parte, type ReciboInput, type ReciboOutput } from './core';
import { GenerarReciboDto } from './dto/recibos.dto';

/** Adapta el generador puro a Faktia: la parte del tenant y el estilo salen de su configuración. */
@Injectable()
export class RecibosService {
  constructor(private readonly tenants: TenantsService) {}

  async generar(tenantId: string, dto: GenerarReciboDto): Promise<ReciboOutput> {
    const [emisor, plantilla] = await Promise.all([this.tenants.obtenerEmisorCompleto(tenantId), this.tenants.obtenerPlantilla(tenantId)]);
    const tenant: Parte = {
      nombre: emisor.razonSocial,
      documento: `CUIT ${formatearCuit(emisor.cuit)}`,
      domicilio: emisor.domicilioFiscal,
    };
    const base = {
      numero: dto.numero,
      fecha: dto.fecha,
      moneda: dto.moneda,
      items: dto.items,
      total: dto.total,
      medioPago: dto.medioPago,
      observaciones: dto.observaciones,
    };
    const input: ReciboInput =
      dto.tipo === 'COBRO'
        ? { ...base, tipo: 'COBRO', emisor: tenant, pagador: dto.contraparte, comprobantesAplicados: dto.comprobantesAplicados }
        : { ...base, tipo: 'PAGO', pagador: tenant, beneficiario: dto.contraparte, periodo: dto.periodo };

    const fuentes = fuentesPdf();
    try {
      return await generarRecibo(input, {
        logo: plantilla.logo ?? undefined,
        logoMime: plantilla.logoMime ?? undefined,
        colorPrimario: plantilla.colorPrimario,
        colorSecundario: plantilla.colorSecundario,
        // El pie de la plantilla (datos para el pago) es para las facturas: en el recibo no va.
        // En el de cobro no se firma: quedan el nombre y el CUIT de quien cobra.
        lineaFirma: dto.tipo !== 'COBRO',
        fuentes: { normal: fuentes.normal, seminegrita: fuentes.seminegrita, italica: fuentes.italica },
        marcaPie: dibujarGeneradoCon,
      });
    } catch (err) {
      if (err instanceof ReciboInvalidoError) throw new BadRequestException(err.message);
      throw err;
    }
  }
}
