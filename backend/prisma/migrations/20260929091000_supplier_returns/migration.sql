CREATE TABLE "supplier_returns" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "purchaseOrderId" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "warehouseId" UUID NOT NULL,
  "processedById" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "totalAmount" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_returns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_returns_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT,
  CONSTRAINT "supplier_returns_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  CONSTRAINT "supplier_returns_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  CONSTRAINT "supplier_returns_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "users"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "supplier_returns_code_key" ON "supplier_returns"("code");
CREATE INDEX "supplier_returns_purchaseOrderId_createdAt_idx" ON "supplier_returns"("purchaseOrderId", "createdAt");
CREATE INDEX "supplier_returns_supplierId_createdAt_idx" ON "supplier_returns"("supplierId", "createdAt");

CREATE TABLE "supplier_return_items" (
  "id" UUID NOT NULL,
  "supplierReturnId" UUID NOT NULL,
  "purchaseOrderItemId" UUID NOT NULL,
  "skuId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitCost" DECIMAL(14,2) NOT NULL,
  "lineTotal" DECIMAL(14,2) NOT NULL,
  CONSTRAINT "supplier_return_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_return_items_supplierReturnId_fkey" FOREIGN KEY ("supplierReturnId") REFERENCES "supplier_returns"("id") ON DELETE CASCADE,
  CONSTRAINT "supplier_return_items_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON DELETE RESTRICT,
  CONSTRAINT "supplier_return_items_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "supplier_return_items_supplierReturnId_purchaseOrderItemId_key" ON "supplier_return_items"("supplierReturnId", "purchaseOrderItemId");
CREATE INDEX "supplier_return_items_skuId_idx" ON "supplier_return_items"("skuId");
