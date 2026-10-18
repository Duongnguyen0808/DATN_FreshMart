import { z } from 'zod';
export const inventoryIdInput = z.string().uuid();
export const safetyStockInput = z.object({ safetyStock: z.coerce.number().int().min(0).max(100_000_000) }).strict();
export const stockAdjustmentInput = z.object({ actualQuantity: z.number().int().min(0).max(100_000_000), reason: z.string().trim().min(5).max(500) }).strict();
export const inventoryListInput = z.object({
  q: z.string().trim().max(100).optional(), storeId: z.string().uuid().optional(), warehouseId: z.string().uuid().optional(), categoryId: z.string().uuid().optional(),
  status: z.enum(['all', 'AVAILABLE', 'LOW', 'OUT']).default('all'), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export const transactionListInput = z.object({
  q: z.string().trim().max(100).optional(), warehouseId: z.string().uuid().optional(), skuId: z.string().uuid().optional(), type: z.enum(['all', 'OPENING', 'SALE', 'SALE_CANCEL', 'SALE_RETURN', 'STOCKTAKE', 'STOCK_ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN', 'PURCHASE_RECEIPT']).default('all'),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
