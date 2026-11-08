import { publishIotEvent } from './iot.realtime.js';
import { parcelInput, registerParcel, listParcels, cancelParcel, processInboundEvent, prepareExistingCameraParcels } from './iot-inbound.service.js';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { Router, raw } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../../common/app-error.js';
import { env } from '../../config/env.js';
import { authenticate, requirePermission } from '../../middleware/authenticate.js';
import { iotEventInput, iotEventListInput, iotTagMappingInput } from './iot.schemas.js';
import { prisma } from '../../common/database.js';
import { ingestEvent, listEvents, listTagMappings, upsertTagMapping } from './iot.service.js';
import { assignAccessCard, createWarehouseEmployee, deleteAccessCard, heartbeatAccessDevice, ingestAccessDoor, ingestAccessRfid, monitorWarehouseAccess, registerAccessDevice, registerAccessDoor, resolveAccessAlert, setupAccessSimulation, SIMULATED_DEVICE_PREFIX } from './warehouse-access.service.js';
import { randomUUID } from 'node:crypto';
import { startCameraDemo, getCameraDemo } from './camera-demo-session.service.js';
import { ingestCameraFrame } from './camera-image.service.js';
import { getCameraDeviceStatus, recordCameraDeviceIp, startAutomaticUsbWifiSyncWatcher, syncLaptopWifiOverUsb } from './wifi-sync.service.js';

export const iotRoutes = Router();
startAutomaticUsbWifiSyncWatcher();
const ok = (data: unknown) => ({ success: true, message: 'Success', data });
const deviceLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false });
const cameraFrameLimiter = rateLimit({ windowMs: 60_000, limit: 360, standardHeaders: 'draft-8', legacyHeaders: false });
const accessCode = z.string().trim().min(3).max(80).regex(/^[A-Za-z0-9_-]+$/);
const accessUid = z.string().trim().min(8).max(32).transform(value => value.replace(/[\s:-]/g, '').toUpperCase()).pipe(z.string().regex(/^[0-9A-F]{8,20}$/));
const physicalBase = z.object({ eventId: accessCode, deviceId: accessCode, warehouseId: z.string().uuid(), timestamp: z.iso.datetime({ offset: true }) });
const rfidAccessInput = physicalBase.extend({ uid: accessUid }).strict();
const doorAccessInput = physicalBase.extend({ doorId: accessCode, state: z.enum(['OPEN', 'CLOSED']) }).strict();
const deviceInput = z.object({ code: accessCode, name: z.string().trim().min(2).max(100), warehouseId: z.string().uuid() }).strict();
const doorInput = deviceInput.extend({ deviceCode: accessCode }).strict();
const cardInput = z.object({ uid: accessUid, employeeId: z.string().uuid(), warehouseId: z.string().uuid(), status: z.enum(['ACTIVE', 'REVOKED']).default('ACTIVE') }).strict();

// Retired browser capture: receiving events must come from a token-authenticated device.
iotRoutes.post('/iot/camera-scans', authenticate, requirePermission('purchase_orders.receive'), (_request, response) => {
  response.status(410).json({ success: false, message: 'Browser scanning retired. Use ESP32-CAM at the receiving station.' });
});

function requireDeviceToken(received: string | undefined) {
  if (!env.IOT_INGEST_TOKEN) throw new AppError(503, 'IOT_INGEST_DISABLED', 'Chưa cấu hình token nhận dữ liệu thiết bị IoT.');
  if (!received) throw new AppError(401, 'IOT_DEVICE_UNAUTHENTICATED', 'Thiếu token thiết bị IoT.');
  const expected = Buffer.from(env.IOT_INGEST_TOKEN);
  const supplied = Buffer.from(received);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new AppError(401, 'IOT_DEVICE_UNAUTHENTICATED', 'Token thiết bị IoT không hợp lệ.');
}

