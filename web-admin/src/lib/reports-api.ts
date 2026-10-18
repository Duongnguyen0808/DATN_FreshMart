import { api } from './auth-api';

export type RevenueReport = {
  filters: { from: string; to: string; storeId: string | null; productId: string | null; categoryId: string | null };
  summary: { grossSales: number; discount: number; netRevenue: number; invoiceCount: number; quantity: number; averageOrderValue: number; costOfGoods: number; grossProfit: number; grossMargin: number };
  revenueSeries: { date: string; revenue: number; invoiceCount: number; quantity: number }[];
  branches: { id: string; code: string; name: string; revenue: number; invoiceCount: number; quantity: number }[];
  categories: { id: string; code: string; name: string; revenue: number; quantity: number }[];
  categoryProducts: { id: string; productCode: string; imageUrl: string | null; name: string; unit: string; revenue: number; quantity: number; categoryId: string; categoryCode: string; categoryName: string }[];
  topProducts: { id: string; productCode: string; imageUrl: string | null; name: string; unit: string; revenue: number; quantity: number }[];
};

export function getRevenueReport(filters: { from: string; to: string; storeId?: string; productId?: string; categoryId?: string }) {
  const params = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.storeId) params.set('storeId', filters.storeId);
  if (filters.productId) params.set('productId', filters.productId);
  if (filters.categoryId) params.set('categoryId', filters.categoryId);
  return api<RevenueReport>(`reports/revenue?${params}`);
}

export type InventoryReportStatus = 'NORMAL' | 'LOW' | 'OUT' | 'HIGH';
export type InventoryReport = {
  summary: { inventoryEntries: number; uniqueSkus: number; onHand: number; available: number; stockValue: number; normal: number; low: number; out: number; high: number; shortageQuantity: number; coveredShortages: number; uncoveredShortages: number };
  items: { id: string; skuId: string; skuCode: string; barcode: string; productId: string; productCode: string; productName: string; imageUrl: string | null; unit: string; category: { id: string; code: string; name: string }; warehouse: { id: string; code: string; name: string }; store: { id: string; code: string; name: string }; onHand: number; reserved: number; available: number; inTransfer: number; incoming: number; safetyStock: number; costPrice: number; stockValue: number; status: InventoryReportStatus; updatedAt: string }[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  warehouses: { id: string; code: string; name: string; storeName: string; skuCount: number; quantity: number; available: number; stockValue: number; lowCount: number; highCount: number }[];
  categories: { id: string; code: string; name: string; skuCount: number; quantity: number; stockValue: number }[];
  recentTransactions: { id: string; type: string; quantity: number; beforeQuantity: number; afterQuantity: number; referenceType: string; referenceId: string; reason: string; occurredAt: string; warehouse: { id: string; code: string; name: string; store: { id: string; code: string; name: string } }; sku: { id: string; code: string; product: { code: string; name: string; unit: string; imageUrl: string | null } }; actor: { id: string; name: string } | null }[];
};

export function getInventoryReport(filters: { q?: string; storeId?: string; warehouseId?: string; categoryId?: string; productId?: string; status?: 'all' | InventoryReportStatus | 'SHORTAGE'; page?: number; pageSize?: number }) {
  const params = new URLSearchParams({ status: filters.status ?? 'all', page: String(filters.page ?? 1), pageSize: String(filters.pageSize ?? 20) });
  Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== '' && !['status', 'page', 'pageSize'].includes(key)) params.set(key, String(value)); });
  return api<InventoryReport>(`reports/inventory?${params}`);
}

