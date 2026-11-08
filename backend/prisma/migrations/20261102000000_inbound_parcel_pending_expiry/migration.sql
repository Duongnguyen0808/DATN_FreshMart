-- Purchase orders can create QR parcels before the delivered expiry is known.
-- A received parcel must still have a date or an explicit no-expiry confirmation.
ALTER TABLE "iot_inbound_parcels" DROP CONSTRAINT "iot_inbound_parcels_check";
ALTER TABLE "iot_inbound_parcels" ADD CONSTRAINT "iot_inbound_parcels_check" CHECK (
  ("expiresAt" IS NOT NULL AND "noExpiry" = false)
  OR ("expiresAt" IS NULL AND "noExpiry" = true)
  OR ("expiresAt" IS NULL AND "noExpiry" = false AND "status" IN ('READY', 'CANCELLED'))
);
