ALTER TABLE "purchase_orders" ALTER COLUMN "purchaseRequestId" DROP NOT NULL;
ALTER TABLE "purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_purchaseRequestId_fkey";
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "purchase_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
