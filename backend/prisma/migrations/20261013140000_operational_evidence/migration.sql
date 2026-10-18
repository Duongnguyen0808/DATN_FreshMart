ALTER TABLE "goods_receipts" ADD COLUMN "evidenceUrls" JSONB;
ALTER TABLE "stock_transfers" ADD COLUMN "dispatchEvidenceUrls" JSONB;
ALTER TABLE "stock_transfers" ADD COLUMN "receiptEvidenceUrls" JSONB;
