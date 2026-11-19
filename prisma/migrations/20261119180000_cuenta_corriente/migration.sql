-- Cuenta corriente de clientes (como Vialto): movimientos DEBE/HABER e imputaciones. Solo agrega
-- (tablas y enums nuevos): compatible con el código desplegado. Los movimientos de comprobantes
-- y recibos ya existentes los crea la sincronización la primera vez que se abre la pantalla.

-- CreateEnum
CREATE TYPE "TipoMovimientoCc" AS ENUM ('DEBE', 'HABER');

-- CreateEnum
CREATE TYPE "OrigenMovimientoCc" AS ENUM ('COMPROBANTE', 'RECIBO', 'MANUAL');

-- CreateTable
CREATE TABLE "movimientos_cuenta_corriente" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "tipo" "TipoMovimientoCc" NOT NULL,
    "origen" "OrigenMovimientoCc" NOT NULL,
    "comprobanteId" TEXT,
    "reciboId" TEXT,
    "concepto" TEXT NOT NULL,
    "numero" TEXT,
    "moneda" "Moneda" NOT NULL,
    "importe" DECIMAL(15,2) NOT NULL,
    "fecha" DATE NOT NULL,
    "fechaVencimiento" DATE,
    "observaciones" TEXT,
    "creadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "movimientos_cuenta_corriente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imputaciones_cuenta_corriente" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "haberId" TEXT NOT NULL,
    "debeId" TEXT NOT NULL,
    "importe" DECIMAL(15,2) NOT NULL,
    "automatica" BOOLEAN NOT NULL DEFAULT false,
    "creadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imputaciones_cuenta_corriente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "movimientos_cuenta_corriente_tenantId_clienteId_fecha_idx" ON "movimientos_cuenta_corriente"("tenantId", "clienteId", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "movimientos_cuenta_corriente_tenantId_id_key" ON "movimientos_cuenta_corriente"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "movimientos_cuenta_corriente_tenantId_comprobanteId_key" ON "movimientos_cuenta_corriente"("tenantId", "comprobanteId");

-- CreateIndex
CREATE UNIQUE INDEX "movimientos_cuenta_corriente_tenantId_reciboId_key" ON "movimientos_cuenta_corriente"("tenantId", "reciboId");

-- CreateIndex
CREATE INDEX "imputaciones_cuenta_corriente_tenantId_debeId_idx" ON "imputaciones_cuenta_corriente"("tenantId", "debeId");

-- CreateIndex
CREATE UNIQUE INDEX "imputaciones_cuenta_corriente_tenantId_haberId_debeId_key" ON "imputaciones_cuenta_corriente"("tenantId", "haberId", "debeId");

-- AddForeignKey
ALTER TABLE "movimientos_cuenta_corriente" ADD CONSTRAINT "movimientos_cuenta_corriente_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_cuenta_corriente" ADD CONSTRAINT "movimientos_cuenta_corriente_tenantId_clienteId_fkey" FOREIGN KEY ("tenantId", "clienteId") REFERENCES "clientes"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_cuenta_corriente" ADD CONSTRAINT "movimientos_cuenta_corriente_tenantId_comprobanteId_fkey" FOREIGN KEY ("tenantId", "comprobanteId") REFERENCES "comprobantes"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_cuenta_corriente" ADD CONSTRAINT "movimientos_cuenta_corriente_tenantId_reciboId_fkey" FOREIGN KEY ("tenantId", "reciboId") REFERENCES "recibos"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imputaciones_cuenta_corriente" ADD CONSTRAINT "imputaciones_cuenta_corriente_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imputaciones_cuenta_corriente" ADD CONSTRAINT "imputaciones_cuenta_corriente_tenantId_haberId_fkey" FOREIGN KEY ("tenantId", "haberId") REFERENCES "movimientos_cuenta_corriente"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imputaciones_cuenta_corriente" ADD CONSTRAINT "imputaciones_cuenta_corriente_tenantId_debeId_fkey" FOREIGN KEY ("tenantId", "debeId") REFERENCES "movimientos_cuenta_corriente"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

