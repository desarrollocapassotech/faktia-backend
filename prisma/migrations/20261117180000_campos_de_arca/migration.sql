-- Campos del emisor que vinieron del padrón de ARCA (quedan bloqueados) y cuándo se verificó.
ALTER TABLE "tenants" ADD COLUMN "camposDeArca" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "tenants" ADD COLUMN "padronVerificadoEn" TIMESTAMP(3);
