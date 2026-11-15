import { expired, warehouseToday } from '../inventory/lot-stock.js';
import { supplyTiming } from './supply-timing.js';
import { planReplenishment } from './recommendation-plan.js';
import {
  evaluateFefoTransferCandidate,
  FEFO_POLICY_CONFIG,
  simulateFefoLotsForSku,
  type ForecastAllocationStatus,
} from './fefo-simulation.js';
import { z } from 'zod';
import { prisma } from '../../common/database.js';
import { toJson, parseJson } from '../../common/json-field.js';
import { AppError } from '../../common/app-error.js';
import { env } from '../../config/env.js';
import type { CurrentUser } from '../auth/auth.repository.js';
import type { forecastHistoryInput, forecastInput } from './forecasts.schemas.js';
import { assessShortage } from './shortage-rule.js';

// Dùng lịch sử vận hành đủ dài để kiểm tra mô hình trên chuỗi thời gian thực.
// Up to one year lets 30-day forecasts accumulate >= 8 disjoint calibration blocks.
const HISTORY_DAYS = 366;
export const vietnamDay = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = (type: string) => Number(parts.find(part => part.type === type)!.value);
  return new Date(Date.UTC(value('year'), value('month') - 1, value('day')));
};
const aiResponse = z.object({
  model: z.string().min(1),
  items: z.array(z.object({
    skuId: z.string().uuid(),
    predictedQuantity: z.number().int().min(0),
    safetyStock: z.object({ quantity: z.number().int().nonnegative().nullable(), source: z.enum(['BACKTEST_P95', 'TEMPORARY_CONFIG']), sampleCount: z.number().int().nonnegative(), serviceLevel: z.literal(0.95), horizonDays: z.number().int().positive(), basis: z.string() }),
    dataQuality: z.enum(['SUFFICIENT', 'SPARSE', 'NO_SALES']),
  })),
});

type Input = z.infer<typeof forecastInput>;
type HistoryInput = z.infer<typeof forecastHistoryInput>;

async function assertStore(user: CurrentUser, storeId: string) {
  if (!user.globalAccess && !user.stores.some(store => store.id === storeId)) throw new AppError(403, 'STORE_FORBIDDEN', 'Bạn không được xem dự báo của chi nhánh này.');
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true, code: true, name: true, active: true } });
  if (!store || !store.active) throw new AppError(404, 'STORE_NOT_FOUND', 'Không tìm thấy chi nhánh đang hoạt động.');
  return store;
}

export async function getLatestForecast(user: CurrentUser, input: Input) {
  const store = await assertStore(user, input.storeId);
  const run = await prisma.forecastRun.findFirst({
    where: { storeId: input.storeId, horizonDays: input.horizonDays },
    orderBy: { generatedAt: 'desc' },
    include: { forecasts: { include: { sku: { select: { code: true, costPrice: true, sellingPrice: true, product: { select: { id: true, code: true, name: true, unit: true, imageUrl: true, purchaseUnit: true, purchasePackSize: true, leadTimeDays: true } } } } }, orderBy: { predictedQuantity: 'desc' } } },
  });
  if (!run) return { store, run: null, items: [] };
  return {
    store,
    run: { id: run.id, model: run.model, generatedAt: run.generatedAt, horizonDays: run.horizonDays, historyDays: run.historyDays, forecastFrom: run.forecastFrom, forecastTo: run.forecastTo },
    items: run.forecasts.map(row => ({
      skuId: row.skuId, skuCode: row.sku.code, costPrice: Number(row.sku.costPrice), sellingPrice: Number(row.sku.sellingPrice), productId: row.sku.product.id, productCode: row.sku.product.code, imageUrl: row.sku.product.imageUrl, productName: row.sku.product.name, unit: row.sku.product.unit, purchaseUnit: row.sku.product.purchaseUnit, purchasePackSize: row.sku.product.purchasePackSize, leadTimeDays: row.sku.product.leadTimeDays,
      predictedQuantity: row.predictedQuantity, observedQuantity: row.observedQuantity,
      dataQuality: row.dataQuality, availableAtRun: row.availableAtRun, safetyStockAtRun: row.safetyStockAtRun, safetyStockEvidence: parseJson(row.safetyStockEvidence),
    })),
  };
}

export async function getForecastById(user: CurrentUser, id: string) {
  const run = await prisma.forecastRun.findUnique({
    where: { id },
    include: { forecasts: { include: { sku: { select: { code: true, product: { select: { id: true, code: true, name: true, unit: true, imageUrl: true, purchaseUnit: true, purchasePackSize: true, leadTimeDays: true } } } } }, orderBy: { predictedQuantity: 'desc' } } },
  });
  if (!run) throw new AppError(404, 'FORECAST_NOT_FOUND', 'Không tìm thấy lần dự báo.');
  const store = await assertStore(user, run.storeId);
  return {
    store,
    run: { id: run.id, model: run.model, generatedAt: run.generatedAt, horizonDays: run.horizonDays, historyDays: run.historyDays, forecastFrom: run.forecastFrom, forecastTo: run.forecastTo },
    items: run.forecasts.map(row => ({
      skuId: row.skuId, skuCode: row.sku.code, productId: row.sku.product.id, productCode: row.sku.product.code, imageUrl: row.sku.product.imageUrl, productName: row.sku.product.name, unit: row.sku.product.unit, purchaseUnit: row.sku.product.purchaseUnit, purchasePackSize: row.sku.product.purchasePackSize, leadTimeDays: row.sku.product.leadTimeDays,
      predictedQuantity: row.predictedQuantity, observedQuantity: row.observedQuantity,
      dataQuality: row.dataQuality, availableAtRun: row.availableAtRun, safetyStockAtRun: row.safetyStockAtRun, safetyStockEvidence: parseJson(row.safetyStockEvidence),
    })),
  };
}

