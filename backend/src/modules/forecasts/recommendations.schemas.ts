import { z } from 'zod';

export const recommendationIdInput = z.string().uuid();
export const recommendationDecisionInput = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  quantity: z.coerce.number().int().min(1).max(100_000_000).optional(),
  note: z.string().trim().min(3).max(500),
}).strict();
