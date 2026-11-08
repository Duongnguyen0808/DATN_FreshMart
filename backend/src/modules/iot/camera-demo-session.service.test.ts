import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ auditLog: { findFirst: vi.fn(), create: vi.fn() }, iotInboundParcel: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() }, warehouse: { findUniqueOrThrow: vi.fn() }, $transaction: vi.fn() }));
vi.mock('../../common/database.js', () => ({ prisma: db }));
import { getCameraDemo, startCameraDemo } from './camera-demo-session.service.js';
import type { CurrentUser } from '../auth/auth.repository.js';

const parcel = { id: '11111111-1111-4111-8111-111111111111', warehouseId: '22222222-2222-4222-8222-222222222222', tagId: 'QR-33333333-3333-4333-8333-333333333333', deviceId: 'FRESHMART-CAMERA-IN-01', status: 'READY' };
const actor = { id: 'actor', globalAccess: false, stores: [{ id: 'store' }] } as CurrentUser;
describe('temporary camera demo warehouse', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.$transaction.mockImplementation(fn => fn(db));
    db.iotInboundParcel.findUniqueOrThrow.mockResolvedValue(parcel);
    db.iotInboundParcel.findUnique.mockResolvedValue(parcel);
    db.warehouse.findUniqueOrThrow.mockResolvedValue({ id: parcel.warehouseId, storeId: 'store', active: true });
    db.auditLog.findFirst.mockResolvedValue(null);
    db.auditLog.create.mockResolvedValue({ id: 'session', createdAt: new Date() });
  });
  it('binds a ready parcel only after checking warehouse scope', async () => {
    await expect(startCameraDemo(actor, parcel.id)).resolves.toHaveProperty('sessionId', 'session');
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ metadata: expect.objectContaining({ warehouseId: parcel.warehouseId, tagId: parcel.tagId }) }) }));
    await expect(startCameraDemo({ ...actor, stores: [] }, parcel.id)).rejects.toMatchObject({ status: 403 });
  });
  it('refuses closed parcels and another operator taking an active camera', async () => {
    db.iotInboundParcel.findUniqueOrThrow.mockResolvedValueOnce({ ...parcel, status: 'RECEIVED' });
    await expect(startCameraDemo(actor, parcel.id)).rejects.toThrow();
    db.auditLog.findFirst.mockResolvedValue({ actorId: 'another' });
    await expect(startCameraDemo(actor, parcel.id)).rejects.toThrow();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
  it('does not bind arbitrary codes or expired sessions', async () => {
    expect(await getCameraDemo(parcel.deviceId, parcel.tagId)).toBeNull();
    expect(db.auditLog.findFirst.mock.calls[0][0].where.createdAt.gt).toBeInstanceOf(Date);
    db.auditLog.findFirst.mockResolvedValue({ id: 'session', metadata: parcel, createdAt: new Date() });
    expect(await getCameraDemo(parcel.deviceId, 'QR-OTHER')).toBeNull();
  });
  it('returns the exact active parcel context and rechecks its current status', async () => {
    db.auditLog.findFirst.mockResolvedValue({ id: 'session', metadata: { ...parcel, parcelId: parcel.id }, createdAt: new Date() });
    await expect(getCameraDemo(parcel.deviceId, parcel.tagId)).resolves.toMatchObject({ warehouseId: parcel.warehouseId, sessionId: 'session' });
    db.iotInboundParcel.findUnique.mockResolvedValue({ ...parcel, status: 'RECEIVED' });
    expect(await getCameraDemo(parcel.deviceId, parcel.tagId)).toBeNull();
  });
});
