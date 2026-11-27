-- Fase Ale Herrería 2: proyectos (obras), hitos y certificaciones, conversión de moneda y anulación de recibos.
-- Compatible con el código desplegado: solo agrega tablas, columnas opcionales y valores de enum.

-- CreateEnum
CREATE TYPE "EstadoProyecto" AS ENUM ('EN_CURSO', 'FINALIZADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "ModoIvaProyecto" AS ENUM ('MAS_IVA', 'ACORDADO_FINAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrigenMovimientoCc" ADD VALUE 'ACUERDO';
ALTER TYPE "OrigenMovimientoCc" ADD VALUE 'ANULACION';

-- AlterTable
ALTER TABLE "comprobantes" ADD COLUMN     "proyectoId" TEXT;

-- AlterTable
ALTER TABLE "movimientos_cuenta_corriente" ADD COLUMN     "anulaId" TEXT,
ADD COLUMN     "importeOrigen" DECIMAL(15,2),
ADD COLUMN     "monedaOrigen" "Moneda",
ADD COLUMN     "orden" INTEGER,
ADD COLUMN     "porCertificacion" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "proyectoId" TEXT,
ADD COLUMN     "tipoCambio" DECIMAL(15,6);

-- AlterTable
ALTER TABLE "recibos" ADD COLUMN     "anuladoEn" TIMESTAMP(3),
ADD COLUMN     "estadoProyecto" JSONB,
ADD COLUMN     "importeImputacion" DECIMAL(15,2),
ADD COLUMN     "monedaImputacion" "Moneda",
ADD COLUMN     "motivoAnulacion" TEXT,
ADD COLUMN     "proyectoId" TEXT,
ADD COLUMN     "tipoCambio" DECIMAL(15,6);

-- CreateTable
CREATE TABLE "proyectos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "ubicacion" TEXT,
    "estado" "EstadoProyecto" NOT NULL DEFAULT 'EN_CURSO',
    "moneda" "Moneda" NOT NULL DEFAULT 'ARS',
    "montoAcordado" DECIMAL(15,2),
    "modoIva" "ModoIvaProyecto" NOT NULL DEFAULT 'MAS_IVA',
    "tipoCambioFijo" DECIMAL(15,6),
    "fechaInicio" DATE,
    "fechaFin" DATE,
    "observaciones" TEXT,
    "creadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proyectos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificaciones_hito" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hitoId" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "descripcion" TEXT NOT NULL,
    "importe" DECIMAL(15,2) NOT NULL,
    "fechaVencimiento" DATE,
    "creadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificaciones_hito_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proyectos_tenantId_estado_idx" ON "proyectos"("tenantId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "proyectos_tenantId_id_key" ON "proyectos"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "proyectos_tenantId_clienteId_nombre_key" ON "proyectos"("tenantId", "clienteId", "nombre");

-- CreateIndex
CREATE INDEX "certificaciones_hito_tenantId_hitoId_idx" ON "certificaciones_hito"("tenantId", "hitoId");

-- CreateIndex
CREATE UNIQUE INDEX "certificaciones_hito_tenantId_id_key" ON "certificaciones_hito"("tenantId", "id");

-- CreateIndex
CREATE INDEX "movimientos_cuenta_corriente_tenantId_proyectoId_idx" ON "movimientos_cuenta_corriente"("tenantId", "proyectoId");

-- CreateIndex
CREATE INDEX "recibos_tenantId_proyectoId_idx" ON "recibos"("tenantId", "proyectoId");

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_tenantId_proyectoId_fkey" FOREIGN KEY ("tenantId", "proyectoId") REFERENCES "proyectos"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recibos" ADD CONSTRAINT "recibos_tenantId_proyectoId_fkey" FOREIGN KEY ("tenantId", "proyectoId") REFERENCES "proyectos"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_cuenta_corriente" ADD CONSTRAINT "movimientos_cuenta_corriente_tenantId_proyectoId_fkey" FOREIGN KEY ("tenantId", "proyectoId") REFERENCES "proyectos"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_cuenta_corriente" ADD CONSTRAINT "movimientos_cuenta_corriente_tenantId_anulaId_fkey" FOREIGN KEY ("tenantId", "anulaId") REFERENCES "movimientos_cuenta_corriente"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_tenantId_clienteId_fkey" FOREIGN KEY ("tenantId", "clienteId") REFERENCES "clientes"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificaciones_hito" ADD CONSTRAINT "certificaciones_hito_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificaciones_hito" ADD CONSTRAINT "certificaciones_hito_tenantId_hitoId_fkey" FOREIGN KEY ("tenantId", "hitoId") REFERENCES "movimientos_cuenta_corriente"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

