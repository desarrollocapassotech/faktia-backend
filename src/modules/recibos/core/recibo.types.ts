// Tipos públicos del generador de recibos. Sin imports de Nest, Prisma ni otros módulos (ARCHITECTURE.md §7.7).

export interface Parte {
  nombre: string;
  documento?: string; // "CUIT 20-12345678-9", "DNI 12.345.678"… ya formateado
  domicilio?: string;
}

export type MonedaRecibo = 'ARS' | 'USD';

export interface ItemRecibo {
  descripcion: string;
  cantidad?: string; // texto libre: "10 hs", "1"
  importe: string; // "1234.56"
}

interface ReciboBase {
  /** Lo asigna quien pide el recibo (numeraciones separadas por tipo). */
  numero?: string;
  fecha: string; // YYYY-MM-DD
  items: ItemRecibo[];
  moneda: MonedaRecibo;
  /** Se valida que coincida con la suma de los ítems. */
  total: string;
  medioPago?: string;
  observaciones?: string;
}

/** Recibo de COBRO: el emisor recibe dinero de su cliente y firma. */
export interface ReciboCobro extends ReciboBase {
  tipo: 'COBRO';
  emisor: Parte;
  pagador: Parte;
  /** Facturas u otros comprobantes que cancela (informativo: puede ser un pago parcial). */
  comprobantesAplicados?: Array<{ descripcion: string; importe: string }>;
}

/** Recibo de PAGO: se le paga a un colaborador o proveedor; el beneficiario firma que recibió. */
export interface ReciboPago extends ReciboBase {
  tipo: 'PAGO';
  pagador: Parte;
  beneficiario: Parte;
  periodo?: string; // "Septiembre 2026"
}

export type ReciboInput = ReciboCobro | ReciboPago;

export interface ReciboEstilo {
  logo?: Uint8Array;
  logoMime?: string;
  colorPrimario?: string; // #RRGGBB
  colorSecundario?: string;
  textoPie?: string;
  /** Línea y leyenda para firmar (por defecto sí); sin ella, al pie quedan solo nombre y documento. */
  lineaFirma?: boolean;
  /** Tipografía TTF a usar en lugar de Helvetica (las que falten siguen en Helvetica). */
  fuentes?: { normal?: Uint8Array; seminegrita?: Uint8Array; italica?: Uint8Array };
  /**
   * Dibuja algo a la derecha del pie de la última página (por ejemplo, la marca del sistema que generó
   * el recibo), con el renglón arrancando en `y`. Devuelve el ancho que ocupó.
   */
  marcaPie?: (doc: PDFKit.PDFDocument, xDerecha: number, y: number) => number;
  /**
   * Código QR (imagen PNG ya generada) que se dibuja abajo a la izquierda, a la altura de la firma,
   * con su leyenda al lado (ej. un link para verificar el recibo).
   */
  qr?: { imagen: Uint8Array; leyenda: string };
}

export interface ReciboOutput {
  pdf: Buffer;
  filename: string;
}

export class ReciboInvalidoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReciboInvalidoError';
  }
}
