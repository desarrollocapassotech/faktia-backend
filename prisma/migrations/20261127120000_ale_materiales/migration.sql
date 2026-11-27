-- Fase Ale Herrería 5: proveedores, catálogo de materiales y listados por obra.
-- Compatible con el código desplegado: solo agrega tablas.

-- CreateEnum
CREATE TYPE "PreciosListado" AS ENUM ('NINGUNO', 'COSTO', 'VENTA');

-- CreateTable
CREATE TABLE "proveedores" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "cuit" TEXT,
    "contacto" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "notas" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proveedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materiales" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "unidad" TEXT NOT NULL,
    "categoria" TEXT,
    "precioCosto" DECIMAL(15,2),
    "monedaCosto" "Moneda" NOT NULL DEFAULT 'ARS',
    "precioVenta" DECIMAL(15,2),
    "monedaVenta" "Moneda" NOT NULL DEFAULT 'ARS',
    "proveedorId" TEXT,
    "preciosActualizadosEn" TIMESTAMP(3),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "materiales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listados_materiales" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "proyectoId" TEXT,
    "presupuestoId" TEXT,
    "proveedorId" TEXT,
    "destino" TEXT,
    "observaciones" TEXT,
    "precios" "PreciosListado" NOT NULL DEFAULT 'NINGUNO',
    "creadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listados_materiales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renglones_listado" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "listadoId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "cantidad" DECIMAL(15,3) NOT NULL,
    "materialId" TEXT,
    "nombre" TEXT NOT NULL,
    "unidad" TEXT NOT NULL,
    "precioCosto" DECIMAL(15,2),
    "monedaCosto" "Moneda",
    "precioVenta" DECIMAL(15,2),
    "monedaVenta" "Moneda",

    CONSTRAINT "renglones_listado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "proveedores_tenantId_id_key" ON "proveedores"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "proveedores_tenantId_nombre_key" ON "proveedores"("tenantId", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "materiales_tenantId_id_key" ON "materiales"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "materiales_tenantId_nombre_key" ON "materiales"("tenantId", "nombre");

-- CreateIndex
CREATE INDEX "listados_materiales_tenantId_proyectoId_idx" ON "listados_materiales"("tenantId", "proyectoId");

-- CreateIndex
CREATE UNIQUE INDEX "listados_materiales_tenantId_id_key" ON "listados_materiales"("tenantId", "id");

-- CreateIndex
CREATE INDEX "renglones_listado_tenantId_listadoId_idx" ON "renglones_listado"("tenantId", "listadoId");

-- AddForeignKey
ALTER TABLE "proveedores" ADD CONSTRAINT "proveedores_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materiales" ADD CONSTRAINT "materiales_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materiales" ADD CONSTRAINT "materiales_tenantId_proveedorId_fkey" FOREIGN KEY ("tenantId", "proveedorId") REFERENCES "proveedores"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listados_materiales" ADD CONSTRAINT "listados_materiales_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listados_materiales" ADD CONSTRAINT "listados_materiales_tenantId_proyectoId_fkey" FOREIGN KEY ("tenantId", "proyectoId") REFERENCES "proyectos"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listados_materiales" ADD CONSTRAINT "listados_materiales_tenantId_presupuestoId_fkey" FOREIGN KEY ("tenantId", "presupuestoId") REFERENCES "presupuestos"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listados_materiales" ADD CONSTRAINT "listados_materiales_tenantId_proveedorId_fkey" FOREIGN KEY ("tenantId", "proveedorId") REFERENCES "proveedores"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renglones_listado" ADD CONSTRAINT "renglones_listado_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renglones_listado" ADD CONSTRAINT "renglones_listado_tenantId_listadoId_fkey" FOREIGN KEY ("tenantId", "listadoId") REFERENCES "listados_materiales"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renglones_listado" ADD CONSTRAINT "renglones_listado_tenantId_materialId_fkey" FOREIGN KEY ("tenantId", "materialId") REFERENCES "materiales"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

