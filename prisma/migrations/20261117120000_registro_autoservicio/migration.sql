-- Registro por autoservicio: una empresa nueva nace solo con su nombre; los datos fiscales
-- se completan después en Configuración y se exigen recién para facturar.
-- El índice único de "cuit" se mantiene (Postgres admite varios NULL).
ALTER TABLE "tenants" ALTER COLUMN "razonSocial" DROP NOT NULL,
ALTER COLUMN "cuit" DROP NOT NULL,
ALTER COLUMN "condicionIva" DROP NOT NULL,
ALTER COLUMN "domicilioFiscal" DROP NOT NULL;
