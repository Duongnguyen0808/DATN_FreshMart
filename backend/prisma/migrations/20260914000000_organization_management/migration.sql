ALTER TABLE "stores"
  ADD COLUMN "address" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "region" TEXT NOT NULL DEFAULT 'MIEN_BAC',
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "managerName" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "warehouses"
  ADD COLUMN "address" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

INSERT INTO "permissions" ("code", "name") VALUES
  ('stores.manage', 'Thêm, sửa và đổi trạng thái chi nhánh'),
  ('warehouses.read', 'Xem kho thuộc chi nhánh được phân công'),
  ('warehouses.manage', 'Thêm, sửa và đổi trạng thái kho')
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name";

INSERT INTO "role_permissions" ("roleId", "permissionCode")
SELECT "id", permission_code
FROM "roles"
CROSS JOIN (VALUES ('stores.manage'), ('warehouses.read'), ('warehouses.manage')) AS permissions(permission_code)
WHERE "code" = 'OWNER'
ON CONFLICT DO NOTHING;
