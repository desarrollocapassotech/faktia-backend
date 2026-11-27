# Faktia — backend

Faktia: sistema de facturación electrónica multi-tenant (ARCA). NestJS 10 + Prisma 6 + PostgreSQL (Neon) + pdfkit. Emisión WSFE vía AfipSDK.
Arquitectura en `../ARCHITECTURE.md` (módulos §4, flujos §8, seguridad §9, decisiones §10); estado, pendientes y gotchas en `../PLAN.md`. Frontend en `../faktia-frontend`.

## Forma de trabajo

- **No crear ramas, commits ni push.** Se trabaja sobre la rama actual y el usuario commitea. Al terminar, decir qué archivos van juntos.
- Antes de dar algo por terminado, correr lo mismo que el CI:
  1. `npm run typecheck`
  2. `npm run lint`
  3. `npm run deps` (límites entre módulos)
  4. `npm test`
  5. `npm run build`
  6. si cambia la API: `npm run openapi` y commitear `docs/openapi.json`.
- Finales de línea LF (`.gitattributes`). Archivos en UTF-8 sin BOM.
- Código, nombres y comentarios en español, como el resto del proyecto. Mensajes de error para el usuario en español rioplatense.

## Arquitectura (reglas que no se rompen)

- **Un módulo solo importa el `index.ts` público de otro.** Nunca servicios internos, entidades Prisma ni tablas ajenas. Lo controla `npm run deps` (`.dependency-cruiser.cjs`).
- **`recibos/core` es independiente:** solo pdfkit y sus propios archivos (se va a publicar aparte). Lo que necesite del resto de Faktia (fuentes, marca del pie) entra por parámetro en `ReciboEstilo`.
- **`shared/` no conoce a los módulos.**
- La comunicación asincrónica va por eventos (`comprobante.emitido`, `comprobante.rechazado`, `importacion.confirmada`); `comprobantes` no conoce a `api-publica`.
- **Aislamiento de tenant:**
  - FKs compuestas `(tenantId, id)`: la base no deja relacionar datos de dos empresas.
  - El guard global (`AuthGuard`) arma el `AuthContext` desde el JWT (`tid`) o la API key. El `tenantId` sale **siempre** de ahí (`@CurrentAuth()`), nunca del body, la URL ni los query params.
  - **El filtro es explícito:** cada método de servicio recibe `tenantId` y lo pone en cada `where` (`tenantId_id` en los `findUnique`, `{ tenantId, id }` en los `updateMany`/`deleteMany`). No hay `TenantContext` ni extensión de Prisma que filtre sola: una query sin `tenantId` lee datos de todas las empresas.
  - Test e2e de aislamiento (`src/aislamiento-tenants.e2e.spec.ts`). Todo endpoint nuevo tiene que entrar en ese test.
- **Alta de empresas:**
  - Registro por autoservicio en `POST /auth/registro`. Crea la empresa y su primer usuario en un solo INSERT anidado desde `auth` (`auth` no puede importar `tenants` porque se formaría un ciclo).
  - La empresa nace solo con `nombreFantasia`: razón social, CUIT, condición IVA y domicilio son `null` hasta que los cargue en Configuración. El CUIT se carga una sola vez.
  - Todo lo que factura o arma documentos usa `TenantsService.obtenerEmisorCompleto()`, que falla con 400 si faltan esos datos. `obtenerEmisor()` devuelve los campos fiscales como nullables y se usa solo para mostrar o configurar.
  - Todavía no hay roles: todos los usuarios de una empresa tienen los mismos permisos.
- **Montos como string decimal** validado con regex y cálculo con `Decimal`. Nunca `number` para dinero.
- `ValidationPipe` global con whitelist estricta: DTO en cada endpoint.
- **Idempotencia:**
  - Emisión con `Idempotency-Key`, número reservado y `FECompConsultar` antes de reintentar.
  - Importaciones por `(tenant, origen, referenciaExterna)` más hash.
  - API pública con `SolicitudIdempotente`.
- **Secretos:**
  - Certificados y claves cifrados con AES-256-GCM (`FAKTIA_ENCRYPTION_KEY`; se acepta también el nombre viejo `FACTURADOR_ENCRYPTION_KEY`, con el mismo valor).
  - API keys y tokens guardados como SHA-256, contraseñas con bcrypt.
  - Logs con redacción de credenciales.
- La configuración por tenant vive en la base (datos fiscales, puntos de venta, certificados, tarifas, plantillas, integraciones, webhooks). En el código solo van las constantes normativas de ARCA.

## PDF (comprobantes y recibos)

