import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../common/database.js';
import { AppError } from '../../common/app-error.js';
import { env } from '../../config/env.js';
import type { CurrentUser } from '../auth/auth.repository.js';
import { publishWarehouseAccess } from './iot.realtime.js';

export type PhysicalSource = 'IOT_DEVICE' | 'SIMULATION';
type RfidInput = { eventId: string; deviceId: string; warehouseId: string; uid: string; timestamp: string };
type DoorInput = { eventId: string; deviceId: string; warehouseId: string; doorId: string; state: 'OPEN' | 'CLOSED'; timestamp: string };
const recent = (seconds: number, now = new Date()) => new Date(now.getTime() - seconds * 1000);
const eventPayload = (value: object): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
export const SIMULATED_DEVICE_PREFIX = 'SIM-ACCESS-';
export const SIMULATED_CARD_UID = 'D00C330C';

async function visibleWarehouse(user: CurrentUser, warehouseId: string) {
  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId }, select: { id: true, storeId: true, active: true } });
  if (!warehouse || !warehouse.active || (!user.globalAccess && !user.stores.some(store => store.id === warehouse.storeId))) {
    throw new AppError(404, 'WAREHOUSE_NOT_FOUND', 'Không tìm thấy kho trong phạm vi được cấp.');
  }
  return warehouse;
}

async function deviceFor(code: string, warehouseId: string) {
  const device = await prisma.warehouseAccessDevice.findUnique({ where: { code } });
  if (!device || !device.active || device.warehouseId !== warehouseId) throw new AppError(404, 'ACCESS_DEVICE_NOT_FOUND', 'Thiết bị chưa được đăng ký cho kho này.');
  return device;
}

export async function heartbeatAccessDevice(input: { deviceId: string; warehouseId: string }) {
  if (input.deviceId.startsWith(SIMULATED_DEVICE_PREFIX)) throw new AppError(400, 'SIMULATED_DEVICE', 'Thiết bị mô phỏng không nhận heartbeat thật.');
  const device = await deviceFor(input.deviceId, input.warehouseId);
  const updated = await prisma.warehouseAccessDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  publishWarehouseAccess(input.warehouseId, { device: { code: updated.code, lastSeenAt: updated.lastSeenAt } });
  return { deviceId: updated.code, lastSeenAt: updated.lastSeenAt };
}

export async function registerAccessDevice(user: CurrentUser, input: { code: string; name: string; warehouseId: string }) {
  await visibleWarehouse(user, input.warehouseId);
  if (input.code.startsWith(SIMULATED_DEVICE_PREFIX)) throw new AppError(400, 'RESERVED_DEVICE_CODE', 'Mã thiết bị mô phỏng được hệ thống quản lý.');
  const existing = await prisma.warehouseAccessDevice.findUnique({ where: { code: input.code } });
  if (existing && existing.warehouseId !== input.warehouseId) throw new AppError(409, 'DEVICE_ALREADY_ASSIGNED', 'Mã thiết bị đã thuộc kho khác.');
  return prisma.warehouseAccessDevice.upsert({ where: { code: input.code }, create: input, update: { name: input.name, active: true } });
}

/** Isolated simulation records: do not register a physical card or alter a real door. */
export async function setupAccessSimulation(user: CurrentUser, warehouseId: string) {
  await visibleWarehouse(user, warehouseId);
  const suffix = warehouseId.replaceAll('-', '').toUpperCase();
  const code = `${SIMULATED_DEVICE_PREFIX}${suffix}`;
  const doorCode = `SIM-DOOR-${suffix}`;
  const device = await prisma.warehouseAccessDevice.upsert({ where: { code }, create: { code, name: 'ESP32 mô phỏng', warehouseId }, update: {} });
  if (device.warehouseId !== warehouseId) throw new AppError(409, 'DEVICE_ALREADY_ASSIGNED', 'Thiết bị mô phỏng đã gắn với kho khác.');
  const door = await prisma.warehouseAccessDoor.upsert({ where: { code: doorCode }, create: { code: doorCode, name: 'Cửa nhân viên chính (mô phỏng)', warehouseId, deviceId: device.id }, update: {} });
  if (door.warehouseId !== warehouseId || door.deviceId !== device.id) throw new AppError(409, 'DOOR_ALREADY_ASSIGNED', 'Cửa mô phỏng đã gắn với kho khác.');
  return { deviceId: device.code, doorId: door.code, demoUid: SIMULATED_CARD_UID };
}