export async function listForecastRuns(user: CurrentUser, input: HistoryInput) {
  const store = await assertStore(user, input.storeId);
  const where = { storeId: input.storeId };
  const [runs, total] = await Promise.all([
    prisma.forecastRun.findMany({ where, orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }], skip: (input.page - 1) * input.pageSize, take: input.pageSize,
      select: { id: true, model: true, generatedAt: true, horizonDays: true, historyDays: true, forecastFrom: true, forecastTo: true, _count: { select: { forecasts: true } } } }),
    prisma.forecastRun.count({ where }),
  ]);
  const totals = runs.length ? await prisma.demandForecast.groupBy({ by: ['runId'], where: { runId: { in: runs.map(run => run.id) } }, _sum: { predictedQuantity: true } }) : [];
  const predictedByRun = new Map(totals.map(row => [row.runId, row._sum.predictedQuantity ?? 0]));
  return { store, items: runs.map(({ _count, ...run }) => ({ ...run, skuCount: _count.forecasts, predictedQuantity: predictedByRun.get(run.id) ?? 0 })), pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.max(1, Math.ceil(total / input.pageSize)) } };
}

export async function createForecast(user: CurrentUser, input: Input) {
  await assertStore(user, input.storeId);
  const stocks = await prisma.inventory.findMany({
    where: { warehouse: { storeId: input.storeId, active: true }, sku: { active: true, product: { active: true } } },
    select: { lots: true, skuId: true, onHand: true, reserved: true, safetyStock: true },
  });
  const stockBySku = new Map<string, { available: number; safetyStock: number }>();
  for (const stock of stocks) {
    const previous = stockBySku.get(stock.skuId) ?? { available: 0, safetyStock: 0 };
    previous.available += Math.max(0, stock.onHand - stock.reserved - stock.lots.filter(lot => lot.status === "QUARANTINE" || expired(lot.expiresAt)).reduce((sum, lot) => sum + lot.quantity, 0));
    previous.safetyStock += stock.safetyStock;
    stockBySku.set(stock.skuId, previous);
  }
  if (!stockBySku.size) throw new AppError(409, 'NO_STOCK_SKUS', 'Chi nhánh chưa có SKU trong kho để dự báo.');
  if (stockBySku.size > 2000) throw new AppError(400, 'TOO_MANY_SKUS', 'Chỉ hỗ trợ tối đa 2.000 SKU mỗi lần dự báo.');

  const lastDay = vietnamDay(new Date()); lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  const forecastFrom = new Date(lastDay); forecastFrom.setUTCDate(forecastFrom.getUTCDate() + 1);
  const forecastTo = new Date(forecastFrom); forecastTo.setUTCDate(forecastTo.getUTCDate() + input.horizonDays - 1);
  const firstDay = new Date(lastDay); firstDay.setUTCDate(firstDay.getUTCDate() - HISTORY_DAYS + 1);
  const firstInstant = new Date(firstDay.getTime() - 7 * 3_600_000);
  const endOfLastDay = new Date(lastDay.getTime() + 17 * 3_600_000 - 1);
  const sales = await prisma.invoiceItem.findMany({
    where: { skuId: { in: [...stockBySku.keys()] }, invoice: { storeId: input.storeId, status: 'COMPLETED', completedAt: { gte: firstInstant, lte: endOfLastDay } } },
    select: { skuId: true, quantity: true, salesReturnItems: { select: { quantity: true } }, invoice: { select: { completedAt: true } } },
  });
  const series = new Map([...stockBySku.keys()].map(id => [id, Array<number>(HISTORY_DAYS).fill(0)]));
  for (const row of sales) {
    const day = vietnamDay(row.invoice.completedAt).getTime();
    const index = Math.round((day - firstDay.getTime()) / 86_400_000);
    if (index < 0 || index >= HISTORY_DAYS) continue;
    const values = series.get(row.skuId)!;
    values[index] += Math.max(0, row.quantity - row.salesReturnItems.reduce((sum, item) => sum + item.quantity, 0));
  }
  let prediction: z.infer<typeof aiResponse>;
  try {
    const response = await fetch(`${env.AI_SERVICE_URL.replace(/\/$/, '')}/forecast/demand`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({ last_day: lastDay.toISOString().slice(0, 10), horizon_days: input.horizonDays, items: [...series].map(([skuId, dailySales]) => ({ sku_id: skuId, daily_sales: dailySales })) }),
    });
    if (!response.ok) throw new Error(`AI service returned ${response.status}`);
    prediction = aiResponse.parse(await response.json());
  } catch {
    throw new AppError(503, 'AI_SERVICE_UNAVAILABLE', 'Dịch vụ dự báo chưa sẵn sàng. Vui lòng khởi động AI service rồi thử lại.');
  }
  if (prediction.items.length !== series.size || new Set(prediction.items.map(item => item.skuId)).size !== series.size || prediction.items.some(item => !series.has(item.skuId))) {
    throw new AppError(502, 'AI_RESPONSE_INVALID', 'Dịch vụ dự báo trả về dữ liệu SKU không khớp.');
  }
  await prisma.$transaction(async tx => {
    await tx.forecastRun.create({ data: {
      storeId: input.storeId, horizonDays: input.horizonDays, historyDays: HISTORY_DAYS, model: prediction.model, forecastFrom, forecastTo,
      forecasts: { create: prediction.items.map(item => ({
        skuId: item.skuId, predictedQuantity: item.predictedQuantity, dataQuality: item.dataQuality,
        observedQuantity: series.get(item.skuId)!.reduce((sum, value) => sum + value, 0),
        availableAtRun: stockBySku.get(item.skuId)!.available, safetyStockAtRun: item.safetyStock.quantity ?? stockBySku.get(item.skuId)!.safetyStock,
        safetyStockEvidence: toJson({ ...item.safetyStock, configuredQuantity: stockBySku.get(item.skuId)!.safetyStock }),
      })) },
    } });
    await tx.inventoryRecommendation.updateMany({ where: { targetStoreId: input.storeId, status: 'PENDING' }, data: { status: 'SUPERSEDED' } });
  });
  return getLatestForecast(user, input);
}

