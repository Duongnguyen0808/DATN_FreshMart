CREATE TABLE "forecast_runs" (
  "id" UUID NOT NULL,
  "storeId" UUID NOT NULL,
  "horizonDays" INTEGER NOT NULL,
  "historyDays" INTEGER NOT NULL,
  "model" TEXT NOT NULL,
  "forecastFrom" TIMESTAMP(3) NOT NULL,
  "forecastTo" TIMESTAMP(3) NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "forecast_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "demand_forecasts" (
  "id" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "skuId" UUID NOT NULL,
  "predictedQuantity" INTEGER NOT NULL,
  "observedQuantity" INTEGER NOT NULL,
  "dataQuality" TEXT NOT NULL,
  "availableAtRun" INTEGER NOT NULL,
  "safetyStockAtRun" INTEGER NOT NULL,
  CONSTRAINT "demand_forecasts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "forecast_runs_storeId_horizonDays_generatedAt_idx" ON "forecast_runs"("storeId", "horizonDays", "generatedAt");
CREATE UNIQUE INDEX "demand_forecasts_runId_skuId_key" ON "demand_forecasts"("runId", "skuId");
CREATE INDEX "demand_forecasts_skuId_idx" ON "demand_forecasts"("skuId");
ALTER TABLE "forecast_runs" ADD CONSTRAINT "forecast_runs_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "demand_forecasts" ADD CONSTRAINT "demand_forecasts_runId_fkey" FOREIGN KEY ("runId") REFERENCES "forecast_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "demand_forecasts" ADD CONSTRAINT "demand_forecasts_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
