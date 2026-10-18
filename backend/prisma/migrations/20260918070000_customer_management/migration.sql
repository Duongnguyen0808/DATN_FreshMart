CREATE TABLE "customers" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "note" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");
CREATE INDEX "customers_name_idx" ON "customers"("name");
CREATE INDEX "customers_active_updatedAt_idx" ON "customers"("active", "updatedAt");

ALTER TABLE "invoices" ADD COLUMN "customerId" UUID;
CREATE INDEX "invoices_customerId_completedAt_idx" ON "invoices"("customerId", "completedAt");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "permissions" ("code", "name") VALUES
  ('customers.read', 'Xem hồ sơ khách hàng'),
  ('customers.manage', 'Thêm, sửa và đổi trạng thái khách hàng')
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name";

INSERT INTO "role_permissions" ("roleId", "permissionCode")
SELECT "id", 'customers.read' FROM "roles" WHERE "code" IN ('OWNER', 'REGIONAL_MANAGER', 'BRANCH_MANAGER', 'CASHIER', 'ACCOUNTANT')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionCode")
SELECT "id", 'customers.manage' FROM "roles" WHERE "code" IN ('OWNER', 'REGIONAL_MANAGER', 'BRANCH_MANAGER')
ON CONFLICT DO NOTHING;
