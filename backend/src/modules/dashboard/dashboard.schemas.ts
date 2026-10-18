import { z } from 'zod';
export const dashboardInput = z.object({ period: z.coerce.number().int().refine(value => [7, 30, 90].includes(value)).default(30), storeId: z.string().uuid().optional() }).strict();
