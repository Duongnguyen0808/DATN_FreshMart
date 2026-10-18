ALTER TABLE "invoice_items" ADD COLUMN "costPrice" DECIMAL(14,2);

-- Existing invoices have no historical cost snapshot. Backfill with the current SKU cost.
UPDATE "invoice_items" AS item
SET "costPrice" = sku."costPrice"
FROM "skus" AS sku
WHERE sku."id" = item."skuId";

ALTER TABLE "invoice_items" ALTER COLUMN "costPrice" SET NOT NULL;
