import { createHash } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../common/database.js';
import { AppError } from '../../common/app-error.js';
import type { CurrentUser } from '../auth/auth.repository.js';
import { Prisma } from '../../generated/prisma/client.js';
import { getShortageAlerts } from '../forecasts/forecasts.service.js';
import { createPurchaseOrder, getPurchaseOrder } from './purchase-orders.service.js';

export const forecastOrderInput = z.object({
  requestId: z.string().uuid(), warehouseId: z.string().uuid(), supplierId: z.string().uuid(), forecastRunId: z.string().uuid(),
  items: z.array(z.object({ skuId: z.string().uuid(), quantity: z.number().int().positive().max(100_000_000), unitCost: z.number().positive().max(999_999_999_999) }).strict()).min(1).max(100),
}).strict().refine(v => new Set(v.items.map(i => i.skuId)).size === v.items.length, 'Không chọn trùng sản phẩm.');
type Input = z.infer<typeof forecastOrderInput>;

export function uncoveredShortage(shortage: number, forecastIncoming: number, pending: number) {
  return Math.max(0, Math.ceil(shortage - Math.max(0, pending - forecastIncoming)));
}

async function warehouseFor(user: CurrentUser, id: string) {
  const warehouse = await prisma.warehouse.findUniqueOrThrow({ where: { id }, include: { store: true } });
  if (!user.globalAccess && !user.stores.some(s => s.id === warehouse.storeId)) throw new AppError(403, 'STORE_FORBIDDEN', 'Bạn không có quyền đặt hàng cho chi nhánh này.');
  if (!warehouse.active || !warehouse.store.active) throw new AppError(409, 'WAREHOUSE_INACTIVE', 'Chi nhánh hoặc kho đã ngừng hoạt động.');
  return warehouse;
}

async function pendingBySku(db: Prisma.TransactionClient, storeId: string, skuIds: string[]) {
  const rows = await db.purchaseOrderItem.findMany({ where: { skuId: { in: skuIds }, purchaseOrder: { status: 'OPEN', warehouse: { storeId } } }, select: { skuId: true, orderedQuantity: true, receivedQuantity: true } });
  const pending = new Map<string, number>();
  for (const row of rows) pending.set(row.skuId, (pending.get(row.skuId) ?? 0) + Math.max(0, row.orderedQuantity - row.receivedQuantity));
  return pending;
}

export async function forecastReplenishmentOptions(user: CurrentUser, warehouseId: string) {
  const warehouse = await warehouseFor(user, warehouseId);
  let report = await getShortageAlerts(user, { storeId: warehouse.storeId, horizonDays: 7 });
  if (!report.run) report = await getShortageAlerts(user, { storeId: warehouse.storeId, horizonDays: 14 });
  const ids = report.items.map(row => row.skuId);
  const [pending, skus, suppliers] = await Promise.all([
    pendingBySku(prisma, warehouse.storeId, ids),
    prisma.sku.findMany({ where: { id: { in: ids }, active: true, product: { active: true, archivedAt: null } }, select: { id: true, costPrice: true } }),
    prisma.supplier.findMany({ where: { active: true }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  return { warehouseId, storeName: warehouse.store.name, forecastRunId: report.run?.id ?? null, horizonDays: report.run?.horizonDays ?? 7, suppliers,
    items: report.items.filter(row => skus.some(s => s.id === row.skuId)).map(row => ({ ...row, unitCost: Number(skus.find(s => s.id === row.skuId)!.costPrice), pendingQuantity: pending.get(row.skuId) ?? 0,
      suggestedQuantity: uncoveredShortage(row.shortageQuantity, row.incomingPurchase, pending.get(row.skuId) ?? 0) })) };
}

export async function createForecastReplenishment(user: CurrentUser, input: Input) {
  const fingerprint = createHash('sha256').update(JSON.stringify({ warehouseId: input.warehouseId, supplierId: input.supplierId, forecastRunId: input.forecastRunId, items: [...input.items].sort((a,b) => a.skuId.localeCompare(b.skuId)) })).digest('hex');
  const previous = async () => {
    const row = await prisma.auditLog.findUnique({ where: { id: input.requestId } });
    if (!row) return null;
    const metadata = row.metadata as { fingerprint?: string } | null;
    if (row.action !== 'purchase_order.forecast_create' || row.actorId !== user.id || metadata?.fingerprint !== fingerprint || !row.targetId) throw new AppError(409, 'ORDER_REQUEST_REUSED', 'Yêu cầu tạo đơn đã được sử dụng. Tải lại danh sách trước khi đặt tiếp.');
    return getPurchaseOrder(user, row.targetId);
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const replay = await previous(); if (replay) return replay;
    const options = await forecastReplenishmentOptions(user, input.warehouseId);
    if (options.forecastRunId !== input.forecastRunId) throw new AppError(409, 'FORECAST_CHANGED', 'Dự báo đã thay đổi. Tải lại gợi ý trước khi tạo đơn.');
    const warehouse = await warehouseFor(user, input.warehouseId);
    if (!options.suppliers.some(s => s.id === input.supplierId)) throw new AppError(409, 'SUPPLIER_INACTIVE', 'Nhà cung cấp không còn hoạt động.');
    try {
      return await createPurchaseOrder(user, { warehouseId: input.warehouseId, supplierId: input.supplierId, note: `Bổ sung theo cảnh báo dự báo ${options.horizonDays} ngày · ${options.storeName}`.slice(0,500), items: input.items }, {
        beforeCreate: async tx => {
          const pending = await pendingBySku(tx, warehouse.storeId, input.items.map(row => row.skuId));
          for (const item of input.items) {
            const advice = options.items.find(row => row.skuId === item.skuId);
            if (!advice || item.quantity > uncoveredShortage(advice.shortageQuantity, advice.incomingPurchase, pending.get(item.skuId) ?? 0)) throw new AppError(409, 'REPLENISHMENT_CHANGED', 'Hàng đã được đặt mua hoặc số lượng vượt nhu cầu còn thiếu. Tải lại gợi ý để tránh đặt trùng.');
          }
        },
        afterCreate: async (tx, id) => { await tx.auditLog.create({ data: { id: input.requestId, actorId: user.id, action: 'purchase_order.forecast_create', targetId: id, metadata: { fingerprint, forecastRunId: input.forecastRunId } } }); },
      });
    } catch (error) {
      const replay = await previous(); if (replay) return replay;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 2) continue;
      throw error;
    }
  }
  throw new AppError(409, 'REPLENISHMENT_BUSY', 'Dữ liệu đang thay đổi. Vui lòng tải lại gợi ý.');
}
