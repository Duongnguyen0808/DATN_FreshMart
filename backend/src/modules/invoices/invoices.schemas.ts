import { z } from 'zod';

const money = z.coerce.number().finite().min(0).max(999_999_999_999);
export const invoiceIdInput = z.string().uuid();
export const invoiceListInput = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['all', 'COMPLETED', 'CANCELLED']).default('all'),
  storeId: z.string().uuid().optional(), shiftId: z.string().uuid().optional(),
  from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict().refine(value => !value.from || !value.to || value.from <= value.to, { message: 'Khoảng thời gian không hợp lệ.' });

export const paymentListInput = z.object({
  q: z.string().trim().max(100).optional(),
  method: z.enum(['all', 'CASH', 'QR', 'CARD']).default('all'),
  status: z.enum(['all', 'COMPLETED', 'CANCELLED']).default('all'),
  storeId: z.string().uuid().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict().refine(value => !value.from || !value.to || value.from <= value.to, { message: 'Khoảng thời gian không hợp lệ.' });

export const createInvoiceInput = z.object({
  shiftId: z.string().uuid(),
  warehouseId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional().nullable(),
  customerName: z.string().trim().max(120).optional().nullable().transform(value => value || null),
  customerPhone: z.string().trim().max(20).regex(/^[0-9+ .()-]*$/).optional().nullable().transform(value => value || null),
  discount: money.default(0), creditAmount: money.default(0), creditDueDate: z.string().date().optional().nullable(), note: z.string().trim().max(500).optional().nullable().transform(value => value || null),
  items: z.array(z.object({ skuId: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(100_000) }).strict()).min(1).max(100),
  payments: z.array(z.object({ method: z.enum(['CASH', 'QR', 'CARD']), amount: money.refine(value => value > 0), reference: z.string().trim().max(100).optional().nullable().transform(value => value || null) }).strict()).max(3),
}).strict().superRefine((value, context) => {
  if (new Set(value.items.map(item => item.skuId)).size !== value.items.length) context.addIssue({ code: 'custom', path: ['items'], message: 'Mỗi SKU chỉ được xuất hiện một lần.' });
  if (new Set(value.payments.map(payment => payment.method)).size !== value.payments.length) context.addIssue({ code: 'custom', path: ['payments'], message: 'Mỗi phương thức thanh toán chỉ được xuất hiện một lần.' });
  if (value.creditAmount > 0 && !value.customerId) context.addIssue({ code: 'custom', path: ['customerId'], message: 'Bán ghi nợ phải chọn khách hàng.' });
  if (value.creditAmount > 0 && !value.creditDueDate) context.addIssue({ code: 'custom', path: ['creditDueDate'], message: 'Bán ghi nợ phải có ngày đến hạn.' });
});

export const cancelInvoiceInput = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

export const createSalesReturnInput = z.object({
  reason: z.string().trim().min(3).max(500),
  refundMethod: z.enum(['CASH', 'QR', 'CARD']),
  refundReference: z.string().trim().max(100).optional().nullable().transform(value => value || null),
  items: z.array(z.object({
    invoiceItemId: z.string().uuid(),
    quantity: z.coerce.number().int().min(1).max(100_000),
    restock: z.boolean().default(true),
  }).strict()).min(1).max(100),
}).strict().superRefine((value, context) => {
  if (new Set(value.items.map(item => item.invoiceItemId)).size !== value.items.length) context.addIssue({ code: 'custom', path: ['items'], message: 'Mỗi dòng hóa đơn chỉ được chọn một lần.' });
});

export const salesReturnListInput = z.object({
  q: z.string().trim().max(100).optional(),
  refundMethod: z.enum(['all', 'CASH', 'QR', 'CARD']).default('all'),
  storeId: z.string().uuid().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict().refine(value => !value.from || !value.to || value.from <= value.to, { message: 'Khoảng thời gian không hợp lệ.' });
