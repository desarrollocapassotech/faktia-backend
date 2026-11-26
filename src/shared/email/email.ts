import { Global, Logger, Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/** Un email a mandar. `html` y `texto` con el mismo contenido (el texto es para clientes sin HTML). */
export interface Email {
  para: string[];
  asunto: string;
  html: string;
  texto: string;
}

/** Puerto de envío de emails. Los módulos dependen de esto, no de nodemailer. */
export interface EmailPort {
  enviar(email: Email): Promise<void>;
  /** Para mostrar en pantalla si los avisos salen de verdad o solo se registran. */
  readonly tipo: 'smtp' | 'log';
}

export const EMAIL_PORT = Symbol('EMAIL_PORT');

/** Solo registra el email en el log: el default en desarrollo y cuando no hay SMTP configurado. */
export class EmailLog implements EmailPort {
  readonly tipo = 'log' as const;
  private readonly logger = new Logger('Email');
  readonly enviados: Email[] = [];

  async enviar(email: Email): Promise<void> {
    this.enviados.push(email);
    this.logger.log(`(sin SMTP) Para: ${email.para.join(', ')} · Asunto: ${email.asunto}\n${email.texto}`);
  }
}

export interface ConfigSmtp {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

/** Envío real por SMTP (cualquier proveedor: Gmail, Brevo, SES…). */
export class EmailSmtp implements EmailPort {
  readonly tipo = 'smtp' as const;
  private readonly transporte: nodemailer.Transporter;

  constructor(private readonly config: ConfigSmtp) {
    this.transporte = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    });
  }

  async enviar(email: Email): Promise<void> {
    await this.transporte.sendMail({ from: this.config.from, to: email.para, subject: email.asunto, html: email.html, text: email.texto });
  }
}

/**
 * SMTP si están SMTP_HOST y SMTP_FROM (o EMAIL_TRANSPORTE=smtp); si no, el que solo registra.
 * EMAIL_TRANSPORTE=log fuerza el log aunque haya SMTP (útil en desarrollo con un .env compartido).
 */
export function crearEmailPort(config: Pick<ConfigService, 'get'>): EmailPort {
  const transporte = config.get<string>('EMAIL_TRANSPORTE');
  const host = config.get<string>('SMTP_HOST');
  const from = config.get<string>('SMTP_FROM');
  if (transporte === 'log' || !host || !from) {
    if (transporte === 'smtp') throw new Error('EMAIL_TRANSPORTE=smtp necesita SMTP_HOST y SMTP_FROM.');
    return new EmailLog();
  }
  const port = Number(config.get<string>('SMTP_PORT') ?? 587);
  return new EmailSmtp({
    host,
    port,
    secure: (config.get<string>('SMTP_SECURE') ?? (port === 465 ? 'true' : 'false')) === 'true',
    user: config.get<string>('SMTP_USER') || undefined,
    pass: config.get<string>('SMTP_PASS') || undefined,
    from,
  });
}

const proveedor: Provider = { provide: EMAIL_PORT, inject: [ConfigService], useFactory: crearEmailPort };

@Global()
@Module({ providers: [proveedor], exports: [proveedor] })
export class EmailModule {}
