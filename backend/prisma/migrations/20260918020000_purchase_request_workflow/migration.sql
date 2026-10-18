CREATE TABLE "purchase_requests" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "code" TEXT NOT NULL, "storeId" UUID NOT NULL,
 "createdById" UUID NOT NULL, "approvedById" UUID, "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
 "reason" TEXT NOT NULL, "decisionNote" TEXT, "approvedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "purchase_requests_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "purchase_requests_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "purchase_requests_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 CONSTRAINT "purchase_requests_status_check" CHECK ("status" IN ('PENDING_APPROVAL','APPROVED','REJECTED','CONVERTED_TO_PO'))
);
CREATE TABLE "purchase_request_items" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "purchaseRequestId" UUID NOT NULL, "skuId" UUID NOT NULL,
 "requestedQuantity" INTEGER NOT NULL, "approvedQuantity" INTEGER,
 CONSTRAINT "purchase_request_items_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "purchase_request_items_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "purchase_request_items_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "purchase_request_items_quantity_check" CHECK ("requestedQuantity" > 0 AND ("approvedQuantity" IS NULL OR "approvedQuantity" > 0))
);
CREATE UNIQUE INDEX "purchase_requests_code_key" ON "purchase_requests"("code");
CREATE INDEX "purchase_requests_storeId_createdAt_idx" ON "purchase_requests"("storeId","createdAt");
CREATE INDEX "purchase_requests_status_createdAt_idx" ON "purchase_requests"("status","createdAt");
CREATE UNIQUE INDEX "purchase_request_items_purchaseRequestId_skuId_key" ON "purchase_request_items"("purchaseRequestId","skuId");
CREATE INDEX "purchase_request_items_skuId_idx" ON "purchase_request_items"("skuId");
INSERT INTO "permissions" ("code","name") VALUES ('purchase_requests.read','Xem đề nghị mua hàng'),('purchase_requests.create','Tạo đề nghị mua hàng'),('purchase_requests.approve','Duyệt, điều chỉnh hoặc từ chối đề nghị mua hàng') ON CONFLICT ("code") DO UPDATE SET "name"=EXCLUDED."name";
INSERT INTO "role_permissions" ("roleId","permissionCode") SELECT r."id",p.code FROM "roles" r CROSS JOIN (VALUES ('purchase_requests.read'),('purchase_requests.create'),('purchase_requests.approve')) p(code) WHERE r."code" IN ('OWNER','REGIONAL_MANAGER','BRANCH_MANAGER') ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("roleId","permissionCode") SELECT r."id",p.code FROM "roles" r CROSS JOIN (VALUES ('purchase_requests.read'),('purchase_requests.create')) p(code) WHERE r."code"='PURCHASING_STAFF' ON CONFLICT DO NOTHING;
