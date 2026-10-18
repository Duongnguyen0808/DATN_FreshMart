import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../common/database.js';
import { AppError } from '../../common/app-error.js';
import type { CurrentUser } from '../auth/auth.repository.js';
import type { z } from 'zod';
import type { branchComparisonInput, debtReportInput, inventoryReportInput, productPerformanceInput, revenueReportInput } from './reports.schemas.js';
import { calculateNetSalesLine } from './sales-line.js';

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const localDate = (value: string, end = false) => { const [year, month, day] = value.split('-').map(Number); return new Date(year!, month! - 1, day!, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0); };

export async function getRevenueReport(user: CurrentUser, input: z.infer<typeof revenueReportInput>) {
  const today = new Date();
  const defaultTo = dayKey(today);
  const defaultFromDate = new Date(today); defaultFromDate.setDate(defaultFromDate.getDate() - 29);
  const fromText = input.from ?? dayKey(defaultFromDate);
  const toText = input.to ?? defaultTo;
  const from = localDate(fromText);
  const to = localDate(toText, true);
  const assignedStoreIds = user.stores.map(store => store.id);
  if (input.storeId && !user.globalAccess && !assignedStoreIds.includes(input.storeId)) throw new AppError(403, 'STORE_FORBIDDEN', 'Bạn không được xem báo cáo của chi nhánh này.');
  const storeIds = input.storeId ? [input.storeId] : user.globalAccess ? undefined : assignedStoreIds;
  const productFilter: Prisma.ProductWhereInput = { ...(input.productId ? { id: input.productId } : {}), ...(input.categoryId ? { categoryId: input.categoryId } : {}) };
  const itemWhere: Prisma.InvoiceItemWhereInput = input.productId || input.categoryId ? { sku: { product: productFilter } } : {};
  const invoices = await prisma.invoice.findMany({
    where: { status: 'COMPLETED', completedAt: { gte: from, lte: to }, ...(storeIds ? { storeId: { in: storeIds } } : {}), ...(input.productId || input.categoryId ? { items: { some: itemWhere } } : {}) },
    select: {
      id: true, storeId: true, subtotal: true, discount: true, total: true, completedAt: true,
      store: { select: { code: true, name: true } },
      items: {
        where: itemWhere,
        select: {
          skuId: true, productName: true, skuCode: true, unit: true, quantity: true,
          lineTotal: true, costPrice: true,
          salesReturnItems: { select: { quantity: true, restock: true, lineRefund: true } },
          sku: { select: { product: { select: { id: true, code: true, imageUrl: true, category: { select: { id: true, code: true, name: true } } } } } },
        },
      },
    },
    orderBy: { completedAt: 'asc' },
  });
  const series = new Map<string, { revenue: number; invoices: Set<string>; quantity: number }>();
  for (let cursor = new Date(from); cursor <= to; cursor.setDate(cursor.getDate() + 1)) series.set(dayKey(cursor), { revenue: 0, invoices: new Set(), quantity: 0 });
  const branches = new Map<string, { id: string; code: string; name: string; revenue: number; invoiceIds: Set<string>; quantity: number }>();
  const categories = new Map<string, { id: string; code: string; name: string; revenue: number; quantity: number }>();
  const products = new Map<string, { id: string; productCode: string; imageUrl: string | null; name: string; unit: string; revenue: number; quantity: number; categoryId: string; categoryCode: string; categoryName: string }>();
  let grossSales = 0; let netRevenue = 0; let costOfGoods = 0; let quantity = 0;
  for (const invoice of invoices) {
    for (const item of invoice.items) {
      const { grossSales: lineGross, netRevenue: lineRevenue, costOfGoods: lineCost, netQuantity } = calculateNetSalesLine(invoice, item);
      grossSales += lineGross; netRevenue += lineRevenue; costOfGoods += lineCost; quantity += netQuantity;
      const point = series.get(dayKey(invoice.completedAt)); if (point) { point.revenue += lineRevenue; point.invoices.add(invoice.id); point.quantity += netQuantity; }
      const branch = branches.get(invoice.storeId) ?? { id: invoice.storeId, code: invoice.store.code, name: invoice.store.name, revenue: 0, invoiceIds: new Set<string>(), quantity: 0 }; branch.revenue += lineRevenue; branch.invoiceIds.add(invoice.id); branch.quantity += netQuantity; branches.set(invoice.storeId, branch);
      const category = item.sku.product.category; const categoryRow = categories.get(category.id) ?? { ...category, revenue: 0, quantity: 0 }; categoryRow.revenue += lineRevenue; categoryRow.quantity += netQuantity; categories.set(category.id, categoryRow);
      const productId = item.sku.product.id; const product = products.get(productId) ?? { id: productId, productCode: item.sku.product.code, imageUrl: item.sku.product.imageUrl, name: item.productName, unit: item.unit, revenue: 0, quantity: 0, categoryId: category.id, categoryCode: category.code, categoryName: category.name }; product.revenue += lineRevenue; product.quantity += netQuantity; products.set(productId, product);
    }
  }
  const invoiceCount = invoices.length; const grossProfit = netRevenue - costOfGoods;
  return {
    filters: { from: fromText, to: toText, storeId: input.storeId ?? null, productId: input.productId ?? null, categoryId: input.categoryId ?? null },
    summary: { grossSales, discount: grossSales - netRevenue, netRevenue, invoiceCount, quantity, averageOrderValue: invoiceCount ? netRevenue / invoiceCount : 0, costOfGoods, grossProfit, grossMargin: netRevenue ? grossProfit * 100 / netRevenue : 0 },
    revenueSeries: [...series].map(([date, row]) => ({ date, revenue: row.revenue, invoiceCount: row.invoices.size, quantity: row.quantity })),
    branches: [...branches.values()].map(({ invoiceIds, ...row }) => ({ ...row, invoiceCount: invoiceIds.size })).sort((a, b) => b.revenue - a.revenue),
    categories: [...categories.values()].sort((a, b) => b.revenue - a.revenue),
    categoryProducts: [...products.values()].sort((a, b) => a.categoryName.localeCompare(b.categoryName, 'vi') || b.revenue - a.revenue || a.name.localeCompare(b.name, 'vi')),
    topProducts: [...products.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
  };
}

type StockStatus = 'NORMAL' | 'LOW' | 'OUT' | 'HIGH';
const stockStatus = (available: number, safetyStock: number): StockStatus => available <= 0 ? 'OUT' : available <= safetyStock ? 'LOW' : safetyStock > 0 && available >= safetyStock * 2 ? 'HIGH' : 'NORMAL';

export async function getInventoryReport(user: CurrentUser, input: z.infer<typeof inventoryReportInput>) {
  const assignedStoreIds = user.stores.map(store => store.id);
  if (input.storeId && !user.globalAccess && !assignedStoreIds.includes(input.storeId)) throw new AppError(403, 'STORE_FORBIDDEN', 'Bạn không được xem báo cáo của chi nhánh này.');
  if (input.warehouseId) {
    const warehouse = await prisma.warehouse.findUnique({ where: { id: input.warehouseId }, select: { storeId: true } });
    if (!warehouse) throw new AppError(404, 'WAREHOUSE_NOT_FOUND', 'Không tìm thấy kho.');
    if (!user.globalAccess && !assignedStoreIds.includes(warehouse.storeId)) throw new AppError(403, 'STORE_FORBIDDEN', 'Bạn không được xem báo cáo của kho này.');
  }
  const storeIds = input.storeId ? [input.storeId] : user.globalAccess ? undefined : assignedStoreIds;
  const productWhere: Prisma.ProductWhereInput = { ...(input.productId ? { id: input.productId } : {}), ...(input.categoryId ? { categoryId: input.categoryId } : {}) };
  const where: Prisma.InventoryWhereInput = {
    ...(storeIds ? { warehouse: { storeId: { in: storeIds } } } : {}),
    ...(input.warehouseId ? { warehouseId: input.warehouseId } : {}),
    ...(input.productId || input.categoryId ? { sku: { product: productWhere } } : {}),
    ...(input.q ? { OR: [{ sku: { code: { contains: input.q, mode: 'insensitive' } } }, { sku: { barcode: { contains: input.q } } }, { sku: { product: { name: { contains: input.q, mode: 'insensitive' } } } }, { warehouse: { name: { contains: input.q, mode: 'insensitive' } } }] } : {}),
  };
  const inventoryRows = await prisma.inventory.findMany({ where, include: { warehouse: { include: { store: { select: { id: true, code: true, name: true } } } }, sku: { include: { product: { include: { category: true } } } } }, orderBy: [{ warehouse: { name: 'asc' } }, { sku: { code: 'asc' } }] });
  const rows = inventoryRows.map(row => { const available = row.onHand - row.reserved; return { id: row.id, skuId: row.skuId, skuCode: row.sku.code, barcode: row.sku.barcode, productId: row.sku.product.id, productCode: row.sku.product.code, productName: row.sku.product.name, imageUrl: row.sku.product.imageUrl, unit: row.sku.product.unit, category: { id: row.sku.product.category.id, code: row.sku.product.category.code, name: row.sku.product.category.name }, warehouse: { id: row.warehouse.id, code: row.warehouse.code, name: row.warehouse.name }, store: row.warehouse.store, onHand: row.onHand, reserved: row.reserved, available, inTransfer: row.inTransfer, incoming: row.incoming, safetyStock: row.safetyStock, costPrice: Number(row.sku.costPrice), stockValue: row.onHand * Number(row.sku.costPrice), status: stockStatus(available, row.safetyStock), updatedAt: row.updatedAt }; });
  const shortageOf = (row: typeof rows[number]) => row.status === 'LOW' || row.status === 'OUT' ? Math.max(row.safetyStock - row.available, 1) : 0;
  const filtered = input.status === 'all'
    ? rows
    : input.status === 'SHORTAGE'
      ? rows.filter(row => row.status === 'LOW' || row.status === 'OUT').sort((a, b) => {
          if (a.status !== b.status) return a.status === 'OUT' ? -1 : 1;
          return shortageOf(b) - shortageOf(a);
        })
      : rows.filter(row => row.status === input.status);
  const skip = (input.page - 1) * input.pageSize;
  const warehouseMap = new Map<string, { id: string; code: string; name: string; storeName: string; skuCount: number; quantity: number; available: number; stockValue: number; lowCount: number; highCount: number }>();
  const categoryMap = new Map<string, { id: string; code: string; name: string; skuCount: number; quantity: number; stockValue: number }>();
  for (const row of rows) {
    const warehouse = warehouseMap.get(row.warehouse.id) ?? { ...row.warehouse, storeName: row.store.name, skuCount: 0, quantity: 0, available: 0, stockValue: 0, lowCount: 0, highCount: 0 }; warehouse.skuCount++; warehouse.quantity += row.onHand; warehouse.available += row.available; warehouse.stockValue += row.stockValue; if (row.status === 'LOW' || row.status === 'OUT') warehouse.lowCount++; if (row.status === 'HIGH') warehouse.highCount++; warehouseMap.set(row.warehouse.id, warehouse);
    const category = categoryMap.get(row.category.id) ?? { ...row.category, skuCount: 0, quantity: 0, stockValue: 0 }; category.skuCount++; category.quantity += row.onHand; category.stockValue += row.stockValue; categoryMap.set(row.category.id, category);
  }
  const transactionWhere: Prisma.InventoryTransactionWhereInput = { ...(storeIds ? { warehouse: { storeId: { in: storeIds } } } : {}), ...(input.warehouseId ? { warehouseId: input.warehouseId } : {}), ...(input.productId || input.categoryId ? { sku: { product: productWhere } } : {}), ...(input.q ? { OR: [{ sku: { code: { contains: input.q, mode: 'insensitive' } } }, { sku: { product: { name: { contains: input.q, mode: 'insensitive' } } } }] } : {}) };
  const transactions = await prisma.inventoryTransaction.findMany({ where: transactionWhere, take: 20, orderBy: { occurredAt: 'desc' }, include: { warehouse: { include: { store: { select: { id: true, code: true, name: true } } } }, sku: { include: { product: { select: { code: true, name: true, unit: true, imageUrl: true } } } }, actor: { select: { id: true, name: true } } } });
  return {
    summary: {
      inventoryEntries: rows.length,
      uniqueSkus: new Set(rows.map(row => row.skuId)).size,
      onHand: rows.reduce((sum, row) => sum + row.onHand, 0),
      available: rows.reduce((sum, row) => sum + row.available, 0),
      stockValue: rows.reduce((sum, row) => sum + row.stockValue, 0),
      normal: rows.filter(row => row.status === 'NORMAL').length,
      low: rows.filter(row => row.status === 'LOW').length,
      out: rows.filter(row => row.status === 'OUT').length,
      high: rows.filter(row => row.status === 'HIGH').length,
      shortageQuantity: rows.reduce((sum, row) => sum + shortageOf(row), 0),
      coveredShortages: rows.filter(row => shortageOf(row) > 0 && row.inTransfer + row.incoming >= shortageOf(row)).length,
      uncoveredShortages: rows.filter(row => shortageOf(row) > 0 && row.inTransfer + row.incoming < shortageOf(row)).length,
    },
    items: filtered.slice(skip, skip + input.pageSize),
    pagination: { page: input.page, pageSize: input.pageSize, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / input.pageSize)) },
    warehouses: [...warehouseMap.values()].sort((a, b) => b.stockValue - a.stockValue),
    categories: [...categoryMap.values()].sort((a, b) => b.stockValue - a.stockValue),
    recentTransactions: transactions,
  };
}

