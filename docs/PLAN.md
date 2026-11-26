# Facturador — Plan y estado del trabajo

> Documento de traspaso para retomar el proyecto en otra sesión. Última actualización: 2026-10-06.
> La arquitectura detallada (esquema, contratos, flujos y decisiones) está en [ARCHITECTURE.md](ARCHITECTURE.md).
> Para retomar: leé este archivo, después ARCHITECTURE.md, y seguí desde "Próximo paso".

## 1. Plan original (pedido del usuario)

Facturador electrónico **multi-tenant, independiente**, que se va a vender como producto.

- **Referencias, solo para leer** (no modificar, no importar, copiar y adaptar):
  - Vialto: `Proyectos/LOGISTICA/VIALTO/vialto-backend` (ARCA vía AfipSDK, PDF, importación de Excel).
  - Time tracker: `Proyectos/CAPASSOTECH/capassotech-backend` (NestJS + TypeORM + Firebase) y `capassotech-timetracker-frontend`.
  - **Excepción aprobada:** agregar al tracker un endpoint chico de horas (Fase 4, ver D2).
- **Repos:** `facturador-backend` (NestJS 10 + Prisma 6 + PostgreSQL/Neon) y `facturador-frontend` (Vite + React 19 + Tailwind 4).
- **Multi-tenant a nivel de datos:** `tenantId` en todas las tablas. Las FKs son compuestas `(tenantId, id)`.
- **Auth básica:** email + contraseña (bcrypt) + JWT. Aislada en `modules/auth` para reemplazarla por Clerk.
  - Registro por autoservicio (`POST /auth/registro`): crea una empresa nueva con su primer usuario y entra directo, sin verificar el email.
  - Los datos fiscales se completan después en Configuración; `TenantsService.obtenerEmisorCompleto` los exige para facturar.
  - Todavía no hay roles ni invitaciones. Los scripts `crear-tenant` y `crear-usuario` siguen funcionando.
- **Monolito modular:** los módulos se comunican solo por su `index.ts` público.
- **Fuentes de datos con puertos y adaptadores:** tracker, API, Excel/CSV y manual, todas convertidas al modelo canónico `ItemFacturable`.
- **Integraciones sin doble login:**
  - API key por integración (se guarda hasheada y se muestra una sola vez).
  - Token de acceso de un solo uso, válido 60 s, que solo lo pide un backend con API key. El frontend lo canjea por JWT; si el usuario no existe, se crea sin contraseña.
- **Flujo:** Importación → Staging → Borrador → Revisión → Emisión ARCA → PDF → Descarga. Nada se emite sin borrador y confirmación.
- **Criterios técnicos:**
  - Tests en cálculos y adaptadores.
  - DTOs en todos los endpoints.
  - Certificados cifrados; keys y tokens hasheados y nunca en logs.
  - Idempotencia en importaciones y emisiones.
  - Todo lo configurable por tenant va a la base.
- **Forma de trabajo:** una fase por vez. Al terminar cada una, mostrar lo hecho y **esperar aprobación** del usuario.

## 2. Decisiones tomadas (detalle en ARCHITECTURE.md §10)

| # | Decisión |
|---|---|
| D1 | ARCA vía **AfipSDK** (`@afipsdk/afip.js`), detrás de la interfaz `ArcaGateway`. `AFIP_SDK_API_KEY` es de la plataforma. En homologación sin certificado se usa el CUIT de prueba `20409378472` con receptores de prueba. |
| D2 | **Endpoint nuevo en el tracker** (Fase 4): `GET /integrations/billable-hours?from&to[&clientId]` con `X-Integration-Key`. Devuelve **horas trabajadas y horas facturables** (hay que mover `computeBillableHoursDetails` del frontend del tracker a su backend, con test de paridad). Por defecto se factura con las facturables; se puede elegir al importar y por ítem. |
| D3 | La letra **A/B/C la elige el usuario**. El sistema sugiere una y avisa si no coincide, sin bloquear. A monotributistas se sugiere A. Las NC/ND heredan la letra de la factura. |
| D4 | Logo en la base y PDF generado a pedido. **Cloudinary a futuro**, detrás del puerto `AlmacenamientoArchivos`. |
| D5 | Recibos de **COBRO y de PAGO**, diferenciados en tipo, texto, firma y nombre de archivo. |
| D6 | Infraestructura: GitHub, Render (región Ohio, plan free, como Vialto) y Neon. |
| — | Tipos del MVP: Factura A/B/C con sus NC y ND. El envío por mail queda para después; en el MVP solo se descarga el PDF. |

## 3. Estado por fase

