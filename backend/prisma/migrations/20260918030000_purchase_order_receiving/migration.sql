CREATE TABLE "purchase_orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "code" TEXT NOT NULL, "purchaseRequestId" UUID NOT NULL,
  "supplierId" UUID NOT NULL, "warehouseId" UUID NOT NULL, "createdById" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN', "expectedAt" TIMESTAMP(3) NOT NULL,
  "note" TEXT, "totalAmount" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_orders_status_check" CHECK ("status" IN ('OPEN','PARTIALLY_RECEIVED','COMPLETED')),
  CONSTRAINT "purchase_orders_total_check" CHECK ("totalAmount" > 0)
);
CREATE TABLE "purchase_order_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "purchaseOrderId" UUID NOT NULL, "skuId" UUID NOT NULL,
  "orderedQuantity" INTEGER NOT NULL, "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
  "unitCost" DECIMAL(14,2) NOT NULL, "lineTotal" DECIMAL(14,2) NOT NULL,
  CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_order_items_quantity_check" CHECK ("orderedQuantity" > 0 AND "receivedQuantity" >= 0 AND "receivedQuantity" <= "orderedQuantity"),
  CONSTRAINT "purchase_order_items_cost_check" CHECK ("unitCost" > 0 AND "lineTotal" > 0)
);
CREATE TABLE "goods_receipts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "code" TEXT NOT NULL, "purchaseOrderId" UUID NOT NULL,
  "receivedById" UUID NOT NULL, "note" TEXT, "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "goods_receipt_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "receiptId" UUID NOT NULL, "purchaseOrderItemId" UUID NOT NULL,
  "skuId" UUID NOT NULL, "quantity" INTEGER NOT NULL, "unitCost" DECIMAL(14,2) NOT NULL,
  CONSTRAINT "goods_receipt_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "goods_receipt_items_quantity_check" CHECK ("quantity" > 0 AND "unitCost" > 0)
);
CREATE UNIQUE INDEX "purchase_orders_code_key" ON "purchase_orders"("code");
CREATE UNIQUE INDEX "purchase_orders_purchaseRequestId_key" ON "purchase_orders"("purchaseRequestId");
CREATE INDEX "purchase_orders_warehouseId_createdAt_idx" ON "purchase_orders"("warehouseId", "createdAt");
CREATE INDEX "purchase_orders_supplierId_createdAt_idx" ON "purchase_orders"("supplierId", "createdAt");
CREATE INDEX "purchase_orders_status_createdAt_idx" ON "purchase_orders"("status", "createdAt");
CREATE UNIQUE INDEX "purchase_order_items_purchaseOrderId_skuId_key" ON "purchase_order_items"("purchaseOrderId", "skuId");
CREATE INDEX "purchase_order_items_skuId_idx" ON "purchase_order_items"("skuId");
CREATE UNIQUE INDEX "goods_receipts_code_key" ON "goods_receipts"("code");
CREATE INDEX "goods_receipts_purchaseOrderId_receivedAt_idx" ON "goods_receipts"("purchaseOrderId", "receivedAt");
CREATE UNIQUE INDEX "goods_receipt_items_receiptId_purchaseOrderItemId_key" ON "goods_receipt_items"("receiptId", "purchaseOrderItemId");
CREATE INDEX "goods_receipt_items_skuId_idx" ON "goods_receipt_items"("skuId");
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "purchase_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO "permissions" ("code","name") VALUES ('purchase_orders.read','Xem đơn mua hàng'),('purchase_orders.create','Tạo đơn mua hàng từ đề nghị đã duyệt'),('purchase_orders.receive','Nhận hàng theo đơn mua hàng') ON CONFLICT ("code") DO UPDATE SET "name"=EXCLUDED."name";
INSERT INTO "role_permissions" ("roleId","permissionCode") SELECT r."id",p.code FROM "roles" r CROSS JOIN (VALUES ('purchase_orders.read'),('purchase_orders.create')) p(code) WHERE r."code" IN ('OWNER','REGIONAL_MANAGER','BRANCH_MANAGER','PURCHASING_STAFF') ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("roleId","permissionCode") SELECT r."id",p.code FROM "roles" r CROSS JOIN (VALUES ('purchase_orders.read'),('purchase_orders.receive')) p(code) WHERE r."code" IN ('OWNER','WAREHOUSE_STAFF') ON CONFLICT DO NOTHING;