// Access/door events are separate from parcel RFID and never mutate inventory.
iotRoutes.get('/iot/access/monitor', authenticate, requirePermission('inventory.read'), async (request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json(ok(await monitorWarehouseAccess(request.currentUser, z.string().uuid().parse(request.query.warehouseId))));
});
iotRoutes.post('/iot/access/devices', authenticate, requirePermission('warehouses.manage'), async (request, response) => {
  response.status(201).json(ok(await registerAccessDevice(request.currentUser, deviceInput.parse(request.body))));
});
iotRoutes.post('/iot/access/doors', authenticate, requirePermission('warehouses.manage'), async (request, response) => {
  response.status(201).json(ok(await registerAccessDoor(request.currentUser, doorInput.parse(request.body))));
});
iotRoutes.post('/iot/access/cards', authenticate, requirePermission('warehouses.manage'), async (request, response) => {
  response.status(201).json(ok(await assignAccessCard(request.currentUser, cardInput.parse(request.body))));
});
iotRoutes.delete('/iot/access/cards/:uid', authenticate, requirePermission('warehouses.manage'), async (request, response) => {
  const uid = accessUid.parse(request.params.uid);
  const warehouseId = z.string().uuid().parse(request.query.warehouseId);
  response.json(ok(await deleteAccessCard(request.currentUser, uid, warehouseId)));
});
iotRoutes.post('/iot/access/employees', authenticate, requirePermission('warehouses.manage'), async (request, response) => {
  const input = z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().email().optional().or(z.literal('')), warehouseId: z.string().uuid() }).strict().parse(request.body);
  response.status(201).json(ok(await createWarehouseEmployee(request.currentUser, input)));
});
iotRoutes.post('/iot/access/simulation/setup', authenticate, requirePermission('inventory.read'), async (request, response) => {
  const input = z.object({ warehouseId: z.string().uuid() }).strict().parse(request.body);
  response.json(ok(await setupAccessSimulation(request.currentUser, input.warehouseId)));
});
iotRoutes.post('/iot/access/alerts/:id/resolve', authenticate, requirePermission('warehouses.manage'), async (request, response) => {
  response.json(ok(await resolveAccessAlert(request.currentUser, z.string().uuid().parse(request.params.id))));
});
iotRoutes.post('/iot/access/simulation/alerts/:id/resolve', authenticate, requirePermission('inventory.read'), async (request, response) => {
  const id = z.string().uuid().parse(request.params.id);
  const alert = await prisma.warehouseSecurityAlert.findUnique({ where: { id }, include: { door: { include: { device: { select: { code: true } } } } } });
  if (!alert || !alert.door.device.code.startsWith(SIMULATED_DEVICE_PREFIX)) throw new AppError(404, 'SIMULATION_ALERT_NOT_FOUND', 'Không tìm thấy cảnh báo mô phỏng.');
  response.json(ok(await resolveAccessAlert(request.currentUser, id)));
});
iotRoutes.post('/iot/access/rfid', deviceLimiter, async (request, response) => {
  requireDeviceToken(request.header('x-iot-device-token'));
  const parsed = rfidAccessInput.parse(request.body);
  recordCameraDeviceIp(parsed.deviceId, request.header('x-iot-device-ip'), request.ip);
  const result = await ingestAccessRfid(parsed);
  response.status(result.duplicate ? 200 : 202).json(ok(result));
});
iotRoutes.post('/iot/door/event', deviceLimiter, async (request, response) => {
  requireDeviceToken(request.header('x-iot-device-token'));
  const parsed = doorAccessInput.parse(request.body);
  recordCameraDeviceIp(parsed.deviceId, request.header('x-iot-device-ip'), request.ip);
  const result = await ingestAccessDoor(parsed);
  response.status(result.duplicate ? 200 : 202).json(ok(result));
});
iotRoutes.post('/iot/access/heartbeat', deviceLimiter, async (request, response) => {
  requireDeviceToken(request.header('x-iot-device-token'));
  const input = z.object({ deviceId: accessCode, warehouseId: z.string().uuid() }).strict().parse(request.body);
  recordCameraDeviceIp(input.deviceId, request.header('x-iot-device-ip'), request.ip);
  response.json(ok(await heartbeatAccessDevice(input)));
});
iotRoutes.post('/iot/access/simulate', authenticate, requirePermission('inventory.read'), async (request, response) => {
  const input = z.discriminatedUnion('action', [
    z.object({ action: z.literal('RFID'), warehouseId: z.string().uuid(), deviceId: accessCode, uid: accessUid }).strict(),
    z.object({ action: z.literal('DOOR'), warehouseId: z.string().uuid(), deviceId: accessCode, doorId: accessCode, state: z.enum(['OPEN', 'CLOSED']) }).strict(),
  ]).parse(request.body);
  const suffix = input.warehouseId.replaceAll('-', '').toUpperCase();
  const simDeviceCode = `${SIMULATED_DEVICE_PREFIX}${suffix}`;
  const effectiveDeviceId = input.deviceId.startsWith(SIMULATED_DEVICE_PREFIX) ? input.deviceId : simDeviceCode;
  await prisma.warehouseAccessDevice.upsert({ where: { code: effectiveDeviceId }, create: { code: effectiveDeviceId, name: 'ESP32 mô phỏng', warehouseId: input.warehouseId }, update: {} });
  let effectiveDoorId = input.action === 'DOOR' ? input.doorId : undefined;
  if (effectiveDoorId) {
    const simDoorCode = `SIM-DOOR-${suffix}`;
    const targetDoorCode = effectiveDoorId.startsWith('SIM-DOOR-') ? effectiveDoorId : simDoorCode;
    const simDevice = await prisma.warehouseAccessDevice.findUnique({ where: { code: effectiveDeviceId } });
    if (simDevice) {
      await prisma.warehouseAccessDoor.upsert({ where: { code: targetDoorCode }, create: { code: targetDoorCode, name: 'Cửa mô phỏng', warehouseId: input.warehouseId, deviceId: simDevice.id }, update: {} });
      effectiveDoorId = targetDoorCode;
    }
  }
  const base = { eventId: randomUUID(), deviceId: effectiveDeviceId, warehouseId: input.warehouseId, timestamp: new Date().toISOString() };
  const result = input.action === 'RFID' ? await ingestAccessRfid({ ...base, uid: input.uid }, 'SIMULATION', request.currentUser) : await ingestAccessDoor({ ...base, doorId: effectiveDoorId!, state: input.state }, 'SIMULATION');
  response.status(result.duplicate ? 200 : 202).json(ok(result));
});