| Fase | Estado |
|---|---|
| 0 — Análisis + ARCHITECTURE.md | ✅ Aprobada |
| 1 — Base del proyecto + auth | ✅ Aprobada, commit inicial en `main` en ambos repos |
| 2 — Núcleo de facturación | ✅ Aprobada (2026-09-28). Commits `524b397` (backend) y `b2a50ff` (frontend) |
| 3 — Recibos | ✅ Aprobada (2026-09-28). Commits `a06dd8c` (backend) y `a2f5897` (frontend) |
| 4 — Fuentes de datos (API keys, token de acceso, staging, tracker, Excel/CSV) | ✅ Aprobada (2026-09-29). Probada con el tracker real |
| 5 — API pública + webhooks + Swagger | ✅ Aprobada (2026-09-29). Commits `c659b79` y `9713475` |
| 6 — Producción por tenant + ajustes | 🟡 **Código terminado** (ver "Fase 6"). Falta el pase real: confirmar el deploy, tenant piloto en producción, certificado y primera factura (necesita al usuario) |
| 7 — Facturador independiente + pantalla Facturación en el tracker | ✅ Aprobada (2026-10-06). Ver "Fase 7" |
| — Recorrido en el navegador + ajustes | ✅ Hecho el 2026-10-06. Ver "Recorrido en el navegador" |

### Fase 1 (hecha)

**Backend:**
- Login con JWT y guard global (`@Public()`, `@CurrentAuth()`).
- Rate limit en el login.
- La sesión se revoca con `tokenVersion`.
- Scripts `crear-tenant` y `crear-usuario`. La contraseña se pasa por la variable `NUEVA_PASSWORD`.
- CI en GitHub Actions y `render.yaml`.

**Frontend:** login (con elección de empresa si el email existe en varias), `RequireAuth` y `AuthProvider` con la misma forma que Clerk.

### Fase 2: lo hecho

**Backend**, todo pasa typecheck, lint y tests:

- Migración `fase2_nucleo_facturacion` aplicada en Neon `develop`. Agrega `PuntoVenta`, `CertificadoArca`, `PlantillaPdf`, `Cliente`, `Comprobante`, `ComprobanteLinea`, `ComprobanteAlicuota` y `ArcaLog`.
- `shared/crypto/cifrado.ts`: AES-256-GCM con prefijo `v1:` y la clave `FACTURADOR_ENCRYPTION_KEY`.
- `modules/arca`:
  - `ArcaGateway` y su implementación `AfipSdkGateway`: último autorizado, FECAESolicitar, FECompConsultar, cotización del dólar y padrón.
  - `arca-errores.ts` clasifica cada error como RECHAZO, INCIERTO o CONFIGURACION.
  - `ArcaAuditService` guarda `ArcaLog` sin credenciales.
- `modules/tenants`:
  - Emisor, puntos de venta, certificados y plantilla PDF.
  - Los certificados se validan: PEM, que la clave sea pareja del cert, vencimiento y CUIT.
  - `CredencialesArcaProvider` elige CUIT real o CUIT de prueba.
  - Rutas bajo `/api/configuracion/*`.
- `modules/clientes`: CRUD, validación de documento (dígito verificador del CUIT) y `GET /clientes/padron/:cuit`.
- `modules/pdf`: renderer puro con pdfkit. Incluye QR de ARCA, marca de agua de homologación, importe en letras, IVA contenido en la B (Ley 27.743), logo y colores del tenant.
- `modules/comprobantes`, dominio puro con tests:
  - `codigos.ts` y `totales.ts`: Decimal, reglas 10051/10061/10023/10020 y Factura C.
  - `letra-sugerida.ts`, `fechas.ts` y `receptor-arca.ts`.
- `modules/comprobantes`, servicios:
  - `comprobantes.service.ts`: borradores con lock optimista `version`, cambio de letra, NC/ND desde una factura emitida y eliminar (solo si nunca fue a ARCA).
  - `emision.service.ts`, emisión idempotente:
    1. Header `Idempotency-Key` obligatorio.
    2. Advisory lock por CUIT + punto de venta + tipo.
    3. `numeroReservado` guardado antes de pedir el CAE.
    4. Resultado: EMITIDO, RECHAZADO o PENDIENTE_VERIFICACION.
    5. Verificación con FECompConsultar.
    6. Cron cada minuto que recupera EMITIENDO colgados y verifica los pendientes.
    7. Una NC por el total pasa la factura a ANULADO.
  - `comprobante-pdf.service.ts` y el controller: `GET/POST /comprobantes`, `GET/PATCH/DELETE /comprobantes/:id`, `POST :id/emitir`, `POST :id/verificar`, `POST :id/notas`, `GET :id/pdf`.
- **Tests:** 76 unitarios y 7 de integración en `emision.int.spec.ts`. Estos últimos corren contra una base real con un ARCA simulado: corte antes y después de autorizar, reintentos, rechazo, emisiones en paralelo y NC que anula. Todos pasan contra Neon `develop`.