export type DebtTiming = 'CURRENT' | 'DUE_SOON' | 'OVERDUE' | 'PAID';
export type DebtReport = {
  receivablesEnabled: boolean;
  receivableSummary: { totalAmount: number; collectedAmount: number; outstandingAmount: number; dueSoonAmount: number; overdueAmount: number; count: number };
  summary: { totalAmount: number; paidAmount: number; outstandingAmount: number; currentAmount: number; dueSoonAmount: number; overdueAmount: number; currentCount: number; dueSoonCount: number; overdueCount: number; paidCount: number };
  items: { id: string; code: string; totalAmount: number; paidAmount: number; outstandingAmount: number; dueDate: string; status: string; timing: DebtTiming; createdAt: string; paymentCount: number; supplier: { id: string; code: string; name: string }; purchaseOrder: { id: string; code: string; warehouse: { id: string; code: string; name: string; store: { id: string; code: string; name: string } } } }[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  suppliers: { id: string; code: string; name: string; payableCount: number; totalAmount: number; paidAmount: number; outstandingAmount: number; overdueAmount: number }[];
  stores: { id: string; code: string; name: string; payableCount: number; outstandingAmount: number; overdueAmount: number }[];
  recentPayments: { id: string; code: string; amount: number; method: string; reference: string | null; note: string | null; paidAt: string; paidBy: { id: string; name: string }; payable: { id: string; code: string; supplier: { id: string; code: string; name: string }; purchaseOrder: { code: string; warehouse: { name: string; store: { id: string; code: string; name: string } } } } }[];
};

export function getDebtReport(filters: { q?: string; storeId?: string; supplierId?: string; timing?: 'all' | DebtTiming; page?: number; pageSize?: number }) {
  const params = new URLSearchParams({ timing: filters.timing ?? 'all', page: String(filters.page ?? 1), pageSize: String(filters.pageSize ?? 20) });
  if (filters.q) params.set('q', filters.q);
  if (filters.storeId) params.set('storeId', filters.storeId);
  if (filters.supplierId) params.set('supplierId', filters.supplierId);
  return api<DebtReport>(`reports/debt?${params}`);
}

export type ProductPerformanceStatus = 'TOP_SELLING' | 'SLOW_MOVING' | 'NO_SALES' | 'HIGH_STOCK';
export type ProductPerformanceRow = { id: string; skuCode: string; barcode: string; productId: string; productCode: string; productName: string; imageUrl: string | null; unit: string; category: { id: string; code: string; name: string }; quantity: number; revenue: number; invoiceCount: number; averagePrice: number; costOfGoods: number; grossProfit: number; grossMargin: number; previousQuantity: number; previousRevenue: number; revenueGrowth: number | null; lastSaleAt: string | null; onHand: number; available: number; safetyStock: number; inventoryValue: number; highStock: boolean; topSelling: boolean; slowMoving: boolean };
export type ProductPerformanceReport = {
  filters: { from: string; to: string };
  summary: { activeSkus: number; soldSkus: number; noSales: number; slowMoving: number; highStock: number; quantity: number; revenue: number; grossProfit: number; grossMargin: number; inventoryValue: number };
  items: ProductPerformanceRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  topProducts: ProductPerformanceRow[];
  categories: { id: string; code: string; name: string; skuCount: number; quantity: number; revenue: number; grossProfit: number; inventoryValue: number }[];
  rules: { topSelling: string; slowMoving: string; highStock: string };
};

export function getProductPerformance(filters: { from: string; to: string; q?: string; storeId?: string; categoryId?: string; productId?: string; status?: 'all' | ProductPerformanceStatus; page?: number; pageSize?: number }) {
  const params = new URLSearchParams({ from: filters.from, to: filters.to, status: filters.status ?? 'all', page: String(filters.page ?? 1), pageSize: String(filters.pageSize ?? 20) });
  for (const key of ['q', 'storeId', 'categoryId', 'productId'] as const) if (filters[key]) params.set(key, filters[key]!);
  return api<ProductPerformanceReport>(`reports/products?${params}`);
}

export type BranchComparisonRow = { id: string; code: string; name: string; region: string; rank: number; revenue: number; previousRevenue: number; revenueGrowth: number | null; invoiceCount: number; quantity: number; averageOrderValue: number; costOfGoods: number; grossProfit: number; grossMargin: number; inventoryValue: number; inventoryQuantity: number; availableQuantity: number; lowStock: number; outOfStock: number; outstandingDebt: number; overdueDebt: number };
export type BranchComparisonReport = { filters: { from: string; to: string; categoryId: string | null; productId: string | null }; summary: { branchCount: number; revenue: number; invoiceCount: number; quantity: number; grossProfit: number; grossMargin: number; inventoryValue: number; lowStock: number; outOfStock: number; outstandingDebt: number; overdueDebt: number }; branches: BranchComparisonRow[] };

export function getBranchComparison(filters: { from: string; to: string; categoryId?: string; productId?: string }) {
  const params = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.categoryId) params.set('categoryId', filters.categoryId);
  if (filters.productId) params.set('productId', filters.productId);
  return api<BranchComparisonReport>(`reports/branches?${params}`);
}
