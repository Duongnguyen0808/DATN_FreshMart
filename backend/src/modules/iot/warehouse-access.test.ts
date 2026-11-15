import { beforeEach, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const table = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() });
  return { warehouse: table(), warehouseAccessDevice: table(), warehouseAccessDoor: table(), warehouseAccessCard: table(), warehouseAccessEvent: table(), warehouseSecurityAlert: table(), $transaction: vi.fn() };
});
vi.mock('../../common/database.js', () => ({ prisma: db }));
vi.mock('./iot.realtime.js', () => ({ publishWarehouseAccess: vi.fn() }));
vi.mock('../../config/env.js', () => ({ env: { ACCESS_WINDOW_SECONDS: 10, MAX_DOOR_OPEN_SECONDS: 30 } }));
import { ingestAccessDoor, ingestAccessRfid, sweepOpenDoors } from './warehouse-access.service.js';

const input = { eventId: 'scan', deviceId: 'ESP', warehouseId: 'wh', uid: 'ABC12345', timestamp: new Date().toISOString() };
beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(fn => fn(db));
  db.warehouseAccessDevice.findUnique.mockResolvedValue({ id: 'dev', code: 'ESP', warehouseId: 'wh', active: true });
  db.warehouse.findUniqueOrThrow.mockResolvedValue({ id: 'wh', storeId: 'store' });
  db.warehouseAccessDoor.findFirst.mockResolvedValue({ id: 'door', code: 'DOOR', warehouseId: 'wh', deviceId: 'dev', state: 'CLOSED', lastStateChangedAt: null });
  db.warehouseAccessEvent.findMany.mockResolvedValue([]);
  db.warehouseAccessEvent.findUnique.mockResolvedValue(null);
  db.warehouseAccessEvent.create.mockImplementation(({ data }) => Promise.resolve({ id: data.eventId, ...data }));
  db.warehouseAccessDoor.updateMany.mockResolvedValue({ count: 1 });
  db.warehouseSecurityAlert.create.mockImplementation(({data}) => Promise.resolve({id:'alert', ...data}));
  db.warehouseSecurityAlert.updateMany.mockResolvedValue({count:1});
  db.warehouseAccessCard.findUnique.mockResolvedValue({ status: 'ACTIVE', warehouseId:'wh', employee: { id:'employee', active:true, roles:[{role:{code:'OWNER'}}], stores:[] } });
});
it('valid RFID grants access without changing the door', async () => {
  expect((await ingestAccessRfid(input)).event?.eventType).toBe('ACCESS_GRANTED');
  expect(db.warehouseAccessDoor.updateMany).not.toHaveBeenCalled();
  expect(db.warehouseSecurityAlert.create).not.toHaveBeenCalled();
});
it('revoked card is denied and raises INVALID_RFID', async () => {
  db.warehouseAccessCard.findUnique.mockResolvedValue({status:'REVOKED',warehouseId:'wh',employee:{id:'employee',active:true}});
  expect((await ingestAccessRfid(input)).event?.eventType).toBe('ACCESS_DENIED');
  expect(db.warehouseSecurityAlert.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({type:'INVALID_RFID'})}));
});
it('physical opening cannot consume a simulation grant and alerts without authorization', async () => {
  db.warehouseAccessEvent.findFirst.mockResolvedValue(null);
  await ingestAccessDoor({...input, doorId:'DOOR',state:'OPEN'});
  expect(db.warehouseAccessEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({source:'IOT_DEVICE',consumedAt:null})}));
  expect(db.warehouseSecurityAlert.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({type:'UNAUTHORIZED_ACCESS'})}));
});
it('closure resolves long-open warning and only records door events', async () => {
  db.warehouseAccessDoor.findFirst.mockResolvedValue({id:'door',state:'OPEN',lastStateChangedAt:null});
  await ingestAccessDoor({...input,doorId:'DOOR',state:'CLOSED'});
  expect(db.warehouseAccessEvent.create.mock.calls.map(([arg])=>arg.data.eventType)).toEqual(['DOOR_CLOSED','ALERT_RESOLVED']);
  expect(db.warehouseAccessEvent.findFirst).not.toHaveBeenCalled();
});
it('a door closed during the sweep cannot acquire a stale long-open alert', async () => {
  db.warehouseAccessDoor.findMany.mockResolvedValue([{id:'door',openSince:new Date(Date.now()-60_000)}]);
  db.warehouseAccessEvent.findFirst.mockResolvedValue({source:'IOT_DEVICE'});
  db.warehouseAccessDoor.updateMany.mockResolvedValue({count:0});
  await sweepOpenDoors();
  expect(db.warehouseSecurityAlert.create).not.toHaveBeenCalled();
});
