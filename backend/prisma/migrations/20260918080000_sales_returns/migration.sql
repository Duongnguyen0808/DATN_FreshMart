ALTER TABLE "invoices" ADD COLUMN "refundedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

CREATE TABLE "sales_returns" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "invoiceId" UUID NOT NULL,
  "warehouseId" UUID NOT NULL,
  "processedById" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "refundMethod" TEXT NOT NULL,
  "refundReference" TEXT,
  "refundAmount" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_returns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_return_items" (
  "id" UUID NOT NULL,
  "salesReturnId" UUID NOT NULL,
  "invoiceItemId" UUID NOT NULL,
  "skuId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "restock" BOOLEAN NOT NULL DEFAULT true,
  "unitRefund" DECIMAL(14,2) NOT NULL,
  "lineRefund" DECIMAL(14,2) NOT NULL,
  CONSTRAINT "sales_return_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sales_returns_code_key" ON "sales_returns"("code");
CREATE INDEX "sales_returns_invoiceId_createdAt_idx" ON "sales_returns"("invoiceId", "createdAt");
CREATE INDEX "sales_returns_warehouseId_createdAt_idx" ON "sales_returns"("warehouseId", "createdAt");
CREATE UNIQUE INDEX "sales_return_items_salesReturnId_invoiceItemId_key" ON "sales_return_items"("salesReturnId", "invoiceItemId");
CREATE INDEX "sales_return_items_invoiceItemId_idx" ON "sales_return_items"("invoiceItemId");
CREATE INDEX "sales_return_items_skuId_idx" ON "sales_return_items"("skuId");

ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_salesReturnId_fkey" FOREIGN KEY ("salesReturnId") REFERENCES "sales_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_invoiceItemId_fkey" FOREIGN KEY ("invoiceItemId") REFERENCES "invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("code", "name") VALUES
  ('returns.read', 'Xem lịch sử đổi trả hàng'),
  ('returns.manage', 'Tạo phiếu trả hàng và hoàn tiền')
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name";

INSERT INTO "role_permissions" ("roleId", "permissionCode")
SELECT "id", 'returns.read' FROM "roles" WHERE "code" IN ('OWNER', 'REGIONAL_MANAGER', 'BRANCH_MANAGER', 'CASHIER', 'ACCOUNTANT')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionCode")
SELECT "id", 'returns.manage' FROM "roles" WHERE "code" IN ('OWNER', 'REGIONAL_MANAGER', 'BRANCH_MANAGER')
ON CONFLICT DO NOTHING;
