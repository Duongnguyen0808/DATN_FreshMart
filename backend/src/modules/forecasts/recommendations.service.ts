import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../common/database.js';
import { nextDailyCode } from '../../common/daily-code.js';
import { AppError } from '../../common/app-error.js';
import type { CurrentUser } from '../auth/auth.repository.js';
import { getLatestForecast, getShortageAlerts, vietnamDay } from './forecasts.service.js';
import type { forecastInput } from './forecasts.schemas.js';
import type { recommendationDecisionInput } from './recommendations.schemas.js';
import { planReplenishment } from './recommendation-plan.js';
import type { z } from 'zod';

type ForecastFilter = z.infer<typeof forecastInput>;
const include = {
  sku: { select: { code: true, product: { select: { code: true, name: true, unit: true, imageUrl: true } } } },
  targetStore: { select: { id: true, code: true, name: true } },
  sourceWarehouse: { select: { id: true, code: true, name: true, store: { select: { id: true, code: true, name: true } } } },
  destinationWarehouse: { select: { id: true, code: true, name: true } },
  transfer: { select: { id: true, code: true, status: true } },
  purchaseRequest: { select: { id: true, code: true, status: true } },
  decidedBy: { select: { id: true, name: true } },
} as const;

function has(user: CurrentUser, permission: string) { return user.permissions.includes(permission); }
function assertManager(user: CurrentUser, type: string, approval: boolean) {
  const prefix = type === 'TRANSFER' ? 'transfers' : 'purchase_requests';
  if (!has(user, `${prefix}.approve`) || (approval && !has(user, `${prefix}.create`))) {
    throw new AppError(403, 'RECOMMENDATION_FORBIDDEN', 'Bạn không có quyền duyệt và tạo phiếu nghiệp vụ tương ứng.');
  }
}

