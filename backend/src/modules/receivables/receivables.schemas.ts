import { z } from 'zod';

export const receivableIdInput = z.string().uuid();
export const receivableListInput = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['all', 'OPEN', 'PARTIALLY_PAID', 'PAID', 'DUE_SOON', 'OVERDUE']).default('all'),
  customerId: z.string().uuid().optional(),
  storeId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export const createReceivablePaymentInput = z.object({
  amount: z.coerce.number().positive().max(999_999_999_999),
  method: z.enum(['CASH', 'QR', 'CARD']),
  reference: z.string().trim().max(100).optional().nullable().transform(value => value || null),
  note: z.string().trim().max(500).optional().nullable().transform(value => value || null),
}).strict().superRefine((value, context) => {
  if (value.method !== 'CASH' && !value.reference) context.addIssue({ code: 'custom', path: ['reference'], message: 'Thu tiền QR/thẻ cần mã tham chiếu.' });
});
export const customerReceivablePaymentInput = z.object({
  method: z.enum(['CASH', 'QR', 'CARD']),
  reference: z.string().trim().max(100).optional().nullable().transform(value => value || null),
  note: z.string().trim().max(500).optional().nullable().transform(value => value || null),
  allocations: z.array(z.object({ receivableId: z.string().uuid(), amount: z.coerce.number().positive().max(999_999_999_999) }).strict()).min(1).max(100),
}).strict().superRefine((value, context) => {
  if (value.method !== 'CASH' && !value.reference) context.addIssue({ code: 'custom', path: ['reference'], message: 'Thu tiền QR/thẻ cần mã tham chiếu.' });
  if (new Set(value.allocations.map(row => row.receivableId)).size !== value.allocations.length) context.addIssue({ code: 'custom', path: ['allocations'], message: 'Hóa đơn phân bổ bị trùng.' });
});
