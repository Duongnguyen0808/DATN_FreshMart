import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../common/database.js';
import { ingestAccessDoor, ingestAccessRfid, isAfterHours, sweepOpenDoors } from './warehouse-access.service.js';

const suffix = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
const deviceCode = `TEST-ACCESS-${suffix}`;
const doorCode = `TEST-DOOR-${suffix}`;
const uid = suffix.slice(0, 8);
let warehouseId = '';
let deviceId = '';
let doorId = '';

describe('warehouse access physical-event flow', () => {
  it('evaluates opening hours in Vietnam time', () => {
    expect(isAfterHours(new Date('2026-10-30T23:00:00Z'))).toBe(true); // 06:00
    expect(isAfterHours(new Date('2026-10-31T00:00:00Z'))).toBe(false); // 07:00
    expect(isAfterHours(new Date('2026-10-31T15:00:00Z'))).toBe(true); // 22:00
  });
  beforeAll(async () => {
    const warehouse = await prisma.warehouse.findFirst({ where: { active: true, store: { active: true } }, orderBy: { code: 'asc' } });
    if (!warehouse) throw new Error('Warehouse access DB test needs one active warehouse.');
    const employee = await prisma.user.findFirst({ where: { active: true, stores: { some: { storeId: warehouse.storeId } }, roles: { some: { role: { permissions: { some: { permissionCode: 'inventory.read' } } } } } } });
    if (!employee) throw new Error('Warehouse access DB test needs one branch employee with inventory.read.');
    warehouseId = warehouse.id;
    const device = await prisma.warehouseAccessDevice.create({ data: { code: deviceCode, name: 'Test access device', warehouseId } });
    deviceId = device.id;
    const door = await prisma.warehouseAccessDoor.create({ data: { code: doorCode, name: 'Test door', warehouseId, deviceId } });
    doorId = door.id;
    await prisma.warehouseAccessCard.create({ data: { uid, employeeId: employee.id, warehouseId } });
  });
  afterAll(async () => {
    if (deviceId) {
      await prisma.warehouseSecurityAlert.deleteMany({ where: { doorId } });
      await prisma.warehouseAccessEvent.deleteMany({ where: { deviceId } });
      await prisma.warehouseAccessCard.deleteMany({ where: { uid } });
      await prisma.warehouseAccessDoor.deleteMany({ where: { id: doorId } });
      await prisma.warehouseAccessDevice.deleteMany({ where: { id: deviceId } });
    }
    await prisma.$disconnect();
  });

  it('authorizes one opening, rejects duplicate scans, alerts on unapproved opening and long opening', async () => {
    const timestamp = new Date().toISOString();
    const scan = { eventId: `SCAN-${suffix}`, deviceId: deviceCode, warehouseId, uid, timestamp };
    expect((await ingestAccessRfid(scan, 'SIMULATION')).event?.eventType).toBe('ACCESS_GRANTED');
    expect((await ingestAccessRfid(scan, 'SIMULATION')).duplicate).toBe(true);
    expect((await ingestAccessRfid({ ...scan, eventId: `SCAN2-${suffix}` }, 'SIMULATION')).duplicate).toBe(true);
    const open = { eventId: `OPEN-${suffix}`, deviceId: deviceCode, warehouseId, doorId: doorCode, state: 'OPEN' as const, timestamp };
    expect((await ingestAccessDoor(open, 'SIMULATION')).event?.eventType).toBe('DOOR_OPEN');
    expect(await prisma.warehouseAccessEvent.count({ where: { deviceId, eventType: 'AUTHORIZED_ACCESS' } })).toBe(1);
    expect((await ingestAccessDoor(open, 'SIMULATION')).duplicate).toBe(true);
    await prisma.warehouseAccessDoor.update({ where: { id: doorId }, data: { lastStateChangedAt: new Date(Date.now() - 1000) } });
    await ingestAccessDoor({ ...open, eventId: `CLOSE-${suffix}`, state: 'CLOSED' }, 'SIMULATION');
    await prisma.warehouseAccessDoor.update({ where: { id: doorId }, data: { lastStateChangedAt: new Date(Date.now() - 1000) } });
    await ingestAccessDoor({ ...open, eventId: `OPEN2-${suffix}` }, 'SIMULATION');
    expect(await prisma.warehouseSecurityAlert.count({ where: { doorId, type: 'UNAUTHORIZED_ACCESS', status: 'OPEN' } })).toBe(1);
    expect(await prisma.warehouseAccessEvent.count({ where: { deviceId, eventType: 'ALERT_CREATED' } })).toBeGreaterThanOrEqual(1);
    // Simulation uses a 10-second warning threshold; hardware still uses MAX_DOOR_OPEN_SECONDS.
    await prisma.warehouseAccessDoor.update({ where: { id: doorId }, data: { openSince: new Date(Date.now() - 11_000) } });
    await sweepOpenDoors();
    await sweepOpenDoors();
    expect(await prisma.warehouseSecurityAlert.count({ where: { doorId, type: 'DOOR_OPEN_TOO_LONG', status: 'OPEN' } })).toBe(1);
    expect(await prisma.warehouseAccessEvent.count({ where: { deviceId, eventType: 'DOOR_OPEN_TOO_LONG' } })).toBe(1);
    await prisma.warehouseAccessDoor.update({ where: { id: doorId }, data: { lastStateChangedAt: new Date(Date.now() - 1000) } });
    await ingestAccessDoor({ ...open, eventId: `CLOSE2-${suffix}`, state: 'CLOSED' }, 'SIMULATION');
    expect(await prisma.warehouseSecurityAlert.count({ where: { doorId, type: 'DOOR_OPEN_TOO_LONG', status: 'OPEN' } })).toBe(0);
    expect(await prisma.warehouseAccessEvent.count({ where: { deviceId, eventType: 'ALERT_RESOLVED' } })).toBe(1);
    const denied = await ingestAccessRfid({ ...scan, eventId: `UNKNOWN-${suffix}`, uid: 'FFFF0000' }, 'SIMULATION');
    expect(denied.event?.eventType).toBe('ACCESS_DENIED');
    expect(await prisma.warehouseSecurityAlert.count({ where: { doorId, type: 'INVALID_RFID', status: 'OPEN' } })).toBe(1);
  });
});
