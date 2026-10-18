CREATE TABLE "stock_transfers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "code" TEXT NOT NULL,
  "sourceWarehouseId" UUID NOT NULL, "destinationWarehouseId" UUID NOT NULL,
  "createdById" UUID NOT NULL, "approvedById" UUID, "dispatchedById" UUID, "receivedById" UUID,
  "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL', "reason" TEXT NOT NULL,
  "decisionNote" TEXT, "dispatchNote" TEXT, "receiptNote" TEXT,
  "approvedAt" TIMESTAMP(3), "dispatchedAt" TIMESTAMP(3), "receivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_transfers_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_transfers_destinationWarehouseId_fkey" FOREIGN KEY ("destinationWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_transfers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_transfers_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "stock_transfers_dispatchedById_fkey" FOREIGN KEY ("dispatchedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "stock_transfers_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "stock_transfers_different_warehouses_check" CHECK ("sourceWarehouseId" <> "destinationWarehouseId"),
  CONSTRAINT "stock_transfers_status_check" CHECK ("status" IN ('PENDING_APPROVAL','APPROVED','IN_TRANSIT','COMPLETED','REJECTED','CANCELLED'))
);
CREATE TABLE "stock_transfer_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "transferId" UUID NOT NULL, "skuId" UUID NOT NULL,
  "requestedQuantity" INTEGER NOT NULL, "approvedQuantity" INTEGER, "dispatchedQuantity" INTEGER,
  "receivedQuantity" INTEGER, "discrepancy" INTEGER, "discrepancyReason" TEXT,
  "costPrice" DECIMAL(14,2) NOT NULL,
  CONSTRAINT "stock_transfer_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_transfer_items_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "stock_transfer_items_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_transfer_items_quantities_check" CHECK ("requestedQuantity" > 0 AND ("approvedQuantity" IS NULL OR "approvedQuantity" > 0) AND ("dispatchedQuantity" IS NULL OR "dispatchedQuantity" > 0) AND ("receivedQuantity" IS NULL OR "receivedQuantity" >= 0))
);
CREATE UNIQUE INDEX "stock_transfers_code_key" ON "stock_transfers"("code");
CREATE INDEX "stock_transfers_sourceWarehouseId_createdAt_idx" ON "stock_transfers"("sourceWarehouseId","createdAt");
CREATE INDEX "stock_transfers_destinationWarehouseId_createdAt_idx" ON "stock_transfers"("destinationWarehouseId","createdAt");
CREATE INDEX "stock_transfers_status_createdAt_idx" ON "stock_transfers"("status","createdAt");
CREATE UNIQUE INDEX "stock_transfer_items_transferId_skuId_key" ON "stock_transfer_items"("transferId","skuId");
CREATE INDEX "stock_transfer_items_skuId_idx" ON "stock_transfer_items"("skuId");

INSERT INTO "permissions" ("code","name") VALUES
 ('transfers.read','Xem phiếu điều chuyển'), ('transfers.create','Tạo phiếu điều chuyển'),
 ('transfers.approve','Duyệt và từ chối phiếu điều chuyển'), ('transfers.dispatch','Xác nhận xuất kho điều chuyển'),
 ('transfers.receive','Xác nhận nhận hàng điều chuyển') ON CONFLICT ("code") DO UPDATE SET "name"=EXCLUDED."name";
INSERT INTO "role_permissions" ("roleId","permissionCode") SELECT r."id",p.code FROM "roles" r CROSS JOIN (VALUES ('transfers.read'),('transfers.create'),('transfers.approve'),('transfers.dispatch'),('transfers.receive')) p(code) WHERE r."code"='OWNER' ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("roleId","permissionCode") SELECT r."id",p.code FROM "roles" r CROSS JOIN (VALUES ('transfers.read'),('transfers.create'),('transfers.approve')) p(code) WHERE r."code" IN ('REGIONAL_MANAGER','BRANCH_MANAGER') ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("roleId","permissionCode") SELECT r."id",p.code FROM "roles" r CROSS JOIN (VALUES ('transfers.read'),('transfers.create'),('transfers.dispatch'),('transfers.receive')) p(code) WHERE r."code"='WAREHOUSE_STAFF' ON CONFLICT DO NOTHING;
