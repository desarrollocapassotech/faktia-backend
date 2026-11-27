# Ale Herrería: revisión del trabajo autónomo

> Trabajo hecho en una sesión remota sin credenciales (sin Neon, sin certificado de ARCA, sin SMTP).
> Lo que no se pudo correr acá está en "Pendiente local".
> El estado de cada subfase, para retomar, está en `docs/PLAN.md` → "Fase Ale Herrería".

## 1. Resumen por fase

**PRs en borrador contra `main`** (rama `claude/exciting-mccarthy-r0epck` en los dos repos; ver R1):
- Backend: https://github.com/desarrollocapassotech/faktia-backend/pull/1
- Frontend: https://github.com/desarrollocapassotech/faktia-frontend/pull/1

| Fase | Backend | Frontend |
|---|---|---|
| 1. Base | `abf6221` | `4656deb` |
| 2. Proyectos + cuenta corriente + recibos | `a76aff1` | `fbf62e0` |
| 3. Avisos por email | `01ef6fc` | `9fa1649` |
| 4. Presupuestos | `ad8dfe6` | `532616b` |
| 5. Materiales + proveedores | `b709c95` | `d71c345` |
| 6. Documentación | (último commit) | — |

Verificado en este entorno, con un Postgres 16 local: las 5 migraciones nuevas aplican sobre una base vacía sin diferencias con el schema, y pasan typecheck, lint, `deps`, build (los dos repos) y **394 tests** del backend, incluidos el e2e de aislamiento y los cinco nuevos (`ale-base`, `ale-proyectos`, `ale-avisos`, `ale-presupuestos`, `ale-materiales`). Falla solo el test conocido de `generar-recibo.spec.ts` (CLAUDE.md). Las pantallas se recorrieron con Playwright contra el backend real y en 390 px no hay scroll horizontal.

### Fase 1: Base

- **Módulos por empresa:** `Tenant.modulosHabilitados` (lista en `src/shared/modulos/modulos.ts`).
  - Backend: decorador `@Modulo('…')` en los controllers. El `AuthGuard` responde 403 si la empresa no lo tiene. Vale para sesión y para API key.
  - Recibos de pago: módulo `recibos-pago`, controlado en `POST /recibos` y `POST /recibos/pdf`.
  - Frontend: menú, pestañas de Configuración y opciones de "Nuevo comprobante" según los módulos del perfil.
  - Script del administrador: `npm run configurar-modulos -- --slug … --ocultar … --etiqueta Obra --etiqueta-plural Obras`.
- **Etiqueta de proyecto:** `Tenant.etiquetaProyecto` / `etiquetaProyectoPlural`. Configuración → Preferencias.
- **Encabezado y firma:** `Tenant.telefono`, `Tenant.emailContacto` (Datos del emisor) y `PlantillaPdf.firmaTexto` (Plantilla PDF).
- **Clientes sin documento:** columna `Cliente.claveDocumento` (`TIPO:NUMERO`, null sin documento) con unique `(tenantId, claveDocumento)`. Reemplaza el unique `(tenantId, tipoDocumento, numeroDocumento)`.
- Migración `20261126120000_ale_base`. E2E `src/ale-base.e2e.spec.ts`.

### Fase 2: Proyectos + cuenta corriente + recibos

