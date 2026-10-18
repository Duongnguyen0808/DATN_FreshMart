ALTER TABLE "products"
ADD COLUMN "baseUnit" TEXT,
ADD COLUMN "unitsPerUnit" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "products"
ADD CONSTRAINT "products_unitsPerUnit_check" CHECK ("unitsPerUnit" >= 1);
