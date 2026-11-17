// Condiciones para pasar un tenant a producción (Fase 6). Función pura: los datos los junta el servicio.

export type IdChequeo = 'emisor' | 'afipsdk' | 'certificado' | 'punto-venta' | 'borradores';

export interface Chequeo {
  id: IdChequeo;
  titulo: string;
  ok: boolean;
  /** Si es obligatorio, sin él no se puede activar producción. */
  obligatorio: boolean;
  mensaje: string;
}

export interface DatosChequeo {
  emisor: { razonSocial: string | null; domicilioFiscal: string | null; inicioActividades: Date | null; cuit: string | null };
  afipSdkConfigurado: boolean;
  certificado: { venceEl: Date; alias: string | null } | null;
  puntosVentaProduccion: number[];
  borradoresHomologacion: number;
  ahora?: Date;
}

const DIA = 86_400_000;

function ddmmaaaa(d: Date): string {
  const [a, m, dd] = d.toISOString().slice(0, 10).split('-');
  return `${dd}/${m}/${a}`;
}

export function evaluarChecklist(d: DatosChequeo): Chequeo[] {
  const ahora = d.ahora ?? new Date();
  const faltan = [
    !d.emisor.razonSocial?.trim() && 'razón social',
    !d.emisor.domicilioFiscal?.trim() && 'domicilio fiscal',
    !d.emisor.inicioActividades && 'inicio de actividades',
    !/^\d{11}$/.test(d.emisor.cuit ?? '') && 'CUIT',
  ].filter(Boolean);

  const dias = d.certificado ? Math.floor((d.certificado.venceEl.getTime() - ahora.getTime()) / DIA) : null;

  return [
    {
      id: 'emisor',
      titulo: 'Datos fiscales del emisor',
      ok: faltan.length === 0,
      obligatorio: true,
      mensaje: faltan.length ? `Falta: ${faltan.join(', ')}.` : 'Completos.',
    },
    {
      id: 'afipsdk',
      titulo: 'Servicio de conexión con ARCA',
      ok: d.afipSdkConfigurado,
      obligatorio: true,
      mensaje: d.afipSdkConfigurado ? 'Configurado.' : 'Falta configurar AFIP_SDK_API_KEY en el servidor.',
    },
    {
      id: 'certificado',
      titulo: 'Certificado de producción',
      ok: dias !== null && dias >= 0,
      obligatorio: true,
      mensaje:
        dias === null
          ? 'Falta cargarlo (Configuración → Certificados ARCA, ambiente Producción).'
          : dias < 0
            ? `Venció el ${ddmmaaaa(d.certificado!.venceEl)}: cargá uno nuevo.`
            : dias <= 30
              ? `Vence el ${ddmmaaaa(d.certificado!.venceEl)} (en ${dias} días): conviene renovarlo pronto.`
              : `Vigente hasta el ${ddmmaaaa(d.certificado!.venceEl)}.`,
    },
    {
      id: 'punto-venta',
      titulo: 'Punto de venta de producción',
      ok: d.puntosVentaProduccion.length > 0,
      obligatorio: true,
      mensaje: d.puntosVentaProduccion.length
        ? `Activo: ${d.puntosVentaProduccion.map((n) => String(n).padStart(5, '0')).join(', ')}. Tiene que estar dado de alta en ARCA como "RECE / Web Services".`
        : 'Falta cargar un punto de venta de producción (el que diste de alta en ARCA para Web Services).',
    },
    {
      id: 'borradores',
      titulo: 'Borradores de prueba',
      ok: d.borradoresHomologacion === 0,
      obligatorio: false,
      mensaje: d.borradoresHomologacion
        ? `Hay ${d.borradoresHomologacion} borrador(es) armados en homologación: no se van a poder emitir en producción (hay que volver a generarlos).`
        : 'No hay borradores de homologación pendientes.',
    },
  ];
}

export function listoParaProduccion(chequeos: Chequeo[]): boolean {
  return chequeos.every((c) => c.ok || !c.obligatorio);
}
