# Pase a producción

Guía para poner el Facturador en producción y emitir la primera factura real con un tenant piloto.
Los pasos marcados **(ARCA)** o **(Render/Neon)** se hacen fuera del código, con las credenciales del dueño.

## 0. Antes de salir

- [x] **NestJS actualizado a 11.2.6** (2026-09-29): resolvió multer, lodash, js-yaml y body-parser (18 → 5 avisos). Nest 12 es solo ESM; no hace falta para estos arreglos.
  Quedan 5 avisos: `deepmerge-ts` (solo en el CLI de Prisma, al migrar; se va con Prisma 7) y `uuid` vía `exceljs`
  (la función afectada, v3/v5/v6 con buffer, no se usa).
- [ ] Guardar **`FACTURADOR_ENCRYPTION_KEY` de producción** en un gestor de secretos. Si se pierde, los certificados
  guardados no se pueden descifrar (hay que volver a cargarlos).
- [ ] Revisar el costo de AfipSDK para producción (el uso de todos los tenants sale de la misma `AFIP_SDK_API_KEY`).

## 1. Base de datos (Render/Neon)

Proyecto Neon `facturador`, rama `production`.

1. Copiar las connection strings de la rama `production` (con pooler para `DATABASE_URL`, sin pooler para `DIRECT_URL`).
2. Aplicar las migraciones: `DATABASE_URL=… DIRECT_URL=… npx prisma migrate deploy`. El build de Render también lo hace
   (`render.yaml`).

## 2. Backend y frontend (Render)

`render.yaml` está en cada repo (región Ohio, plan free, rama `main`). Crear los servicios desde el Blueprint y cargar:

| Variable (backend) | Valor |
|---|---|
| `DATABASE_URL`, `DIRECT_URL` | Neon `production` |
| `JWT_SECRET` | la genera Render |
| `FACTURADOR_ENCRYPTION_KEY` | 32+ caracteres aleatorios; **no se cambia nunca** |
| `AFIP_SDK_API_KEY` | token de AfipSDK |
| `FRONTEND_URL` | Dominios del frontend, separados por coma (CORS). El **primero** se usa para los enlaces de acceso: poné primero el dominio propio. Ej.: `https://facturador.capasso.tech,https://facturador-frontend.onrender.com` |
| `NODE_ENV` | `production` (ya está en `render.yaml`: exige https en webhooks y tracker, y bloquea IPs internas) |

| Variable (frontend) | Valor |
|---|---|
| `VITE_API_URL` | URL del backend + `/api` |

Verificar: `GET /api/health` responde y `/api/docs` muestra la documentación.

## 3. Tenant piloto y usuario

Piloto: **Elias Nicolas Capasso**, CUIT 20-38442199-8, Monotributo (emite Factura C), French 94, General Ramirez,
usuario `contacto@capasso.tech`. Ya está creado en Neon `develop` (slug `capasso`); en producción hay que crearlo con
los mismos datos:

```bash
DATABASE_URL=… npm run crear-tenant -- --slug <slug> --nombre "<Nombre>" \
  --razon-social "<Razón social>" --cuit <CUIT> --condicion-iva RESPONSABLE_INSCRIPTO --domicilio "<Domicilio fiscal>"
DATABASE_URL=… NUEVA_PASSWORD='<clave larga>' npm run crear-usuario -- --tenant <slug> --email <email>
```

El tenant arranca en **homologación**. Entrar, completar Configuración → Datos del emisor (inicio de actividades,
ingresos brutos) y hacer una factura de prueba en homologación.

## 4. Certificado de producción (ARCA)

Con la clave fiscal del CUIT emisor. **Hay un asistente paso a paso en Configuración → Certificados ARCA** que genera la clave y el pedido (CSR) en el navegador, sin openssl (probado: el CSR verifica con openssl, y un certificado emitido desde él pasa la validación del backend).

1. Generar la clave privada y el pedido de certificado (CSR), con el asistente o con openssl. La clave privada **no se comparte** con nadie:
   ```bash
   openssl genrsa -out facturador.key 2048
   openssl req -new -key facturador.key -subj "/C=AR/O=<Razón social>/CN=facturador/serialNumber=CUIT <CUIT sin guiones>" -out facturador.csr
   ```
2. ARCA → **Administración de Certificados Digitales** → agregar alias `facturador` → subir `facturador.csr` →
   descargar el certificado (`.crt`).
3. ARCA → **Administrador de Relaciones de Clave Fiscal** → nueva relación → servicio **Facturación Electrónica**
   (`wsfe`) → representante: el certificado `facturador`.
4. ARCA → **Administración de Puntos de Venta y Domicilios** → alta de un punto de venta **Factura Electrónica -
   Monotributo - Web Services** (monotributistas) o **RECE para aplicativo y web services** (responsables inscriptos).
   No sirve uno de "Comprobantes en línea".

## 5. Configuración en el Facturador

1. Configuración → **Certificados ARCA** → ambiente **Producción** → pegar o subir `facturador.crt` y `facturador.key`.
   Se valida que sean pareja, que no estén vencidos y que el CUIT coincida; se guardan cifrados.
2. Configuración → **Puntos de venta** → agregar el número del paso 4.4 con ambiente **Producción**.
3. Configuración → **Producción** → **Probar conexión con ARCA producción**. Solo consulta el último número autorizado
   (no emite). Tiene que responder "conexión correcta" en cada punto de venta.
4. **Pasar a producción**, escribiendo el CUIT para confirmar. Antes de cambiar se vuelve a probar la conexión.

## 6. Primera factura real

- Elegir un cliente conocido y un importe chico. Revisar el borrador (letra, concepto, fechas de servicio) antes de emitir.
- Emitir. Controlar el CAE en ARCA (**Mis Comprobantes**) y descargar el PDF (el QR tiene que abrir el comprobante en ARCA).
- Si hubo que anularla: nota de crédito por el total desde el comprobante (la factura queda ANULADA).

## 7. Integraciones del piloto (si aplica)

- **Tracker**: en el backend del tracker de producción, `FACTURADOR_INTEGRATION_KEY_HASH` (desde Configuración → Tracker →
  Generar), `FACTURADOR_API_URL` (URL del backend + `/api`) y `FACTURADOR_API_KEY` (Configuración → Integraciones, permiso
  "acceso"). La URL del tracker tiene que ser https.
- **Webhooks**: solo https y a direcciones públicas.
- **Sistemas sin backend con Firebase Auth (ej. panel de EFE Capital)**: en lugar de una API key en el navegador, usan
  el ID token de Firebase del usuario. Pasos:
  1. Configuración → Integraciones: crear una integración (origen API) con los permisos que necesite
     (`comprobantes:read`, `comprobantes:write`, `items:write`). La clave no se usa; anotar el **id** de la integración.
  2. Variable `FIREBASE_FEDERACION` (JSON):
     `[{"projectId":"efecapitaladmin","integracionId":"<id>","emails":["persona@efecapital.com"]}]`.
     Solo esos emails pueden operar; cada acción queda auditada con el email del usuario.
  3. Agregar el origen del panel a `FRONTEND_URL` (CORS), separado por coma.
  4. En el panel: `VITE_FAKTIA_API_URL=https://<backend>/api`.
  Revocar la integración corta el acceso de inmediato.

## Volver a homologación

Configuración → Producción → **Volver a homologación** (con el CUIT). Los comprobantes ya emitidos en producción siguen
siendo válidos.
