ALTER TABLE "stock_transfers" ADD COLUMN "discrepancyResolvedById" UUID;
ALTER TABLE "stock_transfers" ADD COLUMN "discrepancyResolvedAt" TIMESTAMP(3);
ALTER TABLE "stock_transfer_items" ADD COLUMN "discrepancyResolution" TEXT;

ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_discrepancyResolvedById_fkey"
  FOREIGN KEY ("discrepancyResolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
