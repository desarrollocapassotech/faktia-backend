# faktia-backend

Backend de Faktia, sistema de facturación electrónica multi-tenant. NestJS 10 + Prisma 6 + PostgreSQL (Neon).
La arquitectura completa está en `../ARCHITECTURE.md`.

## Puesta en marcha

```bash
npm install                 # también corre prisma generate
cp .env.example .env        # completar DATABASE_URL, DIRECT_URL, JWT_SECRET, FAKTIA_ENCRYPTION_KEY y AFIP_SDK_API_KEY
npx prisma migrate deploy   # aplica las migraciones
npm run start:dev           # http://localhost:3000/api
```

Si `start:dev` se cuelga después de "Found 0 errors" (pasa con la extensión Console Ninja de VS Code), usar `npm run build && npm run start:prod`.

Base de datos: proyecto Neon `facturador`, una sola rama (`production`). No hay QA ni desarrollo: los tests de integración corren contra esa base si `DATABASE_URL` está definida.

## Crear tenants y usuarios

Cualquiera puede registrarse desde `/registro` del frontend (`POST /api/auth/registro`): se crea una empresa nueva, en homologación, con su primer usuario. La empresa nace solo con el nombre, y los datos fiscales (razón social, CUIT, condición IVA, domicilio) se completan después en Configuración. Hasta tenerlos no se puede facturar.

Para dar de alta empresas o usuarios a mano siguen estando los scripts:

```bash
npm run crear-tenant -- --slug capassotech --nombre "CapassoTech" \
  --razon-social "Capasso Tech SAS" --cuit 30-12345678-9 \
  --condicion-iva RESPONSABLE_INSCRIPTO --domicilio "Calle 123, CABA"

# La contraseña se toma de NUEVA_PASSWORD; si no está, se genera y se muestra una vez.
NUEVA_PASSWORD='una-clave-larga' npm run crear-usuario -- --tenant capassotech --email persona@empresa.com
```

Volver a correr `crear-usuario` con un email existente le asigna la contraseña nueva y cierra todas sus sesiones.

## Endpoints (Fase 1)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/health` | pública | Estado del servidor y de la base |
| POST | `/api/auth/login` | pública (5 intentos/min por IP) | `{ email, password, tenantSlug? }` → `{ accessToken, usuario, tenant }`. `409` con `tenants[]` si el email existe en varias empresas |
| POST | `/api/auth/registro` | pública (10/h por IP) | `{ nombreEmpresa, email, password }` → crea empresa y usuario, devuelve la sesión |
| GET | `/api/auth/me` | Bearer | Usuario (con `tienePassword`) y tenant de la sesión |
| PATCH | `/api/auth/me` | Bearer | `{ nombre }`: nombre visible del usuario (vacío lo borra) |
| POST | `/api/auth/password` | Bearer (5/min) | `{ passwordActual?, passwordNueva }`. La actual es obligatoria si ya tiene una. Cierra todas las sesiones y devuelve una nueva |

## Endpoints (Fase 2)

Todos requieren sesión (Bearer) y operan sobre el tenant de la sesión.

**Configuración del tenant** (`modules/tenants`)