- **`Proyecto`** (tabla `proyectos`) vive en el módulo `cuenta-corriente` (carpeta `proyectos/`): no guarda saldos y todo lo que mueve plata es de la cuenta corriente. Rutas `/proyectos` con `@Modulo('proyectos')`.
- **Plan de pagos:** cada hito es un `MovimientoCuentaCorriente` DEBE con origen `ACUERDO`, `proyectoId`, `orden`, vencimiento opcional y `porCertificacion`. `PUT /proyectos/:id/plan` reemplaza el plan: los hitos tienen que sumar el acordado; los que tienen cobros o certificaciones solo cambian descripción y vencimiento. Con acordado y sin hitos, queda un único hito "Monto acordado".
- **Certificaciones:** tabla `certificaciones_hito`. Su suma no supera el hito. Solo lo certificado es exigible: la imputación, los vencidos, el resumen y los avisos trabajan sobre eso. Lo cobrado de un hito se reparte entre sus certificaciones por vencimiento.
- **Saldo total y exigible:** por proyecto, por cliente (`saldos[].exigible`) y en el resumen (`aCertificar`).
- **Imputación automática por proyecto** (`CuentaCorrienteService.imputarProyecto`): los pagos del proyecto se aplican a sus deudas exigibles, hitos por orden y después el resto por vencimiento. Corre después de cada cambio (entrega, certificación, adicional, factura, plan). Un HABER sin proyecto solo se imputa a DEBE sin proyecto (también al imputar a mano).
- **IVA de facturas** (`impactoFactura`): sin acordado, el total; `ACORDADO_FINAL`, $0 (queda el renglón con la aclaración); `MAS_IVA`, IVA + tributos. Una NC hace lo mismo como HABER. Cambiar el modo (o pasar a tener/no tener acordado) desimputa y recalcula (`recalcularComprobantesDeProyecto`). `Comprobante.proyectoId` (también en la API pública); la NC hereda el proyecto de su factura.
- **Tipo de cambio:** editado en el pago → `Proyecto.tipoCambioFijo` → cotización de ARCA (`PROVEEDOR_COTIZACION`, adaptador `CotizacionArca` con `FEParamGetCotizacion`, fake en los tests). Los movimientos guardan `monedaOrigen`, `importeOrigen` y `tipoCambio`; el recibo, `monedaImputacion`, `importeImputacion` y `tipoCambio`.
- **Entregas** (`POST /proyectos/:id/entregas`): con recibo (número siguiente automático, en la moneda en que pagó) o sin recibo (pagos viejos con su fecha original).
- **Recibo con estado de la obra:** `Recibo.proyectoId` + `estadoProyecto` (copia al guardar). El PDF muestra acordado, entregas con fecha, saldo, lo que falta (hitos, certificaciones pendientes, a certificar) y la equivalencia de TC. Encabezado con teléfono, email, IIBB, inicio de actividades y condición IVA; firma con `firmaTexto`.
- **Anular recibo** (`POST /recibos/:id/anular`): el recibo queda con la marca "ANULADO" y su cobro se revierte con un DEBE origen `ANULACION` imputado a él (trazable, no se borra nada).
- **Adicionales:** `POST /proyectos/:id/adicionales` (DEBE `MANUAL` con proyecto). Los movimientos manuales aceptan `proyectoId` y `tipoCambio`.
- Frontend: Obras (listado con filtros por estado, alta con plan de pagos, detalle con plan, certificaciones con ayudante de %, adicionales, facturas, entregas y recibos), obra en el editor de comprobantes, anular recibo, obra y exigible en la cuenta corriente.
- Script `npm run datos-ejemplo-ale` (empresa de ejemplo con los casos del doc, usando los servicios reales).
- Tests: `domain/proyecto.spec.ts` (casos de Costa Doll, Wilson Carrillo, Municipalidad), `estado-proyecto.spec.ts`, e2e `src/ale-proyectos.e2e.spec.ts` y el de aislamiento ampliado.

### Fase 3: Avisos por email

- **Puerto `EmailPort`** (`src/shared/email/email.ts`): adaptador SMTP (nodemailer 10.4, configurable por `SMTP_*`) y uno que solo registra en el log (el default sin SMTP). `EMAIL_TRANSPORTE=log|smtp` lo fuerza.
- **Módulo `avisos`:** resumen diario con `@nestjs/schedule` a las 8 (hora de Argentina) para cada empresa con avisos activos y cuenta corriente habilitada. Va a **todos los usuarios activos** de la empresa, con lo vencido y lo que vence en los próximos `diasAvisoVencimiento` días (default 3). Trabaja sobre lo exigible (certificaciones, no lo que falta certificar). Solo se manda si hay algo.
- **Una vez por día:** tabla `avisos_email` con unique `(tenantId, fecha)`; se reserva el día antes de mandar y se libera si el envío falla.
- **Pantalla:** Configuración → Preferencias: activar, días de anticipación, vista previa de hoy, "Mandarme una prueba" y último envío. Endpoints `GET /avisos/vista-previa`, `GET /avisos/historial`, `POST /avisos/probar`.
- `Tenant.avisosEmail`, `Tenant.diasAvisoVencimiento`. `UsuariosService` exportado por `auth` (solo emails de usuarios activos).
- Tests: `correo.spec.ts`, `email.spec.ts`, e2e `src/ale-avisos.e2e.spec.ts`.

