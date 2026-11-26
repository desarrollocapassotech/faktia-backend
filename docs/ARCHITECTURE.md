# Facturador — Arquitectura

> Fase 0 (análisis). Documento base para `facturador-backend` y `facturador-frontend`.
> Fecha: 2026-09-25. Estado: **decisiones cerradas** — ver [§10 Decisiones tomadas](#10-decisiones-tomadas).

## Índice

1. [Resumen](#1-resumen)
2. [Análisis de los proyectos de referencia](#2-análisis-de-los-proyectos-de-referencia)
3. [Stack y estructura de repos](#3-stack-y-estructura-de-repos)
4. [Módulos del backend](#4-módulos-del-backend)
5. [Esquema Prisma](#5-esquema-prisma)
6. [Modelo canónico: ItemFacturable](#6-modelo-canónico-itemfacturable)
7. [Contratos de adaptadores y puertos](#7-contratos-de-adaptadores-y-puertos)
8. [Flujos clave](#8-flujos-clave)
9. [Seguridad y criterios técnicos](#9-seguridad-y-criterios-técnicos)
10. [Decisiones tomadas](#10-decisiones-tomadas)

---

## 1. Resumen

Facturador electrónico multi-tenant (a nivel de datos), monolito modular NestJS + Prisma + PostgreSQL, con frontend React + Tailwind. Cada tenant es un emisor (CUIT, condición IVA, puntos de venta, certificados ARCA). Los datos a facturar entran por adaptadores (time tracker, API, Excel/CSV, carga manual) que los convierten a un modelo canónico (`ItemFacturable`). Pasan por staging, se agrupan en borradores, el usuario los revisa y recién ahí se emiten en ARCA.

```
Fuentes ─► Adaptador ─► ItemFacturable ─► Staging ─► Borrador ─► Revisión ─► ARCA (CAE) ─► PDF ─► Descarga
(tracker,    (puerto)     (canónico)      (validación,  (Comprobante  (usuario)   (WSFE)
 api, excel,                               duplicados)   BORRADOR)
 manual)
```

---

## 2. Análisis de los proyectos de referencia

### 2.1 Vialto (`LOGISTICA/VIALTO/vialto-backend`)

Stack: NestJS 10, Prisma 6, PostgreSQL (Neon), Clerk, `@afipsdk/afip.js`, `pdfkit`, `qrcode`, `cloudinary`, `xlsx`.

#### Hallazgo importante: Vialto **no** habla WSAA/WSFE directo

Toda la integración pasa por **AfipSDK** (`@afipsdk/afip.js`), un servicio pago en la nube que hace la firma WSAA y proxea WSFE usando un `access_token` de plataforma (`AFIP_SDK_API_KEY`). Además, en homologación **todos los tenants usan el CUIT de prueba de AfipSDK (`20409378472`) sin certificado propio**. **Decisión ([D1](#d1-proveedor-arca-afipsdk)): se sigue con AfipSDK**, como Vialto, detrás de la interfaz `ArcaGateway`.

#### Qué se reutiliza y cómo se desacopla

| Pieza (archivo en Vialto) | Qué aporta | Dependencias de Vialto | Cómo se desacopla en el Facturador |
|---|---|---|---|
| `liquidaciones-arca/arca-client.service.ts` | Último autorizado, `FECAESolicitar`, mapeo de errores AFIP (600, 10007/8/16, 10015, 11002), log de auditoría sin credenciales | `PrismaService` (escribe `arcaLog` directo), `decryptField`, `CUIT_TEST_HOMOLOGACION`, parámetros `liquidacionId`/`facturaId` | Se parte en: **`ArcaGateway`** (interfaz: ultimoAutorizado / autorizar / consultar / cotización), implementación **`AfipSdkGateway`** sin Prisma que recibe credenciales ya descifradas (se copia casi entero: `getAfipClientAndToken`, `normalizePem`, `mapError`, `mapTokenAuthError`), y un **`ArcaAuditLogger`** (puerto) que persiste `ArcaLog`. Se eliminan los ids de Vialto: se pasa un `correlationId` (id del comprobante). Se agrega `FECompConsultar` (`getVoucherInfo`) para resolver emisiones inciertas. |
| `liquidaciones-arca/arca-error.util.ts` | Traducción de rechazos AFIP a mensajes amigables + detalle crudo | Ninguna de negocio | Copiar casi tal cual. |
| `liquidaciones-arca/types/arca.types.ts` | `ArcaAutorizarRequest`, `AlicIva`, `CbteAsoc`, `ArcaException` con `detalle` | Comentarios sobre CVLP | Copiar, quitar CVLP (60/61/65), sumar `FchServDesde/Hasta/FchVtoPago`, `MonId`/`MonCotiz`, tipos C. |
| `liquidaciones-arca/arca-iva.util.ts` | `groupAlicuotasIva` (reglas AFIP 10020/10051), ids de alícuota, `round2` | `cvlpPdfPieFinanciero`, `computeAfipGravadoIva` con parámetros de comisión deprecados | Copiar solo la parte genérica; reescribir con `Decimal` (Vialto usa `Float`). Los specs existentes (`arca-iva.util.spec.ts`) se portan como base de tests. |
| `liquidaciones-arca/arca-cvlp.util.ts` → `buildComprobanteCvlp` | Totalización que respeta AFIP 10061 (ImpNeto = Σ BaseImp) y 10023 (ImpIVA = Σ Importe), con ajuste de centavos en la línea de mayor base | Nombre "CVLP", tipos de Vialto | Se renombra a `calcularTotales(lineas, claseComprobante)` en `comprobantes/domain`. Se agrega rama Factura C (sin discriminar IVA). |
| `liquidaciones-arca/arca.util.ts` | `resolveFechaCbteEmision` (evita 10016 por desfase AR/UTC), `formatNumeroComprobante`, `resolveReceptorAfip` (receptor de prueba en homologación), mapeos tipo de comprobante | `BadRequestException` de Nest, lógica CVLP/transportista | Copiar funciones puras sin Nest. Reescribir la elección de tipo A/B/C según **emisor + receptor** (Vialto solo mira al receptor y nunca emite C). |
| `liquidaciones-arca/arca-config.service.ts` | Ciclo de vida de config ARCA; cert/key cifrados; solo sobreescribe si viene contenido; homologación con CUIT de prueba (`findWithApiKey`) | `CloudinaryService` (logo), rol superadmin, un solo par de certificados | Pasa al módulo `tenants` (`CredencialesArcaProvider`): certificados en tabla propia por ambiente, con vencimiento y huella; logo en `PlantillaPdf`. `AFIP_SDK_API_KEY` sigue siendo una variable de entorno de la plataforma (una cuenta AfipSDK para todos los tenants). |
| `shared/util/arca-crypto.ts` | AES-256-GCM `iv:tag:cipher` | Env `ARCA_ENCRYPTION_KEY`, compatibilidad con CBC heredado | Copiar a `shared/crypto`, env `FACTURADOR_ENCRYPTION_KEY`, **sin** rama CBC, con prefijo de versión de clave (`v1:iv:tag:cipher`) para poder rotar. |
| `liquidaciones-arca/factura-pdf.service.ts` | Layout A4 original/duplicado, letra y código, QR AFIP, "Son: … pesos" (`numeroALetras`), pie de totales, CAE | Prisma (`factura`, `tenant`, `arcaLog`), `Viaje` (`buildDetalleFlete`, `numeroVisibleViaje`), `ArcaConfigService`, logo descargado por `fetch` de Cloudinary | Se reescribe como renderer **puro**: `render(ComprobantePdfData, PlantillaPdfData) → Buffer`. Todo lo de viajes se elimina. El comprobante ya guarda el snapshot de líneas, así que no hace falta reconstruir desde `arcaLog`, como hace Vialto. |
| `liquidaciones-arca/pdf-homologacion-watermark.ts` | Marca de agua "COMPROBANTE DE PRUEBA – SIN VALIDEZ FISCAL" | `normalizeArcaAmbiente` | Copiar tal cual al módulo `pdf`. |
| `shared/storage/cloudinary.service.ts` | Subida de PDFs y logos | Cloudinary | **No se copia en el MVP**: el PDF se genera a pedido desde el snapshot (determinístico) y el logo se guarda en DB. Cloudinary entra más adelante detrás del puerto `AlmacenamientoArchivos` ([§10, D4](#d4-almacenamiento-db-ahora-cloudinary-después)). |
| `importaciones/engine/parser.service.ts` | Lectura xlsx, fila de encabezado configurable, alias de columnas, fechas con formato, columnas no mapeadas | `modulo` de Vialto | Copiar la lógica de parseo y sumar CSV (delimitador, encoding). La plantilla pasa a ser `PlantillaMapeo` (varias por tenant; Vialto tiene una por módulo). |
| `importaciones/*` (session/log/preview) | Patrón preview → confirmar con sesión que expira | Processors de viajes/choferes, IA de sugerencias | Se toma el patrón, no el código: el staging del Facturador es persistente (`Importacion` + `ItemFacturable`). |
| `shared/util/validar-id-fiscal.ts` | Validación de CUIT | — | Copiar (dígito verificador). |
| Emisión (`liquidaciones.service.ts#emitirFacturaArca`) | Estados `pendiente_cae` / `error` / `autorizado`; conectividad vs rechazo; hash de payload en CVLP | Viajes, cuenta corriente, Cloudinary | Se toma el patrón y **se corrige un riesgo** (ver abajo). |

#### Gotchas de ARCA heredados de Vialto (documentados en su `CLAUDE.md`)

- `cms.sign.invalid` → cert y clave no son pareja (siempre recargar ambos juntos).
- PEM con `\n` literales → hay que normalizar (`normalizePem`).
- El punto de venta de web services (RECE) es distinto del de "Comprobantes en línea".
- **Concepto 2 (servicios) exige `FchServDesde`, `FchServHasta` y `FchVtoPago`** (error 10049). Vialto siempre manda Concepto 1. El Facturador factura horas: **tiene que soportar Concepto 2**.
- AFIP 10061/10023/10020: reglas de totales ya resueltas en `buildComprobanteCvlp`/`groupAlicuotasIva`.
- NC/ND requieren `CbtesAsoc` (10197).

#### Riesgo detectado en Vialto que el Facturador no debe copiar

En `emitirFacturaArca`, si la llamada a `FECAESolicitar` se corta por red **después** de que AFIP autorizó, la factura queda `pendiente_cae` sin número reservado. Al reintentar, consulta el último autorizado (que ya es el comprobante "perdido") y pide `último + 1`: **se emiten dos facturas**. El Facturador reserva el número antes de llamar y, al reintentar, primero consulta `FECompConsultar` sobre ese número ([§8.3](#83-emisión-en-arca-idempotente)).

#### Generador de recibos

**Vialto no tiene generador de recibos** (0 coincidencias de "recibo" en todo el repo). El único antecedente está en el tracker (ver 2.2).

#### Multi-tenancy en Vialto

`tenantId` = `clerkOrgId`; aislamiento por `TenantGuard` + filtros manuales en cada query + triggers SQL de verificación cruzada (`tenant_cross_check_triggers`). El Facturador reemplaza los triggers por **FKs compuestas `(tenantId, id)`** en Prisma y por una extensión de Prisma que inyecta `tenantId` ([§9](#9-seguridad-y-criterios-técnicos)).

### 2.2 Time tracker de CapassoTech (`CAPASSOTECH/capassotech-backend` + `capassotech-timetracker-frontend`)

Stack: **NestJS 11 + TypeORM** (no Prisma) + PostgreSQL (schema `tracker`), auth con **Firebase** (ID token Bearer), `pdf-lib`. Frontend Vite + React + shadcn.

#### Modelo de datos relevante

| Tabla | Campos útiles para facturar |
|---|---|
| `time_entries` | `collaborator_id/name`, `project_id/name`, `task_id/title`, `date` (día), `hours` numeric, `task_billing_type` (feature, internal_bug, external_bug, internal_meeting, external_meeting, support), `comments` |
| `projects` | `client_id`, `rate`, `currency` (USD/ARS), `billing_type` (hourly/monthly), `billable_hours_limit` |
| `clients` | `name`, `razon_social`, `cuit`, `iva_condition` (texto libre), `address/city/province`, `billing_currency` (default **USD**), `billable_config` (JSONB) |
| `collaborators` / `collaborator_project_rates` | Tarifa hora del colaborador (base y por proyecto) |

#### ¿Tiene API para horas por cliente, proyecto y período? → **No, así como está no alcanza**

1. `GET /time-entries` devuelve **todos** los registros, sin filtros por fecha, cliente ni proyecto.
2. La única auth es **Firebase ID token de un usuario** (`FirebaseAuthGuard`). No hay API keys ni auth servidor a servidor.
3. Las **horas facturables no son las horas trabajadas**: se calculan en el **frontend** (`src/lib/utils.ts → computeBillableHoursDetails`) con factor de tarifas proyecto/colaborador, markup (1,6 por defecto), markup de bugs internos, horas fijas adicionales, mínimo y overrides por colaborador. Esa lógica no está en ningún endpoint.
4. El tracker es mono-empresa (no tiene concepto de tenant).
5. `time_entries` no tiene `client_id`: el cliente sale de `projects.client_id`.

**Decisión ([D2](#d2-endpoint-nuevo-en-el-tracker)): se agrega un endpoint chico al tracker** que devuelve horas trabajadas y horas facturables. Contrato en §10.

#### Generador de recibos del tracker (`collaborators/collaborator-receipt.service.ts`)

- Genera **recibos de pago a colaboradores** llenando un PDF AcroForm exportado de Canva (`templates/template-recibo-colaborador.pdf`), con campos fijos (`Text2`…`Text20`), 6 filas y páginas de anexo cuando hay más conceptos.
- Dependencias: plantilla PDF con marca CapassoTech, nombres de campo del AcroForm, `pdf-lib`, datos ya formateados como strings.
- Reutilizable: la idea del **anexo de overflow**, `truncateToWidth` y la separación "recibe DTO → devuelve Buffer" (ya está bastante desacoplado).
- No reutilizable para un producto: la plantilla fija y la marca. En el Facturador el recibo se dibuja por código con la plantilla del tenant (logo y colores), igual que el PDF de comprobantes.

---

## 3. Stack y estructura de repos

Carpeta contenedora: `Proyectos/FACTURADOR/` con dos repos git independientes.

### 3.1 `facturador-backend`

- Node 22 LTS, NestJS 10 (igual que Vialto), Prisma 6, PostgreSQL (Neon), TypeScript 5.8.
- `class-validator` + `class-transformer` (DTOs), `@nestjs/swagger` (Fase 5), `@nestjs/schedule` (reintentos de webhooks y verificación de emisiones).
- `bcrypt` (contraseñas), `jsonwebtoken` o `@nestjs/jwt` (sesión), `pdfkit` + `qrcode` (PDF), `xlsx` + `csv-parse` (importación), `decimal.js` (vía `Prisma.Decimal`).
- ARCA: `@afipsdk/afip.js` (AfipSDK), con `AFIP_SDK_API_KEY` de plataforma.
- Tests: Jest. Límites entre módulos verificados en CI con `dependency-cruiser`.

```
facturador-backend/
  prisma/schema.prisma
  scripts/crear-tenant.ts, crear-usuario.ts
  src/
    main.ts, app.module.ts
    shared/            prisma (+ extensión tenant), crypto, logging (redacción), errores, decimal
    modules/
      auth/            guard, JWT, API keys, token de acceso, AuthContext
      tenants/         emisor, puntos de venta, certificados, plantilla PDF
      clientes/        receptores, padrón (puerto)
      importaciones/   staging, ItemFacturable, plantillas de mapeo, adaptadores/
      comprobantes/    dominio (tipos, totales, numeración), borradores, emisión
      arca/            ArcaGateway + implementación, credenciales, audit log
      pdf/             renderer de comprobantes, watermark, QR
      recibos/         core/ (puro, sin Nest) + recibos.module.ts
      api-publica/     controllers externos, webhooks
  test/
```

### 3.2 `facturador-frontend`

- Vite 6, React 19, React Router 7, Tailwind 4 (igual que Vialto), TypeScript.
- Estado de servidor con `@tanstack/react-query`; formularios con `react-hook-form` + `zod`.
- Rutas: `/login`, `/acceso` (canje de token), y bajo `RequireAuth`: `/borradores`, `/comprobantes`, `/clientes`, `/importaciones`, `/configuracion/{emisor,puntos-venta,certificados,plantilla,integraciones,tarifas,plantillas-mapeo}`.
- Todo el acceso a la sesión pasa por un `AuthProvider` propio con la misma forma que usaría Clerk (`useAuth().getToken()`), para cambiarlo sin tocar las pantallas.

### 3.3 CI/CD e infraestructura

- GitHub Actions por repo: lint, typecheck, test, `prisma validate`, `prisma migrate diff` (sin drift), `dependency-cruiser`.
- Deploy: Render (como Vialto, `render.yaml`) + Neon con ramas `develop`/`production`.

---

## 4. Módulos del backend

Regla: un módulo solo importa **el `index.ts` público** de otro (interfaces + tokens de inyección). Nunca importa servicios internos, entidades Prisma de otro módulo ni hace queries a tablas ajenas.

| Módulo | Responsabilidad | Expone (puertos/servicios) | Depende de |
|---|---|---|---|
| `auth` | Login email+contraseña, JWT, API keys por integración, token de acceso de un solo uso, alta automática de usuario sin contraseña | `AuthGuard` global, `@Public()`, `@ApiKey(scopes)`, `@CurrentAuth(): AuthContext` | `shared` |
| `tenants` | Datos fiscales del emisor, puntos de venta, certificados cifrados, plantilla PDF, tarifas | `EmisorProvider`, `CredencialesArcaProvider`, `PlantillaPdfProvider`, `TarifasProvider` | `shared` |
| `clientes` | CRUD de receptores, referencias externas, consulta de padrón | `ClientesService` (buscar/crear por documento, resolver referencia externa), `PadronPort` | `shared`, `arca` (solo `PadronPort`) |
| `importaciones` | Adaptadores, staging, dedupe, plantillas de mapeo | `StagingService`, `FuenteDatosAdapter` (registro) | `clientes`, `tenants` (tarifas) |
| `comprobantes` | Borradores desde ítems, cálculo, numeración, estados, emisión, NC/ND | `ComprobantesService`, eventos `comprobante.emitido` | `clientes`, `tenants`, `arca`, `importaciones` (solo marcar ítems), `pdf` |
| `arca` | Emisión WSFE vía AfipSDK (el SDK resuelve WSAA), homologación y producción por tenant, auditoría | `ArcaGateway`, `PadronPort` | `tenants` (`CredencialesArcaProvider`) |
| `pdf` | Render de comprobantes con plantilla del tenant | `PdfComprobanteRenderer` | nada (recibe datos) |
| `recibos` | Generador de recibos independiente | `generarRecibo` (en `core/`) | `core/`: **nada** (ni Prisma ni otros módulos). El wrapper Nest: `tenants` (datos del emisor y plantilla) |
| `api-publica` | Endpoints externos, idempotencia, webhooks salientes | Controllers `/api/v1/*` | `importaciones`, `comprobantes`, `auth` (guard) |

Comunicación asincrónica: `@nestjs/event-emitter` para `comprobante.emitido`, `comprobante.rechazado` e `importacion.confirmada`. `api-publica` escucha y encola webhooks. Así `comprobantes` no conoce a `api-publica`.

---

## 5. Esquema Prisma

Criterios:
- Todas las tablas llevan `tenantId`, salvo `Tenant` (es la raíz).
- Las relaciones entre entidades de un mismo tenant usan **FK compuesta `(tenantId, id)`**. Así la base impide que un comprobante del tenant A apunte a un cliente del tenant B, sin necesidad de triggers como en Vialto.
- Montos en `Decimal(15,2)`, cantidades y precios unitarios en `Decimal(15,4)` y alícuotas en `Decimal(5,2)` (Vialto usa `Float`).
- Secretos: certificados y claves **cifrados** (AES-256-GCM), API keys y tokens **hasheados** (SHA-256 de un secreto de alta entropía).

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

// ─────────────────────────────── Enums ───────────────────────────────

enum AmbienteArca {
  HOMOLOGACION
  PRODUCCION
}

/// Código ARCA en comentario (CondicionIVAReceptorId / condición del emisor).
enum CondicionIva {
  RESPONSABLE_INSCRIPTO // 1
  EXENTO                // 4
  CONSUMIDOR_FINAL      // 5
  MONOTRIBUTO           // 6
  NO_CATEGORIZADO       // 7
  PROVEEDOR_EXTERIOR    // 8
  CLIENTE_EXTERIOR      // 9
  IVA_LIBERADO          // 10
  MONOTRIBUTO_SOCIAL    // 13
  NO_ALCANZADO          // 15
  MONOTRIBUTO_TIP       // 16 Monotributista trabajador independiente promovido
}

enum TipoDocumento {
  CUIT             // 80
  CUIL             // 86
  DNI              // 96
  PASAPORTE        // 94
  CONSUMIDOR_FINAL // 99 (DocNro 0)
}

enum TipoComprobante {
  FACTURA_A      // 1
  NOTA_DEBITO_A  // 2
  NOTA_CREDITO_A // 3
  FACTURA_B      // 6
  NOTA_DEBITO_B  // 7
  NOTA_CREDITO_B // 8
  FACTURA_C      // 11
  NOTA_DEBITO_C  // 12
  NOTA_CREDITO_C // 13
}

enum ConceptoArca {
  PRODUCTOS             // 1
  SERVICIOS             // 2 → exige FchServDesde/Hasta y FchVtoPago
  PRODUCTOS_Y_SERVICIOS // 3 → ídem
}

enum Moneda {
  ARS // ARCA "PES"
  USD // ARCA "DOL"
}

enum EstadoComprobante {
  BORRADOR               // editable; nada fue a ARCA
  EMITIENDO              // bloqueado; hay una llamada a ARCA en curso
  PENDIENTE_VERIFICACION // se cortó la comunicación; hay número reservado; se resuelve con FECompConsultar
  EMITIDO                // tiene CAE
  RECHAZADO              // ARCA rechazó; vuelve a ser editable (numeroReservado se libera)
  ANULADO                // factura compensada totalmente por NC emitida
}

enum UnidadItem {
  HORA
  UNIDAD
  SERVICIO
  MES
}

enum OrigenItem {
  TRACKER
  API
  EXCEL
  MANUAL
}

enum EstadoItem {
  VALIDO      // listo para agrupar en un borrador
  CON_ERRORES // falta cliente, precio, etc. (ver `errores`)
  DUPLICADO   // ya existe otro ítem con la misma (origen, referenciaExterna)
  EN_BORRADOR // asignado a un comprobante en BORRADOR
  FACTURADO   // su comprobante fue EMITIDO
  DESCARTADO  // el usuario lo descartó
}

enum EstadoImportacion {
  EN_STAGING
  CONFIRMADA
  DESCARTADA
  FALLIDA
}

enum EstadoWebhookEntrega {
  PENDIENTE
  ENTREGADA
  FALLIDA // agotó reintentos
}

// ─────────────────────────────── Tenants ───────────────────────────────

model Tenant {
  id                String       @id @default(cuid())
  slug              String       @unique
  nombreFantasia    String
  razonSocial       String
  cuit              String       @unique // 11 dígitos, sin guiones
  condicionIva      CondicionIva
  domicilioFiscal   String
  ingresosBrutos    String?
  inicioActividades DateTime?    @db.Date
  ambienteArca      AmbienteArca @default(HOMOLOGACION)
  activo            Boolean      @default(true)
  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt

  usuarios             Usuario[]
  integraciones        Integracion[]
  tokensAcceso         TokenAcceso[]
  puntosVenta          PuntoVenta[]
  certificados         CertificadoArca[]
  plantillaPdf         PlantillaPdf?
  clientes             Cliente[]
  referenciasClientes  ClienteReferenciaExterna[]
  tarifas              Tarifa[]
  plantillasMapeo      PlantillaMapeo[]
  importaciones        Importacion[]
  items                ItemFacturable[]
  comprobantes         Comprobante[]
  lineas               ComprobanteLinea[]
  alicuotas            ComprobanteAlicuota[]
  arcaLogs             ArcaLog[]
  solicitudesIdem      SolicitudIdempotente[]
  webhookSuscripciones WebhookSuscripcion[]
  webhookEntregas      WebhookEntrega[]

  @@map("tenants")
}

model PuntoVenta {
  id          String       @id @default(cuid())
  tenantId    String
  tenant      Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  numero      Int
  ambiente    AmbienteArca
  descripcion String?
  activo      Boolean      @default(true)
  createdAt   DateTime     @default(now())

  comprobantes Comprobante[]

  @@unique([tenantId, id])
  @@unique([tenantId, ambiente, numero])
  @@map("puntos_venta")
}

/// Un certificado activo por (tenant, ambiente). Los anteriores quedan con activo=false (historial).
/// Obligatorio en PRODUCCION. En HOMOLOGACION es opcional: sin certificado se usa el CUIT de prueba
/// de AfipSDK (como Vialto); con certificado se prueba con el CUIT real del tenant.
model CertificadoArca {
  id              String       @id @default(cuid())
  tenantId        String
  tenant          Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  ambiente        AmbienteArca
  certCifrado     String // PEM cifrado (v1:iv:tag:cipher)
  claveCifrada    String // PEM cifrado
  alias           String? // DN / alias del certificado en ARCA
  huellaSha256    String // fingerprint del cert (para mostrar, nunca el contenido)
  venceEl         DateTime
  activo          Boolean      @default(true)
  cargadoPorId    String?
  createdAt       DateTime     @default(now())

  @@index([tenantId, ambiente, activo])
  @@map("certificados_arca")
}

model PlantillaPdf {
  tenantId        String   @id
  tenant          Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  logo            Bytes? // ≤ 300 KB, PNG/JPG (ver D4)
  logoMime        String?
  colorPrimario   String   @default("#111827")
  colorSecundario String   @default("#6B7280")
  textoPie        String?
  mostrarDuplicado Boolean @default(true)
  updatedAt       DateTime @updatedAt

  @@map("plantillas_pdf")
}

// ─────────────────────────────── Auth ───────────────────────────────

model Usuario {
  id            String    @id @default(cuid())
  tenantId      String
  tenant        Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  email         String // normalizado a minúsculas
  nombre        String?
  passwordHash  String? // null = solo entra por token de acceso de integración
  activo        Boolean   @default(true)
  tokenVersion  Int       @default(0) // incrementar invalida todas sus sesiones JWT
  creadoPor     String    @default("script") // script | integracion:<id>
  ultimoAcceso  DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  tokensAcceso TokenAcceso[]

  @@unique([tenantId, id])
  @@unique([tenantId, email])
  @@index([email])
  @@map("usuarios")
}

/// Un sistema integrado (tracker, Vialto, …). Tiene UNA API key vigente; rotar = crear otra y revocar esta.
model Integracion {
  id            String    @id @default(cuid())
  tenantId      String
  tenant        Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  nombre        String // "Time tracker CapassoTech"
  origen        OrigenItem @default(API) // origen con el que se registran sus ítems
  keyPrefijo    String    @unique // parte pública, ej. "fct_7Hk2pQ9x" (para buscar y mostrar)
  keyHash       String // SHA-256 del secreto completo
  scopes        String[] // items:write, comprobantes:write, comprobantes:read, acceso:emitir
  ultimoUsoEn   DateTime?
  revocadaEn    DateTime?
  creadaPorId   String?
  createdAt     DateTime  @default(now())

  tokensAcceso         TokenAcceso[]
  webhookSuscripciones WebhookSuscripcion[]
  solicitudesIdem      SolicitudIdempotente[]

  @@unique([tenantId, id])
  @@index([tenantId])
  @@map("integraciones")
}

/// Token de un solo uso (60 s) para entrar al frontend desde un sistema integrado.
model TokenAcceso {
  id            String      @id @default(cuid())
  tenantId      String
  tenant        Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  integracionId String
  integracion   Integracion @relation(fields: [tenantId, integracionId], references: [tenantId, id], onDelete: Cascade)
  usuarioId     String
  usuario       Usuario     @relation(fields: [tenantId, usuarioId], references: [tenantId, id], onDelete: Cascade)
  tokenHash     String      @unique
  destino       String? // path relativo validado, ej. "/borradores/ckx…"
  expiraEn      DateTime
  usadoEn       DateTime?
  createdAt     DateTime    @default(now())

  @@index([expiraEn])
  @@map("tokens_acceso")
}

// ─────────────────────────────── Clientes ───────────────────────────────

model Cliente {
  id               String        @id @default(cuid())
  tenantId         String
  tenant           Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  razonSocial      String
  tipoDocumento    TipoDocumento
  numeroDocumento  String // "0" para consumidor final anónimo
  condicionIva     CondicionIva
  domicilio        String?
  email            String?
  pais             String        @default("AR")
  monedaPreferida  Moneda        @default(ARS)
  diasVencimiento  Int? // para FchVtoPago en servicios; default del tenant si null
  activo           Boolean       @default(true)
  datosPadron      Json? // última respuesta de padrón (snapshot)
  padronConsultadoEn DateTime?
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt

  referencias  ClienteReferenciaExterna[]
  tarifas      Tarifa[]
  items        ItemFacturable[]
  comprobantes Comprobante[]

  @@unique([tenantId, id])
  @@unique([tenantId, tipoDocumento, numeroDocumento])
  @@map("clientes")
}

/// Mapea el id de un cliente en un sistema externo (ej. clients.id del tracker) al Cliente del Facturador.
model ClienteReferenciaExterna {
  id                String     @id @default(cuid())
  tenantId          String
  tenant            Tenant     @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  clienteId         String
  cliente           Cliente    @relation(fields: [tenantId, clienteId], references: [tenantId, id], onDelete: Cascade)
  origen            OrigenItem
  referenciaExterna String
  createdAt         DateTime   @default(now())

  @@unique([tenantId, origen, referenciaExterna])
  @@map("clientes_referencias_externas")
}

/// Tarifa por cliente (y opcionalmente por proyecto/clave externa). La más específica vigente gana.
model Tarifa {
  id             String      @id @default(cuid())
  tenantId       String
  tenant         Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  clienteId      String
  cliente        Cliente     @relation(fields: [tenantId, clienteId], references: [tenantId, id], onDelete: Cascade)
  origen         OrigenItem? // null = aplica a cualquier origen
  claveExterna   String? // ej. projectId del tracker; null = todo el cliente
  descripcion    String? // texto para la línea del comprobante, admite {proyecto} {periodo}
  unidad         UnidadItem
  precioUnitario Decimal     @db.Decimal(15, 4)
  moneda         Moneda
  alicuotaIva    Decimal     @db.Decimal(5, 2)
  vigenteDesde   DateTime    @db.Date
  vigenteHasta   DateTime?   @db.Date
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt

  @@index([tenantId, clienteId, vigenteDesde])
  @@map("tarifas")
}

// ─────────────────────────────── Importaciones ───────────────────────────────

model PlantillaMapeo {
  id        String   @id @default(cuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  nombre    String
  formato   String // "xlsx" | "csv"
  config    Json // PlantillaMapeoConfig (§7.4)
  activa    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  importaciones Importacion[]

  @@unique([tenantId, id])
  @@unique([tenantId, nombre])
  @@map("plantillas_mapeo")
}

/// Un lote de ingreso (archivo, corrida del tracker, request de API, carga manual).
model Importacion {
  id               String            @id @default(cuid())
  tenantId         String
  tenant           Tenant            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  origen           OrigenItem
  estado           EstadoImportacion @default(EN_STAGING)
  descripcion      String? // "Tracker sep-2026", nombre de archivo, etc.
  archivoSha256    String? // detectar el mismo archivo subido dos veces
  plantillaMapeoId String?
  plantillaMapeo   PlantillaMapeo?   @relation(fields: [tenantId, plantillaMapeoId], references: [tenantId, id], onDelete: Restrict)
  integracionId    String?
  parametros       Json? // ej. { desde, hasta, clienteExternoIds } para el tracker
  totalItems       Int               @default(0)
  validos          Int               @default(0)
  conErrores       Int               @default(0)
  duplicados       Int               @default(0)
  creadaPorId      String?
  createdAt        DateTime          @default(now())
  confirmadaEn     DateTime?

  items ItemFacturable[]

  @@unique([tenantId, id])
  @@index([tenantId, createdAt])
  @@map("importaciones")
}

/// Modelo canónico de entrada (§6).
model ItemFacturable {
  id                String       @id @default(cuid())
  tenantId          String
  tenant            Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  importacionId     String?
  importacion       Importacion? @relation(fields: [tenantId, importacionId], references: [tenantId, id], onDelete: Restrict)

  origen            OrigenItem
  referenciaExterna String // id en el sistema de origen; para MANUAL se genera

  // Cliente: resuelto (clienteId) o datos para resolverlo
  clienteId               String?
  cliente                 Cliente? @relation(fields: [tenantId, clienteId], references: [tenantId, id], onDelete: Restrict)
  clienteTipoDocumento    TipoDocumento?
  clienteNumeroDocumento  String?
  clienteReferenciaExterna String?

  descripcion     String
  cantidad        Decimal    @db.Decimal(15, 4)
  unidad          UnidadItem
  precioUnitario  Decimal    @db.Decimal(15, 4)
  moneda          Moneda     @default(ARS)
  alicuotaIva     Decimal    @db.Decimal(5, 2)
  fecha           DateTime?  @db.Date
  periodoDesde    DateTime?  @db.Date
  periodoHasta    DateTime?  @db.Date
  metadatos       Json? // libre por fuente (proyecto, colaborador, tipo de tarea, …)

  estado          EstadoItem @default(VALIDO)
  errores         Json? // [{ campo, mensaje }]
  hashContenido   String // para detectar "misma referencia, contenido distinto"

  comprobanteId   String?
  comprobante     Comprobante? @relation(fields: [tenantId, comprobanteId], references: [tenantId, id], onDelete: Restrict)

  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt

  lineas ComprobanteLinea[]

  @@unique([tenantId, id])
  @@unique([tenantId, origen, referenciaExterna]) // idempotencia de importación
  @@index([tenantId, estado])
  @@index([tenantId, clienteId, estado])
  @@map("items_facturables")
}

// ─────────────────────────────── Comprobantes ───────────────────────────────

model Comprobante {
  id                 String            @id @default(cuid())
  tenantId           String
  tenant             Tenant            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  tipo               TipoComprobante
  estado             EstadoComprobante @default(BORRADOR)
  ambiente           AmbienteArca // snapshot del ambiente al crear/emitir

  clienteId          String
  cliente            Cliente           @relation(fields: [tenantId, clienteId], references: [tenantId, id], onDelete: Restrict)
  puntoVentaId       String
  puntoVenta         PuntoVenta        @relation(fields: [tenantId, puntoVentaId], references: [tenantId, id], onDelete: Restrict)

  // Numeración: se reserva justo antes de llamar a ARCA (ver §8.3)
  numero             Int?
  numeroReservado    Int?

  fechaEmision       DateTime          @db.Date
  concepto           ConceptoArca
  fechaServicioDesde DateTime?         @db.Date
  fechaServicioHasta DateTime?         @db.Date
  fechaVtoPago       DateTime?         @db.Date

  moneda             Moneda            @default(ARS)
  cotizacion         Decimal           @default(1) @db.Decimal(15, 6)

  importeNetoGravado Decimal           @default(0) @db.Decimal(15, 2)
  importeNoGravado   Decimal           @default(0) @db.Decimal(15, 2)
  importeExento      Decimal           @default(0) @db.Decimal(15, 2)
  importeIva         Decimal           @default(0) @db.Decimal(15, 2)
  importeTributos    Decimal           @default(0) @db.Decimal(15, 2)
  importeTotal       Decimal           @default(0) @db.Decimal(15, 2)

  // Snapshots para PDF y auditoría (el comprobante emitido no cambia si cambian el cliente o el tenant)
  emisorSnapshot     Json?
  receptorSnapshot   Json?

  // NC/ND: comprobante asociado (CbtesAsoc)
  asociadoId         String?
  asociado           Comprobante?      @relation("Asociacion", fields: [tenantId, asociadoId], references: [tenantId, id], onDelete: Restrict)
  asociadosDesde     Comprobante[]     @relation("Asociacion")
  motivo             String?

  cae                String?
  caeVencimiento     DateTime?         @db.Date
  observacionesArca  Json?
  errorMensaje       String?
  errorDetalle       String?

  idempotencyKey     String? // de la API pública o del botón "Emitir"
  payloadHash        String? // hash del request a ARCA del último intento
  intentos           Int               @default(0)
  version            Int               @default(0) // lock optimista para edición

  creadoPorId        String?
  emitidoPorId       String?
  emitidoEn          DateTime?
  createdAt          DateTime          @default(now())
  updatedAt          DateTime          @updatedAt

  lineas    ComprobanteLinea[]
  alicuotas ComprobanteAlicuota[]
  items     ItemFacturable[]
  arcaLogs  ArcaLog[]

  @@unique([tenantId, id])
  @@unique([tenantId, ambiente, puntoVentaId, tipo, numero]) // Postgres permite múltiples NULL
  @@unique([tenantId, idempotencyKey])
  @@index([tenantId, estado])
  @@index([tenantId, clienteId])
  @@map("comprobantes")
}

model ComprobanteLinea {
  id               String      @id @default(cuid())
  tenantId         String
  tenant           Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  comprobanteId    String
  comprobante      Comprobante @relation(fields: [tenantId, comprobanteId], references: [tenantId, id], onDelete: Cascade)
  orden            Int
  descripcion      String
  cantidad         Decimal     @db.Decimal(15, 4)
  unidad           UnidadItem
  precioUnitario   Decimal     @db.Decimal(15, 4)
  bonificacionPct  Decimal     @default(0) @db.Decimal(5, 2)
  alicuotaIva      Decimal     @db.Decimal(5, 2) // 0, 2.5, 5, 10.5, 21, 27 (en C se guarda y no se discrimina)
  importeNeto      Decimal     @db.Decimal(15, 2)
  importeIva       Decimal     @db.Decimal(15, 2)
  importeTotal     Decimal     @db.Decimal(15, 2)
  itemFacturableId String?
  itemFacturable   ItemFacturable? @relation(fields: [tenantId, itemFacturableId], references: [tenantId, id], onDelete: Restrict)

  @@index([tenantId, comprobanteId])
  @@map("comprobante_lineas")
}

/// AlicIva enviado a ARCA (Id, BaseImp, Importe) — ya agrupado por alícuota.
model ComprobanteAlicuota {
  id            String      @id @default(cuid())
  tenantId      String
  tenant        Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  comprobanteId String
  comprobante   Comprobante @relation(fields: [tenantId, comprobanteId], references: [tenantId, id], onDelete: Cascade)
  arcaId        Int // 3=0%, 9=2.5%, 8=5%, 4=10.5%, 5=21%, 6=27%
  baseImponible Decimal     @db.Decimal(15, 2)
  importe       Decimal     @db.Decimal(15, 2)

  @@unique([tenantId, comprobanteId, arcaId])
  @@map("comprobante_alicuotas")
}

/// Auditoría de cada llamada a ARCA. Nunca guarda token/sign/cert/clave.
model ArcaLog {
  id            String       @id @default(cuid())
  tenantId      String
  tenant        Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  comprobanteId String?
  comprobante   Comprobante? @relation(fields: [tenantId, comprobanteId], references: [tenantId, id], onDelete: Restrict)
  metodo        String // FECompUltimoAutorizado | FECAESolicitar | FECompConsultar | loginCms | …
  ambiente      AmbienteArca
  request       Json // saneado
  response      Json?
  exitoso       Boolean
  error         String?
  duracionMs    Int
  createdAt     DateTime     @default(now())

  @@index([tenantId, comprobanteId])
  @@index([tenantId, createdAt])
  @@map("arca_logs")
}

// ─────────────────────────────── API pública ───────────────────────────────

/// Respuesta guardada por Idempotency-Key (24 h) para POSTs de la API pública.
model SolicitudIdempotente {
  id             String      @id @default(cuid())
  tenantId       String
  tenant         Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  integracionId  String
  integracion    Integracion @relation(fields: [tenantId, integracionId], references: [tenantId, id], onDelete: Cascade)
  clave          String
  hashRequest    String // misma clave con otro body → 422
  estadoHttp     Int?
  respuesta      Json?
  createdAt      DateTime    @default(now())
  expiraEn       DateTime

  @@unique([tenantId, integracionId, clave])
  @@map("solicitudes_idempotentes")
}

model WebhookSuscripcion {
  id             String       @id @default(cuid())
  tenantId       String
  tenant         Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  integracionId  String?
  integracion    Integracion? @relation(fields: [tenantId, integracionId], references: [tenantId, id], onDelete: Cascade)
  url            String
  eventos        String[] // comprobante.emitido, comprobante.rechazado, importacion.confirmada
  secretoCifrado String // para firmar HMAC-SHA256; reversible porque hay que firmar con él
  activa         Boolean      @default(true)
  createdAt      DateTime     @default(now())

  entregas WebhookEntrega[]

  @@unique([tenantId, id])
  @@map("webhook_suscripciones")
}

model WebhookEntrega {
  id             String               @id @default(cuid())
  tenantId       String
  tenant         Tenant               @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  suscripcionId  String
  suscripcion    WebhookSuscripcion   @relation(fields: [tenantId, suscripcionId], references: [tenantId, id], onDelete: Cascade)
  eventoId       String // id estable del evento, el receptor deduplica con esto
  evento         String
  payload        Json
  estado         EstadoWebhookEntrega @default(PENDIENTE)
  intentos       Int                  @default(0)
  proximoIntento DateTime             @default(now())
  ultimoStatus   Int?
  ultimoError    String?
  createdAt      DateTime             @default(now())
  entregadaEn    DateTime?

  @@unique([suscripcionId, eventoId])
  @@index([estado, proximoIntento])
  @@map("webhook_entregas")
}
```

> `recibos/core` **no tiene tablas**: recibe datos y devuelve el PDF. Desde noviembre de 2026 Faktia guarda los recibos que se crean desde la app: la tabla `recibos` (migración `20261119120000_recibos`) es del wrapper Nest de `recibos`, no del núcleo, que sigue siendo puro. Se guardan los datos y el PDF se regenera a pedido con la plantilla vigente. El listado de comprobantes los suma con `incluirRecibos` (`comprobantes/listado-unificado.ts`); la API pública no los expone.

---

## 6. Modelo canónico: ItemFacturable

Contrato TypeScript que producen **todos** los adaptadores (`importaciones/domain/item-facturable.ts`):

```ts
export type OrigenItem = 'TRACKER' | 'API' | 'EXCEL' | 'MANUAL';
export type UnidadItem = 'HORA' | 'UNIDAD' | 'SERVICIO' | 'MES';

export interface ClienteRef {
  /** Cliente ya existente en el Facturador. */
  clienteId?: string;
  /** O documento (se busca y, si no existe, el ítem queda CON_ERRORES o se ofrece crearlo). */
  tipoDocumento?: 'CUIT' | 'CUIL' | 'DNI' | 'PASAPORTE' | 'CONSUMIDOR_FINAL';
  numeroDocumento?: string;
  /** O id en el sistema de origen (se resuelve con ClienteReferenciaExterna). */
  referenciaExterna?: string;
  /** Datos opcionales para crear el cliente si no existe (razón social, condición IVA, domicilio). */
  alta?: { razonSocial: string; condicionIva: string; domicilio?: string; email?: string };
}

export interface ItemFacturableInput {
  origen: OrigenItem;
  /** Id estable en el sistema de origen. (origen, referenciaExterna) es único por tenant. */
  referenciaExterna: string;
  cliente: ClienteRef;
  descripcion: string;
  cantidad: string;       // decimal como string, nunca number
  unidad: UnidadItem;
  precioUnitario: string; // sin IVA
  moneda?: 'ARS' | 'USD'; // default ARS
  alicuotaIva: string;    // "21", "10.5", "0", …
  fecha?: string;         // YYYY-MM-DD
  periodo?: { desde: string; hasta: string };
  metadatos?: Record<string, unknown>;
}
```

Reglas de validación (`StagingService`):
- Al menos una forma de identificar al cliente. Si no se resuelve → `CON_ERRORES` (`cliente no encontrado`), sin bloquear el resto del lote.
- `cantidad > 0`, `precioUnitario >= 0`, alícuota ∈ {0, 2.5, 5, 10.5, 21, 27}.
- Servicios (`HORA`, `SERVICIO`, `MES`) necesitan `periodo` o `fecha` (para `FchServDesde/Hasta`).
- Duplicados: si ya existe `(tenant, origen, referenciaExterna)`:
  - mismo `hashContenido` → se ignora (reintento idempotente), se informa como `DUPLICADO` en el resumen;
  - distinto contenido y el existente no está `FACTURADO` → se actualiza (el origen corrigió el dato);
  - distinto contenido y ya está `FACTURADO` → `CON_ERRORES` ("ya facturado; emitir NC/ND si corresponde").

---

## 7. Contratos de adaptadores y puertos

### 7.1 Puerto de fuente de datos

```ts
// importaciones/ports/fuente-datos.port.ts
export interface ContextoFuente {
  tenantId: string;
  usuarioId?: string;
  integracionId?: string;
}

export interface ResultadoExtraccion {
  items: ItemFacturableInput[];
  advertencias: Array<{ referencia?: string; mensaje: string }>;
  descripcionLote: string; // "Tracker 2026-09", "horas.xlsx"
  parametros?: Record<string, unknown>;
  archivoSha256?: string;
}

export interface FuenteDatosAdapter<TParams> {
  readonly origen: OrigenItem;
  extraer(ctx: ContextoFuente, params: TParams): Promise<ResultadoExtraccion>;
}
```

El núcleo (`StagingService.ingresar(ctx, resultado)`) solo conoce `ResultadoExtraccion`. Cada adaptador vive en `importaciones/adapters/<fuente>/` y no se importa desde ningún otro lado: se registra con un token (`FUENTES_DATOS`).

### 7.2 Adaptadores

| Adaptador | Params | Notas |
|---|---|---|
| `ManualAdapter` | `ItemFacturableInput[]` desde el frontend | `referenciaExterna` = uuid generado en el cliente (reintentar el submit no duplica). |
| `ApiAdapter` | body de `POST /api/v1/items` | Valida con DTO; `origen = Integracion.origen`. |
| `ExcelCsvAdapter` | `{ archivo: Buffer, nombre, plantillaMapeoId }` | Usa `PlantillaMapeoConfig`. Parser adaptado de Vialto + CSV. |
| `TrackerAdapter` | `{ desde, hasta, clienteExternoIds?, baseHoras: 'FACTURABLES' \| 'TRABAJADAS' }` | Ver 7.3. `baseHoras` por defecto `FACTURABLES`. |

### 7.3 Adaptador del time tracker

Separado en dos partes: el cliente HTTP (cómo se obtienen los datos) y el adaptador (qué se factura).

```ts
// adapters/tracker/tracker-client.port.ts — HTTP contra GET /integrations/billable-hours del tracker (§10 D2)
export interface HorasTracker {
  id: string;                 // time_entries.id
  fecha: string;              // YYYY-MM-DD
  horas: string;              // trabajadas
  horasFacturables: string;   // calculadas por el tracker (markup, factores, mínimos)
  proyecto: { id: string; nombre: string; billingType: 'hourly' | 'monthly' };
  cliente: { id: string; nombre: string; razonSocial?: string; cuit?: string; condicionIva?: string };
  colaborador?: { id: string; nombre: string };
  tipoTarea?: string;
}
export interface TrackerClient {
  obtenerHoras(conexion: { baseUrl: string; apiKey: string }, desde: string, hasta: string): Promise<HorasTracker[]>;
}

// adapters/tracker/tracker.adapter.ts — QUÉ se factura (fijo)
// 1. Pide las horas del período.
// 2. Agrupa por (cliente, proyecto, mes). Una línea por grupo (configurable: por grupo o por registro).
// 3. Resuelve el cliente: ClienteReferenciaExterna(TRACKER, cliente.id) → si no hay, por CUIT → si no, ítem CON_ERRORES con `alta` sugerida.
// 4. Aplica la Tarifa vigente del Facturador (cliente [+ claveExterna = proyecto.id]), NUNCA project.rate del tracker.
//    - unidad HORA: cantidad = Σ horasFacturables (o Σ horas si baseHoras = TRABAJADAS), precio = tarifa.
//    - unidad MES (proyectos monthly): cantidad = 1, precio = tarifa mensual.
// 5. referenciaExterna del ítem agrupado = `tracker:${clienteId}:${proyectoId}:${YYYY-MM}` (estable → reimportar el mes no duplica;
//    si cambian horas antes de facturar, el hash cambia y el ítem se actualiza).
//    metadatos = { proyecto, horasTrabajadas, horasFacturables, baseHoras, idsRegistros[] }.
```

**Elegir la base de horas**: el adaptador siempre guarda **las dos sumas** en `metadatos`. `baseHoras` se elige al importar (default `FACTURABLES`) y en el staging se puede cambiar por ítem: el backend recalcula `cantidad` desde `metadatos`, sin volver a llamar al tracker.

La URL del tracker y su API key se guardan por tenant en una tabla `ConexionTracker` (API key **cifrada**, porque el Facturador tiene que enviarla). Se agrega al esquema en la Fase 4.

### 7.4 Plantilla de mapeo Excel/CSV

```ts
export interface PlantillaMapeoConfig {
  hoja?: string | number;          // xlsx
  filaEncabezado: number;          // 1-based
  delimitador?: ',' | ';' | '\t';  // csv
  encoding?: 'utf-8' | 'latin1';
  columnas: Array<{
    campo: keyof ItemFacturableInput | 'cliente.numeroDocumento' | 'cliente.referenciaExterna'
         | 'cliente.razonSocial' | 'periodo.desde' | 'periodo.hasta' | `metadatos.${string}`;
    encabezado: string;
    alias?: string[];
    tipo: 'texto' | 'numero' | 'fecha' | 'decimal';
    formatoFecha?: string;          // "DD/MM/YYYY"
    separadorDecimal?: ',' | '.';
  }>;
  valoresPorDefecto?: Partial<Pick<ItemFacturableInput, 'unidad' | 'alicuotaIva' | 'moneda'>>;
  /** Columna(s) que forman la referenciaExterna; si no hay, se usa hash(fila normalizada). */
  referencia?: { columnas: string[] };
}
```

### 7.5 Puerto ARCA

```ts
// arca/arca.gateway.ts
export interface CredencialesArca {
  tenantId: string;
  ambiente: 'HOMOLOGACION' | 'PRODUCCION';
  cuit: string;
  certPem: string | null; // ya descifrado, vive solo en memoria
  keyPem: string | null;
}

export interface ArcaGateway {
  ultimoAutorizado(c: CredencialesArca, ptoVta: number, cbteTipo: number): Promise<number>;
  autorizar(c: CredencialesArca, req: SolicitudCae, correlationId: string): Promise<RespuestaCae>;
  consultar(c: CredencialesArca, ptoVta: number, cbteTipo: number, nro: number): Promise<ComprobanteArca | null>;
  cotizacion(c: CredencialesArca, monId: 'DOL'): Promise<string>;
  puntosVentaHabilitados(c: CredencialesArca): Promise<number[]>;
}

export interface SolicitudCae {
  ptoVta: number; cbteTipo: number; cbteNro: number; concepto: 1 | 2 | 3;
  docTipo: number; docNro: string; condicionIvaReceptorId: number;
  cbteFch: string; fchServDesde?: string; fchServHasta?: string; fchVtoPago?: string;
  impTotal: string; impTotConc: string; impNeto: string; impOpEx: string; impIva: string; impTrib: string;
  monId: 'PES' | 'DOL'; monCotiz: string;
  iva?: Array<{ id: number; baseImp: string; importe: string }>;
  cbtesAsoc?: Array<{ tipo: number; ptoVta: number; nro: number; cuit?: string; cbteFch?: string }>;
}
export type RespuestaCae =
  | { resultado: 'A'; cae: string; caeVto: string; observaciones: Obs[] }
  | { resultado: 'R'; errores: Obs[]; observaciones: Obs[] };
// Errores de red/timeouts → throw ArcaConectividadError (el llamador pasa a PENDIENTE_VERIFICACION).
```

`CredencialesArcaProvider` (en `tenants`) arma `CredencialesArca` descifrando el certificado activo del ambiente. `arca` no toca tablas de `tenants`.

Implementación: **`AfipSdkGateway`** (copiado y adaptado de `arca-client.service.ts` de Vialto).
- **Producción**: CUIT real del tenant y su certificado. Si falta alguno, error claro antes de llamar.
- **Homologación sin certificado**: CUIT de prueba de AfipSDK (`20409378472`), punto de venta 1 y receptor de prueba (`resolveReceptorAfip`), igual que Vialto. El PDF muestra los datos reales del tenant y del cliente, con marca de agua.
- **Homologación con certificado**: CUIT real del tenant con su certificado de homologación.
- El `access_token` de AfipSDK nunca se loguea (ya lo cuida Vialto) y no se guarda en `ArcaLog`.

### 7.6 Puerto PDF

```ts
export interface ComprobantePdfData {
  tipo: TipoComprobante; letra: 'A' | 'B' | 'C'; codigo: number; titulo: string;
  puntoVenta: number; numero: number | null; fechaEmision: string;
  emisor: { razonSocial: string; cuit: string; condicionIva: string; domicilio: string; iibb?: string; inicioActividades?: string };
  receptor: { razonSocial: string; documento: string; condicionIva: string; domicilio?: string };
  concepto: string; periodoServicio?: { desde: string; hasta: string }; vtoPago?: string;
  moneda: 'ARS' | 'USD'; cotizacion?: string;
  lineas: Array<{ descripcion: string; cantidad: string; unidad: string; precioUnitario: string; alicuotaIva?: string; importeNeto: string; importeTotal: string }>;
  totales: { netoGravado: string; noGravado: string; exento: string; iva: Array<{ alicuota: string; importe: string }>; tributos: string; total: string };
  discriminaIva: boolean; // false en B y C
  cae?: { numero: string; vencimiento: string; qrUrl: string };
  asociado?: { tipo: string; numero: string };
  homologacion: boolean; // marca de agua
}
export interface PdfComprobanteRenderer {
  render(data: ComprobantePdfData, plantilla: PlantillaPdfData): Promise<Buffer>;
}
```

### 7.7 Generador de recibos

```ts
// recibos/core/recibo.types.ts — sin imports de Nest, Prisma ni otros módulos
interface Parte { nombre: string; documento?: string; domicilio?: string }

interface ReciboBase {
  numero?: string;                 // lo asigna quien lo pide (numeraciones separadas por tipo)
  fecha: string;                   // YYYY-MM-DD
  items: Array<{ descripcion: string; cantidad?: string; importe: string }>;
  moneda: 'ARS' | 'USD';
  total: string;                   // se valida que coincida con Σ items
  medioPago?: string;
  observaciones?: string;
}

/** Recibo de COBRO: el tenant recibe dinero de su cliente. */
export interface ReciboCobro extends ReciboBase {
  tipo: 'COBRO';
  emisor: Parte;                   // quien cobra (el tenant) y firma
  pagador: Parte;                  // el cliente
  comprobantesAplicados?: Array<{ descripcion: string; importe: string }>; // facturas que cancela
}

/** Recibo de PAGO: el tenant le paga a un colaborador/proveedor; el beneficiario firma que recibió. */
export interface ReciboPago extends ReciboBase {
  tipo: 'PAGO';
  pagador: Parte;                  // el tenant
  beneficiario: Parte;             // colaborador/proveedor que cobra y firma
  periodo?: string;                // "Septiembre 2026" (como el recibo del tracker)
}

export type ReciboInput = ReciboCobro | ReciboPago;
export interface ReciboEstilo { logo?: Uint8Array; logoMime?: string; colorPrimario?: string; textoPie?: string }
export interface ReciboOutput { pdf: Buffer; filename: string }

export function generarRecibo(input: ReciboInput, estilo?: ReciboEstilo): Promise<ReciboOutput>;
```

- Los dos tipos se distinguen en todo el PDF, no solo en el título:
  - **COBRO**: "RECIBO DE COBRO", texto "Recibí de {pagador} la suma de {total en letras}…", detalle de comprobantes cancelados y firma del emisor.
  - **PAGO**: "RECIBO DE PAGO", texto "Recibí de {pagador} la suma de … en concepto de …", período y firma del beneficiario.
  - El nombre del archivo lleva el tipo (`Recibo-Cobro_…pdf` / `Recibo-Pago_…pdf`).
- `recibos/core/` es TypeScript puro y tiene su propio `package.json` interno y tests. Se va a poder publicar como `@capassotech/recibos` sin cambios.
- `recibos.module.ts` solo lo envuelve para Nest (`POST /recibos/pdf`, autenticado). El wrapper (no el núcleo) usa `tenants` para completar la parte del tenant con los datos del emisor y tomar el estilo de la plantilla PDF: el cliente del endpoint solo manda la contraparte, así nadie puede generar un recibo a nombre de otra empresa.
- `dependency-cruiser` falla el CI si `recibos/core` importa algo fuera de sí mismo (salvo `pdfkit`). Mientras `dependency-cruiser` no esté, lo controla un test (`generar-recibo.spec.ts`, "límites del núcleo").
- Implementado en la Fase 3 (2026-09-28): montos en centavos (`bigint`, sin `decimal.js`) y una copia propia de `numero-a-letras`. El período de un recibo de PAGO va en el texto del cuerpo. Todos llevan la leyenda "Documento no válido como factura".

---

## 8. Flujos clave

### 8.1 Autenticación (módulo `auth`)

**Contrato hacia el resto del sistema** (lo único que ven los demás módulos):

```ts
export interface AuthContext {
  tenantId: string;
  tipo: 'usuario' | 'integracion';
  usuarioId?: string;
  integracionId?: string;
  scopes: string[];
}
```

`AuthGuard` global: rutas `@Public()` pasan; `Authorization: Bearer <jwt>` → usuario; `X-Api-Key: fct_…` → integración (solo en rutas marcadas con `@ApiKey(...)`). Reemplazar por Clerk = cambiar la estrategia de verificación del Bearer dentro de `auth`, sin tocar controllers.

**Login**: `POST /auth/login { email, password, tenantSlug? }`.
- Busca usuarios activos con ese email **y contraseña** (bcrypt, cost 12). Si coincide en un solo tenant → JWT. Si coincide en más de uno → `409 { tenants: [{slug, nombre}] }` y el frontend pide elegir. Así el email es único por tenant, que lo necesita el alta automática.
- JWT HS256, 8 h, `{ sub, tid, tv }` (`tv` = `tokenVersion` para revocar). Sin refresh token en el MVP.
- Rate limit por IP + email (`@nestjs/throttler`).

**API keys**: `POST /integraciones` (usuario logueado) → devuelve `fct_<prefijo8>_<secreto32>` **una sola vez**. Se guarda `keyPrefijo` + `SHA-256(clave completa)`. La verificación es con `timingSafeEqual`. `DELETE /integraciones/:id` → `revocadaEn`.

**Token de acceso (sin doble login)**:

```
Tracker backend                    Facturador backend                   Navegador
     │ POST /api/v1/acceso/tokens         │                                   │
     │ X-Api-Key, { email, destino? }     │                                   │
     │──────────────────────────────────► │ scope acceso:emitir               │
     │                                    │ usuario (tenant, email) o lo crea │
     │                                    │   sin contraseña                  │
     │                                    │ token = 32 bytes random (b64url)  │
     │                                    │ guarda SHA-256, expira 60 s       │
     │ ◄──────────────── { url }          │                                   │
     │ redirect 302 → {FRONT}/acceso?token=…&destino=/borradores/x ─────────► │
     │                                    │ ◄── POST /auth/acceso/canjear     │
     │                                    │ UPDATE … SET usadoEn=now()        │
     │                                    │  WHERE hash=? AND usadoEn IS NULL │
     │                                    │  AND expiraEn>now()  (atómico)    │
     │                                    │ ──► { jwt, destino }              │
     │                                    │     front: history.replaceState   │
     │                                    │     (saca el token de la URL)     │
```

- `destino` solo acepta paths relativos de una lista blanca de rutas del frontend (evita open redirect).
- La página `/acceso` usa `Referrer-Policy: no-referrer` y no carga recursos de terceros.
- El endpoint de emisión solo acepta API key (nunca JWT de navegador) y CORS no lo expone.

### 8.2 Del staging al borrador

1. `POST /importaciones/{tracker|excel|manual}` → adaptador → `StagingService.ingresar` → `Importacion(EN_STAGING)` + ítems con estado.
2. El frontend muestra el staging: válidos, con errores (editables inline), duplicados. Se pueden corregir, descartar o crear clientes faltantes.
3. `POST /importaciones/:id/confirmar` → `CONFIRMADA`.
4. `POST /borradores/generar { itemIds | importacionId, agrupacion: 'cliente' | 'cliente-periodo' }` → un `Comprobante(BORRADOR)` por grupo (cliente + moneda + punto de venta). Tipo A/B/C calculado; líneas copiadas de los ítems; ítems → `EN_BORRADOR`.
5. El usuario revisa y edita (líneas, fechas de servicio, vencimiento). Cada edición recalcula totales en el backend y usa `version` como lock optimista.
6. Borrar un borrador devuelve sus ítems a `VALIDO`.

**Tipo de comprobante: lo elige el usuario** ([D3](#d3-la-letra-a-b-c-la-elige-el-usuario)).
- Al generar el borrador se precarga una **sugerencia** (`comprobantes/domain/tipo-comprobante.ts`, función pura con tests). En el borrador hay un selector A / B / C que el usuario puede cambiar.
- Cambiar la letra recalcula los totales (en C no se discrimina IVA) y se guarda como cualquier otra edición.
- Si la combinación emisor/receptor no coincide con la sugerencia, el frontend muestra una advertencia pero no bloquea: la última palabra la tiene ARCA, y su rechazo se muestra con el patrón mensaje + detalle.
- Las NC/ND no se eligen: heredan la letra de la factura asociada.

| Emisor | Receptor | Sugerencia |
|---|---|---|
| Monotributo / Exento | cualquiera | **C** (11/12/13) |
| Resp. Inscripto | Resp. Inscripto | **A** (1/2/3) |
| Resp. Inscripto | Monotributo | **A** (criterio vigente según entiendo; el usuario puede pasarla a B) |
| Resp. Inscripto | Consumidor final, Exento, No categorizado, Exterior | **B** (6/7/8) |

### 8.3 Emisión en ARCA idempotente

`POST /comprobantes/:id/emitir` con header `Idempotency-Key` (el frontend genera uno por clic de "Confirmar emisión").

```
1. Tx: UPDATE comprobante SET estado=EMITIENDO, intentos+1
       WHERE id=? AND tenantId=? AND estado IN (BORRADOR, RECHAZADO) AND version=?
   → 0 filas: devolver el estado actual (si ya está EMITIDO con esa key → 200 con el mismo resultado).
2. Validar datos completos del emisor, receptor y fechas de servicio (fail-fast, estilo assertFacturaEmitDatosCompletos).
3. pg_advisory_lock(hash(tenantId, ambiente, ptoVta, cbteTipo))   ← serializa la numeración
4. ultimo = FECompUltimoAutorizado; numeroReservado = ultimo + 1 (se persiste ANTES de llamar)
5. FECAESolicitar(numeroReservado)
   ├─ A (aprobado)  → EMITIDO, numero, CAE, snapshots; ítems → FACTURADO; evento comprobante.emitido
   ├─ R (rechazado) → RECHAZADO, numeroReservado = null, errorMensaje/errorDetalle
   └─ red/timeout   → PENDIENTE_VERIFICACION (se conserva numeroReservado)
6. unlock
```

**Resolver `PENDIENTE_VERIFICACION`** (reintento manual o cron cada minuto):
- `FECompConsultar(numeroReservado)`:
  - existe y coinciden `DocNro`, `ImpTotal` y `CbteFch` → recuperar CAE → `EMITIDO` (**no se vuelve a pedir**);
  - no existe y `ultimoAutorizado < numeroReservado` → se reintenta el paso 4 (seguro);
  - existe pero no coincide → alerta, queda bloqueado para revisión manual.

**Homologación**: se emite exactamente igual, con el ambiente del tenant (CUIT de prueba o certificado propio de homologación, ver §7.5). El PDF lleva la marca de agua y el frontend muestra el badge "Ambiente de pruebas" (patrón `AmbienteTestBadge` de Vialto).

**NC/ND**: `POST /comprobantes/:id/nota-credito { lineas?, motivo }` crea un borrador del tipo de la misma clase con `asociadoId`. Se emite por el mismo flujo con `CbtesAsoc`. Si la NC cubre el total, la factura pasa a `ANULADO`.

### 8.4 Cálculo de totales

`comprobantes/domain/totales.ts`, puro y con `Decimal`, portado de `buildComprobanteCvlp` + `groupAlicuotasIva`:

- Línea: `neto = round2(cantidad × precio × (1 − bonif))`, `iva = round2(neto × alícuota)`.
- A/B: `AlicIva` agrupado por Id (un registro por Id, `BaseImp > 0`), `ImpNeto = Σ BaseImp` (10061), `ImpIVA = Σ Importe` (10023), y la diferencia de centavos se ajusta en la línea de mayor base.
- B: se informa IVA a ARCA igual que A. En el PDF no se discrimina.
- C: sin `AlicIva`, `ImpIVA = 0`, `ImpNeto = total` y alícuota de línea ignorada.
- Alícuota 0 % → `ImpOpEx` o `ImpTotConc` según el caso (exento vs no gravado; se modela con un flag en la línea si hace falta).
- USD: `MonId = DOL`, `MonCotiz` de `FEParamGetCotizacion` al emitir (guardada en el comprobante). Validar al implementar si ARCA exige además el campo de "cancelación en misma moneda extranjera" vigente.

### 8.5 Webhooks salientes

Evento → `WebhookEntrega(PENDIENTE)` → worker (`@nestjs/schedule`) con backoff exponencial (1 m, 5 m, 30 m, 2 h, 12 h; 6 intentos) → header `X-Facturador-Firma: t=<ts>,v1=HMAC_SHA256(secreto, ts + "." + body)` + `X-Facturador-Evento-Id`.

---

## 9. Seguridad y criterios técnicos

- **Aislamiento de tenant**:
  1. FKs compuestas `(tenantId, id)` en la base;
  2. `TenantContext` (AsyncLocalStorage) cargado por el guard;
  3. extensión de Prisma que agrega `where: { tenantId }` en todos los modelos con tenant y falla si una query corre sin contexto (salvo los scripts marcados);
  4. test e2e que intenta leer y modificar recursos de otro tenant en cada endpoint.
  
  Como endurecimiento posterior queda Row Level Security de Postgres.
- **Secretos**: certificados y claves cifrados AES-256-GCM con `FACTURADOR_ENCRYPTION_KEY` (fail-fast al arrancar); la API los expone solo como `{ configurado, venceEl, huella }`. API keys y tokens de acceso guardados como SHA-256. Contraseñas con bcrypt.
- **Logs**: logger con redacción de `authorization`, `x-api-key`, `password`, `token` (también en query string), `cert`, `key`, `sign`. `ArcaLog` guarda el request saneado (sin `Auth`).
- **Validación**: `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` global y DTO en cada endpoint. Montos como string decimal validado con regex, nunca `number`.
- **Idempotencia**:
  - importaciones: `(tenant, origen, referenciaExterna)` único más `hashContenido`;
  - emisiones: `Idempotency-Key`, número reservado y `FECompConsultar` antes de reintentar;
  - API pública: `SolicitudIdempotente`.
- **Configuración por tenant en DB**: datos fiscales, puntos de venta, certificados, tarifas, plantillas de mapeo, plantilla PDF, integraciones y webhooks. En código solo quedan las constantes normativas de ARCA (códigos, alícuotas).
- **Tests obligatorios**: `totales.ts` (casos de Vialto + C + multi-alícuota + centavos), `tipo-comprobante.ts`, numeración/idempotencia de emisión (con `ArcaGateway` fake que simula timeout después de autorizar), cada adaptador (fixtures de tracker, xlsx y csv con `;` y coma decimal), token de acceso (expirado, reusado, de otro tenant) y `recibos/core`.

### Fases (recordatorio, sin cambios respecto del plan)

| Fase | Entregable | Criterio de cierre |
|---|---|---|
| 1 | Repos, CI, DB, `auth` básico, login y rutas protegidas, scripts de alta | Login funcionando contra Neon |
| 2 | tenants, clientes, comprobantes, arca (homologación), pdf | Factura emitida en homologación con carga manual |
| 3 | `recibos` | Tests propios verdes, PDF generado |
| 4 | API keys, token de acceso, staging, tracker, Excel/CSV | Borradores desde un mes del tracker y desde un Excel |
| 5 | API pública, webhooks, Swagger | Docs publicadas |
| 6 | Producción por tenant, descarga de PDF, ajustes | Emisión real con un tenant piloto |

---

## 10. Decisiones tomadas

Cerradas el 2026-09-25.

### D1. Proveedor ARCA: AfipSDK

Se usa **AfipSDK** (`@afipsdk/afip.js`), como Vialto, con una cuenta de plataforma (`AFIP_SDK_API_KEY`).
- Queda detrás de `ArcaGateway` ([§7.5](#75-puerto-arca)). Si en el futuro se pasa a WSAA/WSFE nativo, solo cambia esa implementación.
- Los certificados de producción de cada tenant se guardan cifrados y se le pasan al SDK en memoria en cada llamada.
- A tener en cuenta: el costo de AfipSDK crece con el volumen de todos los tenants. Conviene revisarlo antes de sumar clientes pagos (Fase 6).

### D2. Endpoint nuevo en el tracker

Se agrega un endpoint chico al tracker que devuelve **horas trabajadas y horas facturables**. El Facturador factura por defecto con las **facturables**, y se puede elegir la base al importar y por ítem en el staging ([§7.3](#73-adaptador-del-time-tracker)).

Se implementa en la **Fase 4**, como cambio separado en `capassotech-backend` (esa es la aprobación para tocar el tracker; el resto de su código no se modifica).

**Contrato**

```
GET /integrations/billable-hours?from=YYYY-MM-DD&to=YYYY-MM-DD[&clientId=…]
X-Integration-Key: <clave>
```

```jsonc
{
  "from": "2026-09-01",
  "to": "2026-09-30",
  "generatedAt": "2026-10-01T12:00:00Z",
  "entries": [
    {
      "id": "…",                    // time_entries.id
      "date": "2026-09-03",
      "hours": "6.00",              // trabajadas
      "billableHours": "4.13",      // calculadas por el tracker
      "billableDetail": { "appliedFactor": "…", "markupMultiplier": "…", "additionalFixedHours": "…", "minimumBillableHours": null },
      "taskBillingType": "feature",
      "taskId": "…", "taskTitle": "…",
      "collaborator": { "id": "…", "name": "…" },
      "project": { "id": "…", "name": "…", "billingType": "hourly" },
      "client": { "id": "…", "name": "…", "razonSocial": "…", "cuit": "…", "ivaCondition": "…", "billingCurrency": "USD" }
    }
  ]
}
```

**Qué implica en el tracker**
- **Guard nuevo** `IntegrationKeyGuard`: compara el header `X-Integration-Key` contra el SHA-256 guardado en la variable `FACTURADOR_INTEGRATION_KEY_HASH`, con `timingSafeEqual`. No usa Firebase y solo aplica a esta ruta.
- **Mover `computeBillableHoursDetails`** (hoy en `capassotech-timetracker-frontend/src/lib/utils.ts`) al backend, junto con sus dependencias (`toUSD`, `getEffectiveHourlyRate`, `normalizeBillableConfig`, que ya existe en el backend) y usando el tipo de cambio mensual de `monthly_exchange_rates`.
- **Test de paridad**: con los mismos datos, el backend tiene que dar las mismas horas facturables que hoy muestra el frontend. Antes de implementarlo hay que verificar si el frontend aplica `additionalFixedHours` y `minimumBillableHours` por registro o por agrupación, y replicar exactamente eso.
- **Filtro** por rango de fechas (y cliente, vía `projects.client_id`) en la query, no en memoria.
- **Opcional, en el mismo cambio**: que el frontend pase a usar el cálculo del backend, para no tener la fórmula duplicada. Si no se hace ahora, queda anotado como deuda.

El otro cambio en el tracker es el botón "Ir al facturador", que pide el token de acceso de un solo uso (§8.1). Es de la Fase 4 y también es chico.

### D3. La letra (A, B, C) la elige el usuario

Se sugiere según emisor y receptor, y el usuario la puede cambiar en el borrador ([§8.2](#82-del-staging-al-borrador)). A monotributistas se sugiere **A**; conviene confirmarlo con el contador, pero no bloquea nada porque se puede cambiar.

### D4. Almacenamiento: DB ahora, Cloudinary después

MVP: logo en DB (`bytea` ≤ 300 KB) y PDF generado a pedido desde el snapshot. Cloudinary entra más adelante detrás del puerto `AlmacenamientoArchivos` (subir, obtener URL, borrar), sin cambiar `pdf` ni `comprobantes`. El código de Vialto (`cloudinary.service.ts`) queda como referencia para ese momento.

### D5. Recibos de cobro y de pago, diferenciados

El módulo `recibos` genera los dos tipos (`tipo: 'COBRO' | 'PAGO'`), con datos, textos, firma y nombre de archivo distintos ([§7.7](#77-generador-de-recibos)). La numeración la asigna quien pide el recibo y es independiente por tipo. No son comprobantes electrónicos de ARCA.

### D6. Infraestructura

- GitHub: dos repos privados, `facturador-backend` y `facturador-frontend`.
- Render: web service para el backend y static site para el frontend.
- Neon: proyecto nuevo `facturador` con ramas `develop` y `production`.

Se crea en la Fase 1.
