CREATE TABLE "inventory_recommendations" (
  "id" UUID NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "forecastRunId" UUID NOT NULL,
  "targetStoreId" UUID NOT NULL,
  "skuId" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "suggestedQuantity" INTEGER NOT NULL,
  "finalQuantity" INTEGER,
  "sourceWarehouseId" UUID,
  "destinationWarehouseId" UUID,
  "generatedById" UUID NOT NULL,
  "decidedById" UUID,
  "decisionNote" TEXT,
  "decidedAt" TIMESTAMP(3),
  "transferId" UUID,
  "purchaseRequestId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_recommendations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inventory_recommendations_dedupeKey_key" ON "inventory_recommendations"("dedupeKey");
CREATE UNIQUE INDEX "inventory_recommendations_transferId_key" ON "inventory_recommendations"("transferId");
CREATE UNIQUE INDEX "inventory_recommendations_purchaseRequestId_key" ON "inventory_recommendations"("purchaseRequestId");
CREATE INDEX "inventory_recommendations_forecastRunId_createdAt_idx" ON "inventory_recommendations"("forecastRunId", "createdAt");
CREATE INDEX "inventory_recommendations_targetStoreId_status_idx" ON "inventory_recommendations"("targetStoreId", "status");
ALTER TABLE "inventory_recommendations" ADD CONSTRAINT "inventory_recommendations_forecastRunId_fkey" FOREIGN KEY ("forecastRunId") REFERENCES "forecast_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_recommendations" ADD CONSTRAINT "inventory_recommendations_targetStoreId_fkey" FOREIGN KEY ("targetStoreId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_recommendations" ADD CONSTRAINT "inventory_recommendations_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_recommendations" ADD CONSTRAINT "inventory_recommendations_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_recommendations" ADD CONSTRAINT "inventory_recommendations_destinationWarehouseId_fkey" FOREIGN KEY ("destinationWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_recommendations" ADD CONSTRAINT "inventory_recommendations_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_recommendations" ADD CONSTRAINT "inventory_recommendations_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_recommendations" ADD CONSTRAINT "inventory_recommendations_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "stock_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_recommendations" ADD CONSTRAINT "inventory_recommendations_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "purchase_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