### Fase 4: Presupuestos

- **Módulo `presupuestos`** (`@Modulo('presupuestos')`): tablas `presupuestos`, `presupuesto_items`, `items_biblioteca`, `observaciones_catalogo`; `Tenant.diasValidezPresupuesto` (default 15, Configuración → Preferencias).
- **Numeración** P-0000001 correlativa por empresa (máximo + 1 con advisory lock).
- **Tres formas de cotizar:** por ítem (suma de importes), total global y por superficie (ancho, largo, alturas, m² y precio por m² o total).
- **IVA:** sin mencionar, "no incluye IVA" (agrega la observación) o discriminado con alícuota elegible (21% por defecto; 10,5, 27, 5, 2,5, 0).
- **Texto con formato limitado** (`domain/formato.ts`): el HTML del editor se sanea a un HTML canónico con `<p>`, `<b>`, `<i>`, `<u>` y `<span class="c-rojo|azul|verde|naranja">`; los demás colores van al más cercano de la paleta y lo demás se descarta. El PDF lo dibuja con los mismos colores.
- **Biblioteca:** ítems frecuentes (plantillas que se copian) y observaciones con `{valor}` a completar, `porDefecto` y valor sugerido. Carga inicial de herrería: `npm run biblioteca-presupuestos -- --slug …` o el botón en la pantalla.
- **Estados:** borrador, enviado, aceptado, rechazado y vencido. Solo se edita un borrador. Pasa solo a vencido (al consultar y con un cron diario). Duplicar (con fecha y número nuevos) y "duplicar y reemplazar" (el original queda rechazado).
- **Snapshots** del cliente y del emisor en cada guardado del borrador.
- **Crear la obra** desde un presupuesto aceptado: cliente, nombre (trabajo o lugar), ubicación, moneda, acordado y hitos (la pantalla muestra la condición de pago para cargarlos).
- **PDF** con el layout compartido nuevo (`src/shared/pdf/documento-pdf.ts`): encabezado con logo y datos de la empresa, cliente, obra, ítems con formato, superficie, totales, observaciones con valores y firma.
- Frontend: listado con filtros por estado, editor (cliente con alta rápida, biblioteca, editor de texto con formato, formas de cotizar, IVA, observaciones, notas, totales en vivo), acciones por estado, crear obra y la pantalla de biblioteca.
- Tests: `formato.spec.ts`, `presupuesto.spec.ts` (Diego Streck, Municipalidad, LAR), e2e `src/ale-presupuestos.e2e.spec.ts` y aislamiento ampliado.

### Ajustes después de la revisión

- **Recibos anulados en el listado de Comprobantes:** figuran como "Anulado" (tachado) y el filtro por estado los separa (`estado=ANULADO` / `EMITIDO` también filtra recibos).
- **Ficha del cliente:** muestra sus obras (estado y saldo) y sus presupuestos, con "Nueva obra" y "Nuevo presupuesto" que llegan con el cliente elegido.
- **Editor de facturas:** con el cliente elegido, el selector de obra aparece siempre y tiene "Nueva" para crear la obra sin salir (nombre y acordado opcional; el plan se carga después en la obra).

### Fase 6: Documentación

- `docs/ARCHITECTURE.md`: módulos nuevos en §4 y decisiones D7 a D12 en §10.
- `docs/PLAN.md`: fase "Ale Herrería" con el estado de cada subfase.
- `docs/openapi.json` regenerado: solo documenta la API pública `/v1` (que ganó `proyectoId` en comprobantes). Las rutas nuevas son internas del frontend, como el resto de la configuración, y no van al Swagger público.
- PDFs de muestra en `docs/muestras/` (`npm run muestras-pdf` los regenera).

### Fase 5: Materiales + Proveedores

