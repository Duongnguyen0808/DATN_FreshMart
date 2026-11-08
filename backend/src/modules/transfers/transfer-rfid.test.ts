import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../generated/prisma/client.js';
import { attachTransferTags } from './transfer-rfid.js';

function fixture(eventChanges = {}, mapping: unknown = null, parcel: unknown = null, assigned: unknown = null) {
  const event = { id: 'scan', source: 'DEVICE', eventType: 'RFID_DETECTED', warehouseId: 'source', receivedAt: new Date(), tagId: 'F31B93DC', deviceId: 'reader', mappedSkuId: null, ...eventChanges };
  const tx = { iotEvent: { findUnique: vi.fn().mockResolvedValue(event) }, iotTagMapping: { findUnique: vi.fn().mockResolvedValue(mapping), upsert: vi.fn() }, iotInboundParcel: { findUnique: vi.fn().mockResolvedValue(parcel) }, stockTransferItem: { findFirst: vi.fn().mockResolvedValue(assigned) } };
  return { tx, run: () => attachTransferTags(tx as unknown as Prisma.TransactionClient, 'source', 'actor', [{ skuId: 'product', rfidEventId: 'scan' }]) };
}

describe('RFID attachment on transfer creation', () => {
  it('stores the real scan identity for a new tag without treating it as a stock movement', async () => {
    const { run } = fixture();
    expect((await run()).get('product')).toEqual({ rfidTagId: 'F31B93DC', rfidEventId: 'scan', rfidDeviceId: 'reader' });
  });
  it.each([{ source: 'SIMULATED' }, { warehouseId: 'other' }, { receivedAt: new Date(Date.now() - 16 * 60_000) }])('rejects invalid source, warehouse or stale scans: %j', async changes => {
    const { run, tx } = fixture(changes);
    await expect(run()).rejects.toMatchObject({ code: 'TRANSFER_RFID_SCAN_INVALID' });
    expect(tx.iotTagMapping.upsert).not.toHaveBeenCalled();
  });
  it('does not reassign a tag belonging to another product', async () => {
    await expect(fixture({}, { skuId: 'other', warehouseId: 'source' }).run()).rejects.toMatchObject({ code: 'TRANSFER_RFID_MISMATCH' });
  });
  it('blocks an inbound parcel still waiting to be received', async () => {
    await expect(fixture({}, null, { status: 'READY' }).run()).rejects.toMatchObject({ code: 'TRANSFER_RFID_BUSY' });
  });
  it('blocks a tag assigned to another unfinished transfer', async () => {
    await expect(fixture({}, null, null, { id: 'other-transfer-line' }).run()).rejects.toMatchObject({ code: 'TRANSFER_RFID_BUSY' });
  });
  it('allows a received parcel tag to identify the same goods for transfer', async () => {
    expect((await fixture({ processed: true }, { skuId: 'product', warehouseId: 'source' }, { status: 'RECEIVED' }).run()).size).toBe(1);
  });
});
