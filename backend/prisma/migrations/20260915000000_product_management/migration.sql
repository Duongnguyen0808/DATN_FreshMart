CREATE TABLE "categories" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "products" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "categoryId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "skus" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "barcode" TEXT NOT NULL,
  "sellingPrice" DECIMAL(14,2) NOT NULL,
  "costPrice" DECIMAL(14,2) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "productId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "skus_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "price_history" (
  "id" UUID NOT NULL,
  "skuId" UUID NOT NULL,
  "sellingPrice" DECIMAL(14,2) NOT NULL,
  "costPrice" DECIMAL(14,2) NOT NULL,
  "changedById" UUID,
  "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "categories_code_key" ON "categories"("code");
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");
CREATE INDEX "products_categoryId_active_idx" ON "products"("categoryId", "active");
CREATE INDEX "products_name_idx" ON "products"("name");
CREATE UNIQUE INDEX "skus_code_key" ON "skus"("code");
CREATE UNIQUE INDEX "skus_barcode_key" ON "skus"("barcode");
CREATE INDEX "skus_productId_active_idx" ON "skus"("productId", "active");
CREATE INDEX "price_history_skuId_effectiveAt_idx" ON "price_history"("skuId", "effectiveAt");

ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "skus" ADD CONSTRAINT "skus_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "permissions" ("code", "name") VALUES
  ('products.read', 'Xem danh mục sản phẩm và SKU'),
  ('products.manage', 'Thêm, sửa và đổi trạng thái sản phẩm'),
  ('categories.manage', 'Quản lý danh mục sản phẩm')
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name";

INSERT INTO "role_permissions" ("roleId", "permissionCode")
SELECT "id", permission_code
FROM "roles"
CROSS JOIN (VALUES ('products.read'), ('products.manage'), ('categories.manage')) AS permissions(permission_code)
WHERE "code" = 'OWNER'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionCode")
SELECT "id", 'products.read'
FROM "roles"
WHERE "code" IN ('REGIONAL_MANAGER', 'BRANCH_MANAGER', 'WAREHOUSE_STAFF', 'PURCHASING_STAFF', 'CASHIER')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionCode")
SELECT "id", permission_code
FROM "roles"
CROSS JOIN (VALUES ('products.manage'), ('categories.manage')) AS permissions(permission_code)
WHERE "code" IN ('REGIONAL_MANAGER', 'BRANCH_MANAGER')
ON CONFLICT DO NOTHING;