**Frontend**, terminado; pasa typecheck, lint y build:
- `lib/tipos.ts`, `lib/formato.ts` (incluye `sugerirLetra`, espejo del backend, y `conLetra`), `lib/useApi.ts` y `components/ui.tsx`.
- `main.tsx` con React Query, `App.tsx` con las rutas y `AppLayout.tsx` con la navegación.
- `pages/configuracion/`: `ConfiguracionPage`, `EstadoArcaTarjeta`, `EmisorSeccion`, `PuntosVentaSeccion` (sugiere el PV 1 en homologación), `CertificadosSeccion` (pegar o subir .crt/.key; solo muestra metadatos) y `PlantillaSeccion` (colores, pie, duplicado, logo con vista previa).
- `pages/clientes/`: `ClientesPage` (búsqueda, inactivos) y `ClienteModal` (alta/edición, "Buscar en padrón", activar/desactivar).
- `pages/comprobantes/`:
  - `ComprobantesPage`: lista paginada con filtro por estado.
  - `EditorComprobante`: compartido por alta y detalle. Letra A/B/C con sugerencia y advertencia; al elegir servicios precarga período (mes de la fecha) y vencimiento (días del cliente, o 10); total estimado en pantalla (el que vale es el del backend). Las notas solo editan motivo, fechas, líneas y observaciones.
  - `NuevoComprobantePage`: guarda el borrador y lleva al detalle.
  - `ComprobanteDetallePage`: editor si BORRADOR/RECHAZADO (Emitir se habilita solo sin cambios sin guardar); modal de confirmación con aviso de homologación; `Idempotency-Key` nueva por confirmación, reusada solo si no hubo respuesta del servidor (corte de red). Refresca solo cada 3 s en EMITIENDO y cada 20 s en PENDIENTE_VERIFICACION ("Verificar ahora"). Vista emitida: CAE, PDF, NC/ND (modal con motivo), notas asociadas. Eliminar borrador solo si nunca pasó por ARCA.
- `pages/InicioPage.tsx` borrado.
- **Probado contra la API real** (2026-09-28, Neon `develop`): login demo, PV 1 de homologación, cliente, borrador de Factura A por servicios (10 h × $15.000 → $181.500), cambio a B con advertencia, 409 por `version` vieja, PDF 400 sin CAE, 400 sin `Idempotency-Key`. Esos datos quedaron cargados en la empresa `demo` (PV 1, "Cliente de Prueba SA" con CUIT 20409378472, un borrador de Factura A).

### Fase 2: lo que falta (próximo paso)

1. ~~Frontend de la Fase 2~~ ✅ hecho.
2. ✅ **Cierre cumplido (2026-09-28)** contra ARCA homologación, vía API: Factura A 00001-00015787 (CAE 86390930349599, $181.500), reintento con la misma `Idempotency-Key` sin duplicar, PDF correcto; NC A 00001-00001466 (CAE 86390930372321) por el total → factura ANULADA. Apareció y se corrigió la regla 10210 (fecha de la NC vs. la factura). La factura quedó con fecha 06/10/2026 porque el CUIT de prueba es compartido. Se cargó `inicioActividades = 2020-01-01` en la empresa `demo` (lo exige la emisión). Recorrido en el navegador el 2026-10-06 ✅.
   Texto original del criterio: emitir una Factura en homologación con carga manual. Hace falta **`AFIP_SDK_API_KEY` en `facturador-backend/.env`**. Pedírsela al usuario; no leerla del `.env` de Vialto sin permiso. Después: levantar backend y frontend, crear un punto de venta 1 de homologación y un cliente, emitir y descargar el PDF.
3. ✅ README del backend actualizado y commit de la Fase 2 en ambos repos.
4. ✅ Aprobada por el usuario el 2026-09-28.

### Fase 3 (hecha, esperando aprobación)

**Backend** (`modules/recibos`):
- `core/` puro: `recibo.types.ts`, `montos.ts` (centavos en `bigint`), `numero-a-letras.ts` (copia), `contenido.ts` (valida y arma todos los textos; testeable sin PDF) y `generar-recibo.ts` (pdfkit). Tiene su `package.json` (`@capassotech/recibos`). 21 tests propios, incluido uno que falla si `core/` importa algo externo.
- COBRO y PAGO se distinguen en título, texto ("Recibí de {pagador} la suma de {letras}…"), quién encabeza, quién firma, comprobantes que cancela (solo COBRO), período (solo PAGO) y nombre de archivo (`Recibo-Cobro_…` / `Recibo-Pago_…`). Leyenda "Documento no válido como factura".
- Wrapper Nest `POST /api/recibos/pdf`: completa la parte del tenant desde el emisor y el estilo desde la plantilla PDF. No guarda nada.
- `formatearCuit` pasó a `shared/util/cuit.ts`.

**Frontend**: página `/recibos` (menú "Recibos"). Tiene el selector cobro/pago y, en cobro, permite elegir el cliente: completa sus datos y lista sus facturas emitidas para marcar las que cancela (cada una suma un concepto por el total, editable si el pago es parcial). También: conceptos, total en vivo, medio de pago y observaciones. Sugiere el número siguiente al último generado **en ese navegador** (localStorage, por tipo). `useApi.descargar` acepta `body` (POST) y muestra bien los errores de validación en array.

