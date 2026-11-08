import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ context: vi.fn(), db: { iotEvent: { findUnique: vi.fn(), create: vi.fn() }, warehouse: { findUnique: vi.fn() }, iotTagMapping: { findUnique: vi.fn() }, iotInboundParcel: { findUnique: vi.fn() }, auditLog: { create: vi.fn() }, $transaction: vi.fn() } }));
vi.mock('../../common/database.js', () => ({ prisma: mock.db }));
vi.mock('./camera-demo-session.service.js', () => ({ getCameraDemo: mock.context }));
vi.mock('./iot-inbound.service.js', () => ({ processInboundEvent: vi.fn(async id => ({ id })) }));
vi.mock('./iot.realtime.js', () => ({ publishIotEvent: vi.fn() }));
import { ingestEvent } from './iot.service.js';
const input = { eventId: 'device-1', deviceId: 'CAMERA', eventType: 'CAMERA_CODE_DETECTED' as const, tagId: 'QR-11111111-1111-4111-8111-111111111111', warehouseId: 'physical', timestamp: new Date(), payload: { resolveDemoSession: true } };
describe('single-request camera ingest', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mock.db.iotEvent.findUnique.mockResolvedValue(null);
    mock.db.iotEvent.create.mockResolvedValue({ id: 'event' });
    mock.db.warehouse.findUnique.mockResolvedValue({ id: 'warehouse', active: true, storeId: 'store' });
    mock.db.$transaction.mockImplementation(fn => fn(mock.db));
    mock.context.mockResolvedValue(null);
  });
  it('uses the backend-authorized exact parcel session in the same event request', async () => {
    mock.context.mockResolvedValue({ warehouseId: 'demo', sessionId: 'session' });
    await ingestEvent(input, 'DEVICE', null);
    expect(mock.context).toHaveBeenCalledWith(input.deviceId, input.tagId);
    expect(mock.db.iotEvent.create.mock.calls[0][0].data).toMatchObject({ warehouseId: 'demo', payload: { reportedWarehouseId: 'physical', demoSessionId: 'session' }, source: 'DEVICE' });
  });
  it('keeps the physical warehouse when no live matching session exists', async () => {
    await ingestEvent(input, 'DEVICE', null);
    expect(mock.db.iotEvent.create.mock.calls[0][0].data.warehouseId).toBe('physical');
  });
  it('never applies a device demo binding to simulated events', async () => {
    await ingestEvent(input, 'SIMULATED', 'actor');
    expect(mock.context).not.toHaveBeenCalled();
    expect(mock.db.iotEvent.create.mock.calls[0][0].data.warehouseId).toBe('physical');
  });
  it('replays the original event without rebinding it after a session change', async () => {
    mock.db.iotEvent.findUnique.mockResolvedValue({ id: 'old' });
    await expect(ingestEvent(input, 'DEVICE', null)).resolves.toMatchObject({ duplicate: true, event: { id: 'old' } });
    expect(mock.context).not.toHaveBeenCalled();
    expect(mock.db.iotEvent.create).not.toHaveBeenCalled();
  });
});