- **El comprobante tiene que seguir siendo fiscalmente correcto:** no quitar ni alterar datos obligatorios de ARCA:
  - emisor (razón social, domicilio, CUIT, IIBB, inicio de actividades, condición IVA);
  - letra y código;
  - número;
  - fecha;
  - receptor;
  - período y vencimiento en servicios;
  - totales e IVA;
  - leyenda de Transparencia Fiscal en B;
  - CAE, vencimiento y QR.

  La marca de agua "Comprobante de prueba – sin validez fiscal" va siempre en homologación.
- **Estilo de marca** en `src/shared/pdf/marca-pdf.ts`:
  - Tipografía Familjen Grotesk: TTF estáticos en `assets/fonts/` con licencia OFL. Se resuelven relativo al módulo (sirve desde `src` y desde `dist`).
  - Neutros: texto grafito `#1B262D`, secundario `#4A5258`, divisores finos `#E4E2DA`.
  - Importes y números con la característica `tnum`.
- **Colores principales del tenant:** títulos, letra del comprobante con su recuadro y encabezados de tabla usan `colorPrimario` de la plantilla PDF. Por defecto es casi negro (`#111827`) y se respeta lo que configure cada empresa.
- **Pie:**
  - Izquierda: QR, CAE y vencimiento, y el texto de pie de la plantilla (sin truncar: puede tener datos bancarios).
  - Derecha: "Generado con [ícono] faktia" en fiordo (`dibujarGeneradoCon`). El ícono usa los paths del SVG oficial: no redibujarlo.
- **La marca de Faktia nunca reemplaza los datos del emisor**, solo acompaña al pie.
- El recibo sigue el mismo estilo. `RecibosService` le pasa las fuentes y la marca del pie.
- Para revisar cambios de PDF: generar muestras (A, B en homologación, recibo) con un script temporal y mirarlas. Borrar el script después.

## Gotchas del entorno

- **Console Ninja** (VS Code) parchea `node_modules` y cuelga Jest y `start:dev`.
  - Arreglo: `npm ci`.
  - Alternativas: `node node_modules/jest/bin/jest.js --ci` para los tests; `npm run build && node dist/main.js` para levantar el backend.
- **Hay una sola base: la rama `production` del proyecto Neon `facturador`.** No hay QA ni desarrollo, y el `.env` local apunta ahí.
  - Los tests de integración y e2e corren contra esa base cuando `DATABASE_URL` está definida, y se saltean si no lo está. Crean empresas `E2E …` y las borran en el `afterAll`. Un test cortado a la mitad puede dejar restos.
  - Para correr solo los unitarios: `env -u DATABASE_URL node node_modules/jest/bin/jest.js --ci`.
  - Las migraciones se escriben a mano en `prisma/migrations/` y se aplican con `npx prisma migrate deploy`, **siempre con el OK del usuario**. Nunca usar `prisma migrate dev`, porque puede pedir resetear la base. Tienen que ser compatibles con el código desplegado (agregar o relajar, no romper).
- **Padrón de ARCA:**
  - El de homologación es ficticio: faltan personas reales y las que aparecen tienen datos alterados. No sirve para validar ni para autocompletar.
  - Por eso `arca/PadronService` consulta el padrón de producción con un certificado de plataforma (`PADRON_*`), igual que Vialto (`core/padron`), y no con el de cada empresa.
  - Lo usan el emisor (`PadronEmisorService`) y "Buscar en padrón" de clientes. Sin `PADRON_*`, clientes consulta con las credenciales de la empresa.
  - Campos del emisor que vienen de ARCA:
    - Al cargar el CUIT, razón social, condición IVA y domicilio se toman del padrón y quedan en `Tenant.camposDeArca`. Esos campos ya no se editan: `actualizarEmisor` responde 400 si cambian.
    - Las empresas que cargaron el CUIT antes se sincronizan con `POST /configuracion/emisor/sincronizar-arca`, que bloquea solo lo que coincide con ARCA y no pisa nada.
  - La constancia no trae el inicio de actividades: se sugiere el alta del impuesto más antiguo, editable.
  - Tiene caché de 7 días por CUIT y un tope de 100 consultas reales por tenant por día, los dos en memoria.
  - Nunca bloquea la carga: si está caído o sin configurar, responde 503 y se completa a mano.
- **ARCA:**
  - Concepto servicios exige FchServDesde, FchServHasta y FchVtoPago (error 10049).
  - `cms.sign.invalid` significa certificado y clave que no son pareja.
  - El punto de venta tiene que ser de tipo "RECE / Web Services".
- Relaciones anidadas de Prisma con FK compuesta: no llevan `tenantId` en el `create` anidado.
- curl desde Git Bash rompe los acentos del body: usar un archivo UTF-8 con `-d @archivo.json`.