**Verificado**: 106 tests del backend en verde; typecheck, lint y build de los dos repos. Contra la API real (puerto 3001): recibo de cobro en ARS con factura aplicada y recibo de pago en USD, los dos con acentos correctos. Total que no coincide → 400. Importe con coma → 400. Sin sesión → 401. Pantalla recorrida en el navegador el 2026-10-06 ✅.

**Límite conocido**: no hay numeración ni historial en el servidor (así lo define el diseño: `recibos` no tiene tablas). Si hace falta, sería una tabla `Recibo` en un módulo consumidor (ARCHITECTURE.md §5).

### Fase 4 (hecha el 2026-09-28, esperando aprobación)

**Facturador backend**: migración `fase4_importaciones` (aplicada en `develop`).
- `auth`: API keys (`/integraciones`, hash SHA-256, se muestran una vez), `@ApiKey(scopes)` en el guard (esas rutas no aceptan JWT), token de acceso de un solo uso de 60 s (`POST /api/v1/acceso/tokens` con API key y `POST /api/auth/acceso/canjear`). El usuario se crea sin contraseña y el destino pasa por lista blanca.
- `tenants`: tarifas (`/configuracion/tarifas`). Gana la más específica vigente.
- `importaciones`: staging (resuelve el cliente por id, referencia externa o CUIT y recuerda la referencia; aplica la tarifa si el ítem no trae precio; dedupe por (origen, referencia) con hash), adaptadores tracker (agrupa por cliente, proyecto y mes, con base facturables o trabajadas) y Excel/CSV (`exceljs` + `csv-parse`, no el `xlsx` vulnerable; plantillas de mapeo con vista previa), manual (solo API). Conexión al tracker cifrada (`/configuracion/tracker`).
- `comprobantes`: `POST /comprobantes/generar` (un borrador por cliente y moneda, o también por mes; solo importaciones confirmadas). Eliminar el borrador libera los ítems; emitirlo los marca FACTURADO.
- 205 tests (incluye integración de acceso y del flujo completo). CUIT de los tests de integración aleatorio (`shared/testing/datos.ts`).

**Facturador frontend**: `/acceso`, `/importaciones` y `/importaciones/:id` (staging: asignar o crear cliente, crear tarifa, base de horas, editar, descartar, confirmar, generar). En Configuración: Tarifas, Tracker (con "Generar" clave + hash), Plantillas Excel e Integraciones. `referrer: no-referrer`.

**Tracker** (ramas `feature/facturador-integracion`, sin mergear ni pushear):
- Backend: `GET /integrations/billable-hours` (guard `X-Integration-Key` contra `FACTURADOR_INTEGRATION_KEY_HASH`), port de `computeBillableHoursDetails` **por registro**, con 24 casos de paridad generados con la función del frontend (`scripts/paridad-horas-facturables/`), y `POST /integrations/facturador/acceso` (admin/contable). Variables nuevas documentadas en `docs/ARQUITECTURA.md`.
- Frontend: botón "Ir al facturador" en Finanzas (admin/contable).

**Verificado contra la API real** (puerto 3001, empresa demo en `develop`, con un tracker FALSO local que respeta el contrato): mes del tracker → sin tarifa da error → crear tarifas → válido → confirmar → borrador Factura A USD 1.311,58. Excel .xlsx → 2 válidos + 1 sin cliente → reimportar da 3 duplicados → borrador ARS 459.801,21. Token de acceso: canje, reuso 401, destino malicioso ignorado, revocar.