export async function registerAccessDoor(user: CurrentUser, input: { code: string; name: string; warehouseId: string; deviceCode: string }) {
  await visibleWarehouse(user, input.warehouseId);
  const device = await deviceFor(input.deviceCode, input.warehouseId);
  const existing = await prisma.warehouseAccessDoor.findUnique({ where: { code: input.code } });
  if (existing && (existing.warehouseId !== input.warehouseId || existing.deviceId !== device.id)) throw new AppError(409, 'DOOR_ALREADY_ASSIGNED', 'Mã cửa đã gắn với kho hoặc thiết bị khác.');
  return prisma.warehouseAccessDoor.upsert({ where: { code: input.code }, create: { code: input.code, name: input.name, warehouseId: input.warehouseId, deviceId: device.id }, update: { name: input.name } });
}

export async function assignAccessCard(user: CurrentUser, input: { uid: string; employeeId: string; warehouseId: string; status: 'ACTIVE' | 'REVOKED' }) {
  const warehouse = await visibleWarehouse(user, input.warehouseId);
  const employee = await prisma.user.findUnique({ where: { id: input.employeeId }, include: { stores: true, roles: { include: { role: { include: { permissions: true } } } } } });
  if (!employee || !employee.active || (!employee.roles.some(row => row.role.code === 'OWNER') && (!employee.stores.some(row => row.storeId === warehouse.storeId) || !employee.roles.some(row => row.role.permissions.some(permission => ['inventory.read', 'warehouses.manage'].includes(permission.permissionCode)))))) {
    throw new AppError(400, 'EMPLOYEE_NOT_IN_WAREHOUSE', 'Nhân viên không hoạt động hoặc chưa có quyền vào kho của chi nhánh.');
  }
  // Quy tắc an ninh: Mỗi người chỉ được sở hữu tối đa 1 thẻ RFID. Nếu đã có thẻ thì báo lỗi!
  if (input.status === 'ACTIVE') {
    const existingEmployeeCard = await prisma.warehouseAccessCard.findFirst({
      where: { employeeId: input.employeeId, warehouseId: input.warehouseId, status: 'ACTIVE', uid: { not: input.uid } },
    });
    if (existingEmployeeCard) {
      throw new AppError(400, 'EMPLOYEE_ALREADY_HAS_CARD', `Nhân viên "${employee.name}" đã được gán thẻ RFID (${existingEmployeeCard.uid}). Mỗi người chỉ được gắn tối đa 1 mã thẻ, không thể thêm mã thứ 2! Vui lòng khóa hoặc đổi thẻ cũ trước.`);
    }
  }
  const updated = await prisma.warehouseAccessCard.upsert({
    where: { uid: input.uid },
    create: { ...input, revokedAt: input.status === 'REVOKED' ? new Date() : null },
    update: { employeeId: input.employeeId, warehouseId: input.warehouseId, status: input.status, assignedAt: new Date(), revokedAt: input.status === 'REVOKED' ? new Date() : null },
    include: { employee: { select: { id: true, name: true, email: true } } },
  });
  publishWarehouseAccess(input.warehouseId, { card: updated });
  return updated;
}

export async function createWarehouseEmployee(user: CurrentUser, input: { name: string; email?: string; warehouseId: string }) {
  const warehouse = await visibleWarehouse(user, input.warehouseId);
  const cleanName = input.name.trim();
  if (cleanName.length < 2) throw new AppError(400, 'INVALID_EMPLOYEE_NAME', 'Tên nhân viên kho phải có ít nhất 2 ký tự.');
  const slug = cleanName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').toLowerCase() || 'nhanvien';
  const email = (input.email?.trim() || `${slug}.${Date.now().toString(36)}@freshmart.local`).toLowerCase();
  let role = await prisma.role.findFirst({ where: { permissions: { some: { permissionCode: 'inventory.read' } } }, orderBy: { code: 'asc' } });
  if (!role) {
    role = await prisma.role.findFirst();
  }
  const created = await prisma.user.create({
    data: {
      name: cleanName,
      email,
      passwordHash: '$2b$10$demoWarehouseEmployeeHashPlaceholder000000000000000000',
      active: true,
      stores: { create: [{ storeId: warehouse.storeId }] },
      ...(role ? { roles: { create: [{ roleId: role.id }] } } : {}),
    },
    select: { id: true, name: true, email: true },
  });
  publishWarehouseAccess(input.warehouseId, { employee: created });
  return created;
}