| Método | Ruta | Descripción |
|---|---|---|
| GET / PATCH | `/api/configuracion/emisor` | Datos fiscales del emisor. El CUIT se carga una sola vez y, con el padrón configurado, se verifica al guardarlo (`404` si no existe; si ARCA no responde, se acepta). El GET incluye `padronDisponible`. El ambiente no se cambia desde acá |
| POST | `/api/configuracion/emisor/sincronizar-arca` | Con el CUIT ya guardado: bloquea (`camposDeArca`) los datos que coinciden con el padrón, sin pisar nada, y devuelve el inicio de actividades sugerido |
| GET | `/api/configuracion/emisor/padron/:cuit` | Constancia de inscripción del CUIT (razón social, domicilio, condición IVA) para autocompletar el emisor. `503` si el padrón no está configurado o ARCA no responde, `429` por el tope diario |
| GET | `/api/configuracion/arca` | Ambiente, CUIT con el que se emite (real o de prueba), certificado vigente y si AfipSDK está configurado |
| GET / POST | `/api/configuracion/puntos-venta` | Listar / crear `{ numero, ambiente, descripcion? }` |
| PATCH | `/api/configuracion/puntos-venta/:id` | `{ descripcion?, activo? }` |
| GET / POST | `/api/configuracion/certificados` | Listar (solo metadatos) / cargar `{ ambiente, certificadoPem, clavePrivadaPem }`. Se valida pareja, vencimiento y CUIT; se guarda cifrado y reemplaza al anterior del ambiente |
| GET / PATCH | `/api/configuracion/plantilla-pdf` | Colores, texto de pie, duplicado |
| GET / PUT / DELETE | `/api/configuracion/plantilla-pdf/logo` | Ver / subir (multipart, campo `logo`, PNG o JPG hasta 300 KB) / borrar |

**Clientes** (`modules/clientes`)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/clientes?q=&incluirInactivos=` | Busca por razón social o documento (hasta 200) |
| GET | `/api/clientes/padron/:cuit` | Constancia de inscripción en ARCA: razón social, domicilio, condición IVA |
| GET / POST / PATCH | `/api/clientes`, `/api/clientes/:id` | Alta y edición. Valida el dígito verificador del CUIT/CUIL; `409` si el documento ya existe |

**Comprobantes** (`modules/comprobantes`)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/comprobantes?estado=&clase=&clienteId=&numero=&fechaDesde=&fechaHasta=&ordenarPor=&dir=&pagina=&porPagina=` | Lista paginada `{ total, pagina, porPagina, items }`. `clase`: `FACTURA`, `NOTA_CREDITO` o `NOTA_DEBITO` (cualquier letra). `numero`: `15` o `00002-00000015`. Fechas de emisión `YYYY-MM-DD`, inclusive. `ordenarPor`: `comprobante`, `numero`, `fecha`, `cliente`, `total` o `estado` (`dir` `asc`/`desc`); sin él, los más recientes primero. `incluirRecibos=true` (lo usa la app; la API pública no) suma los recibos guardados como filas con `clase: "recibo"`, `tipo` `RECIBO_COBRO`/`RECIBO_PAGO` y `numeroTexto`; con `clase=RECIBO`, solo recibos |
| POST | `/api/comprobantes` | Crea un borrador de factura. `tipo` opcional (`FACTURA_A/B/C`); si falta, se usa la letra sugerida |
| GET | `/api/comprobantes/:id` | Detalle con líneas, alícuotas, cliente, notas asociadas, `letraSugerida` y `advertenciaLetra` |
| PATCH | `/api/comprobantes/:id` | Edita un BORRADOR o RECHAZADO. Requiere `version` (lock optimista, `409` si cambió) |
| DELETE | `/api/comprobantes/:id` | Solo borradores que nunca fueron a ARCA |
| POST | `/api/comprobantes/:id/emitir` | `{ version }` + header **`Idempotency-Key`** obligatorio. Devuelve EMITIDO, `422` si ARCA rechaza (con `message` y `detalle`) o PENDIENTE_VERIFICACION si no se sabe el resultado. Reintentar con la misma clave no emite dos veces |
| POST | `/api/comprobantes/:id/verificar` | Consulta en ARCA un PENDIENTE_VERIFICACION (también lo hace un cron cada minuto) |
| POST | `/api/comprobantes/:id/notas` | `{ clase: NOTA_CREDITO \| NOTA_DEBITO, motivo }`: borrador de nota sobre una factura emitida, con su letra y sus líneas. Una NC por el total anula la factura al emitirse |
| GET | `/api/comprobantes/:id/pdf` | PDF (solo con CAE). Original + duplicado según la plantilla; marca de agua en homologación |

## API pública, webhooks y documentación (Fases 4 y 5)

