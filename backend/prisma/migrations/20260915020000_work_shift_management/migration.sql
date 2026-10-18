CREATE TABLE "work_shifts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "storeId" UUID NOT NULL,
  "cashierId" UUID NOT NULL,
  "posCode" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "openingCash" DECIMAL(14,2) NOT NULL,
  "cashRevenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "digitalRevenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "cashExpenses" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "closingCash" DECIMAL(14,2),
  "cashDiscrepancy" DECIMAL(14,2),
  "discrepancyReason" TEXT,
  "denominations" JSONB,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "approvedById" UUID,
  "managerNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "work_shifts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_shifts_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "work_shifts_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "work_shifts_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "work_shifts_status_check" CHECK ("status" IN ('OPEN', 'PENDING_REVIEW', 'CLOSED')),
  CONSTRAINT "work_shifts_money_check" CHECK ("openingCash" >= 0 AND "cashRevenue" >= 0 AND "digitalRevenue" >= 0 AND "cashExpenses" >= 0 AND ("closingCash" IS NULL OR "closingCash" >= 0))
);

CREATE UNIQUE INDEX "work_shifts_code_key" ON "work_shifts"("code");
CREATE INDEX "work_shifts_storeId_openedAt_idx" ON "work_shifts"("storeId", "openedAt");
CREATE INDEX "work_shifts_cashierId_openedAt_idx" ON "work_shifts"("cashierId", "openedAt");
CREATE INDEX "work_shifts_status_openedAt_idx" ON "work_shifts"("status", "openedAt");
CREATE UNIQUE INDEX "work_shifts_one_open_cashier" ON "work_shifts"("cashierId") WHERE "status" = 'OPEN';
CREATE UNIQUE INDEX "work_shifts_one_open_pos" ON "work_shifts"("storeId", "posCode") WHERE "status" = 'OPEN';

INSERT INTO "permissions" ("code", "name") VALUES
  ('shifts.read', 'Xem ca làm việc trong phạm vi chi nhánh'),
  ('shifts.manage', 'Mở và chốt ca làm việc'),
  ('shifts.approve', 'Duyệt chênh lệch và khóa sổ ca')
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name";

INSERT INTO "role_permissions" ("roleId", "permissionCode")
SELECT r."id", p.code FROM "roles" r
CROSS JOIN (VALUES ('shifts.read'), ('shifts.manage'), ('shifts.approve')) AS p(code)
WHERE r."code" IN ('OWNER', 'REGIONAL_MANAGER', 'BRANCH_MANAGER')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionCode")
SELECT r."id", p.code FROM "roles" r
CROSS JOIN (VALUES ('shifts.read'), ('shifts.manage')) AS p(code)
WHERE r."code" = 'CASHIER'
ON CONFLICT DO NOTHING;
