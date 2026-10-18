ALTER TABLE "invoices" ADD COLUMN "creditAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

CREATE TABLE "receivables" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "invoiceId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "storeId" UUID NOT NULL,
  "totalAmount" DECIMAL(14,2) NOT NULL,
  "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "receivables_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "receivable_payments" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "receivableId" UUID NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "method" TEXT NOT NULL,
  "reference" TEXT,
  "note" TEXT,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidById" UUID NOT NULL,
  CONSTRAINT "receivable_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "receivables_code_key" ON "receivables"("code");
CREATE UNIQUE INDEX "receivables_invoiceId_key" ON "receivables"("invoiceId");
CREATE INDEX "receivables_customerId_status_idx" ON "receivables"("customerId", "status");
CREATE INDEX "receivables_storeId_dueDate_idx" ON "receivables"("storeId", "dueDate");
CREATE INDEX "receivables_status_dueDate_idx" ON "receivables"("status", "dueDate");
CREATE UNIQUE INDEX "receivable_payments_code_key" ON "receivable_payments"("code");
CREATE INDEX "receivable_payments_receivableId_paidAt_idx" ON "receivable_payments"("receivableId", "paidAt");

ALTER TABLE "receivables" ADD CONSTRAINT "receivables_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("code", "name") VALUES
  ('receivables.read', 'Xem công nợ phải thu khách hàng'),
  ('receivables.pay', 'Ghi nhận thu tiền công nợ khách hàng')
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name";

INSERT INTO "role_permissions" ("roleId", "permissionCode")
SELECT "id", 'receivables.read' FROM "roles" WHERE "code" IN ('OWNER', 'REGIONAL_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionCode")
SELECT "id", 'receivables.pay' FROM "roles" WHERE "code" IN ('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
ON CONFLICT DO NOTHING;
