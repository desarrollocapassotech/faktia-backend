# Ale Herrería: revisión del trabajo autónomo

> Trabajo hecho en una sesión remota sin credenciales (sin Neon, sin certificado de ARCA, sin SMTP).
> Lo que no se pudo correr acá está en "Pendiente local".
> El estado de cada subfase, para retomar, está en `docs/PLAN.md` → "Fase Ale Herrería".

## 1. Resumen por fase

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

## 2. Decisiones tomadas por mi cuenta

| # | Tema | Decisión |
|---|---|---|
| R1 | Rama | Pediste trabajar sobre `main`, pero un push a `main` despliega en Render y corre `prisma migrate deploy` contra la base de producción (`render.yaml`). Eso sería deployar, que también pediste no hacer. Trabajé sobre la rama de la sesión (`claude/exciting-mccarthy-r0epck`, que salió de `main`) y abrí PRs en borrador contra `main`. Para llevarlo a `main` alcanza con mergear el PR. |
| R2 | Quién cambia los módulos | Los módulos los habilita el administrador de Faktia (doc §3): se cambian con el script `configurar-modulos`, no desde la pantalla. La empresa los ve en Configuración → Preferencias, sin editarlos. Las etiquetas sí las edita la empresa. |
| R3 | Módulos por defecto | Una empresa nueva trae todos los módulos (incluidos los nuevos). Las existentes también, por el default de la migración. |
| R4 | Facturación para Ale | Seguí el pedido: a Ale se le ocultan importaciones, integraciones, webhooks y recibos de pago. **La facturación queda visible** aunque el doc la marca como opcional. Si preferís ocultarla, `--ocultar comprobantes`: el listado de Comprobantes sigue mostrando los recibos y los avisos de ARCA desaparecen. |
| R5 | Rutas de comprobantes | Con `comprobantes` deshabilitado se bloquean crear, editar, emitir y notas. El listado (`GET /comprobantes`) queda abierto porque también lista los recibos. |
| R6 | Tarifas | La pestaña Tarifas se muestra con el módulo `importaciones` (las tarifas se usan al importar ítems). |
| R7 | Clientes sin documento | Se siguen guardando como `CONSUMIDOR_FINAL` con número "0" (lo que ya entendía ARCA). En pantalla el tipo se llama "Sin documento". |

## 3. BLOQUEANTES

Ninguno por ahora.

## 4. Pendiente local

- [ ] Aplicar las migraciones nuevas en la base (con tu OK): `npx prisma migrate deploy`.

## 5. Cómo revisarlo

(Se completa al terminar.)
