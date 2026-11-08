-- A purchase order stays open while any ordered quantity remains, including
-- after one or more partial receipts. Keep receipt records and quantities intact.
ALTER TABLE "purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_status_check";

UPDATE "purchase_orders"
SET "status" = 'OPEN'
WHERE "status" = 'PARTIALLY_RECEIVED';

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_status_check"
  CHECK ("status" IN ('OPEN', 'COMPLETED'));
