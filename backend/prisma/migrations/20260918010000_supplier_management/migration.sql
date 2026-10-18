CREATE TABLE "suppliers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "contactName" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "currentDebt" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "suppliers_debt_check" CHECK ("currentDebt" >= 0)
);
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");
CREATE INDEX "suppliers_name_idx" ON "suppliers"("name");
CREATE INDEX "suppliers_active_name_idx" ON "suppliers"("active","name");

INSERT INTO "permissions" ("code","name") VALUES
 ('suppliers.read','Xem hồ sơ nhà cung cấp'),
 ('suppliers.manage','Thêm, sửa và đổi trạng thái nhà cung cấp')
ON CONFLICT ("code") DO UPDATE SET "name"=EXCLUDED."name";
INSERT INTO "role_permissions" ("roleId","permissionCode") SELECT "id",'suppliers.read' FROM "roles" WHERE "code" IN ('OWNER','REGIONAL_MANAGER','BRANCH_MANAGER','PURCHASING_STAFF','ACCOUNTANT') ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("roleId","permissionCode") SELECT "id",'suppliers.manage' FROM "roles" WHERE "code" IN ('OWNER','REGIONAL_MANAGER','PURCHASING_STAFF') ON CONFLICT DO NOTHING;
