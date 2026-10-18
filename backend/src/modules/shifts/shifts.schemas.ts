import { z } from 'zod';

const money = z.coerce.number().finite().min(0).max(999_999_999_999);
export const shiftIdInput = z.string().uuid();
export const shiftListInput = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['all', 'OPEN', 'PENDING_REVIEW', 'CLOSED']).default('all'),
  storeId: z.string().uuid().optional(),
  cashierId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export const shiftStaffInput = z.object({ storeId: z.string().uuid().optional() }).strict();
export const openShiftInput = z.object({
  storeId: z.string().uuid(),
  cashierId: z.string().uuid(),
  posCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,29}$/),
  name: z.string().trim().min(1).max(50),
  openingCash: money,
}).strict();
export const closeShiftInput = z.object({
  closingCash: money,
  cashExpenses: money.default(0),
  discrepancyReason: z.string().trim().max(500).optional().nullable().transform(value => value || null),
  denominations: z.array(z.object({ value: z.number().int().positive().max(10_000_000), count: z.number().int().min(0).max(100_000) }).strict()).max(30).default([]),
}).strict();
export const approveShiftInput = z.object({ managerNote: z.string().trim().max(500).optional().nullable().transform(value => value || null) }).strict();