- **Documentación**: Swagger en `/api/docs` (y `/api/docs/openapi.json`). Copia versionada en [`docs/openapi.json`](docs/openapi.json): se regenera con `npm run openapi` (corre en modo preview, sin base).
- **API pública** `/api/v1/*` (módulo `api-publica`): `X-Api-Key` con scopes (`items:write`, `comprobantes:write`, `comprobantes:read`, `acceso:emitir`). No acepta la sesión de un usuario. Carga de ítems (`POST /v1/items`, idempotente por `referenciaExterna`), confirmación, clientes, borradores (por ids, referencias o importación), emisión (`Idempotency-Key` obligatoria), consulta y PDF.
- **Idempotencia**: `Idempotency-Key` en los POST → `SolicitudIdempotente` (24 h). Mismo request devuelve la respuesta guardada (`Idempotent-Replayed: true`); otro request con la misma clave da `422`; en curso da `409`. Los 5xx no se guardan.
- **Webhooks** (`/api/configuracion/webhooks`, sesión de usuario): eventos `comprobante.emitido`, `comprobante.rechazado` e `importacion.confirmada`, emitidos con `@nestjs/event-emitter` (quien emite no conoce a `api-publica`). Firma `X-Faktia-Firma: t=…,v1=HMAC_SHA256(secreto, t + "." + cuerpo)` (por compatibilidad también se mandan los headers viejos `X-Facturador-*`), secreto cifrado y mostrado una vez. Reintentos a 1 m, 5 m, 30 m, 2 h y 12 h (6 intentos) con un cron cada 30 s. En producción (`NODE_ENV=production`): solo https, sin direcciones internas (también se revisa el DNS al enviar), sin seguir redirecciones.
- **Importaciones**, tarifas, conexión al tracker, API keys y token de acceso: ver `PLAN.md` (Fase 4).

## Endpoints (Fase 3)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/recibos` | Crea (guarda) un recibo: el mismo body que `/api/recibos/pdf` más `clienteId?` (solo COBRO). Aparece en `GET /api/comprobantes?incluirRecibos=true`. `409` si ya hay un recibo de ese tipo con el mismo número |
| GET | `/api/recibos/siguiente-numero?tipo=` | Número sugerido: el siguiente al del último recibo guardado de ese tipo (`0001-00000001` si no hay) |
| GET | `/api/recibos/:id` · `/api/recibos/:id/pdf` | Recibo guardado y su PDF (se arma con la plantilla vigente) |
| POST | `/api/recibos/pdf` | Genera un recibo en PDF, sin guardarlo. `{ tipo: COBRO \| PAGO, numero?, fecha, moneda, contraparte: { nombre, documento?, domicilio? }, items: [{ descripcion, cantidad?, importe }], total, medioPago?, observaciones?, comprobantesAplicados? (COBRO), periodo? (PAGO) }`. La parte del tenant (quien cobra o quien paga) sale de los datos del emisor; el estilo, de la plantilla PDF. `400` si el total no coincide con la suma de los conceptos |

El generador vive en `src/modules/recibos/core/`: TypeScript puro (solo `pdfkit`), con su propio `package.json` (`@capassotech/recibos`) y tests. Un test falla si importa algo fuera de esa carpeta.

En homologación sin certificado propio se emite con el CUIT de prueba de AfipSDK (`20409378472`). Como ese CUIT es compartido, la fecha informada a ARCA puede quedar en el futuro (nunca anterior al último comprobante autorizado).

## Auth

- Todo endpoint requiere sesión salvo los marcados con `@Public()` (guard global en `modules/auth`).
- Los demás módulos solo usan `@CurrentAuth(): AuthContext` y lo exportado en `modules/auth/index.ts`, para poder reemplazar la autenticación por Clerk sin tocarlos.
- JWT HS256 (8 h). La sesión se revoca incrementando `Usuario.tokenVersion`.

## Scripts

| Script | Qué hace |
|---|---|
| `npm run typecheck` / `lint` / `test` | Lo mismo que corre el CI |
| `npm run prisma:migrate -- --name <nombre>` | Crea una migración nueva (rama `develop`) |
| `npm run prisma:deploy` | Aplica migraciones (producción) |