- **Módulo `materiales`** (`@Modulo('materiales')`): tablas `proveedores`, `materiales`, `listados_materiales`, `renglones_listado`. Rutas `/proveedores`, `/materiales`, `/listados-materiales`.
- **Proveedores** genéricos (CUIT opcional validado, contacto, teléfono, email). Con materiales o listados no se borran: se desactivan.
- **Catálogo:** nombre, unidad, categoría, costo y venta (cada uno en pesos o dólares, cargados a mano), proveedor habitual y fecha de la última actualización de precios. Usado en listados: se desactiva.
- **Listados:** título, fecha, obra, presupuesto y proveedor opcionales, destino, observaciones y qué precios muestra el PDF (ninguno, costo o venta). Cada renglón copia nombre, unidad y precios: el catálogo nuevo no los cambia (salvo "Actualizar con el catálogo", a pedido). Totales por moneda. Duplicar.
- **PDF** con el layout compartido: sin precios (para pedir cotización) o con precios y totales por moneda.
- Frontend: Materiales (Listados, Catálogo, Proveedores) y el editor de listados; botón "Listado de materiales" en la obra.
- Tests: `listado.spec.ts`, e2e `src/ale-materiales.e2e.spec.ts` y aislamiento ampliado.

## 2. Decisiones tomadas por mi cuenta

| # | Tema | Decisión |
|---|---|---|
| R1 | Rama | Pediste trabajar sobre `main`, pero un push a `main` despliega en Render y corre `prisma migrate deploy` contra la base de producción (`render.yaml`). Eso sería deployar, que también pediste no hacer. Trabajé sobre la rama de la sesión (`claude/exciting-mccarthy-r0epck`, que salió de `main`) y abrí PRs en borrador contra `main`. Para llevarlo a `main` alcanza con mergear el PR. |
| R2 | Quién cambia los módulos | Los módulos los habilita el administrador de Faktia (doc §3): se cambian con el script `configurar-modulos`, no desde la pantalla. La empresa los ve en Configuración → Preferencias, sin editarlos. Las etiquetas sí las edita la empresa. |
| R3 | Módulos por defecto | Una empresa nueva trae todos los módulos (incluidos los nuevos). Las existentes también, por el default de la migración. |
| R4 | Facturación para Ale | Seguí el pedido: a Ale se le ocultan importaciones, integraciones, webhooks y recibos de pago. **La facturación queda visible** aunque el doc la marca como opcional. Si preferís ocultarla, `--ocultar comprobantes`: el listado de Comprobantes sigue mostrando los recibos y los avisos de ARCA desaparecen. |
| R5 | Rutas de comprobantes | Con `comprobantes` deshabilitado se bloquean crear, editar, emitir y notas. El listado (`GET /comprobantes`) queda abierto porque también lista los recibos. |
| R6 | Tarifas | La pestaña Tarifas se muestra con el módulo `importaciones` (las tarifas se usan al importar ítems). |
| R8 | Dónde vive Proyecto | En el módulo `cuenta-corriente`. Un módulo `proyectos` aparte formaría un ciclo: la cuenta corriente necesita el modo de IVA del proyecto para las facturas y el proyecto necesita la cuenta para hitos y saldos. Los demás módulos ven el proyecto solo por FK compuesta. |
| R9 | Hito "al terminar" sin fecha | Un hito común sin vencimiento es exigible (cuenta en el saldo exigible) pero nunca aparece como vencido. En Costa Doll, con $5.000.000 certificados, el exigible es $6.320.000 (certificado + hito final). Si preferís que "al terminar" no sea exigible hasta una fecha, se le carga el vencimiento cuando corresponda. |
| R10 | Factura en otra moneda que la obra | Si la factura no es del mismo cliente o de la misma moneda que la obra, cuenta como factura sin proyecto (suma su total). Ej.: obra en dólares facturada en pesos. |
| R11 | "Acordado final" | La factura queda en la cuenta con importe $0 y la aclaración "Incluida en el monto acordado", para que se vea. |
| R12 | Número de recibo de una entrega | El siguiente al último recibo de cobro (como ya sugería la pantalla de recibos), editable en la API. |
| R13 | Anulación | La anulación se registra con la fecha del día en que se sincroniza. El recibo anulado sigue en el listado, con su PDF marcado. Solo se anulan recibos de cobro desde la pantalla. |
| R14 | Recibos sueltos | La pantalla general de recibos (Nuevo comprobante → Recibo) sigue sin obra; las entregas de obra se registran desde la obra. |
| R15 | Avisos (pregunta abierta del doc §14) | Destinatarios: todos los usuarios activos de la empresa. Resumen diario con lo vencido y lo que vence en los próximos 3 días (configurable por empresa). A las 8 de Argentina. Si no hay nada, no se manda. |
| R16 | Render free | **El plan free de Render duerme el servidor sin tráfico y el cron de las 8 no corre.** Opciones: pasar a un plan pago, un cron externo que pegue a `/api/health` unos minutos antes (por ejemplo, cron-job.org a las 7:55) o un endpoint protegido que dispare el envío. Lo dejo anotado sin elegir. |
| R17 | nodemailer | Versión 10.4.0 fija: las anteriores a 10.1.4 tienen avisos de seguridad y las más nuevas tienen menos de dos semanas. |
| R18 | Importe de un ítem | En "por ítem" el importe es el total del renglón (no precio unitario): así están los presupuestos de Ale. La cantidad es texto libre ("4", "320 m²"). |
| R19 | Acordado al crear la obra | "No incluye IVA": el acordado es el neto y la obra queda en "más IVA". IVA discriminado o sin mencionar: el acordado es el total y la obra queda en "acordado final". |
| R20 | Edición | Solo se edita un borrador. Un enviado puede volver a borrador si no venció. El resto se duplica. |
| R21 | Borrar | Solo se borran borradores (puede quedar un salto en la numeración). |
| R22 | Formato | Paleta de 4 colores (rojo, azul, verde, naranja) más el normal, tomados de los tokens. Negrita y cursiva juntas se dibujan en negrita (la fuente no tiene negrita cursiva). |
| R23 | Biblioteca inicial | Los textos de `biblioteca-inicial.ts` los escribí a partir del doc: **hay que reemplazarlos con los presupuestos reales de Ale** antes de cargarlos en su empresa. |
| R24 | Precio de venta (pregunta abierta) | Se carga a mano, sin margen automático. |
| R25 | Unidades | Texto libre con sugerencias (barras, metros, chapas, unidades, litros, m³, kg, rollos). |
| R26 | Nombre de material | Único por empresa (sin importar la unidad). |
| R7 | Clientes sin documento | Se siguen guardando como `CONSUMIDOR_FINAL` con número "0" (lo que ya entendía ARCA). En pantalla el tipo se llama "Sin documento". |

