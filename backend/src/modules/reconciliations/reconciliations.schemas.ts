import { z } from 'zod';

export const reconciliationListInput = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.enum(['all', 'PAYABLE', 'RECEIVABLE']).default('all'),
  result: z.enum(['all', 'MATCHED', 'DISCREPANCY']).default('all'),
  storeId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
