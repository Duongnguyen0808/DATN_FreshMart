CREATE TABLE "iot_inbound_parcels" (
 "id" UUID PRIMARY KEY, "tagId" TEXT NOT NULL UNIQUE, "palletCode" TEXT NOT NULL UNIQUE,
 "deviceId" TEXT NOT NULL, "warehouseId" UUID NOT NULL REFERENCES warehouses(id),
 "purchaseOrderId" UUID NOT NULL REFERENCES purchase_orders(id),
 "purchaseOrderItemId" UUID NOT NULL REFERENCES purchase_order_items(id),
 "skuId" UUID NOT NULL REFERENCES skus(id), "quantity" INTEGER NOT NULL CHECK (quantity > 0),
 "lotCode" TEXT NOT NULL, "expiresAt" DATE, "noExpiry" BOOLEAN NOT NULL DEFAULT false,
 "status" TEXT NOT NULL DEFAULT 'READY' CHECK (status IN ('READY','RECEIVED','CANCELLED')),
 "registeredById" UUID NOT NULL REFERENCES users(id), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "receivedAt" TIMESTAMP(3), "goodsReceiptId" UUID UNIQUE REFERENCES goods_receipts(id),
 CHECK (("expiresAt" IS NOT NULL AND "noExpiry" = false) OR ("expiresAt" IS NULL AND "noExpiry" = true))
);
CREATE INDEX "iot_inbound_parcels_warehouseId_status_idx" ON "iot_inbound_parcels"("warehouseId", "status");
ALTER TABLE "iot_events" ADD COLUMN "inboundParcelId" UUID REFERENCES iot_inbound_parcels(id),
 ADD COLUMN "automationStatus" TEXT, ADD COLUMN "automationMessage" TEXT,
 ADD COLUMN "goodsReceiptId" UUID REFERENCES goods_receipts(id);