**Probado con el tracker real (2026-09-29):** tracker local en :4000 (rama `develop`, que ya tiene el PR #22), levantado entre las 14:01 y las 14:05 para no cruzar su cron horario de Google Sheets, contra su base real (solo lectura). 473 registros de agosto y 421 de septiembre. Tipo de cambio bloqueado de agosto 1530 y vigente de septiembre 1545. Clave inválida da 401. Agosto importado da 8 ítems (cliente, proyecto y mes) → los 2 de Carlos Andretich asignados al "Cliente de Prueba SA" de demo + tarifa USD 20/h → borrador Factura A USD 2.210,19. Ajustes que salieron de la prueba: el tracker manda 6 decimales (rama `fix/facturador-precision-horas`, commit `84175b7`, sin mergear) y la razón social "-" usa el nombre (`77a5c50`). Datos de prueba en demo: ese borrador y el vínculo de la referencia de Carlos Andretich con el cliente de prueba. La integración de prueba quedó revocada.

**Pendiente del plan original de la fase (ya no bloquea):**
1. Probar contra el tracker real: no se levantó su backend porque arranca crons (Google Sheets, alertas por mail) y apunta a su base. Hay que definir las variables `FACTURADOR_INTEGRATION_KEY_HASH`, `FACTURADOR_API_URL` y `FACTURADOR_API_KEY` en el entorno del tracker (QA) y mergear las ramas.
2. ~~Recorrer las pantallas en el navegador.~~ ✅ 2026-10-06.
3. Quedaron datos de prueba en la empresa demo: tarifas, una plantilla "Ventas (Excel del ERP)", dos borradores y una integración revocada.

### Fase 5 (hecha el 2026-09-29, esperando aprobación)

- **Backend**: migración `fase5_api_publica` (aplicada en `develop`): `SolicitudIdempotente`, `WebhookSuscripcion`, `WebhookEntrega`. Módulo `api-publica`:
  - `/api/v1` con API key y scopes: `POST/GET items` (idempotente por referencia; el DTO valida la forma y el staging el contenido, por ítem), `GET importaciones/:id` y `POST …/confirmar`, `GET/POST clientes`, `POST comprobantes/borradores` (por ids, **tus referencias** o importación), `GET comprobantes` y `GET comprobantes/:id`, `POST comprobantes/:id/emitir` (Idempotency-Key obligatoria; el 422 devuelve la representación pública) y `GET …/pdf`. Rate limit de 300/min.
  - Idempotencia: interceptor `@Idempotente()` (24 h; 422 con otro request; 409 en curso; los 5xx no se guardan).
  - Webhooks: eventos de dominio en `shared/eventos` (EventEmitter2), encolado con `eventoId` estable, cron cada 30 s, backoff 1 m/5 m/30 m/2 h/12 h (6 intentos), firma HMAC con el secreto cifrado. En producción: solo https, sin IPs internas (también por DNS), sin seguir redirecciones. El payload del comprobante incluye las `referenciaExterna` de sus ítems. Pantalla en Configuración → Webhooks (probar, envíos, reenviar, pausar, nuevo secreto).
  - Swagger en `/api/docs` y `docs/openapi.json` (`npm run openapi`, en modo preview). Solo rutas `/api/v1` y sus modelos, con la guía de autenticación, idempotencia, flujo y verificación de la firma. `render.yaml` define `NODE_ENV=production`.
- **Tests**: 233 (incluye integración de idempotencia y webhooks con un receptor HTTP real).
- **Verificado de punta a punta** (app en :3001, empresa demo, ARCA homologación real): webhook de prueba con firma verificada por un receptor que usa el código de la documentación. `POST /v1/items` (2 válidos + 1 con errores, repetición con la misma clave, 422 con otro body), borradores por referencias ($94.380), emisión con CAE 86390934239161 (Factura A 00001-00015797), reintento con la misma clave sin reemitir, otra clave da 409, PDF, ítems FACTURADO, y webhooks `importacion.confirmada` y `comprobante.emitido` entregados y firmados. La key de prueba quedó revocada y el webhook de prueba pausado.

### Fase 6 (código hecho el 2026-09-29)

- **Pase a producción** (módulo `produccion`, pestaña Configuración → Producción): chequeo (datos del emisor, AfipSDK, certificado de producción vigente con aviso a 30 días, punto de venta de producción, aviso por borradores de homologación), **prueba de conexión de solo lectura** (`FECompUltimoAutorizado` en producción con cada punto de venta, sin emitir) y activación con el CUIT escrito como confirmación (vuelve a probar antes de cambiar). También se puede volver a homologación. Verificado con demo: bloquea sin certificado ni punto de venta.
- **Aislamiento entre tenants** (`src/aislamiento-tenants.e2e.spec.ts`): app completa por HTTP. Con la sesión o la API key de B, más de 35 endpoints con id sobre recursos de A fallan, los listados no filtran y los datos de A quedan intactos. Queda pendiente la extensión de Prisma que inyecta `tenantId` (el test cubre el riesgo).
- **CI**: `npm run deps` (dependency-cruiser: solo por index, `recibos/core` independiente, `shared` sin módulos, sin ciclos; verificado que detecta violaciones) y control de que `docs/openapi.json` esté al día.
- **`npm audit`**: 18 avisos en dependencias de producción (7 altos: multer, lodash, js-yaml, deepmerge-ts…). `npm audit fix` no resuelve nada sin **actualizar NestJS 10 → 12**. Queda como primer paso de `docs/PRODUCCION.md`.
- **Guía**: `facturador-backend/docs/PRODUCCION.md` (deploy en Render/Neon, tenant piloto, certificado con openssl + ARCA, punto de venta RECE, primera factura, integraciones).
- 245 tests. Commits `d26b5c9` (backend) y `ab95249` (frontend).
- **2026-09-29, segunda tanda**: NestJS 10 → **11.2.6** (Nest 12 es solo ESM; la 11 ya trae multer, express, lodash y js-yaml corregidos) y csv-parse 7: vulnerabilidades de producción de 18 a 5 (quedan `deepmerge-ts`, solo en el CLI de Prisma, y `uuid` vía exceljs, no alcanzable). `@nestjs/jwt` 11 tipa `expiresIn` estricto. 245 tests en verde. Commit `dce8055`.
- **Tenant piloto** creado en Neon `develop`: slug `capasso`, Elias Nicolas Capasso, CUIT 20384421998, MONOTRIBUTO (Factura C), "French 94, General Ramirez, Argentina", usuario `contacto@capasso.tech` (contraseña generada y entregada al usuario una sola vez; no está en ningún archivo). En producción hay que crearlo de nuevo (Render/Neon los hace el usuario).
- **Asistente del certificado** (Configuración → Certificados ARCA): genera clave RSA 2048 + CSR en el navegador (`src/lib/csr.ts`, WebCrypto + DER propio) y guía ARCA (certificado, relación con Facturación Electrónica, punto de venta Web Services) hasta la carga y el pase a producción. Verificado: el CSR pasa `openssl req -verify` con el sujeto que pide ARCA; un certificado emitido desde ese CSR por una CA de prueba pasa `analizarCertificado` del backend (CUIT y alias leídos, clave pareja). Commits `347a400` (frontend) y `8926965` (guía).
- **Falta** (lo hace el usuario): deploy en Render/Neon, trámite en ARCA con su clave fiscal y primera factura real.

### Fase 7 (2026-09-30): el Facturador vive sin el tracker

Decisión del usuario: el Facturador es un producto vendible e independiente; desde el tracker se factura todo en una pantalla **Facturación**, salvo la configuración (queda en el Facturador, botón "Ir al facturador"). Precio: **opción A**, lo manda el tracker (tarifa del proyecto). Reemplaza D2.

- **Facturador backend** (`main`): se quitó el adaptador que consultaba al tracker, la tabla `conexiones_tracker` (migración `20260930120000_quitar_conexion_tracker`) y la base horas facturables/trabajadas (commit `06c53d6`). API pública ampliada (commits `3f587cf`, `2e5bce6`): `GET /v1/configuracion`, clientes (listar, ver, modificar, padrón, `GET /clientes/referencias`, `POST /clientes/:id/referencias`, `referenciaExterna` en el alta), borrador a mano, editar/eliminar borrador, notas, verificar. Header `X-Usuario-Email` para la auditoría (crea el usuario sin contraseña). E2E nuevo `src/api-publica-v1.e2e.spec.ts`; aislamiento ampliado. 230 tests.
- **Facturador frontend** (`763aede`): sin pestaña Tracker, sin importar horas, sin horas facturables/trabajadas; textos de integraciones genéricos.
- **Tracker backend** (rama `feature/facturacion`, commit `41f87b1`, sin push): módulo `facturacion` (admin/contable) — resumen del mes (misma regla que Ingresos: por hora = horas facturables × tarifa; mensual activo = 1 abono; moneda del proyecto), alta automática del cliente en el Facturador (con el padrón si falta la condición de IVA; a mano si no hay CUIT; queda asociado por id del tracker), carga de ítems (`tracker:<cliente>:<proyecto>:<YYYY-MM>`, idempotente) y borradores; proxy de comprobantes. `FacturadorClient` con la API key solo en el servidor. Se borró `GET /integrations/billable-hours` y `FACTURADOR_INTEGRATION_KEY_HASH` ya no se usa.
- **Tracker frontend** (rama `feature/facturacion`, commit `9c211cd`, sin push): `/admin/facturacion` (menú Finanzas → Facturación): Para facturar (mes, clientes, alta con padrón, generar borradores) y Comprobantes (editar, emitir con Idempotency-Key, NC/ND, verificar, PDF, factura manual).
- **Probado** con el Facturador local contra ARCA homologación real (tenant descartable, ya borrado): alta automática, borradores ARS y USD, emisión (CAE 86390938564458), reintento sin duplicar, PDF, NC, re-facturar sin duplicar. Falta probar la pantalla en el navegador con un usuario real del tracker.
- **Recibos** quedan en el Facturador, sin cambios.
- 2026-09-30: la base `develop` quedó sin datos (se perdieron `demo` y el piloto `capasso`). **Resuelto el 2026-10-06** sin restore: `demo` ya se había recreado el 30/09 y `capasso` se creó de nuevo con los scripts (ver "Datos operativos").

### 2026-10-02: ajustes después de la Fase 7

- **Facturador backend:**
  - `render.yaml` instala las devDependencies en el build: con `NODE_ENV=production`, `npm ci` salteaba `@nestjs/cli`, `typescript` y `prisma`, y el build fallaba con "nest: not found" (`b760f52`).
  - En homologación se crea el punto de venta 1 si no hay ninguno activo. Pasa al pedir `GET /v1/configuracion` y al generar borradores (`f4b2472`).
- **Tracker** (mergeado en `develop`: backend PR #29 + `08036bd`, frontend PR #144 + `513a1c6`):
  - Lo de proyectos en USD se factura en pesos con el TC del mes (el fijado o el oficial del día). Sin TC no factura.
  - TC editable en la pantalla.
  - Horas facturables redondeadas para arriba a la media hora.
  - Factura manual a clientes del tracker.
  - `POST /facturacion/despertar` pinguea `/health` del Facturador (plan free de Render) como mucho cada 4 minutos, mientras un admin o contable usa el tracker.
- Los dos repos del Facturador ya están en GitHub (`desarrollocapassotech/facturador-backend` y `-frontend`), al día con `origin/main`.

### Recorrido en el navegador (2026-10-06)

Con Playwright contra backend y frontend locales, Neon `develop` y ARCA homologación real. Se recorrió todo:

- **Login:** contraseña incorrecta, "Salir" y vuelta a `/login`.
- **Configuración:** las 9 pestañas, con estas acciones:
  - Guardar emisor, punto de venta (el repetido da 409), tarifa, logo y pie del PDF, y plantilla Excel.
  - Integración: la key se muestra una sola vez; después se revoca.
  - Webhook: el secreto se muestra una sola vez; probar, envíos, pausar y reanudar.
  - Producción: bloquea sin certificado ni punto de venta de producción.
- **Clientes:** alta, CUIT con dígito verificador inválido y padrón.
- **Comprobantes (empresa demo):**
  - Factura A 00001-00016283 (CAE 86400955847380, $181.500) emitida desde la pantalla, con PDF.
  - NC A 00001-00001485 por el total, que deja la factura ANULADA.
  - Advertencia de letra, "Emitir" bloqueado con cambios sin guardar, filtros.
  - Factura A 00001-00016284 ($302.500), emitida por la API para probar el recibo.
- **Recibos:** cobro con esa factura aplicada y pago en USD, con PDF.
- **Importaciones** desde Excel:
  - Plantilla con fila de encabezado 2, decimales con coma, fechas DD/MM/YYYY y "Ñ".
  - Alta del cliente faltante desde el staging, confirmar y 2 borradores (uno por cliente).
  - Reimportar da 3 repetidos; descartar el lote.
- **Piloto `capasso`** (monotributo): Factura C 00001-00016312 (CAE 86400956017357) con PDF correcto, sin IVA discriminado.
- **`/acceso`:** entra al destino, el token sale de la URL y el segundo uso da "expiró o ya se usó".

**Arreglos que salieron del recorrido** (backend `49b7dff`, frontend `14c1726`):

| Repo | Arreglo |
|---|---|
| backend | Padrón: "No existe persona con ese Id" ahora da 404 "ARCA no tiene datos para ese CUIT" (antes 502 "no se pudo consultar"). Lo detecta `esPersonaInexistente` en `arca-errores.ts`, con test. |
| backend | Webhooks: el error de red dice el motivo (DNS, conexión rechazada, certificado, timeout) en lugar de "fetch failed". Lo arma `mensajeErrorConexion` en `url-webhook.ts`, con tests. |
| backend | `GET /configuracion/puntos-venta` también crea el PV 1 en homologación si no hay ninguno, como `GET /v1/configuracion`. Sin esto, un tenant nuevo no podía guardar una factura desde la pantalla. |
| backend | Punto de venta repetido: el mensaje dice "en homologación" en lugar de "para homologacion". |
| frontend | Letra por defecto sin cliente: A si el emisor es Responsable Inscripto. Antes era C, que un RI no puede emitir. |
| frontend | Unidades en singular y plural ("1 unidad", "10 servicios", "US$ 20 / hora"), con `unidadTexto` en `lib/formato.ts`. |
| frontend | Editor de comprobante: la columna Unidad se ve entera (antes "Servic…"). |
| frontend | Modal de cliente: el número de documento se ve completo y los errores viejos se borran al corregir. |
| frontend | Emisor: "Inicio de actividades" dice "Obligatorio para emitir" (antes "Opcional"), porque la emisión y el chequeo de producción lo exigen. |
| frontend | Favicon: evita el 404 de `/favicon.ico` en cada página. |

Verificado en verde: 238 tests unitarios, los e2e de aislamiento y de la API pública (9), y typecheck, lint, `deps` y build de los dos repos.

**Detalles menores anotados:**
- El total estimado del staging puede diferir en un centavo del real, porque redondea el IVA por ítem de otra forma. Es una estimación con "≈"; el que vale es el del backend.
- Con el CUIT de prueba compartido, ARCA corre la fecha de las facturas unos días hacia adelante (ya conocido).

### Pendientes y deuda anotada

- La extensión Prisma que inyecta `tenantId` automáticamente (ARCHITECTURE.md §9) **no está hecha**. Hoy cada query filtra `tenantId` a mano, respaldado por las FKs compuestas. Evaluarla y sumar tests e2e cruzados entre tenants.
- `npm audit` del backend marca 25 vulnerabilidades (en su mayoría de dependencias de desarrollo): revisar antes de producción.
- Si cambia el certificado mientras un comprobante está PENDIENTE_VERIFICACION, la verificación usa las credenciales nuevas (caso borde).

## 4. Datos operativos

- **Neon:** proyecto `facturador` (id `rough-mud-84399020`), organización CapassoTech, región `aws-sa-east-1`. Ramas `production` y `develop` (`br-divine-pine-b6bacfps`). El `.env` del backend apunta a `develop`.
- **Variables del backend** (`.env`, no versionado):
  - `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `FRONTEND_URL`, `PORT`.
  - `FACTURADOR_ENCRYPTION_KEY`: **no cambiarla**, cifra los certificados guardados.
  - `AFIP_SDK_API_KEY`: cargada (la pasó el usuario el 2026-09-28).
- **Frontend:** `VITE_API_URL=http://localhost:3000/api`.
- **Datos de prueba en `develop`** (2026-10-06):
  - **`demo`** (CUIT de prueba 20409378472, RI, homologación). Usuario `demo@facturador.local` / `demo-facturador-2026`.
    - Configuración: PV 1 y 2, IIBB, logo y pie de prueba, tarifa USD 20/h de "Cliente de Prueba SA" y plantilla "Ventas (Excel del ERP)".
    - Integraciones: "Time tracker (local)" activa (creada el 30/09 para probar el tracker) y "ERP de prueba" revocada.
    - Un webhook a example.com, pausado.
    - Clientes: "Cliente de Prueba SA" (CUIT 20409378472) y "Ñandú Logística SRL" (30712345671).
    - Comprobantes: Factura A 16283 anulada por la NC A 1485, Factura A 16284 emitida y 2 borradores generados desde la importación.
  - **`capasso`** (piloto: Elias Nicolas Capasso, CUIT 20384421998, MONOTRIBUTO, "French 94, General Ramirez, Argentina"). Usuario `contacto@capasso.tech`.
    - La contraseña se generó el 2026-10-06 y se le dio al usuario. No está en ningún archivo; para cambiarla se usa `crear-usuario` con `NUEVA_PASSWORD`.
    - Tiene la PV 1 de homologación, la clienta "María Gómez" (DNI) y la Factura C 16312.
    - **Falta cargar el inicio de actividades real.** Quedó vacío y sin ese dato no se puede emitir.
- **GitHub:** `desarrollocapassotech/facturador-backend` y `desarrollocapassotech/facturador-frontend`. No hay `gh` instalado: el push lo hace el usuario.
- **Render:** hay un `render.yaml` en cada repo (ajustado el 2026-10-02 para el build). Falta confirmar con el usuario si el deploy quedó andando.

## 5. Gotchas del entorno

- **Console Ninja** (extensión de VS Code) parchea archivos de `node_modules`: `jest/bin/jest.js`, `@nestjs/core/index.js`, `jest-runner` y otros. Eso **cuelga Jest** o llena la salida de ruido.
  - Arreglo: `npm ci` restaura los paquetes limpios.
  - Para correr los tests: `node node_modules/jest/bin/jest.js --ci`. Si está parcheado, usar `node node_modules/jest-cli/bin/jest.js --ci`.
  - Solución de fondo: desactivar Console Ninja en este workspace. **Volvió a pasar el 2026-10-06** (el backend no arrancaba) y se resolvió con `npm ci`.
  - Con Console Ninja activo, `npm run start:dev` también se cuelga después de "Found 0 errors". Alternativa: `npm run build && node dist/main.js`.
- **`nest build` dejaba `dist` vacío o solo con `.d.ts`** por el `incremental` junto con `deleteOutDir`. Ya está resuelto: `tsconfig.build.json` tiene `incremental: false`. Si vuelve a pasar, borrar `*.tsbuildinfo`.
- En el entorno de Claude no se resuelven por DNS los dominios arbitrarios (por ejemplo, `example.com`), así que los webhooks de prueba fallan con "No se encontró el dominio". ARCA y AfipSDK sí funcionan. Para probar una entrega, usar un receptor local (`http://localhost:…`, que se permite fuera de producción).
- Probar la API con curl desde Git Bash **rompe los acentos** del body (se mandan en Latin-1). Para textos con tildes, usar un archivo UTF-8 con `-d @archivo.json`.
- Tests de integración: cargar el `.env` antes (`set -a && . ./.env && set +a`). Sin `DATABASE_URL`, se saltean solos. En CI corren contra el Postgres del workflow.
- Jest usa `tsconfig.spec.json` (`isolatedModules`, solo transpila); los tipos los verifica `npm run typecheck`. `roots` está limitado a `src/`.
- Las carpetas están en OneDrive: `npm install` tarda 2 minutos o más.
- Las relaciones anidadas de Prisma con FK compuesta **no llevan `tenantId`** en el `create` anidado (sale del padre).
- Gotchas de ARCA (heredados de Vialto, en ARCHITECTURE.md §2.1):
  - Concepto 2 (servicios) exige FchServDesde, FchServHasta y FchVtoPago (error 10049).
  - `cms.sign.invalid` significa que el certificado y la clave no son pareja.
  - El punto de venta tiene que ser de tipo "RECE / Web Services".
- Cómo levantar todo en local:
  - Backend: `cd facturador-backend && npm run start:dev`.
  - Frontend: `cd facturador-frontend && npm run dev`.