export async function listRecommendations(user: CurrentUser, input: ForecastFilter) {
  const forecast = await getLatestForecast(user, input);
  if (!forecast.run) return { store: forecast.store, run: null, items: [] };
  const [items, alerts] = await Promise.all([
    prisma.inventoryRecommendation.findMany({ where: { forecastRunId: forecast.run.id }, include, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
    getShortageAlerts(user, input),
  ]);
  const priorityBySku = new Map(alerts.items.map(item => [item.skuId, item.severity]));
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return { store: forecast.store, run: forecast.run, items: items.map(row => ({
    ...row, priority: priorityBySku.get(row.skuId) ?? null,
    skuCode: row.sku.code, productCode: row.sku.product.code, imageUrl: row.sku.product.imageUrl, productName: row.sku.product.name, unit: row.sku.product.unit,
  })).sort((a, b) => (a.priority ? rank[a.priority] : 3) - (b.priority ? rank[b.priority] : 3) || Number(a.type === 'PURCHASE') - Number(b.type === 'PURCHASE') || b.suggestedQuantity - a.suggestedQuantity) };
}

export async function generateRecommendations(user: CurrentUser, input: ForecastFilter) {
  const alerts = await getShortageAlerts(user, input);
  if (!alerts.run) throw new AppError(409, 'FORECAST_REQUIRED', 'Hãy tạo dự báo nhu cầu trước khi sinh đề xuất.');
  if (alerts.run.forecastTo < vietnamDay(new Date())) throw new AppError(409, 'FORECAST_EXPIRED', 'Kỳ dự báo đã kết thúc. Vui lòng cập nhật dự báo.');
  const skuIds = alerts.items.map(item => item.skuId);
  if (!skuIds.length) return listRecommendations(user, input);

  const [stocks, pendingTransfers, pendingRecommendations, inboundTransfers, purchaseRequests] = await Promise.all([
    prisma.inventory.findMany({ where: { skuId: { in: skuIds }, warehouse: { active: true, store: { active: true } } }, select: { skuId: true, warehouseId: true, onHand: true, reserved: true, safetyStock: true, warehouse: { select: { code: true, storeId: true } } } }),
    prisma.stockTransferItem.findMany({ where: { skuId: { in: skuIds }, transfer: { status: { in: ['PENDING_APPROVAL', 'APPROVED'] } } }, select: { skuId: true, requestedQuantity: true, approvedQuantity: true, transfer: { select: { sourceWarehouseId: true } } } }),
    prisma.inventoryRecommendation.findMany({ where: { skuId: { in: skuIds }, type: 'TRANSFER', status: 'PENDING' }, select: { skuId: true, sourceWarehouseId: true, suggestedQuantity: true } }),
    prisma.stockTransferItem.findMany({ where: { skuId: { in: skuIds }, transfer: { destinationWarehouse: { storeId: input.storeId }, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } } }, select: { skuId: true, requestedQuantity: true, approvedQuantity: true } }),
    prisma.purchaseRequestItem.findMany({ where: { skuId: { in: skuIds }, purchaseRequest: { storeId: input.storeId, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } } }, select: { skuId: true, requestedQuantity: true, approvedQuantity: true } }),
  ]);
  const reserved = new Map<string, number>();
  const key = (warehouseId: string, skuId: string) => `${warehouseId}:${skuId}`;
  for (const row of pendingTransfers) {
    const id = key(row.transfer.sourceWarehouseId, row.skuId);
    reserved.set(id, (reserved.get(id) ?? 0) + (row.approvedQuantity ?? row.requestedQuantity));
  }
  for (const row of pendingRecommendations) if (row.sourceWarehouseId) {
    const id = key(row.sourceWarehouseId, row.skuId);
    reserved.set(id, (reserved.get(id) ?? 0) + row.suggestedQuantity);
  }
  const committedInbound = new Map<string, number>();
  for (const row of [...inboundTransfers, ...purchaseRequests]) committedInbound.set(row.skuId, (committedInbound.get(row.skuId) ?? 0) + (row.approvedQuantity ?? row.requestedQuantity));
  const allowedStores = new Set(user.stores.map(store => store.id));
  const sourceStoreIds = [...new Set(stocks.map(row => row.warehouse.storeId).filter(storeId => storeId !== input.storeId && (user.globalAccess || allowedStores.has(storeId))))];
  const sourceRuns = await prisma.forecastRun.findMany({
    where: { storeId: { in: sourceStoreIds }, horizonDays: input.horizonDays, forecastTo: { gte: vietnamDay(new Date()) } },
    distinct: ['storeId'], orderBy: { generatedAt: 'desc' },
    include: { forecasts: { where: { skuId: { in: skuIds } }, select: { skuId: true, predictedQuantity: true } } },
  });
  const sourceDemand = new Map(sourceRuns.flatMap(run => run.forecasts.map(row => [`${run.storeId}:${row.skuId}`, row.predictedQuantity] as const)));
  const proposals: Prisma.InventoryRecommendationCreateManyInput[] = [];
  for (const alert of alerts.items) {
    const destination = stocks.filter(row => row.skuId === alert.skuId && row.warehouse.storeId === input.storeId)
      .sort((a, b) => a.warehouse.code.localeCompare(b.warehouse.code))[0];
    const sourceRows = stocks.filter(row => row.skuId === alert.skuId && row.warehouse.storeId !== input.storeId && (user.globalAccess || allowedStores.has(row.warehouse.storeId)))
      .map(row => ({ warehouseId: row.warehouseId, storeId: row.warehouse.storeId, surplus: Math.max(0, row.onHand - row.reserved - row.safetyStock - (reserved.get(key(row.warehouseId, row.skuId)) ?? 0)) }))
      .sort((a, b) => b.surplus - a.surplus);
    const sourceCapacity = new Map<string, number>();
    for (const source of sourceRows) sourceCapacity.set(source.storeId, (sourceCapacity.get(source.storeId) ?? 0) + source.surplus);
    for (const [storeId, total] of sourceCapacity) sourceCapacity.set(storeId, Math.max(0, total - (sourceDemand.get(`${storeId}:${alert.skuId}`) ?? 0)));
    const sources = sourceRows.map(source => {
      const surplus = Math.min(source.surplus, sourceCapacity.get(source.storeId) ?? 0);
      sourceCapacity.set(source.storeId, (sourceCapacity.get(source.storeId) ?? 0) - surplus);
      return { warehouseId: source.warehouseId, surplus };
    });
    const remainingNeed = Math.max(0, alert.shortageQuantity - (committedInbound.get(alert.skuId) ?? 0));
    const plan = planReplenishment(remainingNeed, destination ? sources : []);
    for (const transfer of plan.transfers) proposals.push({
      dedupeKey: `${alerts.run.id}:${alert.skuId}:TRANSFER:${transfer.sourceWarehouseId}`,
      forecastRunId: alerts.run.id, targetStoreId: input.storeId, skuId: alert.skuId,
      type: 'TRANSFER', status: 'PENDING', suggestedQuantity: transfer.quantity,
      sourceWarehouseId: transfer.sourceWarehouseId, destinationWarehouseId: destination!.warehouseId, generatedById: user.id,
    });
    if (plan.purchaseQuantity > 0) proposals.push({
      dedupeKey: `${alerts.run.id}:${alert.skuId}:PURCHASE`, forecastRunId: alerts.run.id,
      targetStoreId: input.storeId, skuId: alert.skuId, type: 'PURCHASE', status: 'PENDING',
      suggestedQuantity: plan.purchaseQuantity, generatedById: user.id,
    });
  }
  if (!proposals.length) return listRecommendations(user, input);
  try {
    await prisma.$transaction(async tx => {
      await tx.inventoryRecommendation.createMany({ data: proposals, skipDuplicates: true });
      if (proposals.length) await tx.auditLog.create({ data: { actorId: user.id, action: 'recommendation.generate', targetId: alerts.run!.id } });
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code))) throw error;
  }
  return listRecommendations(user, input);
}

