/**
 * Único contrato de autenticación que ven los demás módulos.
 * Si se reemplaza el login propio por Clerk, cambia cómo se arma este objeto
 * (dentro de `auth`), no quién lo consume.
 */
export interface AuthContext {
  tenantId: string;
  tipo: 'usuario' | 'integracion';
  usuarioId?: string;
  integracionId?: string;
  /** Solo integraciones: origen con el que se registran sus ítems (TRACKER, API, …). */
  origenIntegracion?: 'TRACKER' | 'API' | 'EXCEL' | 'MANUAL';
  scopes: string[];
  /** Módulos habilitados de la empresa (shared/modulos). Las rutas con @Modulo(...) los exigen. */
  modulos?: string[];
}

/** Payload del JWT de sesión. Claves cortas a propósito. */
export interface SesionJwtPayload {
  sub: string; // usuarioId
  tid: string; // tenantId
  tv: number; // tokenVersion del usuario al emitir
}
