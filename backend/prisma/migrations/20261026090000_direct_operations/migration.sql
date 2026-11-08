BEGIN;
ALTER TABLE "stock_transfers" DROP CONSTRAINT "stock_transfers_status_check";
ALTER TABLE "purchase_requests" DROP CONSTRAINT "purchase_requests_status_check";
ALTER TABLE "stocktakes" DROP CONSTRAINT "stocktakes_status_check";

INSERT INTO "audit_logs" ("id", "action", "targetId", "metadata", "createdAt")
SELECT gen_random_uuid(), 'workflow.remove_approval', "id"::text,
 jsonb_build_object('entity','stock_transfer','previousStatus',"status",'newStatus','READY'), NOW()
FROM "stock_transfers" WHERE "status" IN ('PENDING_APPROVAL','APPROVED');
INSERT INTO "audit_logs" ("id", "action", "targetId", "metadata", "createdAt")
SELECT gen_random_uuid(), 'workflow.remove_approval', "id"::text,
 jsonb_build_object('entity','purchase_request','previousStatus',"status",'newStatus','READY'), NOW()
FROM "purchase_requests" WHERE "status" IN ('PENDING_APPROVAL','APPROVED');
INSERT INTO "audit_logs" ("id", "action", "targetId", "metadata", "createdAt")
SELECT gen_random_uuid(), 'workflow.remove_approval', "id"::text,
 jsonb_build_object('entity','stocktake','previousStatus',"status",'newStatus',CASE WHEN "status"='APPROVED' THEN 'COMPLETED' ELSE 'COUNTING' END), NOW()
FROM "stocktakes" WHERE "status" IN ('PENDING_APPROVAL','APPROVED');
INSERT INTO "audit_logs" ("id", "action", "targetId", "metadata", "createdAt")
SELECT gen_random_uuid(), 'workflow.remove_approval', "id"::text,
 jsonb_build_object('entity','lot_disposal','previousStatus',"status",'newStatus','READY'), NOW()
FROM "lot_disposals" WHERE "status" IN ('PENDING','APPROVED');

UPDATE "stock_transfer_items" i SET "approvedQuantity"=COALESCE(i."approvedQuantity",i."requestedQuantity")
FROM "stock_transfers" t WHERE i."transferId"=t.id AND t.status IN ('PENDING_APPROVAL','APPROVED');
UPDATE "purchase_request_items" i SET "approvedQuantity"=COALESCE(i."approvedQuantity",i."requestedQuantity")
FROM "purchase_requests" r WHERE i."purchaseRequestId"=r.id AND r.status IN ('PENDING_APPROVAL','APPROVED');
UPDATE "stock_transfers" SET status='READY' WHERE status IN ('PENDING_APPROVAL','APPROVED');
UPDATE "purchase_requests" SET status='READY' WHERE status IN ('PENDING_APPROVAL','APPROVED');
UPDATE "stocktakes" SET status=CASE WHEN status='APPROVED' THEN 'COMPLETED' ELSE 'COUNTING' END WHERE status IN ('PENDING_APPROVAL','APPROVED');
UPDATE "lot_disposals" SET status='READY' WHERE status IN ('PENDING','APPROVED');

ALTER TABLE "stock_transfers" ALTER COLUMN status SET DEFAULT 'READY';
ALTER TABLE "purchase_requests" ALTER COLUMN status SET DEFAULT 'READY';
ALTER TABLE "lot_disposals" ALTER COLUMN status SET DEFAULT 'READY';
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_status_check" CHECK(status IN ('READY','IN_TRANSIT','COMPLETED','REJECTED','CANCELLED'));
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_status_check" CHECK(status IN ('READY','REJECTED','CONVERTED_TO_PO'));
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_status_check" CHECK(status IN ('COUNTING','COMPLETED','REJECTED'));
COMMIT;
