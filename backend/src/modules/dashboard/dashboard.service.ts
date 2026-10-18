import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../common/database.js';
import { AppError } from '../../common/app-error.js';
import type { CurrentUser } from '../auth/auth.repository.js';
import type { z } from 'zod';
import type { dashboardInput } from './dashboard.schemas.js';
import { summarizeDebt } from './debt-summary.js';
import { calculateNetSalesLine } from '../reports/sales-line.js';

const ids = (user: CurrentUser) => user.stores.map(store => store.id);
function assertScope(user: CurrentUser, storeId: string) { if (!user.globalAccess && !ids(user).includes(storeId)) throw new AppError(403, 'STORE_FORBIDDEN', 'Bạn không được xem dashboard của chi nhánh này.'); }
const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export async function getDashboard(user: CurrentUser, input: z.infer<typeof dashboardInput>) {
  if (input.storeId) assertScope(user, input.storeId);
  const allowedStores = input.storeId ? [input.storeId] : user.globalAccess ? undefined : ids(user);
  const storeWhere: Prisma.StoreWhereInput = { ...(allowedStores ? { id: { in: allowedStores } } : {}), active: true };
  const invoiceWhere: Prisma.InvoiceWhereInput = { status: 'COMPLETED', ...(allowedStores ? { storeId: { in: allowedStores } } : {}) };
  const inventoryWhere: Prisma.InventoryWhereInput = allowedStores ? { warehouse: { storeId: { in: allowedStores } } } : {};
  const payableWhere: Prisma.PayableWhereInput = allowedStores ? { purchaseOrder: { warehouse: { storeId: { in: allowedStores } } } } : {};
  const receivableWhere: Prisma.ReceivableWhereInput = allowedStores ? { storeId: { in: allowedStores } } : {};
  const transferWhere: Prisma.StockTransferWhereInput = allowedStores ? { OR: [{ sourceWarehouse: { storeId: { in: allowedStores } } }, { destinationWarehouse: { storeId: { in: allowedStores } } }] } : {};
  const today = new Date(); today.setHours(23, 59, 59, 999); const from = new Date(today); from.setDate(from.getDate() - input.period + 1); from.setHours(0, 0, 0, 0);
  const periodInvoices = await prisma.invoice.findMany({ where: { ...invoiceWhere, completedAt: { gte: from, lte: today } }, select: { completedAt: true, subtotal: true, total: true, refundedAmount: true, storeId: true, items: { select: { skuId: true, productName: true, skuCode: true, unit: true, quantity: true, lineTotal: true, costPrice: true, sku: { select: { product: { select: { id: true, code: true, imageUrl: true } } } }, salesReturnItems: { select: { quantity: true, restock: true, lineRefund: true } } } } } });
  const [stores, inventories, payables, receivables, pendingTransfers] = await Promise.all([
    prisma.store.findMany({ where: storeWhere, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } }),
    prisma.inventory.findMany({ where: inventoryWhere, select: { onHand: true, reserved: true, safetyStock: true, sku: { select: { costPrice: true } } } }),
    prisma.payable.findMany({ where: payableWhere, select: { totalAmount: true, paidAmount: true, dueDate: true, status: true } }),
    prisma.receivable.findMany({ where: receivableWhere, select: { totalAmount: true, paidAmount: true, dueDate: true } }),
    prisma.stockTransfer.count({ where: { AND: [transferWhere, { status: 'PENDING_APPROVAL' }] } }),
  ]);
  const revenue = periodInvoices.reduce((sum, invoice) => sum + Number(invoice.total) - Number(invoice.refundedAmount), 0);
  const seriesMap = new Map<string, { revenue: number; invoices: number }>();
  for (let index = 0; index < input.period; index++) { const date = new Date(from); date.setDate(from.getDate() + index); seriesMap.set(dayKey(date), { revenue: 0, invoices: 0 }); }
  for (const invoice of periodInvoices) { const point = seriesMap.get(dayKey(invoice.completedAt)); if (point) { point.revenue += Number(invoice.total) - Number(invoice.refundedAmount); point.invoices++; } }
  const branchMap = new Map(stores.map(store => [store.id, { ...store, revenue: 0, invoiceCount: 0 }]));
  for (const invoice of periodInvoices) { const branch = branchMap.get(invoice.storeId); if (branch) { branch.revenue += Number(invoice.total) - Number(invoice.refundedAmount); branch.invoiceCount++; } }
  const productMap = new Map<string, { productCode: string; productName: string; imageUrl: string | null; unit: string; quantity: number; revenue: number }>();
  let costOfGoods = 0;
  for (const invoice of periodInvoices) {
    for (const item of invoice.items) {
      const line = calculateNetSalesLine(invoice, item);
      costOfGoods += line.costOfGoods;
      const product = item.sku.product;
      const current = productMap.get(product.id) ?? { productCode: product.code, productName: item.productName, imageUrl: product.imageUrl, unit: item.unit, quantity: 0, revenue: 0 };
      current.quantity += line.netQuantity;
      current.revenue += line.netRevenue;
      productMap.set(product.id, current);
    }
  }
  const lowStock = inventories.filter(item => item.onHand - item.reserved <= item.safetyStock).length;
  const stockValue = inventories.reduce((sum, item) => sum + item.onHand * Number(item.sku.costPrice), 0);
  const payableDebt = summarizeDebt(payables);
  const receivableDebt = summarizeDebt(receivables);
  const grossProfit = revenue - costOfGoods;
  return { period: input.period, from: from.toISOString(), to: today.toISOString(), summary: { revenue, costOfGoods, grossProfit, grossMargin: revenue ? grossProfit * 100 / revenue : 0, invoiceCount: periodInvoices.length, stockValue, lowStock, outstandingDebt: payableDebt.outstanding, overdueDebt: payableDebt.overdue, overdueCount: payableDebt.overdueCount, outstandingReceivables: receivableDebt.outstanding, overdueReceivables: receivableDebt.overdue, overdueReceivableCount: receivableDebt.overdueCount, pendingTransfers }, revenueSeries: [...seriesMap].map(([date, value]) => ({ date, ...value })), branches: [...branchMap.values()].sort((a, b) => b.revenue - a.revenue), topProducts: [...productMap.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5) };
}