## 3. BLOQUEANTES

Nada quedó sin hacer por falta de una decisión tuya. Lo único que necesita tu OK explícito antes de tocar algo real:

- **Pasar a `main`** (R1): mergear los PRs despliega en Render y corre `prisma migrate deploy` contra la base de producción. Las migraciones solo agregan (tablas, columnas con default, valores de enum) y relajan un unique, así que son compatibles con el código desplegado, pero aplicarlas es tu decisión.
- **Render free y el cron de avisos** (R16): elegir cómo despertar el servidor a las 8.

## 4. Pendiente local

En orden, desde `faktia-backend` con tu `.env` (la base es la de producción: revisá antes):

- [ ] `npm ci` en los dos repos (nodemailer es dependencia nueva).
- [ ] Aplicar las migraciones (con tu OK): `npx prisma migrate deploy`. Son 5: `20261126120000_ale_base`, `20261126130000_ale_proyectos`, `20261126140000_ale_avisos`, `20261126150000_ale_presupuestos`, `20261127120000_ale_materiales`.
- [ ] Correr todo: `npm run typecheck && npm run lint && npm run deps && npm test && npm run build`. Los e2e crean empresas `E2E …` y las borran al terminar.
- [ ] Crear una empresa de ejemplo para recorrer (no es la de Ale): `NUEVA_PASSWORD='…' npm run datos-ejemplo-ale -- --slug ale-herreria-demo --email <tu email>`. Carga clientes, obras con hitos, una certificación, entregas (con y sin recibo, una en pesos para una obra en dólares), presupuestos y el listado del galpón.
- [ ] Crear la empresa real de Ale con `npm run crear-tenant` (o desde el registro), su usuario con `crear-usuario`, y después: `npm run configurar-modulos -- --slug <slug> --ocultar importaciones,integraciones,webhooks,recibos-pago --etiqueta Obra --etiqueta-plural Obras`.
- [ ] Configurar SMTP en `.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`), reiniciar y en Configuración → Preferencias tocar "Mandarme una prueba". Revisar que llegue y cómo se ve (Gmail y celular).
- [ ] Decidir cómo despertar el servidor para el cron de las 8 en Render (ver R16) y cargar las `SMTP_*` en Render.
- [ ] Ajustar `src/modules/presupuestos/biblioteca-inicial.ts` con los presupuestos reales de Ale y cargar: `npm run biblioteca-presupuestos -- --slug <slug de Ale>`.
- [ ] Probar la cotización real de ARCA: en una obra en dólares sin TC fijo, "Registrar entrega" en pesos. Tiene que sugerir el TC de `FEParamGetCotizacion` (necesita `AFIP_SDK_API_KEY`).