type DebtTiming = 'CURRENT' | 'DUE_SOON' | 'OVERDUE' | 'PAID';
function debtTiming(dueDate: Date, outstanding: number, now: Date): DebtTiming { if (outstanding <= 0) return 'PAID'; if (dueDate < now) return 'OVERDUE'; if (dueDate <= new Date(now.getTime() + 7 * 86_400_000)) return 'DUE_SOON'; return 'CURRENT'; }

export async function getDebtReport(user: CurrentUser, input: z.infer<typeof debtReportInput>) {
  const assignedStoreIds = user.stores.map(store => store.id);
  if (input.storeId && !user.globalAccess && !assignedStoreIds.includes(input.storeId)) throw new AppError(403, 'STORE_FORBIDDEN', 'Bạn không được xem báo cáo của chi nhánh này.');
  const storeIds = input.storeId ? [input.storeId] : user.globalAccess ? undefined : assignedStoreIds;
  const where: Prisma.PayableWhereInput = { ...(storeIds ? { purchaseOrder: { warehouse: { storeId: { in: storeIds } } } } : {}), ...(input.supplierId ? { supplierId: input.supplierId } : {}), ...(input.q ? { OR: [{ code: { contains: input.q, mode: 'insensitive' } }, { supplier: { name: { contains: input.q, mode: 'insensitive' } } }, { purchaseOrder: { code: { contains: input.q, mode: 'insensitive' } } }] } : {}) };
  const payables = await prisma.payable.findMany({ where, include: { supplier: { select: { id: true, code: true, name: true } }, purchaseOrder: { select: { id: true, code: true, warehouse: { select: { id: true, code: true, name: true, store: { select: { id: true, code: true, name: true } } } } } }, _count: { select: { payments: true } } }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }] });
  const now = new Date();
  const receivables = await prisma.receivable.findMany({ where: storeIds ? { storeId: { in: storeIds } } : {}, select: { totalAmount: true, paidAmount: true, dueDate: true } });
  const receivableRows = receivables.map(row => { const totalAmount = Number(row.totalAmount); const paidAmount = Number(row.paidAmount); const outstandingAmount = totalAmount - paidAmount; return { totalAmount, paidAmount, outstandingAmount, timing: debtTiming(row.dueDate, outstandingAmount, now) }; });
  const rows = payables.map(row => { const totalAmount = Number(row.totalAmount); const paidAmount = Number(row.paidAmount); const outstandingAmount = totalAmount - paidAmount; return { id: row.id, code: row.code, totalAmount, paidAmount, outstandingAmount, dueDate: row.dueDate, status: row.status, timing: debtTiming(row.dueDate, outstandingAmount, now), createdAt: row.createdAt, supplier: row.supplier, purchaseOrder: row.purchaseOrder, paymentCount: row._count.payments }; });
  const filtered = input.timing === 'all' ? rows : rows.filter(row => row.timing === input.timing);
  const supplierMap = new Map<string, { id: string; code: string; name: string; payableCount: number; totalAmount: number; paidAmount: number; outstandingAmount: number; overdueAmount: number }>();
  const storeMap = new Map<string, { id: string; code: string; name: string; payableCount: number; outstandingAmount: number; overdueAmount: number }>();
  for (const row of rows) {
    const supplier = supplierMap.get(row.supplier.id) ?? { ...row.supplier, payableCount: 0, totalAmount: 0, paidAmount: 0, outstandingAmount: 0, overdueAmount: 0 }; supplier.payableCount++; supplier.totalAmount += row.totalAmount; supplier.paidAmount += row.paidAmount; supplier.outstandingAmount += row.outstandingAmount; if (row.timing === 'OVERDUE') supplier.overdueAmount += row.outstandingAmount; supplierMap.set(row.supplier.id, supplier);
    const branch = row.purchaseOrder.warehouse.store; const store = storeMap.get(branch.id) ?? { ...branch, payableCount: 0, outstandingAmount: 0, overdueAmount: 0 }; store.payableCount++; store.outstandingAmount += row.outstandingAmount; if (row.timing === 'OVERDUE') store.overdueAmount += row.outstandingAmount; storeMap.set(branch.id, store);
  }
  const paymentWhere: Prisma.PayablePaymentWhereInput = { payable: where };
  const recentPayments = await prisma.payablePayment.findMany({ where: paymentWhere, take: 30, orderBy: { paidAt: 'desc' }, include: { paidBy: { select: { id: true, name: true } }, payable: { include: { supplier: { select: { id: true, code: true, name: true } }, purchaseOrder: { select: { code: true, warehouse: { select: { name: true, store: { select: { id: true, code: true, name: true } } } } } } } } } });
  const skip = (input.page - 1) * input.pageSize;
  const sum = (selector: (row: typeof rows[number]) => number) => rows.reduce((total, row) => total + selector(row), 0);
  return {
    receivablesEnabled: true,
    receivableSummary: {
      totalAmount: receivableRows.reduce((total, row) => total + row.totalAmount, 0),
      collectedAmount: receivableRows.reduce((total, row) => total + row.paidAmount, 0),
      outstandingAmount: receivableRows.reduce((total, row) => total + row.outstandingAmount, 0),
      dueSoonAmount: receivableRows.filter(row => row.timing === 'DUE_SOON').reduce((total, row) => total + row.outstandingAmount, 0),
      overdueAmount: receivableRows.filter(row => row.timing === 'OVERDUE').reduce((total, row) => total + row.outstandingAmount, 0),
      count: receivableRows.length,
    },
    summary: { totalAmount: sum(row => row.totalAmount), paidAmount: sum(row => row.paidAmount), outstandingAmount: sum(row => row.outstandingAmount), currentAmount: sum(row => row.timing === 'CURRENT' ? row.outstandingAmount : 0), dueSoonAmount: sum(row => row.timing === 'DUE_SOON' ? row.outstandingAmount : 0), overdueAmount: sum(row => row.timing === 'OVERDUE' ? row.outstandingAmount : 0), currentCount: rows.filter(row => row.timing === 'CURRENT').length, dueSoonCount: rows.filter(row => row.timing === 'DUE_SOON').length, overdueCount: rows.filter(row => row.timing === 'OVERDUE').length, paidCount: rows.filter(row => row.timing === 'PAID').length },
    items: filtered.slice(skip, skip + input.pageSize),
    pagination: { page: input.page, pageSize: input.pageSize, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / input.pageSize)) },
    suppliers: [...supplierMap.values()].sort((a, b) => b.outstandingAmount - a.outstandingAmount),
    stores: [...storeMap.values()].sort((a, b) => b.outstandingAmount - a.outstandingAmount),
    recentPayments: recentPayments.map(payment => ({ ...payment, amount: Number(payment.amount) })),
  };
}