export type SmartRebalanceTransferSource = {
  sourceWarehouseId: string;
  sourceWarehouseCode: string;
  sourceWarehouseName: string;
  sourceStoreId: string;
  sourceStoreName: string;
  availableStock: number;
  ownRequired: number;
  surplusAvailable: number;
  suggestedTransferQty: number;
};

export type SmartRebalancingPlan = {
  totalShortage: number;
  totalTransferQty: number;
  remainingPurchaseQty: number;
  unitCost: number;
  estimatedCapitalSaved: number;
  strategy: 'FULL_TRANSFER' | 'HYBRID_TRANSFER_PURCHASE' | 'FULL_PURCHASE' | 'NONE';
  headline: string;
  transfers: SmartRebalanceTransferSource[];
};

export async function getShortageAlerts(user: CurrentUser, input: Input) {
  const forecast = await getLatestForecast(user, input);
  if (!forecast.run) return { store: forecast.store, run: null, summary: { total: 0, high: 0, medium: 0, low: 0, shortageQuantity: 0, transferableQuantity: 0, netPurchaseQuantity: 0, estimatedCapitalSaved: 0 }, items: [], analysisItems: [] };
  const skuIds = forecast.items.map(item => item.skuId);
  const allowedStores = new Set(user.stores.map(store => store.id));
  const [inventories, purchaseItems, otherInventories, pendingOutTransfers] = await Promise.all([
    prisma.inventory.findMany({ where: { skuId: { in: skuIds }, warehouse: { storeId: input.storeId, active: true } }, select: { lots: true, skuId: true, onHand: true, reserved: true, safetyStock: true, incoming: true } }),
    prisma.purchaseOrderItem.findMany({
      where: { skuId: { in: skuIds }, purchaseOrder: { warehouse: { storeId: input.storeId }, status: 'OPEN', expectedAt: { gte: new Date(vietnamDay(new Date()).getTime() - 7 * 3_600_000), lte: new Date(forecast.run.forecastTo.getTime() + 17 * 3_600_000 - 1) } } },
      select: { skuId: true, orderedQuantity: true, receivedQuantity: true, purchaseOrder: { select: { expectedAt: true } } },
    }),
    prisma.inventory.findMany({
      where: {
        skuId: { in: skuIds },
        warehouse: {
          active: true,
          storeId: { not: input.storeId },
          store: { active: true },
        },
      },
      select: {
        lots: true,
        skuId: true,
        warehouseId: true,
        onHand: true,
        reserved: true,
        safetyStock: true,
        warehouse: { select: { id: true, code: true, name: true, storeId: true, store: { select: { id: true, code: true, name: true } } } },
      },
    }),
    prisma.stockTransferItem.findMany({
      where: { skuId: { in: skuIds }, transfer: { status: { in: ['READY'] } } },
      select: { skuId: true, requestedQuantity: true, approvedQuantity: true, transfer: { select: { sourceWarehouseId: true } } },
    }),
  ]);

  const filteredOtherInventories = otherInventories.filter(
    row => user.globalAccess || allowedStores.has(row.warehouse.storeId)
  );
  const otherStoreIds = [...new Set(filteredOtherInventories.map(row => row.warehouse.storeId))];
  const otherRuns = otherStoreIds.length
    ? await prisma.forecastRun.findMany({
        where: { storeId: { in: otherStoreIds }, horizonDays: input.horizonDays, forecastTo: { gte: vietnamDay(new Date()) } },
        distinct: ['storeId'],
        orderBy: { generatedAt: 'desc' },
        include: { forecasts: { where: { skuId: { in: skuIds } }, select: { skuId: true, predictedQuantity: true } } },
      })
    : [];
  const otherPredictedDemand = new Map<string, number>();
  for (const run of otherRuns) {
    for (const f of run.forecasts) {
      otherPredictedDemand.set(`${run.storeId}:${f.skuId}`, f.predictedQuantity);
    }
  }
  const committedOutboundByWhSku = new Map<string, number>();
  for (const item of pendingOutTransfers) {
    const k = `${item.transfer.sourceWarehouseId}:${item.skuId}`;
    committedOutboundByWhSku.set(k, (committedOutboundByWhSku.get(k) ?? 0) + (item.approvedQuantity ?? item.requestedQuantity));
  }

  const stock = new Map<string, { available: number; safetyStock: number; inTransfer: number }>();
  for (const row of inventories) {
    const total = stock.get(row.skuId) ?? { available: 0, safetyStock: 0, inTransfer: 0 };
    total.available += Math.max(0, row.onHand - row.reserved - row.lots.filter(lot => lot.status !== 'AVAILABLE' || expired(lot.expiresAt)).reduce((sum, lot) => sum + lot.quantity, 0));
    total.safetyStock += row.safetyStock;
    total.inTransfer += row.incoming;
    stock.set(row.skuId, total);
  }
  const incomingPurchase = new Map<string, number>();
  for (const row of purchaseItems) incomingPurchase.set(row.skuId, (incomingPurchase.get(row.skuId) ?? 0) + Math.max(0, row.orderedQuantity - row.receivedQuantity));
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const fmtMoney = (v: number) => new Intl.NumberFormat('vi-VN').format(Math.round(v));

  const analysisItems = forecast.items.map(row => {
    const current = stock.get(row.skuId) ?? { available: 0, safetyStock: 0, inTransfer: 0 };
    // Forecast-specific buffer, with legacy runs falling back to current configuration.
    current.safetyStock = parseJson(row.safetyStockEvidence) ? row.safetyStockAtRun : current.safetyStock;
    const purchase = incomingPurchase.get(row.skuId) ?? 0;
    const result = assessShortage({ predictedQuantity: row.predictedQuantity, available: current.available, safetyStock: current.safetyStock, inTransfer: current.inTransfer, incomingPurchase: purchase });
    const today = vietnamDay(new Date());
    const timing = supplyTiming({ predictedQuantity: row.predictedQuantity, horizonDays: forecast.run!.horizonDays, available: current.available, safetyStock: current.safetyStock, leadTimeDays: row.leadTimeDays, packSize: row.purchasePackSize, shortage: result.shortageQuantity,
      receipts: purchaseItems.filter(item => item.skuId === row.skuId && item.purchaseOrder.expectedAt).map(item => ({ day: Math.round((vietnamDay(item.purchaseOrder.expectedAt!).getTime() - today.getTime()) / 86400000), quantity: Math.max(0, item.orderedQuantity - item.receivedQuantity) })) });

    // Tính toán Phương án Điều chuyển thông minh giữa các Kho (Smart Branch Rebalancing)
    const candidateSources = filteredOtherInventories
      .filter(inv => inv.skuId === row.skuId)
      .map(inv => {
        const blocked = inv.lots.filter(lot => lot.status !== 'AVAILABLE' || expired(lot.expiresAt)).reduce((sum, lot) => sum + lot.quantity, 0);
        const availableStock = Math.max(0, inv.onHand - inv.reserved - blocked);
        const predictedOther = otherPredictedDemand.get(`${inv.warehouse.storeId}:${row.skuId}`) ?? 0;
        const committedOut = committedOutboundByWhSku.get(`${inv.warehouseId}:${row.skuId}`) ?? 0;
        const ownRequired = inv.safetyStock + predictedOther + committedOut;
        const surplusAvailable = Math.max(0, availableStock - ownRequired);
        return {
          warehouseId: inv.warehouseId,
          warehouseCode: inv.warehouse.code,
          warehouseName: inv.warehouse.name,
          storeId: inv.warehouse.storeId,
          storeName: inv.warehouse.store.name,
          availableStock,
          ownRequired,
          surplusAvailable,
        };
      })
      .filter(src => src.surplusAvailable > 0)
      .sort((a, b) => b.surplusAvailable - a.surplusAvailable);

    const plan = planReplenishment(
      result.shortageQuantity,
      candidateSources.map(s => ({ warehouseId: s.warehouseId, surplus: s.surplusAvailable }))
    );

    const transfers: SmartRebalanceTransferSource[] = plan.transfers.map(t => {
      const meta = candidateSources.find(c => c.warehouseId === t.sourceWarehouseId)!;
      return {
        sourceWarehouseId: meta.warehouseId,
        sourceWarehouseCode: meta.warehouseCode,
        sourceWarehouseName: meta.warehouseName,
        sourceStoreId: meta.storeId,
        sourceStoreName: meta.storeName,
        availableStock: meta.availableStock,
        ownRequired: meta.ownRequired,
        surplusAvailable: meta.surplusAvailable,
        suggestedTransferQty: t.quantity,
      };
    });

    const totalTransferQty = transfers.reduce((s, t) => s + t.suggestedTransferQty, 0);
    const remainingPurchaseQty = plan.purchaseQuantity;
    const unitCost = row.costPrice ?? 0;
    const estimatedCapitalSaved = totalTransferQty * unitCost;
    const strategy: SmartRebalancingPlan['strategy'] =
      result.shortageQuantity === 0
        ? 'NONE'
        : totalTransferQty >= result.shortageQuantity
          ? 'FULL_TRANSFER'
          : totalTransferQty > 0
            ? 'HYBRID_TRANSFER_PURCHASE'
            : 'FULL_PURCHASE';

    const sourceDesc = transfers.map(t => `${t.suggestedTransferQty} ${row.unit} đang dư từ ${t.sourceWarehouseName} (dư ${t.surplusAvailable} ${row.unit})`).join(' + ');
    const headline =
      result.shortageQuantity === 0
        ? 'Đủ tồn kho đáp ứng nhu cầu dự báo và mức dự phòng.'
        : strategy === 'FULL_TRANSFER'
          ? `${forecast.store.name} thiếu ${result.shortageQuantity} ${row.unit} → Đề xuất Điều chuyển đủ ${sourceDesc} sang · Không cần mua mới NCC (Tiết kiệm ${fmtMoney(estimatedCapitalSaved)} đ vốn nhập hàng)`
          : strategy === 'HYBRID_TRANSFER_PURCHASE'
            ? `${forecast.store.name} thiếu ${result.shortageQuantity} ${row.unit} → Đề xuất Điều chuyển ${sourceDesc} sang + chỉ cần Đặt mua mới ${remainingPurchaseQty} ${row.unit} từ NCC (Tiết kiệm ${fmtMoney(estimatedCapitalSaved)} đ vốn nhập hàng)`
            : `${forecast.store.name} thiếu ${result.shortageQuantity} ${row.unit} → Các kho khác không còn dư vượt mức an toàn, đề xuất Đặt mua mới ${remainingPurchaseQty} ${row.unit} từ NCC`;

    const smartRebalancing: SmartRebalancingPlan = {
      totalShortage: result.shortageQuantity,
      totalTransferQty,
      remainingPurchaseQty,
      unitCost,
      estimatedCapitalSaved,
      strategy,
      headline,
      transfers,
    };

    return { ...row, ...result, timing, smartRebalancing, severity: timing.urgent ? 'HIGH' as const : result.severity, available: current.available, safetyStock: current.safetyStock, inTransfer: current.inTransfer, incomingPurchase: purchase,
      surplusQuantity: Math.max(0, current.available + current.inTransfer + purchase - row.predictedQuantity - current.safetyStock) };
  });
  const items = analysisItems.filter(row => row.severity !== null)
    .sort((a, b) => rank[a.severity!] - rank[b.severity!] || b.shortageQuantity - a.shortageQuantity);
  const transferableQuantity = items.reduce((sum, row) => sum + row.smartRebalancing.totalTransferQty, 0);
  const netPurchaseQuantity = items.reduce((sum, row) => sum + row.smartRebalancing.remainingPurchaseQty, 0);
  const estimatedCapitalSaved = items.reduce((sum, row) => sum + row.smartRebalancing.estimatedCapitalSaved, 0);
  return {
    store: forecast.store, run: forecast.run,
    summary: { total: items.length, high: items.filter(row => row.severity === 'HIGH').length, medium: items.filter(row => row.severity === 'MEDIUM').length, low: items.filter(row => row.severity === 'LOW').length, shortageQuantity: items.reduce((sum, row) => sum + row.shortageQuantity, 0), transferableQuantity, netPurchaseQuantity, estimatedCapitalSaved },
    items,
    analysisItems,
  };
}

