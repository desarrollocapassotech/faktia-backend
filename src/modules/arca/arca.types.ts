export type AmbienteArca = 'HOMOLOGACION' | 'PRODUCCION';

/** Credenciales ya resueltas y descifradas: viven solo en memoria. */
export interface CredencialesArca {
  tenantId: string;
  ambiente: AmbienteArca;
  /** CUIT con el que se habla con ARCA (en homologación sin certificado, el de prueba de AfipSDK). */
  cuit: string;
  certPem: string | null;
  keyPem: string | null;
  usaCuitPrueba: boolean;
}

export interface SolicitudCae {
  ptoVta: number;
  cbteTipo: number;
  cbteNro: number;
  concepto: 1 | 2 | 3;
  docTipo: number;
  docNro: number;
  condicionIvaReceptorId: number;
  cbteFch: string; // yyyymmdd
  fchServDesde?: string;
  fchServHasta?: string;
  fchVtoPago?: string;
  impTotal: string;
  impTotConc: string;
  impNeto: string;
  impOpEx: string;
  impIva: string;
  impTrib: string;
  monId: 'PES' | 'DOL';
  monCotiz: string;
  canMisMonExt?: 'S' | 'N';
  iva?: Array<{ id: number; baseImp: string; importe: string }>;
  cbtesAsoc?: Array<{ tipo: number; ptoVta: number; nro: number; cuit?: string; cbteFch?: string }>;
}

export interface ObservacionArca {
  codigo: number;
  mensaje: string;
}

export interface CaeOtorgado {
  cae: string;
  caeVto: string; // yyyymmdd
  observaciones: ObservacionArca[];
}

/** Comprobante tal como lo devuelve FECompConsultar. */
export interface ComprobanteArca {
  cae: string;
  caeVto: string;
  cbteFch: string;
  docTipo: number;
  docNro: number;
  impTotal: number;
  resultado: string;
}

export interface DatosPadron {
  cuit: string;
  razonSocial: string;
  domicilio: string | null;
  condicionIva: 'RESPONSABLE_INSCRIPTO' | 'MONOTRIBUTO' | 'EXENTO' | null;
  /**
   * "AAAA-MM-01" del alta del impuesto más antiguo. La constancia no trae la fecha de inicio de
   * actividades: es una aproximación para sugerir, no un dato para dar por cierto.
   */
  inicioActividadesSugerido?: string | null;
  crudo: unknown;
}

/**
 * - RECHAZO: ARCA (o AfipSDK antes de enviar) rechazó; seguro reintentar tras corregir.
 * - INCIERTO: no sabemos si ARCA procesó el pedido (timeout, 5xx, respuesta ilegible).
 * - CONFIGURACION: falta API key, certificado, etc.
 */
export type TipoErrorArca = 'RECHAZO' | 'INCIERTO' | 'CONFIGURACION';

export class ArcaError extends Error {
  constructor(
    public readonly tipo: TipoErrorArca,
    message: string,
    public readonly detalle?: string,
    public readonly codigoArca?: number,
  ) {
    super(message);
    this.name = 'ArcaError';
  }
}
