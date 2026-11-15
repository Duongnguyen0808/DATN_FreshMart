import { z } from 'zod';

export const purchaseOrderIdInput = z.string().uuid();
export const purchaseOrderListInput = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['all', 'OPEN', 'COMPLETED']).default('all'),
  supplierId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

const createLine = z.object({
  purchasePacks: z.boolean().optional(),
  skuId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(100_000_000),
  unitCost: z.coerce.number().positive().max(999_999_999_999),
}).strict();

export const createPurchaseOrderInput = z.object({
  purchaseRequestId: z.string().uuid().optional(),
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  expectedAt: z.string().datetime({ offset: true }).optional(),
  paymentDueAt: z.string().datetime({ offset: true }).optional(),
  note: z.string().trim().max(500).optional(),
  items: z.array(createLine).min(1).max(500),
}).strict().refine(value => new Set(value.items.map(item => item.skuId)).size === value.items.length, {
  message: 'SKU không được trùng.', path: ['items'],
});

const receiptLine = z.object({
  purchasePacks: z.boolean().optional(),
  lotCode: z.string().trim().min(1).max(100).optional(),
  expiresAt: z.string().date().optional(),
  purchaseOrderItemId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(100_000_000),
}).strict();

export const receivePurchaseOrderInput = z.object({
  note: z.string().trim().max(500).optional(),
  iotEventIds: z.array(z.string().uuid()).min(1).max(500).refine(ids => new Set(ids).size === ids.length, 'Event không được trùng.').optional(),
  evidence: z.array(z.string().max(2_400_000)).max(3).default([]),
  items: z.array(receiptLine).min(1).max(500),
}).strict().refine(value => new Set(value.items.map(item => item.purchaseOrderItemId)).size === value.items.length, {
  message: 'Dòng hàng không được trùng.', path: ['items'],
});

export const supplierReturnListInput = z.object({
  q: z.string().trim().max(100).optional(),
  supplierId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export const goodsReceiptListInput = z.object({
  q: z.string().trim().max(100).optional(),
  supplierId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export const createSupplierReturnInput = z.object({
  reason: z.string().trim().min(3).max(500),
  items: z.array(z.object({ lotId: z.string().uuid().optional(), purchaseOrderItemId: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(100_000_000) }).strict()).min(1).max(500),
}).strict().refine(value => new Set(value.items.map(item => item.purchaseOrderItemId)).size === value.items.length, {
  message: 'Dòng hàng trả không được trùng.', path: ['items'],
});

