-- Fase Ale Herrería 4: presupuestos, biblioteca de ítems y catálogo de observaciones.
-- Compatible con el código desplegado: solo agrega tablas y una columna con default.

-- CreateEnum
CREATE TYPE "EstadoPresupuesto" AS ENUM ('BORRADOR', 'ENVIADO', 'ACEPTADO', 'RECHAZADO', 'VENCIDO');

-- CreateEnum
CREATE TYPE "FormaCotizar" AS ENUM ('POR_ITEM', 'GLOBAL', 'SUPERFICIE');

-- CreateEnum
CREATE TYPE "IvaPresupuesto" AS ENUM ('SIN_IVA', 'NO_INCLUYE', 'DISCRIMINADO');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "diasValidezPresupuesto" INTEGER NOT NULL DEFAULT 15;

-- CreateTable
CREATE TABLE "presupuestos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "fechaVencimiento" DATE NOT NULL,
    "estado" "EstadoPresupuesto" NOT NULL DEFAULT 'BORRADOR',
    "clienteId" TEXT NOT NULL,
    "titulo" TEXT,
    "lugar" TEXT,
    "moneda" "Moneda" NOT NULL DEFAULT 'ARS',
    "formaCotizar" "FormaCotizar" NOT NULL DEFAULT 'POR_ITEM',
    "superficie" JSONB,
    "importeGlobal" DECIMAL(15,2),
    "ivaModo" "IvaPresupuesto" NOT NULL DEFAULT 'NO_INCLUYE',
    "alicuotaIva" DECIMAL(5,2) NOT NULL DEFAULT 21,
    "subtotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "iva" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "observaciones" JSONB NOT NULL DEFAULT '[]',
    "notas" TEXT,
    "clienteSnapshot" JSONB NOT NULL,
    "emisorSnapshot" JSONB NOT NULL,
    "proyectoId" TEXT,
    "duplicadoDeId" TEXT,
    "creadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "presupuestos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "presupuesto_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "presupuestoId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "cantidad" TEXT,
    "descripcion" TEXT NOT NULL,
    "importe" DECIMAL(15,2),

    CONSTRAINT "presupuesto_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items_biblioteca" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "categoria" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "items_biblioteca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observaciones_catalogo" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "llevaValor" BOOLEAN NOT NULL DEFAULT false,
    "valorSugerido" TEXT,
    "porDefecto" BOOLEAN NOT NULL DEFAULT false,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "observaciones_catalogo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "presupuestos_tenantId_estado_idx" ON "presupuestos"("tenantId", "estado");

-- CreateIndex
CREATE INDEX "presupuestos_tenantId_clienteId_idx" ON "presupuestos"("tenantId", "clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "presupuestos_tenantId_id_key" ON "presupuestos"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "presupuestos_tenantId_numero_key" ON "presupuestos"("tenantId", "numero");

-- CreateIndex
CREATE INDEX "presupuesto_items_tenantId_presupuestoId_idx" ON "presupuesto_items"("tenantId", "presupuestoId");

-- CreateIndex
CREATE UNIQUE INDEX "items_biblioteca_tenantId_id_key" ON "items_biblioteca"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "items_biblioteca_tenantId_titulo_key" ON "items_biblioteca"("tenantId", "titulo");

-- CreateIndex
CREATE UNIQUE INDEX "observaciones_catalogo_tenantId_id_key" ON "observaciones_catalogo"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "observaciones_catalogo_tenantId_texto_key" ON "observaciones_catalogo"("tenantId", "texto");

-- AddForeignKey
ALTER TABLE "presupuestos" ADD CONSTRAINT "presupuestos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presupuestos" ADD CONSTRAINT "presupuestos_tenantId_clienteId_fkey" FOREIGN KEY ("tenantId", "clienteId") REFERENCES "clientes"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presupuestos" ADD CONSTRAINT "presupuestos_tenantId_proyectoId_fkey" FOREIGN KEY ("tenantId", "proyectoId") REFERENCES "proyectos"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presupuesto_items" ADD CONSTRAINT "presupuesto_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presupuesto_items" ADD CONSTRAINT "presupuesto_items_tenantId_presupuestoId_fkey" FOREIGN KEY ("tenantId", "presupuestoId") REFERENCES "presupuestos"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items_biblioteca" ADD CONSTRAINT "items_biblioteca_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observaciones_catalogo" ADD CONSTRAINT "observaciones_catalogo_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

