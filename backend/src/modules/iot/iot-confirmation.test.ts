import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../generated/prisma/client.js';

let confirmIotEvents: typeof import('./iot.service.js').confirmIotEvents;
beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgresql://localhost:5432/smart_store';
  process.env.JWT_SECRET ??= 'test-only-secret-at-least-32-characters';
  ({ confirmIotEvents } = await import('./iot.service.js'));
});

describe('IoT confirmation guard', () => {
  it('marks each matching event with the confirming actor and business reference', async () => {
    const events = [{ id: 'event-1', eventType: 'RFID_DETECTED', warehouseId: 'warehouse-1', mappedSkuId: 'sku-1', tagMappingId: 'map-1', processed: false, payload: { reference: 'PO-1', workflow: 'PURCHASE_RECEIPT' } }];
    const tx = {
      iotEvent: { findMany: vi.fn().mockResolvedValue(events), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    } as unknown as Prisma.TransactionClient;
    await confirmIotEvents(tx, ['event-1'], { warehouseId: 'warehouse-1', skuIds: ['sku-1'], actorId: 'user-1', action: 'iot.confirm', referenceType: 'PURCHASE_ORDER', referenceId: 'po-1', referenceCode: 'PO-1', workflow: 'PURCHASE_RECEIPT' });
    expect(tx.iotEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ processed: true, processedById: 'user-1', confirmedReferenceId: 'po-1' }) }));
    expect(tx.auditLog.createMany).toHaveBeenCalledWith({ data: [{ actorId: 'user-1', action: 'iot.confirm', targetId: 'event-1' }] });
  });

  it('rejects mismatched warehouse/SKU without consuming the event', async () => {
    const events = [{ id: 'event-1', eventType: 'RFID_DETECTED', warehouseId: 'wrong-warehouse', mappedSkuId: 'sku-1', processed: false, payload: {} }];
    const tx = {
      iotEvent: { findMany: vi.fn().mockResolvedValue(events), updateMany: vi.fn() },
      auditLog: { createMany: vi.fn() },
    } as unknown as Prisma.TransactionClient;
    await expect(confirmIotEvents(tx, ['event-1'], { warehouseId: 'warehouse-1', skuIds: ['sku-1'], actorId: 'user-1', action: 'iot.confirm', referenceType: 'STOCK_TRANSFER', referenceId: 'transfer-1', referenceCode: 'TR-1', workflow: 'STOCK_TRANSFER' })).rejects.toMatchObject({ code: 'IOT_CONFIRMATION_MISMATCH' });
    expect(tx.iotEvent.updateMany).not.toHaveBeenCalled();
  });

  it('keeps existing manual business confirmations independent of IoT', async () => {
    const tx = { iotEvent: { findMany: vi.fn(), updateMany: vi.fn() }, auditLog: { createMany: vi.fn() } } as unknown as Prisma.TransactionClient;
    await expect(confirmIotEvents(tx, undefined, { warehouseId: 'warehouse-1', skuIds: [], actorId: 'user-1', action: 'manual', referenceType: 'PURCHASE_ORDER', referenceId: 'po-1', referenceCode: 'PO-1', workflow: 'PURCHASE_RECEIPT' })).resolves.toEqual([]);
    expect(tx.iotEvent.findMany).not.toHaveBeenCalled();
  });
});