export async function getProductPerformance(user: CurrentUser, input: z.infer<typeof productPerformanceInput>) {
  const today = new Date(); const defaultTo = dayKey(today); const defaultFromDate = new Date(today); defaultFromDate.setDate(defaultFromDate.getDate() - 29);
  const fromText = input.from ?? dayKey(defaultFromDate); const toText = input.to ?? defaultTo; const from = localDate(fromText); const to = localDate(toText, true);
  const periodDays = Math.floor((localDate(toText).getTime() - localDate(fromText).getTime()) / 86_400_000) + 1; const previousTo = new Date(from.getTime() - 1); const previousFrom = new Date(previousTo); previousFrom.setDate(previousFrom.getDate() - periodDays + 1); previousFrom.setHours(0, 0, 0, 0);
  const assignedStoreIds = user.stores.map(store => store.id); if (input.storeId && !user.globalAccess && !assignedStoreIds.includes(input.storeId)) throw new AppError(403, 'STORE_FORBIDDEN', 'Bạn không được xem báo cáo của chi nhánh này.');
  const storeIds = input.storeId ? [input.storeId] : user.globalAccess ? undefined : assignedStoreIds;
  const skuWhere: Prisma.SkuWhereInput = { active: true, product: { active: true, ...(input.productId ? { id: input.productId } : {}), ...(input.categoryId ? { categoryId: input.categoryId } : {}) }, ...(input.q ? { OR: [{ code: { contains: input.q, mode: 'insensitive' } }, { barcode: { contains: input.q } }, { product: { OR: [{ code: { contains: input.q, mode: 'insensitive' } }, { name: { contains: input.q, mode: 'insensitive' } }] } }] } : {}) };
  const invoiceScope: Prisma.InvoiceWhereInput = { status: 'COMPLETED', ...(storeIds ? { storeId: { in: storeIds } } : {}) };
  const [skus, currentItems, previousItems] = await Promise.all([
    prisma.sku.findMany({ where: skuWhere, include: { product: { include: { category: true } }, inventories: { where: storeIds ? { warehouse: { storeId: { in: storeIds } } } : {}, select: { onHand: true, reserved: true, safetyStock: true } } }, orderBy: { code: 'asc' } }),
    prisma.invoiceItem.findMany({ where: { sku: skuWhere, invoice: { ...invoiceScope, completedAt: { gte: from, lte: to } } }, select: { skuId: true, quantity: true, lineTotal: true, costPrice: true, salesReturnItems: { select: { quantity: true, restock: true, lineRefund: true } }, invoice: { select: { id: true, subtotal: true, total: true, completedAt: true } } } }),
    prisma.invoiceItem.findMany({ where: { sku: skuWhere, invoice: { ...invoiceScope, completedAt: { gte: previousFrom, lte: previousTo } } }, select: { skuId: true, quantity: true, lineTotal: true, salesReturnItems: { select: { quantity: true, lineRefund: true } }, invoice: { select: { subtotal: true, total: true } } } }),
  ]);
  type Sales = { quantity: number; costOfGoods: number; revenue: number; invoiceIds: Set<string>; lastSaleAt: Date | null };
  const current = new Map<string, Sales>(); const previous = new Map<string, { quantity: number; revenue: number }>();
  for (const item of currentItems) { const row = current.get(item.skuId) ?? { quantity: 0, costOfGoods: 0, revenue: 0, invoiceIds: new Set<string>(), lastSaleAt: null }; const subtotal = Number(item.invoice.subtotal); const returned = item.salesReturnItems.reduce((sum, value) => sum + value.quantity, 0); const restocked = item.salesReturnItems.filter(value => value.restock).reduce((sum, value) => sum + value.quantity, 0); row.quantity += item.quantity - returned; row.costOfGoods += (item.quantity - restocked) * Number(item.costPrice); row.revenue += Number(item.lineTotal) * (subtotal > 0 ? Number(item.invoice.total) / subtotal : 0) - item.salesReturnItems.reduce((sum, value) => sum + Number(value.lineRefund), 0); row.invoiceIds.add(item.invoice.id); if (!row.lastSaleAt || item.invoice.completedAt > row.lastSaleAt) row.lastSaleAt = item.invoice.completedAt; current.set(item.skuId, row); }
  for (const item of previousItems) { const row = previous.get(item.skuId) ?? { quantity: 0, revenue: 0 }; const subtotal = Number(item.invoice.subtotal); row.quantity += item.quantity - item.salesReturnItems.reduce((sum, value) => sum + value.quantity, 0); row.revenue += Number(item.lineTotal) * (subtotal > 0 ? Number(item.invoice.total) / subtotal : 0) - item.salesReturnItems.reduce((sum, value) => sum + Number(value.lineRefund), 0); previous.set(item.skuId, row); }
  const rows = skus.map(sku => { const sales = current.get(sku.id) ?? { quantity: 0, costOfGoods: 0, revenue: 0, invoiceIds: new Set<string>(), lastSaleAt: null }; const prior = previous.get(sku.id) ?? { quantity: 0, revenue: 0 }; const onHand = sku.inventories.reduce((sum, row) => sum + row.onHand, 0); const available = sku.inventories.reduce((sum, row) => sum + row.onHand - row.reserved, 0); const safetyStock = sku.inventories.reduce((sum, row) => sum + row.safetyStock, 0); const costOfGoods = sales.costOfGoods; const grossProfit = sales.revenue - costOfGoods; return { id: sku.id, skuCode: sku.code, barcode: sku.barcode, productId: sku.product.id, productCode: sku.product.code, productName: sku.product.name, imageUrl: sku.product.imageUrl, unit: sku.product.unit, category: { id: sku.product.category.id, code: sku.product.category.code, name: sku.product.category.name }, quantity: sales.quantity, revenue: sales.revenue, invoiceCount: sales.invoiceIds.size, averagePrice: sales.quantity ? sales.revenue / sales.quantity : 0, costOfGoods, grossProfit, grossMargin: sales.revenue ? grossProfit * 100 / sales.revenue : 0, previousQuantity: prior.quantity, previousRevenue: prior.revenue, revenueGrowth: prior.revenue ? (sales.revenue - prior.revenue) * 100 / prior.revenue : null, lastSaleAt: sales.lastSaleAt, onHand, available, safetyStock, inventoryValue: onHand * Number(sku.costPrice), highStock: safetyStock > 0 && available >= safetyStock * 2 }; });
  const positiveQuantities = rows.filter(row => row.quantity > 0).map(row => row.quantity); const averageSoldQuantity = positiveQuantities.length ? positiveQuantities.reduce((sum, value) => sum + value, 0) / positiveQuantities.length : 0; const topIds = new Set([...rows].sort((a, b) => b.quantity - a.quantity).filter(row => row.quantity > 0).slice(0, 20).map(row => row.id));
  const classified = rows.map(row => ({ ...row, topSelling: topIds.has(row.id), slowMoving: row.quantity > 0 && row.quantity < averageSoldQuantity }));
  const filtered = input.status === 'all' ? classified : input.status === 'TOP_SELLING' ? classified.filter(row => row.topSelling) : input.status === 'SLOW_MOVING' ? classified.filter(row => row.slowMoving) : input.status === 'NO_SALES' ? classified.filter(row => row.quantity === 0) : classified.filter(row => row.highStock);
  const categoryMap = new Map<string, { id: string; code: string; name: string; skuCount: number; quantity: number; revenue: number; grossProfit: number; inventoryValue: number }>();
  for (const row of classified) { const category = categoryMap.get(row.category.id) ?? { ...row.category, skuCount: 0, quantity: 0, revenue: 0, grossProfit: 0, inventoryValue: 0 }; category.skuCount++; category.quantity += row.quantity; category.revenue += row.revenue; category.grossProfit += row.grossProfit; category.inventoryValue += row.inventoryValue; categoryMap.set(row.category.id, category); }
  const skip = (input.page - 1) * input.pageSize; const totalRevenue = classified.reduce((sum, row) => sum + row.revenue, 0); const totalGrossProfit = classified.reduce((sum, row) => sum + row.grossProfit, 0);
  return { filters: { from: fromText, to: toText }, summary: { activeSkus: classified.length, soldSkus: classified.filter(row => row.quantity > 0).length, noSales: classified.filter(row => row.quantity === 0).length, slowMoving: classified.filter(row => row.slowMoving).length, highStock: classified.filter(row => row.highStock).length, quantity: classified.reduce((sum, row) => sum + row.quantity, 0), revenue: totalRevenue, grossProfit: totalGrossProfit, grossMargin: totalRevenue ? totalGrossProfit * 100 / totalRevenue : 0, inventoryValue: classified.reduce((sum, row) => sum + row.inventoryValue, 0) }, items: filtered.slice(skip, skip + input.pageSize), pagination: { page: input.page, pageSize: input.pageSize, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / input.pageSize)) }, topProducts: [...classified].filter(row => row.quantity > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 10), categories: [...categoryMap.values()].sort((a, b) => b.revenue - a.revenue), rules: { topSelling: '20 SKU có số lượng bán cao nhất trong kỳ', slowMoving: 'SKU có bán nhưng thấp hơn số lượng bán trung bình', highStock: 'Tồn khả dụng từ 200% mức an toàn' } };
}

