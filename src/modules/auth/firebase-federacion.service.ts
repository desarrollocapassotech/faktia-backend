import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createVerify } from 'crypto';
import type { AuthContext } from './auth-context';
import { IntegracionesService } from './integraciones.service';
import { normalizarEmail } from './password';

/**
 * Federación con Firebase Auth para sistemas integrados que no tienen backend propio
 * (ej. el panel de EFE Capital, una SPA en Firebase Hosting).
 *
 * En las rutas `@ApiKey(...)`, en lugar de `X-Api-Key` se acepta
 * `Authorization: Bearer <Firebase ID token>`. El token se verifica contra los certificados
 * públicos de Google y se traduce a la integración configurada: mismos scopes, mismo origen,
 * y el email del usuario queda como quien actúa (auditoría), igual que `X-Usuario-Email`.
 *
 * Config (`FIREBASE_FEDERACION`, JSON):
 *   [{ "projectId": "efecapitaladmin", "integracionId": "<id de Integracion>", "emails": ["persona@dominio.com"] }]
 * Solo los emails listados pueden operar. Sin la variable, la federación está apagada.
 */

interface ReglaFederacion {
  projectId: string;
  integracionId: string;
  emails: string[];
}

interface FirebaseClaims {
  iss?: string;
  aud?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  auth_time?: number;
  email?: string;
}

const URL_CERTIFICADOS = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const TOLERANCIA_SEG = 60;
const NO_AUTORIZADO = 'Sesión de Firebase inválida o sin acceso a Faktia.';

const base64url = (parte: string) => Buffer.from(parte.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

@Injectable()
export class FirebaseFederacionService {
  private readonly logger = new Logger(FirebaseFederacionService.name);
  private readonly reglas: ReglaFederacion[];
  private certificados: { porKid: Record<string, string>; vence: number } | null = null;

  constructor(
    config: ConfigService,
    private readonly integraciones: IntegracionesService,
  ) {
    this.reglas = FirebaseFederacionService.leerReglas(config.get<string>('FIREBASE_FEDERACION'));
    if (this.reglas.length) {
      this.logger.log(`Federación Firebase activa para: ${this.reglas.map((r) => r.projectId).join(', ')}`);
    }
  }

  static leerReglas(crudo: string | undefined): ReglaFederacion[] {
    if (!crudo?.trim()) return [];
    let datos: unknown;
    try {
      datos = JSON.parse(crudo);
    } catch {
      throw new Error('FIREBASE_FEDERACION no es un JSON válido.');
    }
    if (!Array.isArray(datos)) throw new Error('FIREBASE_FEDERACION debe ser una lista.');
    return datos.map((r, i) => {
      const regla = r as Partial<ReglaFederacion>;
      if (!regla.projectId || !regla.integracionId || !Array.isArray(regla.emails) || !regla.emails.length) {
        throw new Error(`FIREBASE_FEDERACION[${i}] necesita projectId, integracionId y al menos un email.`);
      }
      return {
        projectId: String(regla.projectId),
        integracionId: String(regla.integracionId),
        emails: regla.emails.map((e) => normalizarEmail(String(e))),
      };
    });
  }

  get activa(): boolean {
    return this.reglas.length > 0;
  }

  /**
   * Devuelve el AuthContext si `token` es un ID token de Firebase de un proyecto configurado;
   * `null` si no parece un token de Firebase (para que el guard siga con su mensaje normal).
   */
  async validar(token: string): Promise<AuthContext | null> {
    if (!this.activa) return null;

    const partes = token.split('.');
    if (partes.length !== 3) return null;

    let header: { alg?: string; kid?: string };
    let claims: FirebaseClaims;
    try {
      header = JSON.parse(base64url(partes[0]).toString('utf8'));
      claims = JSON.parse(base64url(partes[1]).toString('utf8'));
    } catch {
      return null;
    }

    const regla = this.reglas.find((r) => claims.iss === `https://securetoken.google.com/${r.projectId}`);
    if (!regla) return null; // no es de un proyecto federado

    if (header.alg !== 'RS256' || !header.kid) throw new UnauthorizedException(NO_AUTORIZADO);

    const certificado = (await this.obtenerCertificados())[header.kid];
    if (!certificado) throw new UnauthorizedException(NO_AUTORIZADO);

    const firmaValida = createVerify('RSA-SHA256')
      .update(`${partes[0]}.${partes[1]}`)
      .verify(certificado, base64url(partes[2]));
    if (!firmaValida) throw new UnauthorizedException(NO_AUTORIZADO);

    const ahora = Math.floor(Date.now() / 1000);
    const claimsValidos =
      claims.aud === regla.projectId &&
      typeof claims.sub === 'string' &&
      claims.sub.length > 0 &&
      typeof claims.exp === 'number' &&
      claims.exp > ahora - TOLERANCIA_SEG &&
      typeof claims.iat === 'number' &&
      claims.iat <= ahora + TOLERANCIA_SEG &&
      (claims.auth_time === undefined || claims.auth_time <= ahora + TOLERANCIA_SEG);
    if (!claimsValidos) throw new UnauthorizedException(NO_AUTORIZADO);

    const email = claims.email ? normalizarEmail(claims.email) : '';
    if (!email || !regla.emails.includes(email)) {
      this.logger.warn(`Firebase: ${email || claims.sub} no está habilitado para ${regla.projectId}.`);
      throw new UnauthorizedException(NO_AUTORIZADO);
    }

    const auth = await this.integraciones.contextoDeIntegracion(regla.integracionId);
    return this.integraciones.actuarComo(auth, email);
  }

  /** Certificados públicos de Google, cacheados según su Cache-Control. */
  private async obtenerCertificados(): Promise<Record<string, string>> {
    if (this.certificados && this.certificados.vence > Date.now()) return this.certificados.porKid;

    const respuesta = await fetch(URL_CERTIFICADOS);
    if (!respuesta.ok) throw new UnauthorizedException('No se pudieron validar las credenciales de Firebase.');
    const porKid = (await respuesta.json()) as Record<string, string>;
    const maxAge = Number(/max-age=(\d+)/.exec(respuesta.headers.get('cache-control') ?? '')?.[1] ?? 3600);
    this.certificados = { porKid, vence: Date.now() + maxAge * 1000 };
    return porKid;
  }
}
