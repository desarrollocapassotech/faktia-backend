/**
 * Módulos que se habilitan por empresa (Tenant.modulosHabilitados). Clientes, Configuración y Perfil
 * no están acá: los usa siempre todo el sistema.
 * - comprobantes: facturación electrónica (ARCA).
 * - recibos: recibos de cobro. recibos-pago: recibos de pago (a empleados, contratistas, proveedores).
 * - cuenta-corriente, proyectos, presupuestos, materiales (incluye proveedores).
 * - importaciones (Excel/CSV), integraciones (API keys y API pública /v1), webhooks.
 */
export const MODULOS = [
  'comprobantes',
  'recibos',
  'recibos-pago',
  'cuenta-corriente',
  'proyectos',
  'presupuestos',
  'materiales',
  'importaciones',
  'integraciones',
  'webhooks',
] as const;

export type ModuloFaktia = (typeof MODULOS)[number];

export function esModulo(valor: string): valor is ModuloFaktia {
  return (MODULOS as readonly string[]).includes(valor);
}

/** Lo que trae una empresa nueva: todo habilitado (el administrador de Faktia oculta lo que no contrató). */
export const MODULOS_POR_DEFECTO: ModuloFaktia[] = [...MODULOS];

export const MODULO_DESHABILITADO = 'Este módulo no está habilitado para tu empresa.';