export async function getBranchComparison(user: CurrentUser, input: z.infer<typeof branchComparisonInput>) {
  const today = new Date(); const defaultTo = dayKey(today); const defaultFromDate = new Date(today); defaultFromDate.setDate(defaultFromDate.getDate() - 29);
  const fromText = input.from ?? dayKey(defaultFromDate); const toText = input.to ?? defaultTo; const from = localDate(fromText); const to = localDate(toText, true);
  const periodDays = Math.floor((localDate(toText).getTime() - localDate(fromText).getTime()) / 86_400_000) + 1; const previousTo = new Date(from.getTime() - 1); const previousFrom = new Date(previousTo); previousFrom.setDate(previousFrom.getDate() - periodDays + 1); previousFrom.setHours(0, 0, 0, 0);
  const assignedStoreIds = user.stores.map(store => store.id); const storeWhere: Prisma.StoreWhereInput = { active: true, ...(user.globalAccess ? {} : { id: { in: assignedStoreIds } }) };
  const stores = await prisma.store.findMany({ where: storeWhere, select: { id: true, code: true, name: true, region: true }, orderBy: { code: 'asc' } }); const storeIds = stores.map(store => store.id);
  const productWhere: Prisma.ProductWhereInput = { ...(input.productId ? { id: input.productId } : {}), ...(input.categoryId ? { categoryId: input.categoryId } : {}) }; const itemWhere: Prisma.InvoiceItemWhereInput = input.productId || input.categoryId ? { sku: { product: productWhere } } : {};
  const invoiceWhere: Prisma.InvoiceWhereInput = { status: 'COMPLETED', storeId: { in: storeIds }, ...(input.productId || input.categoryId ? { items: { some: itemWhere } } : {}) };
  const [currentInvoices, previousInvoices, inventories, payables] = await Promise.all([
    prisma.invoice.findMany({ where: { ...invoiceWhere, completedAt: { gte: from, lte: to } }, select: { id: true, storeId: true, subtotal: true, total: true, items: { where: itemWhere, select: { quantity: true, lineTotal: true, costPrice: true, salesReturnItems: { select: { quantity: true, restock: true, lineRefund: true } } } } } }),
    prisma.invoice.findMany({ where: { ...invoiceWhere, completedAt: { gte: previousFrom, lte: previousTo } }, select: { storeId: true, subtotal: true, total: true, items: { where: itemWhere, select: { lineTotal: true, salesReturnItems: { select: { lineRefund: true } } } } } }),
    prisma.inventory.findMany({ where: { warehouse: { storeId: { in: storeIds } }, ...(input.productId || input.categoryId ? { sku: { product: productWhere } } : {}) }, select: { onHand: true, reserved: true, safetyStock: true, warehouse: { select: { storeId: true } }, sku: { select: { costPrice: true } } } }),
    prisma.payable.findMany({ where: { purchaseOrder: { warehouse: { storeId: { in: storeIds } } } }, select: { totalAmount: true, paidAmount: true, dueDate: true, status: true, purchaseOrder: { select: { warehouse: { select: { storeId: true } } } } } }),
  ]);
  type Branch = { id: string; code: string; name: string; region: string; revenue: number; previousRevenue: number; invoiceCount: number; quantity: number; costOfGoods: number; inventoryValue: number; inventoryQuantity: number; availableQuantity: number; lowStock: number; outOfStock: number; outstandingDebt: number; overdueDebt: number };
  const map = new Map(stores.map(store => [store.id, { ...store, revenue: 0, previousRevenue: 0, invoiceCount: 0, quantity: 0, costOfGoods: 0, inventoryValue: 0, inventoryQuantity: 0, availableQuantity: 0, lowStock: 0, outOfStock: 0, outstandingDebt: 0, overdueDebt: 0 } satisfies Branch]));
  for (const invoice of currentInvoices) { const branch = map.get(invoice.storeId); if (!branch) continue; const subtotal = Number(invoice.subtotal); const ratio = subtotal > 0 ? Number(invoice.total) / subtotal : 0; branch.invoiceCount++; for (const item of invoice.items) { const returned = item.salesReturnItems.reduce((sum, value) => sum + value.quantity, 0); const restocked = item.salesReturnItems.filter(value => value.restock).reduce((sum, value) => sum + value.quantity, 0); branch.quantity += item.quantity - returned; branch.revenue += Number(item.lineTotal) * ratio - item.salesReturnItems.reduce((sum, value) => sum + Number(value.lineRefund), 0); branch.costOfGoods += (item.quantity - restocked) * Number(item.costPrice); } }
  for (const invoice of previousInvoices) { const branch = map.get(invoice.storeId); if (!branch) continue; const subtotal = Number(invoice.subtotal); const ratio = subtotal > 0 ? Number(invoice.total) / subtotal : 0; branch.previousRevenue += invoice.items.reduce((sum, item) => sum + Number(item.lineTotal) * ratio - item.salesReturnItems.reduce((refund, value) => refund + Number(value.lineRefund), 0), 0); }
  for (const inventory of inventories) { const branch = map.get(inventory.warehouse.storeId); if (!branch) continue; const available = inventory.onHand - inventory.reserved; branch.inventoryQuantity += inventory.onHand; branch.availableQuantity += available; branch.inventoryValue += inventory.onHand * Number(inventory.sku.costPrice); if (available <= 0) branch.outOfStock++; else if (available <= inventory.safetyStock) branch.lowStock++; }
  for (const payable of payables) { const branch = map.get(payable.purchaseOrder.warehouse.storeId); if (!branch) continue; const outstanding = Number(payable.totalAmount) - Number(payable.paidAmount); branch.outstandingDebt += outstanding; if (payable.status !== 'PAID' && payable.dueDate < today) branch.overdueDebt += outstanding; }
  const branches = [...map.values()].map(branch => { const grossProfit = branch.revenue - branch.costOfGoods; return { ...branch, averageOrderValue: branch.invoiceCount ? branch.revenue / branch.invoiceCount : 0, grossProfit, grossMargin: branch.revenue ? grossProfit * 100 / branch.revenue : 0, revenueGrowth: branch.previousRevenue ? (branch.revenue - branch.previousRevenue) * 100 / branch.previousRevenue : null }; }).sort((a, b) => b.revenue - a.revenue).map((branch, index) => ({ ...branch, rank: index + 1 }));
  const totalRevenue = branches.reduce((sum, branch) => sum + branch.revenue, 0); const totalGrossProfit = branches.reduce((sum, branch) => sum + branch.grossProfit, 0);
  return { filters: { from: fromText, to: toText, categoryId: input.categoryId ?? null, productId: input.productId ?? null }, summary: { branchCount: branches.length, revenue: totalRevenue, invoiceCount: branches.reduce((sum, branch) => sum + branch.invoiceCount, 0), quantity: branches.reduce((sum, branch) => sum + branch.quantity, 0), grossProfit: totalGrossProfit, grossMargin: totalRevenue ? totalGrossProfit * 100 / totalRevenue : 0, inventoryValue: branches.reduce((sum, branch) => sum + branch.inventoryValue, 0), lowStock: branches.reduce((sum, branch) => sum + branch.lowStock, 0), outOfStock: branches.reduce((sum, branch) => sum + branch.outOfStock, 0), outstandingDebt: branches.reduce((sum, branch) => sum + branch.outstandingDebt, 0), overdueDebt: branches.reduce((sum, branch) => sum + branch.overdueDebt, 0) }, branches };
}
