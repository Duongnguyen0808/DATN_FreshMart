CREATE TABLE "invoices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "shiftId" UUID NOT NULL,
  "storeId" UUID NOT NULL,
  "cashierId" UUID NOT NULL,
  "customerName" TEXT,
  "customerPhone" TEXT,
  "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  "subtotal" DECIMAL(14,2) NOT NULL,
  "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(14,2) NOT NULL,
  "note" TEXT,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt" TIMESTAMP(3),
  "cancelledById" UUID,
  "cancellationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "invoices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoices_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "work_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "invoices_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "invoices_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "invoices_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "invoices_status_check" CHECK ("status" IN ('COMPLETED', 'CANCELLED')),
  CONSTRAINT "invoices_money_check" CHECK ("subtotal" >= 0 AND "discount" >= 0 AND "discount" <= "subtotal" AND "total" = "subtotal" - "discount")
);

CREATE TABLE "invoice_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "invoiceId" UUID NOT NULL, "skuId" UUID NOT NULL,
  "productCode" TEXT NOT NULL, "skuCode" TEXT NOT NULL, "productName" TEXT NOT NULL, "unit" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL, "unitPrice" DECIMAL(14,2) NOT NULL, "lineTotal" DECIMAL(14,2) NOT NULL,
  CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoice_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "invoice_items_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "invoice_items_values_check" CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "lineTotal" = "unitPrice" * "quantity")
);

CREATE TABLE "invoice_payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "invoiceId" UUID NOT NULL, "method" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL, "reference" TEXT,
  CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoice_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "invoice_payments_method_check" CHECK ("method" IN ('CASH', 'QR', 'CARD')),
  CONSTRAINT "invoice_payments_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "invoices_code_key" ON "invoices"("code");
CREATE INDEX "invoices_storeId_completedAt_idx" ON "invoices"("storeId", "completedAt");
CREATE INDEX "invoices_shiftId_completedAt_idx" ON "invoices"("shiftId", "completedAt");
CREATE INDEX "invoices_cashierId_completedAt_idx" ON "invoices"("cashierId", "completedAt");
CREATE INDEX "invoices_status_completedAt_idx" ON "invoices"("status", "completedAt");
CREATE UNIQUE INDEX "invoice_items_invoiceId_skuId_key" ON "invoice_items"("invoiceId", "skuId");
CREATE INDEX "invoice_items_skuId_idx" ON "invoice_items"("skuId");
CREATE INDEX "invoice_payments_invoiceId_idx" ON "invoice_payments"("invoiceId");

INSERT INTO "permissions" ("code", "name") VALUES
  ('invoices.read', 'Xem hóa đơn bán hàng trong phạm vi chi nhánh'),
  ('invoices.create', 'Tạo hóa đơn và ghi nhận thanh toán'),
  ('invoices.cancel', 'Hủy hóa đơn và hoàn doanh thu ca')
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name";

INSERT INTO "role_permissions" ("roleId", "permissionCode")
SELECT r."id", p.code FROM "roles" r CROSS JOIN (VALUES ('invoices.read'), ('invoices.create'), ('invoices.cancel')) AS p(code)
WHERE r."code" IN ('OWNER', 'REGIONAL_MANAGER', 'BRANCH_MANAGER') ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionCode")
SELECT r."id", p.code FROM "roles" r CROSS JOIN (VALUES ('invoices.read'), ('invoices.create')) AS p(code)
WHERE r."code" = 'CASHIER' ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionCode")
SELECT r."id", 'invoices.read' FROM "roles" r WHERE r."code" = 'ACCOUNTANT' ON CONFLICT DO NOTHING;
