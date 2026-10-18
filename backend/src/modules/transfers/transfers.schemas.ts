import { z } from 'zod';

export const transferIdInput = z.string().uuid();
export const transferListInput = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['all', 'PENDING_APPROVAL', 'APPROVED', 'IN_TRANSIT', 'COMPLETED', 'REJECTED', 'CANCELLED']).default('all'),
  warehouseId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
const itemQuantity = z.object({ skuId: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(100_000_000) }).strict();
export const createTransferInput = z.object({
  sourceWarehouseId: z.string().uuid(), destinationWarehouseId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500), items: z.array(itemQuantity).min(1).max(500),
}).strict().refine(v => v.sourceWarehouseId !== v.destinationWarehouseId, { message: 'Kho nguá»“n vĂ  kho Ä‘Ă­ch pháº£i khĂ¡c nhau.', path: ['destinationWarehouseId'] })
  .refine(v => new Set(v.items.map(i => i.skuId)).size === v.items.length, { message: 'SKU khĂ´ng Ä‘Æ°á»£c trĂ¹ng.', path: ['items'] });
export const approveTransferInput = z.object({
  note: z.string().trim().min(3).max(500),
  items: z.array(itemQuantity).min(1).max(500),
}).strict().refine(v => new Set(v.items.map(i => i.skuId)).size === v.items.length, { message: 'SKU khĂ´ng Ä‘Æ°á»£c trĂ¹ng.', path: ['items'] });
export const transferNoteInput = z.object({ note: z.string().trim().min(3).max(500) }).strict();
export const dispatchTransferInput = z.object({ note: z.string().trim().max(500).optional().nullable().transform(v => v || null), evidence: z.array(z.string().max(2_400_000)).max(3).default([]), iotEventIds: z.array(z.string().uuid()).min(1).max(500).refine(ids => new Set(ids).size === ids.length, 'Event không được trùng.').optional() }).strict();
export const receiveTransferInput = z.object({
  note: z.string().trim().max(500).optional().nullable().transform(v => v || null),
  evidence: z.array(z.string().max(2_400_000)).max(3).default([]),
  iotEventIds: z.array(z.string().uuid()).min(1).max(500).refine(ids => new Set(ids).size === ids.length, 'Event không được trùng.').optional(),
  items: z.array(z.object({ skuId: z.string().uuid(), quantity: z.coerce.number().int().min(0).max(100_000_000), discrepancyReason: z.string().trim().max(500).optional().nullable().transform(v => v || null) }).strict()).min(1).max(500),
}).strict().refine(v => new Set(v.items.map(i => i.skuId)).size === v.items.length, { message: 'SKU khĂ´ng Ä‘Æ°á»£c trĂ¹ng.', path: ['items'] });
export const resolveTransferDiscrepancyInput = z.object({
  items: z.array(z.object({ skuId: z.string().uuid(), resolution: z.string().trim().min(3).max(500) }).strict()).min(1).max(500),
}).strict().refine(v => new Set(v.items.map(i => i.skuId)).size === v.items.length, { message: 'SKU khĂ´ng Ä‘Æ°á»£c trĂ¹ng.', path: ['items'] });

