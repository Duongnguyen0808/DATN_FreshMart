import { z } from 'zod';
import { prisma } from '../../common/database.js';
import { AppError } from '../../common/app-error.js';
import { env } from '../../config/env.js';
import type { CurrentUser } from '../auth/auth.repository.js';
import type { forecastHistoryInput, forecastInput } from './forecasts.schemas.js';
import { assessShortage } from './shortage-rule.js';

// Dùng lịch sử vận hành đủ dài để kiểm tra mô hình trên chuỗi thời gian thực.
const HISTORY_DAYS = 180;
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
    include: { forecasts: { include: { sku: { select: { code: true, product: { select: { id: true, code: true, name: true, unit: true, imageUrl: true } } } } }, orderBy: { predictedQuantity: 'desc' } } },
  });
  if (!run) return { store, run: null, items: [] };
  return {
    store,
    run: { id: run.id, model: run.model, generatedAt: run.generatedAt, horizonDays: run.horizonDays, historyDays: run.historyDays, forecastFrom: run.forecastFrom, forecastTo: run.forecastTo },
    items: run.forecasts.map(row => ({
      skuId: row.skuId, skuCode: row.sku.code, productId: row.sku.product.id, productCode: row.sku.product.code, imageUrl: row.sku.product.imageUrl, productName: row.sku.product.name, unit: row.sku.product.unit,
      predictedQuantity: row.predictedQuantity, observedQuantity: row.observedQuantity,
      dataQuality: row.dataQuality, availableAtRun: row.availableAtRun, safetyStockAtRun: row.safetyStockAtRun,
    })),
  };
}

export async function getForecastById(user: CurrentUser, id: string) {
  const run = await prisma.forecastRun.findUnique({
    where: { id },
    include: { forecasts: { include: { sku: { select: { code: true, product: { select: { id: true, code: true, name: true, unit: true, imageUrl: true } } } } }, orderBy: { predictedQuantity: 'desc' } } },
  });
  if (!run) throw new AppError(404, 'FORECAST_NOT_FOUND', 'Không tìm thấy lần dự báo.');
  const store = await assertStore(user, run.storeId);
  return {
    store,
    run: { id: run.id, model: run.model, generatedAt: run.generatedAt, horizonDays: run.horizonDays, historyDays: run.historyDays, forecastFrom: run.forecastFrom, forecastTo: run.forecastTo },
    items: run.forecasts.map(row => ({
      skuId: row.skuId, skuCode: row.sku.code, productId: row.sku.product.id, productCode: row.sku.product.code, imageUrl: row.sku.product.imageUrl, productName: row.sku.product.name, unit: row.sku.product.unit,
      predictedQuantity: row.predictedQuantity, observedQuantity: row.observedQuantity,
      dataQuality: row.dataQuality, availableAtRun: row.availableAtRun, safetyStockAtRun: row.safetyStockAtRun,
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
    select: { skuId: true, onHand: true, reserved: true, safetyStock: true },
  });
  const stockBySku = new Map<string, { available: number; safetyStock: number }>();
  for (const stock of stocks) {
    const previous = stockBySku.get(stock.skuId) ?? { available: 0, safetyStock: 0 };
    previous.available += stock.onHand - stock.reserved;
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
        availableAtRun: stockBySku.get(item.skuId)!.available, safetyStockAtRun: stockBySku.get(item.skuId)!.safetyStock,
      })) },
    } });
    await tx.inventoryRecommendation.updateMany({ where: { targetStoreId: input.storeId, status: 'PENDING' }, data: { status: 'SUPERSEDED' } });
  });
  return getLatestForecast(user, input);
}

export async function getShortageAlerts(user: CurrentUser, input: Input) {
  const forecast = await getLatestForecast(user, input);
  if (!forecast.run) return { store: forecast.store, run: null, summary: { total: 0, high: 0, medium: 0, low: 0, shortageQuantity: 0 }, items: [], analysisItems: [] };
  const skuIds = forecast.items.map(item => item.skuId);
  const [inventories, purchaseItems] = await Promise.all([
    prisma.inventory.findMany({ where: { skuId: { in: skuIds }, warehouse: { storeId: input.storeId, active: true } }, select: { skuId: true, onHand: true, reserved: true, safetyStock: true, incoming: true } }),
    prisma.purchaseOrderItem.findMany({
      where: { skuId: { in: skuIds }, purchaseOrder: { warehouse: { storeId: input.storeId }, status: { in: ['OPEN', 'PARTIALLY_RECEIVED'] }, expectedAt: { lte: new Date(forecast.run.forecastTo.getTime() + 17 * 3_600_000 - 1) } } },
      select: { skuId: true, orderedQuantity: true, receivedQuantity: true },
    }),
  ]);
  const stock = new Map<string, { available: number; safetyStock: number; inTransfer: number }>();
  for (const row of inventories) {
    const total = stock.get(row.skuId) ?? { available: 0, safetyStock: 0, inTransfer: 0 };
    total.available += row.onHand - row.reserved;
    total.safetyStock += row.safetyStock;
    total.inTransfer += row.incoming;
    stock.set(row.skuId, total);
  }
  const incomingPurchase = new Map<string, number>();
  for (const row of purchaseItems) incomingPurchase.set(row.skuId, (incomingPurchase.get(row.skuId) ?? 0) + Math.max(0, row.orderedQuantity - row.receivedQuantity));
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const analysisItems = forecast.items.map(row => {
    const current = stock.get(row.skuId) ?? { available: 0, safetyStock: 0, inTransfer: 0 };
    const purchase = incomingPurchase.get(row.skuId) ?? 0;
    const result = assessShortage({ predictedQuantity: row.predictedQuantity, available: current.available, safetyStock: current.safetyStock, inTransfer: current.inTransfer, incomingPurchase: purchase });
    return { ...row, ...result, severity: result.severity, available: current.available, safetyStock: current.safetyStock, inTransfer: current.inTransfer, incomingPurchase: purchase,
      surplusQuantity: Math.max(0, current.available + current.inTransfer + purchase - row.predictedQuantity - current.safetyStock) };
  });
  const items = analysisItems.filter(row => row.severity !== null)
    .sort((a, b) => rank[a.severity!] - rank[b.severity!] || b.shortageQuantity - a.shortageQuantity);
  return {
    store: forecast.store, run: forecast.run,
    summary: { total: items.length, high: items.filter(row => row.severity === 'HIGH').length, medium: items.filter(row => row.severity === 'MEDIUM').length, low: items.filter(row => row.severity === 'LOW').length, shortageQuantity: items.reduce((sum, row) => sum + row.shortageQuantity, 0) },
    items,
    analysisItems,
  };
}
