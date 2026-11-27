import { crearEmailPort, EmailLog, EmailSmtp } from './email';

const config = (vars: Record<string, string>) => ({ get: <T>(k: string) => vars[k] as T });

describe('crearEmailPort', () => {
  it('sin SMTP configurado, solo registra (default en desarrollo)', () => {
    expect(crearEmailPort(config({}))).toBeInstanceOf(EmailLog);
  });
  it('con SMTP_HOST y SMTP_FROM, manda por SMTP', () => {
    expect(crearEmailPort(config({ SMTP_HOST: 'smtp.ejemplo.com', SMTP_FROM: 'Faktia <avisos@ejemplo.com>' }))).toBeInstanceOf(EmailSmtp);
  });
  it('EMAIL_TRANSPORTE=log gana aunque haya SMTP', () => {
    expect(crearEmailPort(config({ EMAIL_TRANSPORTE: 'log', SMTP_HOST: 'h', SMTP_FROM: 'f' }))).toBeInstanceOf(EmailLog);
  });
  it('EMAIL_TRANSPORTE=smtp sin datos falla al arrancar', () => {
    expect(() => crearEmailPort(config({ EMAIL_TRANSPORTE: 'smtp' }))).toThrow(/SMTP_HOST/);
  });
  it('el log guarda lo enviado', async () => {
    const log = new EmailLog();
    await log.enviar({ para: ['a@b.c'], asunto: 'Hola', html: '<p>x</p>', texto: 'x' });
    expect(log.enviados).toHaveLength(1);
  });
});
