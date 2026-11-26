-- Fase Ale Herrería 3: avisos por email (preferencias de la empresa y registro de envíos).

-- CreateTable
CREATE TABLE "avisos_email" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "destinatarios" TEXT[],
    "vencidos" INTEGER NOT NULL,
    "proximos" INTEGER NOT NULL,
    "transporte" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avisos_email_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "avisos_email_tenantId_fecha_key" ON "avisos_email"("tenantId", "fecha");

-- AddForeignKey
ALTER TABLE "avisos_email" ADD CONSTRAINT "avisos_email_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "avisosEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "diasAvisoVencimiento" INTEGER NOT NULL DEFAULT 3;

