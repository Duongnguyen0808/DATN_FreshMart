ALTER TABLE "products" ADD COLUMN "lastReceivedAt" TIMESTAMP(3);
ALTER TABLE "inventories" ADD COLUMN "lastReceivedAt" TIMESTAMP(3), ADD COLUMN "lastReceivedQuantity" INTEGER;
ALTER TABLE "stock_transfer_items" ADD COLUMN "rfidTagId" TEXT, ADD COLUMN "rfidEventId" UUID, ADD COLUMN "rfidDeviceId" TEXT;
CREATE INDEX "stock_transfer_items_rfidTagId_idx" ON "stock_transfer_items"("rfidTagId");

-- Recover receipt visibility from the existing ledger, without changing stock.
UPDATE "inventories" i SET "lastReceivedAt" = t."occurredAt", "lastReceivedQuantity" = t.quantity
FROM (SELECT DISTINCT ON ("inventoryId") "inventoryId", "occurredAt", quantity
      FROM "inventory_transactions" WHERE type IN ('PURCHASE_RECEIPT', 'TRANSFER_IN') AND quantity > 0
      ORDER BY "inventoryId", "occurredAt" DESC, id DESC) t WHERE i.id = t."inventoryId";
UPDATE "products" p SET "lastReceivedAt" = t.received
FROM (SELECT s."productId", MAX(i."lastReceivedAt") AS received FROM "inventories" i
      JOIN "skus" s ON s.id = i."skuId" GROUP BY s."productId") t WHERE p.id = t."productId";