export type FefoExpiryRiskItem = {
  lotId: string;
  lotCode: string;
  inventoryId: string;
  skuId: string;
  skuCode: string;
  productId: string;
  productCode: string;
  productName: string;
  imageUrl: string | null;
  unit: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  storeId: string;
  storeName: string;
  expiresAt: string;
  daysRemaining: number;
  lotQuantity: number;
  priorLotsQuantity: number;
  priorConsumedDemand: number;
  evaluatedDays: number;
  horizonDays: number;
  predictedHorizonDemand: number;
  dailyForecastRate: number;
  projectedSoldBeforeExpiry: number;
  atRiskQuantity: number;
  unsoldRatio: number;
  costPrice: number;
  sellingPrice: number;
  atRiskValue: number;
  suggestedDiscountPercent: number;
  discountedPrice: number;
  recoverableValue: number;
  riskLevel: 'EXPIRED' | 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'SAFE';
  allocationStatus: ForecastAllocationStatus;
  beyondHorizon: boolean;
  hasValidForecast: boolean;
  conditionalComboSuggestion: boolean;
  decisionSource: 'AI_FORECAST_AND_INVENTORY_BALANCE' | 'RULE_BASED_POLICY' | 'INSUFFICIENT_DATA';
  pendingTransfer: {
    id: string;
    code: string;
    quantity: number;
    destinationWarehouseName: string;
    status: string;
  } | null;
  recommendedTransferBranch: {
    storeId: string;
    storeName: string;
    warehouseId: string;
    warehouseName: string;
    dailyDemandRate: number;
    absorbableQuantity: number;
  } | null;
  aiInsight: string;
};