export async function monitorWarehouseAccess(user: CurrentUser, warehouseId: string) {
  const warehouse = await visibleWarehouse(user, warehouseId);
  const [devices, doors, cards, events, alerts, employees] = await Promise.all([
    prisma.warehouseAccessDevice.findMany({ where: { warehouseId }, orderBy: { code: 'asc' } }),
    prisma.warehouseAccessDoor.findMany({ where: { warehouseId }, include: { device: { select: { code: true } } }, orderBy: { code: 'asc' } }),
    prisma.warehouseAccessCard.findMany({ where: { warehouseId }, include: { employee: { select: { id: true, name: true, email: true } } }, orderBy: { assignedAt: 'desc' } }),
    prisma.warehouseAccessEvent.findMany({ where: { warehouseId }, include: { employee: { select: { id: true, name: true } }, door: { select: { code: true, name: true } } }, orderBy: { occurredAt: 'desc' }, take: 80 }),
    prisma.warehouseSecurityAlert.findMany({ where: { warehouseId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.user.findMany({ where: { active: true, stores: { some: { storeId: warehouse.storeId } }, roles: { some: { role: { permissions: { some: { permissionCode: { in: ['inventory.read', 'warehouses.manage'] } } } } } } }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } }),
  ]);
  const now = Date.now();
  return { accessWindowSeconds: env.ACCESS_WINDOW_SECONDS, maxDoorOpenSeconds: env.MAX_DOOR_OPEN_SECONDS, simulationDoorOpenSeconds: Math.min(10, env.MAX_DOOR_OPEN_SECONDS), devices: devices.map(device => ({ ...device, online: !!device.lastSeenAt && now - device.lastSeenAt.getTime() < 60_000 })), doors, cards, events, alerts, employees, mode: devices.some(device => device.lastSeenAt && now - device.lastSeenAt.getTime() < 60_000) ? 'REAL_IOT' : 'SIMULATION' };
}

export function isAfterHours(now: Date) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', hourCycle: 'h23' }).format(now));
  return hour < env.WAREHOUSE_OPEN_HOUR || hour >= env.WAREHOUSE_CLOSE_HOUR;
}

export async function ingestAccessRfid(input: RfidInput, source: PhysicalSource = 'IOT_DEVICE', simulationUser?: CurrentUser) {
  const device = await deviceFor(input.deviceId, input.warehouseId);
  if (source === 'IOT_DEVICE' && device.code.startsWith(SIMULATED_DEVICE_PREFIX)) throw new AppError(400, 'SIMULATED_DEVICE', 'Thiết bị mô phỏng không nhận thẻ thật.');
  const now = new Date();
  const prior = await prisma.warehouseAccessEvent.findUnique({ where: { deviceId_eventId: { deviceId: device.id, eventId: input.eventId } } });
  if (prior) return { duplicate: true, event: prior };
  const repeated = await prisma.warehouseAccessEvent.findFirst({ where: { deviceId: device.id, eventType: 'RFID_SCAN', occurredAt: { gte: recent(source === 'IOT_DEVICE' ? 1 : 3, now) }, payload: { path: ['uid'], equals: input.uid } }, orderBy: { occurredAt: 'desc' } });
  if (repeated) {
    if (source === 'IOT_DEVICE') publishWarehouseAccess(input.warehouseId, { event: repeated });
    return { duplicate: true, event: repeated };
  }
  const simulatedReader = source === 'SIMULATION' && device.code.startsWith(SIMULATED_DEVICE_PREFIX);
  const warehouse = await prisma.warehouse.findUniqueOrThrow({ where: { id: input.warehouseId } });
  let card = simulatedReader ? null : await prisma.warehouseAccessCard.findUnique({ where: { uid: input.uid }, include: { employee: { include: { stores: true, roles: { include: { role: { include: { permissions: true } } } } } } } });
  const demoCard = simulatedReader && input.uid === SIMULATED_CARD_UID && !!simulationUser;
  const employee = demoCard ? await prisma.user.findUnique({ where: { id: simulationUser!.id }, include: { stores: true, roles: { include: { role: { include: { permissions: true } } } } } }) : card?.employee;
  const granted = demoCard ? !!employee?.active : !!(card?.status === 'ACTIVE' && card.warehouseId === input.warehouseId && employee?.active && (employee.roles.some(row => row.role.code === 'OWNER') || (employee.stores.some(row => row.storeId === warehouse.storeId) && employee.roles.some(row => row.role.permissions.some(permission => ['inventory.read', 'warehouses.manage'].includes(permission.permissionCode))))));
  const door = await prisma.warehouseAccessDoor.findFirst({ where: { deviceId: device.id, warehouseId: input.warehouseId }, orderBy: { code: 'asc' } });
  try {
    const result = await prisma.$transaction(async tx => {
      if (source === 'IOT_DEVICE') await tx.warehouseAccessDevice.update({ where: { id: device.id }, data: { lastSeenAt: now } });
      await tx.warehouseAccessEvent.create({ data: { eventId: input.eventId, deviceId: device.id, warehouseId: input.warehouseId, doorId: door?.id, employeeId: employee?.id, eventType: 'RFID_SCAN', source, occurredAt: now, reportedAt: new Date(input.timestamp), payload: eventPayload({ uid: input.uid, reader: 'RC522' }) } });
      const event = await tx.warehouseAccessEvent.create({ data: { eventId: `${input.eventId}:result`, deviceId: device.id, warehouseId: input.warehouseId, doorId: door?.id, employeeId: employee?.id, eventType: granted ? 'ACCESS_GRANTED' : 'ACCESS_DENIED', source, occurredAt: now, reportedAt: new Date(input.timestamp), payload: eventPayload({ uid: input.uid, reason: demoCard ? 'SIMULATED_CARD' : granted ? 'ACTIVE_CARD' : 'UNKNOWN_REVOKED_OR_NO_WAREHOUSE_PERMISSION' }) } });
      if (!granted && door) {
        const alert = await tx.warehouseSecurityAlert.create({ data: { warehouseId: input.warehouseId, doorId: door.id, employeeId: employee?.id, type: 'INVALID_RFID', severity: 'WARNING', message: `Thẻ ${input.uid} không được phép truy cập ${door.name}.` } });
        await tx.warehouseAccessEvent.create({ data: { eventId: `${input.eventId}:alert`, deviceId: device.id, warehouseId: input.warehouseId, doorId: door.id, employeeId: employee?.id, eventType: 'ALERT_CREATED', source: 'BACKEND_RULE', occurredAt: now, payload: eventPayload({ alertId: alert.id, type: alert.type }) } });
      }
      return event;
    });
    publishWarehouseAccess(input.warehouseId, { event: result });
    return { duplicate: false, event: result };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { duplicate: true, event: await prisma.warehouseAccessEvent.findUnique({ where: { deviceId_eventId: { deviceId: device.id, eventId: input.eventId } } }) };
    throw error;
  }
}

export async function ingestAccessDoor(input: DoorInput, source: PhysicalSource = 'IOT_DEVICE') {
  const device = await deviceFor(input.deviceId, input.warehouseId);
  if (source === 'IOT_DEVICE' && device.code.startsWith(SIMULATED_DEVICE_PREFIX)) throw new AppError(400, 'SIMULATED_DEVICE', 'Thiết bị mô phỏng không nhận cảm biến thật.');
  const door = await prisma.warehouseAccessDoor.findFirst({ where: { code: input.doorId, deviceId: device.id, warehouseId: input.warehouseId } });
  if (!door) throw new AppError(404, 'DOOR_NOT_FOUND', 'Cửa chưa được đăng ký cho thiết bị và kho này.');
  const prior = await prisma.warehouseAccessEvent.findUnique({ where: { deviceId_eventId: { deviceId: device.id, eventId: input.eventId } } });
  if (prior) return { duplicate: true, event: prior };
  const now = new Date();
  if (door.state === input.state) return { duplicate: true, event: null };
  if (door.lastStateChangedAt && now.getTime() - door.lastStateChangedAt.getTime() < 500) throw new AppError(409, 'DOOR_DEBOUNCE_RETRY', 'Cảm biến cửa đổi trạng thái quá nhanh; gửi lại sau 0,5 giây.');
  const grant = input.state === 'OPEN' ? await prisma.warehouseAccessEvent.findFirst({ where: { deviceId: device.id, doorId: door.id, eventType: 'ACCESS_GRANTED', consumedAt: null, occurredAt: { gte: recent(env.ACCESS_WINDOW_SECONDS, now) } }, orderBy: { occurredAt: 'desc' } }) : null;
  const authorized = !!grant;
  try {
    const result = await prisma.$transaction(async tx => {
      const changed = await tx.warehouseAccessDoor.updateMany({ where: { id: door.id, state: door.state }, data: { state: input.state, lastStateChangedAt: now, openSince: input.state === 'OPEN' ? now : null } });
      if (!changed.count) return null;
      if (source === 'IOT_DEVICE') await tx.warehouseAccessDevice.update({ where: { id: device.id }, data: { lastSeenAt: now } });
      if (grant) await tx.warehouseAccessEvent.update({ where: { id: grant.id }, data: { consumedAt: now } });
      const event = await tx.warehouseAccessEvent.create({ data: { eventId: input.eventId, deviceId: device.id, warehouseId: input.warehouseId, doorId: door.id, employeeId: grant?.employeeId, eventType: input.state === 'OPEN' ? 'DOOR_OPEN' : 'DOOR_CLOSED', source, occurredAt: now, reportedAt: new Date(input.timestamp), payload: eventPayload({ state: input.state }) } });
      if (input.state === 'OPEN') {
        await tx.warehouseAccessEvent.create({ data: { eventId: `${input.eventId}:result`, deviceId: device.id, warehouseId: input.warehouseId, doorId: door.id, employeeId: grant?.employeeId, eventType: authorized ? 'AUTHORIZED_ACCESS' : 'UNAUTHORIZED_ACCESS', source, occurredAt: now, payload: eventPayload({ grantEventId: grant?.id ?? null }) } });
        if (!authorized) {
          const alert = await tx.warehouseSecurityAlert.create({ data: { warehouseId: input.warehouseId, doorId: door.id, type: 'UNAUTHORIZED_ACCESS', severity: 'CRITICAL', message: `Cửa ${door.name} mở khi không có thẻ hợp lệ trong ${env.ACCESS_WINDOW_SECONDS} giây trước đó.` } });
          await tx.warehouseAccessEvent.create({ data: { eventId: `${input.eventId}:alert`, deviceId: device.id, warehouseId: input.warehouseId, doorId: door.id, eventType: 'ALERT_CREATED', source: 'BACKEND_RULE', occurredAt: now, payload: eventPayload({ alertId: alert.id, type: alert.type }) } });
        }
        if (source === 'IOT_DEVICE' && isAfterHours(now)) {
          await tx.warehouseAccessEvent.create({ data: { eventId: `${input.eventId}:after-hours`, deviceId: device.id, warehouseId: input.warehouseId, doorId: door.id, employeeId: grant?.employeeId, eventType: 'AFTER_HOURS_ACCESS', source, occurredAt: now, payload: eventPayload({ localHour: 'Asia/Ho_Chi_Minh' }) } });
          const alert = await tx.warehouseSecurityAlert.create({ data: { warehouseId: input.warehouseId, doorId: door.id, employeeId: grant?.employeeId, type: 'AFTER_HOURS_ACCESS', severity: 'WARNING', message: `Cửa ${door.name} mở ngoài giờ kho.` } });
          await tx.warehouseAccessEvent.create({ data: { eventId: `${input.eventId}:after-hours-alert`, deviceId: device.id, warehouseId: input.warehouseId, doorId: door.id, employeeId: grant?.employeeId, eventType: 'ALERT_CREATED', source: 'BACKEND_RULE', occurredAt: now, payload: eventPayload({ alertId: alert.id, type: alert.type }) } });
        }
      } else {
        const resolved = await tx.warehouseSecurityAlert.updateMany({ where: { doorId: door.id, type: 'DOOR_OPEN_TOO_LONG', status: 'OPEN' }, data: { status: 'RESOLVED', resolvedAt: now } });
        if (resolved.count) await tx.warehouseAccessEvent.create({ data: { eventId: `${input.eventId}:alert-resolved`, deviceId: device.id, warehouseId: input.warehouseId, doorId: door.id, eventType: 'ALERT_RESOLVED', source: 'BACKEND_RULE', occurredAt: now, payload: eventPayload({ type: 'DOOR_OPEN_TOO_LONG', reason: 'DOOR_CLOSED' }) } });
      }
      return event;
    });
    if (result) publishWarehouseAccess(input.warehouseId, { event: result, door: { ...door, state: input.state, lastStateChangedAt: now } });
    return { duplicate: !result, event: result };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { duplicate: true, event: await prisma.warehouseAccessEvent.findUnique({ where: { deviceId_eventId: { deviceId: device.id, eventId: input.eventId } } }) };
    throw error;
  }
}

export async function sweepOpenDoors() {
  const now = new Date();
  const doors = await prisma.warehouseAccessDoor.findMany({ where: { state: 'OPEN', openSince: { lte: recent(Math.min(10, env.MAX_DOOR_OPEN_SECONDS), now) } } });
  for (const door of doors) {
    const opening = await prisma.warehouseAccessEvent.findFirst({ where: { doorId: door.id, eventType: 'DOOR_OPEN', occurredAt: { gte: door.openSince ?? undefined } }, orderBy: { occurredAt: 'desc' }, select: { source: true } });
    const threshold = opening?.source === 'SIMULATION' ? Math.min(10, env.MAX_DOOR_OPEN_SECONDS) : env.MAX_DOOR_OPEN_SECONDS;
    if (!door.openSince || now.getTime() - door.openSince.getTime() < threshold * 1000) continue;
    const active = await prisma.warehouseSecurityAlert.findFirst({ where: { doorId: door.id, type: 'DOOR_OPEN_TOO_LONG', status: 'OPEN' } });
    if (active) continue;
    try {
      const { alert, event } = await prisma.$transaction(async tx => {
        const alert = await tx.warehouseSecurityAlert.create({ data: { warehouseId: door.warehouseId, doorId: door.id, type: 'DOOR_OPEN_TOO_LONG', severity: 'WARNING', message: `Cửa ${door.name} mở quá ${threshold} giây.` } });
        const event = await tx.warehouseAccessEvent.create({ data: { eventId: randomUUID(), deviceId: door.deviceId, warehouseId: door.warehouseId, doorId: door.id, eventType: 'DOOR_OPEN_TOO_LONG', source: 'BACKEND_RULE', payload: eventPayload({ openSince: door.openSince?.toISOString() }) } });
        await tx.warehouseAccessEvent.create({ data: { eventId: randomUUID(), deviceId: door.deviceId, warehouseId: door.warehouseId, doorId: door.id, eventType: 'ALERT_CREATED', source: 'BACKEND_RULE', payload: eventPayload({ alertId: alert.id, type: alert.type }) } });
        return { alert, event };
      });
      publishWarehouseAccess(door.warehouseId, { event, alert });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    }
  }
}

export async function resolveAccessAlert(user: CurrentUser, alertId: string) {
  const alert = await prisma.warehouseSecurityAlert.findUnique({ where: { id: alertId } });
  if (!alert) throw new AppError(404, 'ALERT_NOT_FOUND', 'Không tìm thấy cảnh báo.');
  await visibleWarehouse(user, alert.warehouseId);
  if (alert.status === 'RESOLVED') return alert;
  const door = await prisma.warehouseAccessDoor.findUniqueOrThrow({ where: { id: alert.doorId }, select: { deviceId: true } });
  const { updated, event } = await prisma.$transaction(async tx => {
    const changed = await tx.warehouseSecurityAlert.updateMany({ where: { id: alertId, status: 'OPEN' }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
    const updated = await tx.warehouseSecurityAlert.findUniqueOrThrow({ where: { id: alertId } });
    const event = changed.count ? await tx.warehouseAccessEvent.create({ data: { eventId: randomUUID(), deviceId: door.deviceId, warehouseId: alert.warehouseId, doorId: alert.doorId, employeeId: alert.employeeId, eventType: 'ALERT_RESOLVED', source: 'BACKEND_RULE', payload: eventPayload({ alertId, type: alert.type, resolvedBy: user.id }) } }) : null;
    return { updated, event };
  });
  if (event) publishWarehouseAccess(alert.warehouseId, { alert: updated, event });
  return updated;
}

export async function deleteAccessCard(user: CurrentUser, uid: string, warehouseId: string) {
  await visibleWarehouse(user, warehouseId);
  const deleted = await prisma.warehouseAccessCard.deleteMany({
    where: { uid, warehouseId },
  });
  publishWarehouseAccess(warehouseId, { cardDeleted: uid });
  return { uid, deleted: deleted.count > 0 };
}
