CREATE TABLE "iot_events" (
    "id" UUID NOT NULL,
    "eventId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "warehouseId" UUID NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "tagMappingId" UUID,
    "mappedSkuId" UUID,
    "palletCode" TEXT,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "processedById" UUID,
    "confirmedReferenceType" TEXT,
    "confirmedReferenceId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'DEVICE',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "iot_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "iot_events_deviceId_eventId_key" ON "iot_events"("deviceId", "eventId");
CREATE INDEX "iot_events_warehouseId_timestamp_idx" ON "iot_events"("warehouseId", "timestamp");
CREATE INDEX "iot_events_processed_timestamp_idx" ON "iot_events"("processed", "timestamp");
CREATE INDEX "iot_events_tagId_timestamp_idx" ON "iot_events"("tagId", "timestamp");
ALTER TABLE "iot_events" ADD CONSTRAINT "iot_events_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "iot_tag_mappings" (
    "id" UUID NOT NULL,
    "tagId" TEXT NOT NULL,
    "skuId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "palletCode" TEXT,
    "source" TEXT NOT NULL DEFAULT 'HARDWARE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "iot_tag_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "iot_tag_mappings_tagId_key" ON "iot_tag_mappings"("tagId");
CREATE INDEX "iot_tag_mappings_warehouseId_active_idx" ON "iot_tag_mappings"("warehouseId", "active");
CREATE INDEX "iot_tag_mappings_skuId_idx" ON "iot_tag_mappings"("skuId");
ALTER TABLE "iot_tag_mappings" ADD CONSTRAINT "iot_tag_mappings_skuId_fkey"
  FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "iot_tag_mappings" ADD CONSTRAINT "iot_tag_mappings_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "iot_tag_mappings" ADD CONSTRAINT "iot_tag_mappings_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "iot_events" ADD CONSTRAINT "iot_events_tagMappingId_fkey"
  FOREIGN KEY ("tagMappingId") REFERENCES "iot_tag_mappings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "iot_events" ADD CONSTRAINT "iot_events_mappedSkuId_fkey"
  FOREIGN KEY ("mappedSkuId") REFERENCES "skus"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "iot_events" ADD CONSTRAINT "iot_events_processedById_fkey"
  FOREIGN KEY ("processedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
