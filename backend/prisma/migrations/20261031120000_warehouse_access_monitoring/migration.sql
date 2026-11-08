CREATE TABLE "warehouse_access_devices" (
  "id" UUID NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL,
  "warehouseId" UUID NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "lastSeenAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "warehouse_access_devices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "warehouse_access_devices_code_key" ON "warehouse_access_devices"("code");
CREATE INDEX "warehouse_access_devices_warehouseId_active_idx" ON "warehouse_access_devices"("warehouseId", "active");
ALTER TABLE "warehouse_access_devices" ADD CONSTRAINT "warehouse_access_devices_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "warehouse_access_doors" (
  "id" UUID NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL,
  "warehouseId" UUID NOT NULL, "deviceId" UUID NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'CLOSED', "lastStateChangedAt" TIMESTAMP(3),
  "openSince" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "warehouse_access_doors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "warehouse_access_doors_code_key" ON "warehouse_access_doors"("code");
CREATE INDEX "warehouse_access_doors_warehouseId_state_idx" ON "warehouse_access_doors"("warehouseId", "state");
ALTER TABLE "warehouse_access_doors" ADD CONSTRAINT "warehouse_access_doors_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warehouse_access_doors" ADD CONSTRAINT "warehouse_access_doors_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "warehouse_access_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "warehouse_access_cards" (
  "id" UUID NOT NULL, "uid" TEXT NOT NULL, "employeeId" UUID NOT NULL,
  "warehouseId" UUID NOT NULL, "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "revokedAt" TIMESTAMP(3),
  CONSTRAINT "warehouse_access_cards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "warehouse_access_cards_uid_key" ON "warehouse_access_cards"("uid");
CREATE INDEX "warehouse_access_cards_warehouseId_status_idx" ON "warehouse_access_cards"("warehouseId", "status");
ALTER TABLE "warehouse_access_cards" ADD CONSTRAINT "warehouse_access_cards_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warehouse_access_cards" ADD CONSTRAINT "warehouse_access_cards_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "warehouse_access_events" (
  "id" UUID NOT NULL, "eventId" TEXT NOT NULL, "deviceId" UUID NOT NULL,
  "warehouseId" UUID NOT NULL, "doorId" UUID, "employeeId" UUID,
  "eventType" TEXT NOT NULL, "source" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reportedAt" TIMESTAMP(3), "consumedAt" TIMESTAMP(3),
  "payload" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "warehouse_access_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "warehouse_access_events_deviceId_eventId_key" ON "warehouse_access_events"("deviceId", "eventId");
CREATE INDEX "warehouse_access_events_warehouseId_occurredAt_idx" ON "warehouse_access_events"("warehouseId", "occurredAt");
CREATE INDEX "warehouse_access_events_deviceId_eventType_occurredAt_idx" ON "warehouse_access_events"("deviceId", "eventType", "occurredAt");
ALTER TABLE "warehouse_access_events" ADD CONSTRAINT "warehouse_access_events_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "warehouse_access_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warehouse_access_events" ADD CONSTRAINT "warehouse_access_events_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warehouse_access_events" ADD CONSTRAINT "warehouse_access_events_doorId_fkey" FOREIGN KEY ("doorId") REFERENCES "warehouse_access_doors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "warehouse_access_events" ADD CONSTRAINT "warehouse_access_events_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "warehouse_security_alerts" (
  "id" UUID NOT NULL, "warehouseId" UUID NOT NULL, "doorId" UUID NOT NULL,
  "employeeId" UUID, "type" TEXT NOT NULL, "severity" TEXT NOT NULL DEFAULT 'WARNING',
  "message" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "warehouse_security_alerts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "warehouse_security_alerts_warehouseId_status_createdAt_idx" ON "warehouse_security_alerts"("warehouseId", "status", "createdAt");
CREATE UNIQUE INDEX "warehouse_security_alerts_one_open_long_door" ON "warehouse_security_alerts"("doorId", "type") WHERE "status" = 'OPEN' AND "type" = 'DOOR_OPEN_TOO_LONG';
ALTER TABLE "warehouse_security_alerts" ADD CONSTRAINT "warehouse_security_alerts_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warehouse_security_alerts" ADD CONSTRAINT "warehouse_security_alerts_doorId_fkey" FOREIGN KEY ("doorId") REFERENCES "warehouse_access_doors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