iotRoutes.get('/iot/events', authenticate, requirePermission('inventory.read'), async (request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json(ok(await listEvents(request.currentUser, iotEventListInput.parse(request.query))));
});

iotRoutes.post('/iot/camera-demo-session', authenticate, requirePermission('purchase_orders.receive'), async (request, response) => {
  const input = z.object({ parcelId: z.string().uuid() }).strict().parse(request.body);
  response.status(201).json(ok(await startCameraDemo(request.currentUser, input.parcelId)));
});

iotRoutes.get('/iot/camera-demo-session', deviceLimiter, async (request, response) => {
  requireDeviceToken(request.header('x-iot-device-token'));
  const input = z.object({ deviceId: accessCode, tagId: z.string().regex(/^QR-[0-9A-F-]{36}$/) }).strict().parse(request.query);
  response.set('Cache-Control', 'no-store');
  response.json(ok(await getCameraDemo(input.deviceId, input.tagId)));
});

iotRoutes.get('/iot/tag-mappings', authenticate, requirePermission('inventory.read'), async (request, response) => {
  const warehouseId = request.query.warehouseId === undefined ? undefined : iotEventListInput.pick({ warehouseId: true }).parse({ warehouseId: request.query.warehouseId }).warehouseId;
  response.set('Cache-Control', 'no-store');
  response.json(ok(await listTagMappings(request.currentUser, warehouseId)));
});

iotRoutes.post('/iot/tag-mappings', authenticate, requirePermission('warehouses.manage'), async (request, response) => {
  response.status(201).json(ok(await upsertTagMapping(request.currentUser, iotTagMappingInput.parse(request.body))));
});

