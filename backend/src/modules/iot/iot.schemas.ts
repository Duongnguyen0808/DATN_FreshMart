import { z } from 'zod';

export const iotEventInput = z.object({
  eventId: z.string().trim().min(1).max(128),
  deviceId: z.string().trim().min(1).max(100),
  eventType: z.literal('RFID_DETECTED'),
  tagId: z.string().trim().min(1).max(128),
  warehouseId: z.string().uuid(),
  timestamp: z.coerce.date(),
  payload: z.record(z.string(), z.unknown()).default({}),
}).strict();

export const iotEventListInput = z.object({
  warehouseId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export const iotEventIdsInput = z.array(z.string().uuid()).min(1).max(500).refine(ids => new Set(ids).size === ids.length, 'Event không được trùng.');

export const iotSimulationInput = iotEventInput.omit({ deviceId: true, eventId: true }).extend({
  deviceId: z.string().trim().min(1).max(100).default('SIMULATOR-WEB'),
  eventId: z.string().trim().min(1).max(128).optional(),
}).strict();

export const iotTagMappingInput = z.object({
  tagId: z.string().trim().min(1).max(128),
  skuId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  palletCode: z.string().trim().max(100).optional().nullable(),
}).strict();
