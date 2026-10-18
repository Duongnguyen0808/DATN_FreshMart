ALTER TABLE "stock_transfers" ADD COLUMN "cancelledById" UUID;
ALTER TABLE "stock_transfers" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "stock_transfers" ADD COLUMN "cancelledAt" TIMESTAMP(3);

ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
