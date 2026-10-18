CREATE TABLE "stocktakes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "code" TEXT NOT NULL, "warehouseId" UUID NOT NULL, "createdById" UUID NOT NULL, "approvedById" UUID,
  "type" TEXT NOT NULL, "area" TEXT, "status" TEXT NOT NULL DEFAULT 'COUNTING', "note" TEXT, "decisionNote" TEXT,
  "submittedAt" TIMESTAMP(3), "approvedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stocktakes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stocktakes_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stocktakes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stocktakes_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "stocktakes_status_check" CHECK ("status" IN ('COUNTING','PENDING_APPROVAL','APPROVED','REJECTED')),
  CONSTRAINT "stocktakes_type_check" CHECK ("type" IN ('PERIODIC','SPOT','SHELF'))
);
CREATE TABLE "stocktake_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "stocktakeId" UUID NOT NULL, "inventoryId" UUID NOT NULL, "skuId" UUID NOT NULL,
  "systemQuantity" INTEGER NOT NULL, "actualQuantity" INTEGER, "difference" INTEGER, "costPrice" DECIMAL(14,2) NOT NULL, "reason" TEXT,
  CONSTRAINT "stocktake_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stocktake_items_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "stocktakes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "stocktake_items_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stocktake_items_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stocktake_items_values_check" CHECK ("systemQuantity" >= 0 AND ("actualQuantity" IS NULL OR "actualQuantity" >= 0) AND ("actualQuantity" IS NULL OR "difference" = "actualQuantity" - "systemQuantity"))
);
CREATE UNIQUE INDEX "stocktakes_code_key" ON "stocktakes"("code");
CREATE INDEX "stocktakes_warehouseId_createdAt_idx" ON "stocktakes"("warehouseId","createdAt");
CREATE INDEX "stocktakes_status_createdAt_idx" ON "stocktakes"("status","createdAt");
CREATE UNIQUE INDEX "stocktake_items_stocktakeId_skuId_key" ON "stocktake_items"("stocktakeId","skuId");
CREATE INDEX "stocktake_items_inventoryId_idx" ON "stocktake_items"("inventoryId");

INSERT INTO "permissions" ("code","name") VALUES
 ('stocktakes.read','Xem phiếu kiểm kho và chênh lệch'), ('stocktakes.create','Tạo và gửi phiếu kiểm kho'), ('stocktakes.approve','Duyệt điều chỉnh tồn kho')
ON CONFLICT ("code") DO UPDATE SET "name"=EXCLUDED."name";
INSERT INTO "role_permissions" ("roleId","permissionCode") SELECT r."id",p.code FROM "roles" r CROSS JOIN (VALUES ('stocktakes.read'),('stocktakes.approve')) p(code)
WHERE r."code" IN ('OWNER','REGIONAL_MANAGER','BRANCH_MANAGER') ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("roleId","permissionCode") SELECT r."id",p.code FROM "roles" r CROSS JOIN (VALUES ('stocktakes.read'),('stocktakes.create')) p(code)
WHERE r."code"='WAREHOUSE_STAFF' ON CONFLICT DO NOTHING;