export async function decideRecommendation(user: CurrentUser, id: string, input: z.infer<typeof recommendationDecisionInput>) {
  const current = await prisma.inventoryRecommendation.findUnique({ where: { id }, include: { forecastRun: true, sourceWarehouse: { select: { storeId: true } }, sku: { select: { costPrice: true, code: true, active: true, product: { select: { active: true } } } } } });
  if (!current) throw new AppError(404, 'RECOMMENDATION_NOT_FOUND', 'Không tìm thấy đề xuất.');
  if (!user.globalAccess && !user.stores.some(store => store.id === current.targetStoreId)) throw new AppError(403, 'STORE_FORBIDDEN', 'Bạn không được xử lý đề xuất tại chi nhánh này.');
  if (current.type === 'TRANSFER' && !user.globalAccess && !user.stores.some(store => store.id === current.sourceWarehouse?.storeId)) throw new AppError(403, 'STORE_FORBIDDEN', 'Bạn không được xử lý kho nguồn của đề xuất.');
  assertManager(user, current.type, input.action === 'APPROVE');
  if (current.status !== 'PENDING') throw new AppError(409, 'RECOMMENDATION_DECIDED', 'Đề xuất đã được xử lý.');
  if (!current.sku.active || !current.sku.product.active) throw new AppError(409, 'SKU_INACTIVE', 'SKU đã ngừng kinh doanh.');
  if (input.action === 'REJECT') {
    await prisma.$transaction(async tx => {
      const changed = await tx.inventoryRecommendation.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'REJECTED', decidedById: user.id, decidedAt: new Date(), decisionNote: input.note } });
      if (changed.count !== 1) throw new AppError(409, 'RECOMMENDATION_DECIDED', 'Đề xuất vừa được người khác xử lý.');
      await tx.auditLog.create({ data: { actorId: user.id, action: 'recommendation.reject', targetId: id } });
    });
    return prisma.inventoryRecommendation.findUniqueOrThrow({ where: { id }, include });
  }
  const quantity = input.quantity ?? current.suggestedQuantity;
  if (current.type === 'TRANSFER' && quantity > current.suggestedQuantity) throw new AppError(400, 'QUANTITY_EXCEEDS_SURPLUS', 'Số lượng chuyển không được vượt lượng dư đã đề xuất.');
  const latest = await getLatestForecast(user, { storeId: current.targetStoreId, horizonDays: current.forecastRun.horizonDays });
  if (latest.run?.id !== current.forecastRunId) throw new AppError(409, 'FORECAST_OUTDATED', 'Đã có lần dự báo mới. Vui lòng tạo đề xuất từ dự báo mới nhất.');
  if (current.forecastRun.forecastTo < vietnamDay(new Date())) throw new AppError(409, 'FORECAST_EXPIRED', 'Kỳ dự báo đã kết thúc. Vui lòng cập nhật dự báo.');
  const alerts = await getShortageAlerts(user, { storeId: current.targetStoreId, horizonDays: current.forecastRun.horizonDays });
  const alert = alerts.items.find(row => row.skuId === current.skuId);
  if (!alert) throw new AppError(409, 'SHORTAGE_RESOLVED', 'SKU không còn thiếu hàng theo tồn hiện tại.');

  try {
    await prisma.$transaction(async tx => {
      const pending = await tx.inventoryRecommendation.findUniqueOrThrow({ where: { id }, select: { status: true } });
      if (pending.status !== 'PENDING') throw new AppError(409, 'RECOMMENDATION_DECIDED', 'Đề xuất vừa được người khác xử lý.');
      const [pendingInboundTransfers, pendingPurchases] = await Promise.all([
        tx.stockTransferItem.findMany({ where: { skuId: current.skuId, transfer: { destinationWarehouse: { storeId: current.targetStoreId }, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } } }, select: { requestedQuantity: true, approvedQuantity: true } }),
        tx.purchaseRequestItem.findMany({ where: { skuId: current.skuId, purchaseRequest: { storeId: current.targetStoreId, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } } }, select: { requestedQuantity: true, approvedQuantity: true } }),
      ]);
      const committedInbound = [...pendingInboundTransfers, ...pendingPurchases].reduce((sum, row) => sum + (row.approvedQuantity ?? row.requestedQuantity), 0);
      if (quantity > Math.max(0, alert.shortageQuantity - committedInbound)) throw new AppError(409, 'NEED_CHANGED', 'Số lượng còn thiếu đã thay đổi hoặc đã có phiếu chờ. Vui lòng tạo đề xuất từ dự báo mới.');
      let transferId: string | undefined;
      let purchaseRequestId: string | undefined;
      if (current.type === 'TRANSFER') {
        if (!current.sourceWarehouseId || !current.destinationWarehouseId) throw new AppError(409, 'WAREHOUSE_REQUIRED', 'Đề xuất thiếu kho nguồn hoặc kho đích.');
        const source = await tx.inventory.findUnique({ where: { warehouseId_skuId: { warehouseId: current.sourceWarehouseId, skuId: current.skuId } }, include: { warehouse: { select: { active: true, storeId: true, store: { select: { active: true } } } } } });
        const destination = await tx.inventory.findUnique({ where: { warehouseId_skuId: { warehouseId: current.destinationWarehouseId, skuId: current.skuId } }, include: { warehouse: { select: { active: true, store: { select: { active: true } } } } } });
        if (!source || !destination || !source.warehouse.active || !destination.warehouse.active || !source.warehouse.store.active || !destination.warehouse.store.active) throw new AppError(409, 'WAREHOUSE_UNAVAILABLE', 'Kho nguồn hoặc kho đích không còn hoạt động.');
        const pendingItems = await tx.stockTransferItem.findMany({ where: { skuId: current.skuId, transfer: { sourceWarehouseId: current.sourceWarehouseId, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } } }, select: { requestedQuantity: true, approvedQuantity: true } });
        const committed = pendingItems.reduce((sum, item) => sum + (item.approvedQuantity ?? item.requestedQuantity), 0);
        if (source.onHand - source.reserved - source.safetyStock - committed < quantity) throw new AppError(409, 'SOURCE_SURPLUS_CHANGED', 'Kho nguồn không còn đủ hàng dư sau khi giữ tồn an toàn và các phiếu đang chờ.');
        const sourceStocks = await tx.inventory.findMany({ where: { skuId: current.skuId, warehouse: { storeId: source.warehouse.storeId, active: true } }, select: { warehouseId: true, onHand: true, reserved: true, safetyStock: true } });
        const sourceTransfers = await tx.stockTransferItem.findMany({ where: { skuId: current.skuId, transfer: { sourceWarehouse: { storeId: source.warehouse.storeId }, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } } }, select: { requestedQuantity: true, approvedQuantity: true, transfer: { select: { sourceWarehouseId: true } } } });
        const committedByWarehouse = new Map<string, number>();
        for (const item of sourceTransfers) committedByWarehouse.set(item.transfer.sourceWarehouseId, (committedByWarehouse.get(item.transfer.sourceWarehouseId) ?? 0) + (item.approvedQuantity ?? item.requestedQuantity));
        const sourceRun = await tx.forecastRun.findFirst({ where: { storeId: source.warehouse.storeId, horizonDays: current.forecastRun.horizonDays, forecastTo: { gte: vietnamDay(new Date()) } }, orderBy: { generatedAt: 'desc' }, include: { forecasts: { where: { skuId: current.skuId }, select: { predictedQuantity: true } } } });
        const predictedDemand = sourceRun?.forecasts[0]?.predictedQuantity ?? 0;
        const storeSurplus = sourceStocks.reduce((sum, stock) => sum + Math.max(0, stock.onHand - stock.reserved - stock.safetyStock - (committedByWarehouse.get(stock.warehouseId) ?? 0)), 0) - predictedDemand;
        if (storeSurplus < quantity) throw new AppError(409, 'SOURCE_SURPLUS_CHANGED', 'Chi nhánh nguồn cần giữ hàng cho nhu cầu dự báo của mình. Vui lòng tạo đề xuất mới.');
        const transfer = await tx.stockTransfer.create({ data: {
          code: await nextDailyCode(tx, 'DC', dayPrefix => tx.stockTransfer.findMany({ where: { code: { startsWith: `${dayPrefix}-` } }, select: { code: true } })), sourceWarehouseId: current.sourceWarehouseId,
          destinationWarehouseId: current.destinationWarehouseId, createdById: user.id,
          reason: `Theo đề xuất ${id}: ${input.note}`.slice(0, 500),
          items: { create: [{ skuId: current.skuId, requestedQuantity: quantity, costPrice: current.sku.costPrice }] },
        } });
        transferId = transfer.id;
      } else {
        const store = await tx.store.findUnique({ where: { id: current.targetStoreId }, select: { active: true } });
        if (!store?.active) throw new AppError(409, 'STORE_INACTIVE', 'Chi nhánh đã ngừng hoạt động.');
        const request = await tx.purchaseRequest.create({ data: {
          code: await nextDailyCode(tx, 'PR', dayPrefix => tx.purchaseRequest.findMany({ where: { code: { startsWith: `${dayPrefix}-` } }, select: { code: true } })), storeId: current.targetStoreId,
          createdById: user.id, reason: `Theo đề xuất ${id}: ${input.note}`.slice(0, 500),
          items: { create: [{ skuId: current.skuId, requestedQuantity: quantity }] },
        } });
        purchaseRequestId = request.id;
      }
      const changed = await tx.inventoryRecommendation.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPROVED', finalQuantity: quantity, decidedById: user.id, decidedAt: new Date(), decisionNote: input.note, transferId, purchaseRequestId } });
      if (changed.count !== 1) throw new AppError(409, 'RECOMMENDATION_DECIDED', 'Đề xuất vừa được người khác xử lý.');
      await tx.auditLog.create({ data: { actorId: user.id, action: 'recommendation.approve', targetId: id } });
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) throw new AppError(409, 'RECOMMENDATION_CONFLICT', 'Dữ liệu vừa thay đổi. Vui lòng tải lại và thử lại.');
    throw error;
  }
  return prisma.inventoryRecommendation.findUniqueOrThrow({ where: { id }, include });
}
