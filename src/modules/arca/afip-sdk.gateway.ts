import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Afip from '@afipsdk/afip.js';
import { ArcaAuditService } from './arca-audit.service';
import { esPersonaInexistente, mapearError } from './arca-errores';
import type { ArcaGateway, ContextoLlamada } from './arca.gateway';
import {
  ArcaError,
  type CaeOtorgado,
  type ComprobanteArca,
  type CredencialesArca,
  type DatosPadron,
  type SolicitudCae,
} from './arca.types';

// Adaptado de Vialto (liquidaciones-arca/arca-client.service.ts), sin Prisma ni ids de Vialto.

type Obj = Record<string, unknown>;

/** Corrige PEM pegados con "\n" literales o CRLF (afip.js falla con "Invalid PEM formatted message"). */
export function normalizarPem(pem: string): string {
  return pem.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r/g, '').trim() + '\n';
}

function asArray<T>(v: T | T[] | null | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

@Injectable()
export class AfipSdkGateway implements ArcaGateway {
  private readonly logger = new Logger(AfipSdkGateway.name);

  constructor(
    private readonly config: ConfigService,
    private readonly audit: ArcaAuditService,
  ) {}

  private cliente(c: CredencialesArca): Afip {
    const accessToken = this.config.get<string>('AFIP_SDK_API_KEY');
    if (!accessToken) {
      throw new ArcaError('CONFIGURACION', 'Falta AFIP_SDK_API_KEY en el servidor: no se puede hablar con ARCA.');
    }
    const produccion = c.ambiente === 'PRODUCCION';
    if (produccion && (!c.certPem || !c.keyPem)) {
      throw new ArcaError('CONFIGURACION', 'Falta el certificado o la clave privada de producción.');
    }
    return new Afip({
      CUIT: Number(c.cuit),
      access_token: accessToken,
      production: produccion,
      ...(c.certPem && c.keyPem ? { cert: normalizarPem(c.certPem), key: normalizarPem(c.keyPem) } : {}),
    });
  }

  /** Ejecuta una llamada auditada. `puedeHaberLlegado` define si un fallo sin respuesta es INCIERTO. */
  private async llamar<T>(
    c: CredencialesArca,
    metodo: string,
    requestSaneado: unknown,
    ctx: ContextoLlamada | undefined,
    puedeHaberLlegado: boolean,
    fn: (afip: Afip) => Promise<T>,
  ): Promise<T> {
    const inicio = Date.now();
    let response: unknown;
    let error: ArcaError | undefined;
    try {
      const afip = this.cliente(c);
      const r = await fn(afip);
      response = r;
      return r;
    } catch (err) {
      error = mapearError(err, puedeHaberLlegado);
      response = (err as Obj)?.data;
      this.logger.warn(`ARCA ${metodo} falló (${error.tipo}): ${error.message}`);
      throw error;
    } finally {
      await this.audit.registrar({
        tenantId: c.tenantId,
        comprobanteId: ctx?.comprobanteId,
        metodo,
        ambiente: c.ambiente,
        request: { cuit: c.cuit, usaCuitPrueba: c.usaCuitPrueba, ...(requestSaneado as Obj) },
        response,
        exitoso: !error,
        error: error?.message,
        duracionMs: Date.now() - inicio,
      });
    }
  }

  ultimoAutorizado(c: CredencialesArca, ptoVta: number, cbteTipo: number, ctx?: ContextoLlamada) {
    return this.llamar(c, 'FECompUltimoAutorizado', { ptoVta, cbteTipo }, ctx, false, async (afip) => {
      const n = Number(await afip.ElectronicBilling.getLastVoucher(ptoVta, cbteTipo));
      return Number.isFinite(n) && n >= 0 ? n : 0;
    });
  }

  autorizar(c: CredencialesArca, s: SolicitudCae, ctx?: ContextoLlamada): Promise<CaeOtorgado> {
    const detalle: Obj = {
      Concepto: s.concepto,
      DocTipo: s.docTipo,
      DocNro: s.docNro,
      CbteDesde: s.cbteNro,
      CbteHasta: s.cbteNro,
      CbteFch: Number(s.cbteFch),
      ImpTotal: Number(s.impTotal),
      ImpTotConc: Number(s.impTotConc),
      ImpNeto: Number(s.impNeto),
      ImpOpEx: Number(s.impOpEx),
      ImpIVA: Number(s.impIva),
      ImpTrib: Number(s.impTrib),
      MonId: s.monId,
      MonCotiz: Number(s.monCotiz),
      CondicionIVAReceptorId: s.condicionIvaReceptorId,
      ...(s.canMisMonExt ? { CanMisMonExt: s.canMisMonExt } : {}),
      ...(s.fchServDesde ? { FchServDesde: s.fchServDesde, FchServHasta: s.fchServHasta, FchVtoPago: s.fchVtoPago } : {}),
      ...(s.iva?.length
        ? { Iva: { AlicIva: s.iva.map((a) => ({ Id: a.id, BaseImp: Number(a.baseImp), Importe: Number(a.importe) })) } }
        : {}),
      ...(s.cbtesAsoc?.length
        ? {
            CbtesAsoc: {
              CbteAsoc: s.cbtesAsoc.map((a) => ({
                Tipo: a.tipo,
                PtoVta: a.ptoVta,
                Nro: a.nro,
                ...(a.cuit ? { Cuit: a.cuit } : {}),
                ...(a.cbteFch ? { CbteFch: a.cbteFch } : {}),
              })),
            },
          }
        : {}),
    };
    const request = {
      FeCAEReq: { FeCabReq: { CantReg: 1, PtoVta: s.ptoVta, CbteTipo: s.cbteTipo }, FeDetReq: { FECAEDetRequest: detalle } },
    };

    return this.llamar(c, 'FECAESolicitar', request, ctx, true, async (afip) => {
      // executeRequest agrega Auth y lanza AfipWebServiceError si hay Errors o Resultado ≠ A.
      const res = (await afip.ElectronicBilling.executeRequest('FECAESolicitar', request)) as Obj;
      const det = asArray((res?.FeDetResp as Obj | undefined)?.FECAEDetResponse as Obj | Obj[])[0];
      if (!det || det.Resultado !== 'A' || !det.CAE) {
        // Respuesta sin CAE ni error explícito: no sabemos qué pasó.
        throw new ArcaError('INCIERTO', 'ARCA respondió sin CAE.', JSON.stringify(res).slice(0, 4000));
      }
      const obs = asArray((det.Observaciones as Obj | undefined)?.Obs as Obj | Obj[]).map((o) => ({
        codigo: Number(o.Code),
        mensaje: String(o.Msg ?? ''),
      }));
      return { cae: String(det.CAE), caeVto: String(det.CAEFchVto), observaciones: obs };
    });
  }

  consultar(c: CredencialesArca, ptoVta: number, cbteTipo: number, numero: number, ctx?: ContextoLlamada) {
    return this.llamar(
      c,
      'FECompConsultar',
      { ptoVta, cbteTipo, numero },
      ctx,
      false,
      async (afip): Promise<ComprobanteArca | null> => {
        const r = (await afip.ElectronicBilling.getVoucherInfo(numero, ptoVta, cbteTipo)) as Obj | null;
        if (!r) return null;
        return {
          cae: String(r.CodAutorizacion ?? ''),
          caeVto: String(r.FchVto ?? ''),
          cbteFch: String(r.CbteFch ?? ''),
          docTipo: Number(r.DocTipo),
          docNro: Number(r.DocNro),
          impTotal: Number(r.ImpTotal),
          resultado: String(r.Resultado ?? ''),
        };
      },
    );
  }

  cotizacionDolar(c: CredencialesArca, ctx?: ContextoLlamada) {
    return this.llamar(c, 'FEParamGetCotizacion', { MonId: 'DOL' }, ctx, false, async (afip) => {
      const r = (await afip.ElectronicBilling.executeRequest('FEParamGetCotizacion', { MonId: 'DOL' })) as Obj;
      const cotiz = (r?.ResultGet as Obj | undefined)?.MonCotiz;
      if (cotiz == null) throw new ArcaError('RECHAZO', 'ARCA no devolvió la cotización del dólar.');
      return String(cotiz);
    });
  }

  consultarPadron(c: CredencialesArca, cuit: string) {
    return this.llamar(c, 'ws_sr_constancia_inscripcion', { cuit }, undefined, false, async (afip) => {
      let r: Obj | null;
      try {
        r = (await afip.RegisterInscriptionProof.getTaxpayerDetails(Number(cuit))) as Obj | null;
      } catch (err) {
        // El CUIT no está en el padrón: no es una falla de ARCA, es "sin datos".
        if (esPersonaInexistente(err)) return null;
        throw err;
      }
      return r ? mapearPadron(cuit, r) : null;
    });
  }
}

/** Normaliza la constancia de inscripción (best effort: la forma varía según el tipo de persona). */
export function mapearPadron(cuit: string, r: Obj): DatosPadron {
  const gen = (r.datosGenerales ?? {}) as Obj;
  const razonSocial =
    (gen.razonSocial as string | undefined) ??
    [gen.apellido, gen.nombre].filter((x) => typeof x === 'string' && x).join(' ');
  const dom = (gen.domicilioFiscal ?? {}) as Obj;
  const domicilio =
    [dom.direccion, dom.localidad, dom.descripcionProvincia].filter((x) => typeof x === 'string' && x).join(', ') ||
    null;

  let condicionIva: DatosPadron['condicionIva'] = null;
  if (r.datosMonotributo) {
    condicionIva = 'MONOTRIBUTO';
  } else {
    const impuestos = asArray(((r.datosRegimenGeneral ?? {}) as Obj).impuesto as Obj | Obj[]);
    const ids = impuestos.map((i) => Number(i.idImpuesto));
    if (ids.includes(30)) condicionIva = 'RESPONSABLE_INSCRIPTO';
    else if (ids.includes(32)) condicionIva = 'EXENTO';
  }

  return { cuit, razonSocial: razonSocial || '', domicilio, condicionIva, inicioActividadesSugerido: altaMasAntigua(r), crudo: r };
}

/** Período (AAAAMM) de alta del impuesto más antiguo, como "AAAA-MM-01". */
function altaMasAntigua(r: Obj): string | null {
  const impuestos = [
    ...asArray(((r.datosRegimenGeneral ?? {}) as Obj).impuesto as Obj | Obj[]),
    ...asArray(((r.datosMonotributo ?? {}) as Obj).impuesto as Obj | Obj[]),
  ];
  const periodos = impuestos
    .map((i) => String(i.periodo ?? '').slice(0, 6))
    .filter((p) => /^\d{6}$/.test(p) && Number(p.slice(0, 4)) >= 1900 && Number(p.slice(4)) >= 1 && Number(p.slice(4)) <= 12)
    .sort();
  return periodos[0] ? `${periodos[0].slice(0, 4)}-${periodos[0].slice(4)}-01` : null;
}
