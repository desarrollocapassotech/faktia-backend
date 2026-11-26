-- Fase Ale Herrería 1: módulos por empresa, etiquetas de proyecto, contacto, firma y clientes sin documento.
-- Compatible con el código desplegado: solo agrega columnas con default y relaja un unique.

-- Empresa
ALTER TABLE "tenants" ADD COLUMN "telefono" TEXT;
ALTER TABLE "tenants" ADD COLUMN "emailContacto" TEXT;
ALTER TABLE "tenants" ADD COLUMN "modulosHabilitados" TEXT[] DEFAULT ARRAY['comprobantes', 'recibos', 'recibos-pago', 'cuenta-corriente', 'proyectos', 'presupuestos', 'materiales', 'importaciones', 'integraciones', 'webhooks']::TEXT[];
ALTER TABLE "tenants" ADD COLUMN "etiquetaProyecto" TEXT NOT NULL DEFAULT 'Proyecto';
ALTER TABLE "tenants" ADD COLUMN "etiquetaProyectoPlural" TEXT NOT NULL DEFAULT 'Proyectos';

-- Plantilla de documentos
ALTER TABLE "plantillas_pdf" ADD COLUMN "firmaTexto" TEXT;

-- Clientes: el documento no se repite, pero puede haber varios clientes sin documento ("0").
ALTER TABLE "clientes" ADD COLUMN "claveDocumento" TEXT;
UPDATE "clientes" SET "claveDocumento" = "tipoDocumento"::text || ':' || "numeroDocumento"
  WHERE "tipoDocumento" <> 'CONSUMIDOR_FINAL' AND "numeroDocumento" <> '0';
DROP INDEX "clientes_tenantId_tipoDocumento_numeroDocumento_key";
CREATE UNIQUE INDEX "clientes_tenantId_claveDocumento_key" ON "clientes"("tenantId", "claveDocumento");
CREATE INDEX "clientes_tenantId_tipoDocumento_numeroDocumento_idx" ON "clientes"("tenantId", "tipoDocumento", "numeroDocumento");
