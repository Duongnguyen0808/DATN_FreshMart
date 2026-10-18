import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../../common/app-error.js';
import { env } from '../../config/env.js';
import { authenticate, requirePermission } from '../../middleware/authenticate.js';
import { iotEventInput, iotEventListInput, iotSimulationInput, iotTagMappingInput } from './iot.schemas.js';
import { ingestEvent, listEvents, listTagMappings, simulateEvent, upsertTagMapping } from './iot.service.js';

export const iotRoutes = Router();
const ok = (data: unknown) => ({ success: true, message: 'Success', data });
const deviceLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false });

function requireDeviceToken(received: string | undefined) {
  if (!env.IOT_INGEST_TOKEN) throw new AppError(503, 'IOT_INGEST_DISABLED', 'Chưa cấu hình token nhận dữ liệu thiết bị IoT.');
  if (!received) throw new AppError(401, 'IOT_DEVICE_UNAUTHENTICATED', 'Thiếu token thiết bị IoT.');
  const expected = Buffer.from(env.IOT_INGEST_TOKEN);
  const supplied = Buffer.from(received);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new AppError(401, 'IOT_DEVICE_UNAUTHENTICATED', 'Token thiết bị IoT không hợp lệ.');
}

iotRoutes.get('/iot/events', authenticate, requirePermission('inventory.read'), async (request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json(ok(await listEvents(request.currentUser, iotEventListInput.parse(request.query))));
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
  const result = await ingestEvent(iotEventInput.parse(request.body), 'DEVICE', null);
  response.status(result.duplicate ? 200 : 202).json(ok({ ...result, waitingForConfirmation: true }));
});

iotRoutes.post('/iot/simulate', authenticate, requirePermission('inventory.read'), async (request, response) => {
  const result = await simulateEvent(request.currentUser, iotSimulationInput.parse(request.body));
  response.status(result.duplicate ? 200 : 202).json(ok({ ...result, waitingForConfirmation: true }));
});
