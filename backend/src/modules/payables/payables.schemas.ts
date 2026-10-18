import { z } from 'zod';
export const payableIdInput = z.string().uuid();
export const payableListInput = z.object({ q: z.string().trim().max(100).optional(), status: z.enum(['all', 'OPEN', 'PARTIALLY_PAID', 'PAID', 'DUE_SOON', 'OVERDUE']).default('all'), supplierId: z.string().uuid().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }).strict();
export const createPayablePaymentInput = z.object({ amount: z.coerce.number().positive().max(999_999_999_999), method: z.enum(['BANK_TRANSFER', 'CASH']), reference: z.string().trim().max(100).optional(), note: z.string().trim().max(500).optional() }).strict();
