ALTER TABLE "purchase_orders" ADD COLUMN "paymentDueAt" TIMESTAMP(3);
UPDATE "purchase_orders" SET "paymentDueAt" = "expectedAt" WHERE "paymentDueAt" IS NULL;
ALTER TABLE "purchase_orders" ALTER COLUMN "paymentDueAt" SET NOT NULL;

CREATE TABLE "payables" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "code" TEXT NOT NULL, "supplierId" UUID NOT NULL,
  "purchaseOrderId" UUID NOT NULL, "totalAmount" DECIMAL(14,2) NOT NULL,
  "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0, "dueDate" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payables_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payables_amount_check" CHECK ("totalAmount" > 0 AND "paidAmount" >= 0 AND "paidAmount" <= "totalAmount"),
  CONSTRAINT "payables_status_check" CHECK ("status" IN ('OPEN','PARTIALLY_PAID','PAID'))
);
CREATE TABLE "payable_payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "code" TEXT NOT NULL, "payableId" UUID NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL, "method" TEXT NOT NULL, "reference" TEXT, "note" TEXT,
  "paidById" UUID NOT NULL, "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payable_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payable_payments_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "payable_payments_method_check" CHECK ("method" IN ('BANK_TRANSFER','CASH'))
);
CREATE UNIQUE INDEX "payables_code_key" ON "payables"("code");
CREATE UNIQUE INDEX "payables_purchaseOrderId_key" ON "payables"("purchaseOrderId");
CREATE INDEX "payables_supplierId_dueDate_idx" ON "payables"("supplierId","dueDate");
CREATE INDEX "payables_status_dueDate_idx" ON "payables"("status","dueDate");
CREATE UNIQUE INDEX "payable_payments_code_key" ON "payable_payments"("code");
CREATE INDEX "payable_payments_payableId_paidAt_idx" ON "payable_payments"("payableId","paidAt");
ALTER TABLE "payables" ADD CONSTRAINT "payables_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payables" ADD CONSTRAINT "payables_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payable_payments" ADD CONSTRAINT "payable_payments_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payable_payments" ADD CONSTRAINT "payable_payments_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO "permissions" ("code","name") VALUES ('payables.read','Xem công nợ phải trả'),('payables.pay','Ghi nhận thanh toán công nợ') ON CONFLICT ("code") DO UPDATE SET "name"=EXCLUDED."name";
INSERT INTO "role_permissions" ("roleId","permissionCode") SELECT "id",'payables.read' FROM "roles" WHERE "code" IN ('OWNER','REGIONAL_MANAGER','BRANCH_MANAGER','ACCOUNTANT') ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("roleId","permissionCode") SELECT "id",'payables.pay' FROM "roles" WHERE "code" IN ('OWNER','ACCOUNTANT') ON CONFLICT DO NOTHING;