iotRoutes.post('/iot/events', deviceLimiter, async (request, response) => {
  requireDeviceToken(request.header('x-iot-device-token'));
  const input = iotEventInput.parse(request.body);
  recordCameraDeviceIp(input.deviceId, request.header('x-iot-device-ip'), request.ip);
  if (input.eventType === 'RFID_DETECTED') throw new AppError(410, 'RFID_RECEIVING_RETIRED', 'RFID hiện dùng để xác thực nhân viên cửa kho. Nhập hàng dùng mã QR qua ESP32-CAM.');
  const result = await ingestEvent(input, 'DEVICE', null);
  response.status(result.duplicate ? 200 : 202).json(ok({ ...result, waitingForConfirmation: result.event.automationStatus === 'WAITING_CONFIRMATION' }));
});

iotRoutes.post('/iot/camera-frames', cameraFrameLimiter, (request, _response, next) => {
  requireDeviceToken(request.header('x-iot-device-token')); next();
}, raw({ type: 'image/jpeg', limit: '512kb' }), async (request, response) => {
  const input = iotEventInput.pick({ eventId: true, deviceId: true, warehouseId: true, timestamp: true }).parse({
    eventId: request.header('x-iot-event-id'), deviceId: request.header('x-iot-device-id'), warehouseId: request.header('x-iot-warehouse-id'), timestamp: request.header('x-iot-timestamp'),
  });
  recordCameraDeviceIp(input.deviceId, request.header('x-iot-device-ip'), request.ip);
  if (!Buffer.isBuffer(request.body)) throw new AppError(400, 'CAMERA_IMAGE_REQUIRED', 'Thiết bị phải gửi ảnh JPEG để đọc QR.');
  response.set('Cache-Control', 'no-store');
  response.json(ok(await ingestCameraFrame(input, request.body)));
});

iotRoutes.get('/iot/camera-device-status', authenticate, requirePermission('inventory.read'), async (_request, response) => {
  response.set('Cache-Control', 'no-store');
  const status = getCameraDeviceStatus();
  if (!status.cameraIp) {
    void syncLaptopWifiOverUsb(false).catch(() => {});
  }
  response.json(ok(status));
});

iotRoutes.post('/iot/camera-sync-wifi', authenticate, requirePermission('inventory.read'), async (_request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json(ok(await syncLaptopWifiOverUsb(true)));
});



iotRoutes.get('/iot/inbound-parcels', authenticate, requirePermission('inventory.read'), async (req, res) => {
  res.json(ok(await listParcels(req.currentUser, z.string().uuid().parse(req.query.warehouseId))));
});
iotRoutes.post('/iot/inbound-parcels', authenticate, requirePermission('purchase_orders.receive'), async (req, res) => {
  res.status(201).json(ok(await registerParcel(req.currentUser, parcelInput.parse(req.body))));
});
iotRoutes.post('/iot/inbound-parcels/:id/cancel', authenticate, requirePermission('purchase_orders.receive'), async (req, res) => {
  res.json(ok(await cancelParcel(req.currentUser, z.string().uuid().parse(req.params.id))));
});

iotRoutes.post('/iot/inbound-parcels/prepare-orders', authenticate, requirePermission('purchase_orders.receive'), async (req, res) => {
  const input = z.object({ warehouseId: z.string().uuid() }).strict().parse(req.body);
  res.json(ok(await prepareExistingCameraParcels(req.currentUser, input.warehouseId)));
});

iotRoutes.post('/iot/events/:id/confirm', authenticate, requirePermission('purchase_orders.receive'), async (req, res) => {
  const input = z.object({ expiresAt: z.string().date().nullable(), noExpiry: z.boolean() }).strict().refine(v => Boolean(v.expiresAt) !== v.noExpiry).optional().parse(Object.keys(req.body).length ? req.body : undefined);
  const event = await processInboundEvent(z.string().uuid().parse(req.params.id), req.currentUser, input);
  publishIotEvent(event);
  res.json(ok(event));
});
