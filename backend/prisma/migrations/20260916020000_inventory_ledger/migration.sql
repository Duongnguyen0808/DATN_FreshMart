ALTER TABLE "invoices" ADD COLUMN "warehouseId" UUID;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "invoices_warehouseId_completedAt_idx" ON "invoices"("warehouseId", "completedAt");

CREATE TABLE "inventories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "warehouseId" UUID NOT NULL, "skuId" UUID NOT NULL,
  "onHand" INTEGER NOT NULL DEFAULT 0, "reserved" INTEGER NOT NULL DEFAULT 0, "inTransfer" INTEGER NOT NULL DEFAULT 0,
  "incoming" INTEGER NOT NULL DEFAULT 0, "safetyStock" INTEGER NOT NULL DEFAULT 0, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inventories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventories_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventories_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventories_quantities_check" CHECK ("onHand" >= 0 AND "reserved" >= 0 AND "inTransfer" >= 0 AND "incoming" >= 0 AND "safetyStock" >= 0 AND "reserved" <= "onHand")
);

CREATE TABLE "inventory_transactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "inventoryId" UUID NOT NULL, "warehouseId" UUID NOT NULL, "skuId" UUID NOT NULL,
  "type" TEXT NOT NULL, "quantity" INTEGER NOT NULL, "beforeQuantity" INTEGER NOT NULL, "afterQuantity" INTEGER NOT NULL,
  "referenceType" TEXT NOT NULL, "referenceId" TEXT NOT NULL, "reason" TEXT NOT NULL, "actorId" UUID, "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_transactions_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_transactions_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_transactions_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_transactions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "inventory_transactions_values_check" CHECK ("quantity" <> 0 AND "beforeQuantity" >= 0 AND "afterQuantity" >= 0 AND "afterQuantity" = "beforeQuantity" + "quantity")
);

CREATE UNIQUE INDEX "inventories_warehouseId_skuId_key" ON "inventories"("warehouseId", "skuId");
CREATE INDEX "inventories_skuId_idx" ON "inventories"("skuId");
CREATE INDEX "inventory_transactions_inventoryId_occurredAt_idx" ON "inventory_transactions"("inventoryId", "occurredAt");
CREATE INDEX "inventory_transactions_warehouseId_occurredAt_idx" ON "inventory_transactions"("warehouseId", "occurredAt");
CREATE INDEX "inventory_transactions_skuId_occurredAt_idx" ON "inventory_transactions"("skuId", "occurredAt");
CREATE INDEX "inventory_transactions_referenceType_referenceId_idx" ON "inventory_transactions"("referenceType", "referenceId");

-- Create empty stock records for existing master data. Quantity may only change through a later business transaction.
INSERT INTO "inventories" ("warehouseId", "skuId", "onHand", "reserved", "inTransfer", "incoming", "safetyStock", "updatedAt")
SELECT w."id", s."id", 0, 0, 0, 0, 0, CURRENT_TIMESTAMP FROM "warehouses" w CROSS JOIN "skus" s WHERE w."active" = true AND s."active" = true;

INSERT INTO "permissions" ("code", "name") VALUES ('inventory.read', 'Xem tồn kho và lịch sử biến động trong phạm vi chi nhánh')
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name";
INSERT INTO "role_permissions" ("roleId", "permissionCode") SELECT r."id", 'inventory.read' FROM "roles" r
WHERE r."code" IN ('OWNER', 'REGIONAL_MANAGER', 'BRANCH_MANAGER', 'CASHIER', 'WAREHOUSE_STAFF', 'PURCHASING_STAFF') ON CONFLICT DO NOTHING;