export async function getFefoExpiryRiskAlerts(user: CurrentUser, query: { storeId?: string; horizonDays?: number }) {
  if (query.storeId) {
    await assertStore(user, query.storeId);
  }
  const horizonDays = query.horizonDays ?? 14;
  const allowedStoreIds = user.globalAccess ? undefined : user.stores.map(s => s.id);

  const [lots, stores, pendingFefoTransfersAll] = await Promise.all([
    prisma.inventoryLot.findMany({
      where: {
        quantity: { gt: 0 },
        expiresAt: { not: null },
        status: { in: ['AVAILABLE', 'QUARANTINE'] },
        inventory: {
          warehouse: {
            active: true,
            ...(query.storeId ? { storeId: query.storeId } : allowedStoreIds ? { storeId: { in: allowedStoreIds } } : {}),
          },
        },
      },
      include: {
        inventory: {
          include: {
            lots: { where: { quantity: { gt: 0 } }, select: { id: true, quantity: true, status: true, expiresAt: true } },
            warehouse: { include: { store: { select: { id: true, code: true, name: true } } } },
            sku: { include: { product: { select: { id: true, code: true, name: true, unit: true, imageUrl: true } } } },
          },
        },
      },
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.store.findMany({
      where: { active: true, ...(allowedStoreIds ? { id: { in: allowedStoreIds } } : {}) },
      include: {
        warehouses: {
          where: { active: true },
          orderBy: { code: 'asc' },
          include: {
            inventories: {
              select: {
                skuId: true,
                incoming: true,
                lots: {
                  where: { quantity: { gt: 0 }, status: 'AVAILABLE' },
                  select: { quantity: true, status: true, expiresAt: true },
                },
              },
            },
          },
        },
      },
    }),
    prisma.stockTransfer.findMany({
      where: { status: { in: ['READY'] } },
      select: {
        id: true,
        code: true,
        status: true,
        reason: true,
        sourceWarehouseId: true,
        destinationWarehouseId: true,
        destinationWarehouse: { select: { name: true } },
        items: { select: { skuId: true, requestedQuantity: true, approvedQuantity: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const allStoreIds = stores.map(s => s.id);
  const latestRuns = allStoreIds.length
    ? await prisma.forecastRun.findMany({
        where: { storeId: { in: allStoreIds } },
        distinct: ['storeId'],
        orderBy: { generatedAt: 'desc' },
        include: { forecasts: { select: { skuId: true, predictedQuantity: true, dataQuality: true } } },
      })
    : [];

  const forecastByStoreSku = new Map<
    string,
    {
      hasForecastRun: boolean;
      dataQuality: 'SUFFICIENT' | 'SPARSE' | 'NO_SALES' | null;
      dailyRate: number;
      predictedQuantity: number;
      horizonDays: number;
    }
  >();
  for (const run of latestRuns) {
    for (const f of run.forecasts) {
      const dq =
        f.dataQuality === 'SUFFICIENT' || f.dataQuality === 'SPARSE' || f.dataQuality === 'NO_SALES'
          ? f.dataQuality
          : 'SUFFICIENT';
      const runHorizon = Math.max(1, run.horizonDays);
      forecastByStoreSku.set(`${run.storeId}:${f.skuId}`, {
        hasForecastRun: true,
        dataQuality: dq,
        dailyRate: dq === 'NO_SALES' ? 0 : f.predictedQuantity / runHorizon,
        predictedQuantity: f.predictedQuantity,
        horizonDays: runHorizon,
      });
    }
  }

  // Lập chỉ mục tồn kho cạnh tranh tại từng kho đích để tính sức hấp thụ ròng
  const destInventoryByWhSku = new Map<
    string,
    { incoming: number; lots: { quantity: number; status: string; expiresAt: Date | null }[] }
  >();
  for (const s of stores) {
    for (const wh of s.warehouses) {
      for (const inv of wh.inventories) {
        destInventoryByWhSku.set(`${wh.id}:${inv.skuId}`, {
          incoming: inv.incoming,
          lots: inv.lots,
        });
      }
    }
  }

  const pendingFefoTransfers = pendingFefoTransfersAll.filter(t => t.reason.includes('FEFO ('));
  const committedOutByWhSku = new Map<string, number>();
  const committedInByWhSku = new Map<string, number>();
  for (const t of pendingFefoTransfersAll) {
    for (const item of t.items) {
      const qty = item.approvedQuantity ?? item.requestedQuantity;
      const outKey = `${t.sourceWarehouseId}:${item.skuId}`;
      committedOutByWhSku.set(outKey, (committedOutByWhSku.get(outKey) ?? 0) + qty);
      const inKey = `${t.destinationWarehouseId}:${item.skuId}`;
      committedInByWhSku.set(inKey, (committedInByWhSku.get(inKey) ?? 0) + qty);
    }
  }

  const todayMs = warehouseToday().getTime();
  const fmtMoney = (v: number) => new Intl.NumberFormat('vi-VN').format(Math.round(v));

  // Nhóm các lô theo cùng inventoryId để mô phỏng hàng đợi xuất FEFO (lô hết hạn trước được bán trước, không phân bổ trùng nhu cầu)
  const lotsByInventory = new Map<string, typeof lots>();
  for (const lot of lots) {
    const arr = lotsByInventory.get(lot.inventoryId) ?? [];
    arr.push(lot);
    lotsByInventory.set(lot.inventoryId, arr);
  }

  const items: FefoExpiryRiskItem[] = [];

  for (const [, invLots] of lotsByInventory) {
    const validInvLots = invLots.filter(l => l.expiresAt !== null);
    if (validInvLots.length === 0) continue;

    const firstLot = validInvLots[0]!;
    const storeId = firstLot.inventory.warehouse.storeId;
    const skuId = firstLot.inventory.skuId;
    const sku = firstLot.inventory.sku;
    const product = sku.product;
    const costPrice = Number(sku.costPrice);
    const sellingPrice = Number(sku.sellingPrice);

    const forecastMeta = forecastByStoreSku.get(`${storeId}:${skuId}`) ?? {
      hasForecastRun: false,
      dataQuality: null,
      dailyRate: 0,
      predictedQuantity: 0,
      horizonDays,
    };

    const simInputs = validInvLots.map(lot => ({
      lotId: lot.id,
      lotCode: lot.code,
      quantity: lot.quantity,
      status: lot.status,
      daysRemaining: Math.ceil((lot.expiresAt!.getTime() - todayMs) / 86_400_000),
      costPrice,
      sellingPrice,
    }));

    const simResults = simulateFefoLotsForSku(simInputs, {
      hasForecastRun: forecastMeta.hasForecastRun,
      dataQuality: forecastMeta.dataQuality,
      predictedHorizonDemand: forecastMeta.predictedQuantity,
      horizonDays: forecastMeta.horizonDays,
    });

    const blockedQty = firstLot.inventory.lots
      .filter(l => l.status !== 'AVAILABLE' || expired(l.expiresAt))
      .reduce((s, l) => s + l.quantity, 0);
    const committedOut = committedOutByWhSku.get(`${firstLot.inventory.warehouseId}:${skuId}`) ?? 0;

    for (let idx = 0; idx < validInvLots.length; idx++) {
      const lot = validInvLots[idx]!;
      const sim = simResults[idx]!;

      let recommendedTransferBranch: FefoExpiryRiskItem['recommendedTransferBranch'] = null;
      if (
        lot.status === 'AVAILABLE' &&
        !expired(lot.expiresAt) &&
        sim.atRiskQuantity > 0 &&
        sim.hasValidForecast &&
        !sim.beyondHorizon
      ) {
        const otherCandidates = stores
          .filter(s => s.id !== storeId && s.warehouses.length > 0)
          .map(s => {
            const targetWh = s.warehouses[0]!;
            const otherForecast = forecastByStoreSku.get(`${s.id}:${skuId}`);
            const otherHasValidForecast = Boolean(
              otherForecast?.hasForecastRun &&
                otherForecast.dataQuality !== null &&
                otherForecast.dataQuality !== 'NO_SALES'
            );
            const otherRate = otherHasValidForecast ? (otherForecast?.dailyRate ?? 0) : 0;

            const destInv = destInventoryByWhSku.get(`${targetWh.id}:${skuId}`);
            const competingLotsAtDest = (destInv?.lots ?? [])
              .filter(
                dl =>
                  dl.status === 'AVAILABLE' &&
                  !expired(dl.expiresAt) &&
                  (dl.expiresAt === null || dl.expiresAt.getTime() <= lot.expiresAt!.getTime())
              )
              .reduce((sum, dl) => sum + dl.quantity, 0);
            const pendingInboundAtDest =
              (destInv?.incoming ?? 0) + (committedInByWhSku.get(`${targetWh.id}:${skuId}`) ?? 0);

            const evalResult = evaluateFefoTransferCandidate({
              atRiskQuantity: sim.atRiskQuantity,
              lotQuantity: lot.quantity,
              daysRemaining: sim.daysRemaining,
              horizonDays: forecastMeta.horizonDays,
              sourceDailyRate: forecastMeta.dailyRate,
              sourceOnHand: lot.inventory.onHand,
              sourceReserved: lot.inventory.reserved,
              sourceSafetyStock: lot.inventory.safetyStock,
              sourceBlockedLotQty: blockedQty,
              sourceCommittedOutboundQty: committedOut,
              destinationDailyRate: otherRate,
              destinationHasValidForecast: otherHasValidForecast,
              destinationCompetingStockBeforeExpiry: competingLotsAtDest + pendingInboundAtDest,
            });

            return {
              eligible: evalResult.eligible,
              storeId: s.id,
              storeName: s.name,
              warehouseId: targetWh.id,
              warehouseName: targetWh.name,
              dailyDemandRate: Number(otherRate.toFixed(2)),
              absorbableQuantity: evalResult.absorbableQuantity,
              rawDailyRate: otherRate,
            };
          })
          .filter(c => c.eligible && c.absorbableQuantity > 0)
          .sort((a, b) => b.absorbableQuantity - a.absorbableQuantity || b.rawDailyRate - a.rawDailyRate);

        if (otherCandidates.length > 0) {
          const best = otherCandidates[0]!;
          recommendedTransferBranch = {
            storeId: best.storeId,
            storeName: best.storeName,
            warehouseId: best.warehouseId,
            warehouseName: best.warehouseName,
            dailyDemandRate: best.dailyDemandRate,
            absorbableQuantity: best.absorbableQuantity,
          };
        }
      }

      const matchedPending = pendingFefoTransfers.find(
        t =>
          t.sourceWarehouseId === lot.inventory.warehouseId &&
          t.reason.includes(`FEFO (${lot.code})`) &&
          t.items.some(i => i.skuId === skuId)
      );
      const pendingTransfer: FefoExpiryRiskItem['pendingTransfer'] = matchedPending
        ? {
            id: matchedPending.id,
            code: matchedPending.code,
            quantity: matchedPending.items.find(i => i.skuId === skuId)?.requestedQuantity ?? 0,
            destinationWarehouseName: matchedPending.destinationWarehouse.name,
            status: matchedPending.status,
          }
        : null;

      const transferHint = recommendedTransferBranch
        ? ` | Quy tắc điều chuyển: gợi ý chuyển ${recommendedTransferBranch.absorbableQuantity} ${product.unit} sang ${recommendedTransferBranch.warehouseName} (nhu cầu dự báo ${recommendedTransferBranch.dailyDemandRate} ${product.unit}/ngày, đã trừ ${FEFO_POLICY_CONFIG.transferTransitDays} ngày vận chuyển & tồn FEFO cạnh tranh tại kho nhận)`
        : '';

      const comboHint = sim.conditionalComboSuggestion
        ? ` | Quy tắc khuyến mãi có điều kiện: cân nhắc bán kèm / Mua 1 tặng 1 nếu biên lợi nhuận cho phép (gợi ý chính sách, chưa có dữ liệu đo lường độ co giãn giá)`
        : '';

      let aiInsight: string;
      let decisionSource: FefoExpiryRiskItem['decisionSource'] = 'AI_FORECAST_AND_INVENTORY_BALANCE';

      if (sim.allocationStatus === 'EXPIRED_OR_QUARANTINED') {
        decisionSource = 'RULE_BASED_POLICY';
        aiInsight =
          sim.daysRemaining < 0
            ? `Quá hạn ${Math.abs(sim.daysRemaining)} ngày · Đã chặn xuất bán FEFO tại POS, cần cách ly/tiêu hủy theo quy định kho.`
            : `Lô đang ở trạng thái cách ly (${lot.status}) · Không phân bổ xuất bán POS.`;
      } else if (sim.allocationStatus === 'NO_FORECAST_RUN') {
        decisionSource = 'INSUFFICIENT_DATA';
        aiInsight = `Chưa có lượt chạy dự báo AI cho SKU này tại chi nhánh · Chưa đủ dữ liệu để kết luận số lượng nguy cơ dư trước hạn.`;
      } else if (sim.allocationStatus === 'NO_SALES_HISTORY') {
        decisionSource = 'INSUFFICIENT_DATA';
        aiInsight = `SKU chưa có lịch sử bán hàng (NO_SALES) · Không tự suy diễn dự báo, cần kiểm tra thực tế tại quầy.`;
      } else if (sim.allocationStatus === 'BEYOND_FORECAST_HORIZON') {
        decisionSource = 'AI_FORECAST_AND_INVENTORY_BALANCE';
        aiInsight = `Còn ${sim.daysRemaining} ngày (> tầm nhìn dự báo ${forecastMeta.horizonDays} ngày) · Trong ${forecastMeta.horizonDays} ngày tới dự kiến tiêu thụ ${sim.projectedSoldBeforeExpiry}/${lot.quantity} ${product.unit} (giả định phân bổ đều ${sim.dailyForecastRate} ${product.unit}/ngày); chưa kết luận dư thừa ngoài tầm nhìn ${forecastMeta.horizonDays} ngày.`;
      } else if (sim.atRiskQuantity > 0) {
        decisionSource = 'RULE_BASED_POLICY';
        aiInsight = `[Dự báo AI & Cân bằng FEFO]: Ước tính bán ${sim.projectedSoldBeforeExpiry}/${lot.quantity} ${product.unit} trong ${sim.evaluatedDays} ngày trước hạn (giả định phân bổ đều ${sim.dailyForecastRate} ${product.unit}/ngày, đã trừ ${sim.priorConsumedDemand} ${product.unit} nhu cầu dành cho lô hạn sớm hơn) → Nguy cơ dư ${sim.atRiskQuantity} ${product.unit}. [Gợi ý quy tắc]: tham khảo giảm giá ${sim.suggestedDiscountPercent}% (thu hồi ước tính ~${fmtMoney(sim.recoverableValue)} đ nếu bán hết lượng dư)${comboHint}${transferHint}.`;
      } else {
        decisionSource = 'AI_FORECAST_AND_INVENTORY_BALANCE';
        aiInsight = `[Dự báo AI & Cân bằng FEFO]: Sức mua dự báo (${sim.dailyForecastRate} ${product.unit}/ngày, phân bổ đều trong tầm nhìn ${forecastMeta.horizonDays} ngày) đủ hấp thụ hết ${lot.quantity} ${product.unit} trước hạn.`;
      }

      items.push({
        lotId: lot.id,
        lotCode: lot.code,
        inventoryId: lot.inventoryId,
        skuId,
        skuCode: sku.code,
        productId: product.id,
        productCode: product.code,
        productName: product.name,
        imageUrl: product.imageUrl,
        unit: product.unit,
        warehouseId: lot.inventory.warehouseId,
        warehouseCode: lot.inventory.warehouse.code,
        warehouseName: lot.inventory.warehouse.name,
        storeId,
        storeName: lot.inventory.warehouse.store.name,
        expiresAt: lot.expiresAt!.toISOString().slice(0, 10),
        daysRemaining: sim.daysRemaining,
        lotQuantity: sim.lotQuantity,
        priorLotsQuantity: sim.priorLotsQuantity,
        priorConsumedDemand: sim.priorConsumedDemand,
        evaluatedDays: sim.evaluatedDays,
        horizonDays: forecastMeta.horizonDays,
        predictedHorizonDemand: forecastMeta.predictedQuantity,
        dailyForecastRate: sim.dailyForecastRate,
        projectedSoldBeforeExpiry: sim.projectedSoldBeforeExpiry,
        atRiskQuantity: sim.atRiskQuantity,
        unsoldRatio: sim.unsoldRatio,
        costPrice,
        sellingPrice,
        atRiskValue: sim.atRiskValue,
        suggestedDiscountPercent: sim.suggestedDiscountPercent,
        discountedPrice: sim.discountedPrice,
        recoverableValue: sim.recoverableValue,
        riskLevel: sim.riskLevel,
        allocationStatus: sim.allocationStatus,
        beyondHorizon: sim.beyondHorizon,
        hasValidForecast: sim.hasValidForecast,
        conditionalComboSuggestion: sim.conditionalComboSuggestion,
        decisionSource,
        pendingTransfer,
        recommendedTransferBranch,
        aiInsight,
      });
    }
  }

  const riskOrder = { EXPIRED: 0, CRITICAL: 1, HIGH: 2, MEDIUM: 3, SAFE: 4 } as const;
  items.sort((a, b) => riskOrder[a.riskLevel] - riskOrder[b.riskLevel] || a.daysRemaining - b.daysRemaining || b.atRiskValue - a.atRiskValue);

  const atRiskItems = items.filter(i => i.atRiskQuantity > 0 && i.daysRemaining >= 0);

  return {
    summary: {
      totalTrackedLots: items.length,
      atRiskLotsCount: atRiskItems.length,
      criticalLotsCount: items.filter(i => i.riskLevel === 'CRITICAL').length,
      totalAtRiskUnits: atRiskItems.reduce((s, i) => s + i.atRiskQuantity, 0),
      totalAtRiskValue: atRiskItems.reduce((s, i) => s + i.atRiskValue, 0),
      totalRecoverableValue: atRiskItems.reduce((s, i) => s + i.recoverableValue, 0),
    },
    items,
  };
}
