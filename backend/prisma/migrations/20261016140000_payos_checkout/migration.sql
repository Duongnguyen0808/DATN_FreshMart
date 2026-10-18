CREATE TABLE "payos_checkouts" (
  "id" UUID NOT NULL,
  "orderCode" BIGSERIAL NOT NULL,
  "actorId" UUID NOT NULL,
  "shiftId" UUID NOT NULL,
  "storeId" UUID NOT NULL,
  "warehouseId" UUID NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CREATING',
  "snapshot" JSONB NOT NULL,
  "paymentLinkId" TEXT,
  "checkoutUrl" TEXT,
  "qrCode" TEXT,
  "accountName" TEXT,
  "accountNumber" TEXT,
  "description" TEXT,
  "invoiceId" UUID,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payos_checkouts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payos_checkouts_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payos_checkouts_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payos_checkouts_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "work_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payos_checkouts_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payos_checkouts_amount_positive" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "payos_checkouts_orderCode_key" ON "payos_checkouts"("orderCode");
CREATE UNIQUE INDEX "payos_checkouts_paymentLinkId_key" ON "payos_checkouts"("paymentLinkId");
CREATE UNIQUE INDEX "payos_checkouts_invoiceId_key" ON "payos_checkouts"("invoiceId");
CREATE INDEX "payos_checkouts_shiftId_status_idx" ON "payos_checkouts"("shiftId", "status");
CREATE INDEX "payos_checkouts_status_expiresAt_idx" ON "payos_checkouts"("status", "expiresAt");
CREATE INDEX "payos_checkouts_actorId_createdAt_idx" ON "payos_checkouts"("actorId", "createdAt");
