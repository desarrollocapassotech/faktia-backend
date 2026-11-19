-- Recibos guardados: hasta ahora solo se generaba el PDF. Solo agrega (tabla y enum nuevos):
-- compatible con el código desplegado.

-- CreateEnum
CREATE TYPE "TipoRecibo" AS ENUM ('COBRO', 'PAGO');

-- CreateTable
CREATE TABLE "recibos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tipo" "TipoRecibo" NOT NULL,
    "numero" TEXT,
    "fecha" DATE NOT NULL,
    "moneda" "Moneda" NOT NULL DEFAULT 'ARS',
    "total" DECIMAL(15,2) NOT NULL,
    "clienteId" TEXT,
    "contraparteNombre" TEXT NOT NULL,
    "contraparte" JSONB NOT NULL,
    "items" JSONB NOT NULL,
    "comprobantesAplicados" JSONB,
    "periodo" TEXT,
    "medioPago" TEXT,
    "observaciones" TEXT,
    "creadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recibos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recibos_tenantId_fecha_idx" ON "recibos"("tenantId", "fecha");

-- CreateIndex
CREATE INDEX "recibos_tenantId_clienteId_idx" ON "recibos"("tenantId", "clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "recibos_tenantId_id_key" ON "recibos"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "recibos_tenantId_tipo_numero_key" ON "recibos"("tenantId", "tipo", "numero");

-- AddForeignKey
ALTER TABLE "recibos" ADD CONSTRAINT "recibos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recibos" ADD CONSTRAINT "recibos_tenantId_clienteId_fkey" FOREIGN KEY ("tenantId", "clienteId") REFERENCES "clientes"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