## 5. Cómo revisarlo

**Primero, los PDFs** de `docs/muestras/` (son los documentos que va a mandar Ale):
- `presupuesto-LAR-superficie.pdf`, `presupuesto-Municipalidad-global.pdf`, `presupuesto-DiegoStreck-por-item.pdf`: las tres formas de cotizar, IVA no incluido / discriminado / sin mencionar, observaciones con valores, texto con formato y firma.
- `recibo-LAR-anticipo.pdf`: el recibo de Costa Doll con el anticipo (acordado, entregas, saldo $14.705.000, "a certificar" y saldo al terminar).
- `recibo-WilsonCarrillo-USD.pdf`: obra en dólares cobrada en pesos, con las entregas de 2024 sin recibo y la equivalencia de TC.
- `listado-galpon-para-proveedor.pdf` y `listado-galpon-precios-venta.pdf`: 34 renglones, sin precios y con precios de venta (totales en pesos y dólares).

**Después, el código** en este orden: `cuenta-corriente/domain/proyecto.ts` (todas las reglas de plata, puras y con tests), `cuenta-corriente.service.ts` (`imputarProyecto`, `registrarAnulaciones`, IVA de facturas), `proyectos/proyectos.service.ts`, `presupuestos/domain/formato.ts` y `shared/pdf/documento-pdf.ts`.

**Recorrido por pantalla** con la empresa de ejemplo:
1. Entrás y caés en **Obras** (Ale no ve Importaciones, Integraciones ni Webhooks; en Nuevo comprobante → Recibo no está "De pago").
2. **Galpón sucursal Costa Doll:** saldo $14.705.000, exigible $6.320.000, vencido $5.000.000 (la certificación). Registrá una entrega de $6.000.000: se imputa a la certificación y al hito final, y se abre el recibo con el estado de la obra. Probá "Certificar" con el ayudante de %, "Adicional" y "Editar plan" (un hito cobrado no deja cambiar su importe).
3. **Tinglado casa** (Wilson Carrillo, en dólares): entregas de 2024 sin recibo y una en pesos con TC. Registrá otra en pesos: sugiere el TC fijo de la obra.
4. **Comprobantes → Recibos:** abrí un recibo de obra y anulalo: queda marcado y la obra vuelve a tener ese saldo.
5. **Cuenta corriente:** "Por cobrar" aclara cuánto falta certificar; en la cuenta de La Agrícola Regional cada movimiento muestra su obra.
6. **Presupuestos:** P-0000003 (aceptado, ya con obra), P-0000001 (enviado), P-0000002 (borrador). Armá uno nuevo con "Agregar de la biblioteca", el editor de formato y las tres formas de cotizar; marcá aceptado y "Crear obra".
7. **Materiales:** el listado del galpón; cambiá "Precios que muestra" y mirá el PDF. Catálogo y proveedores en las otras pestañas.
8. **Configuración → Preferencias:** etiqueta de proyectos, módulos (solo lectura), validez de presupuestos y avisos (vista previa de hoy y "Mandarme una prueba"; sin SMTP queda en el log). **Plantilla PDF:** firma. **Datos del emisor:** teléfono y email.
