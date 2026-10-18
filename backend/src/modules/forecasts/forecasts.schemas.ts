import { z } from 'zod';

export const forecastInput = z.object({
  storeId: z.string().uuid(),
  horizonDays: z.coerce.number().int().refine(value => [7, 14, 30].includes(value), 'Chọn kỳ dự báo 7, 14 hoặc 30 ngày.'),
}).strict();

export const forecastHistoryInput = z.object({
  storeId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
}).strict();
