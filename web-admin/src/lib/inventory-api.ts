import { api } from './auth-api';
export type InventoryStatus = 'AVAILABLE' | 'LOW' | 'OUT';
export type Inventory = { id: string; warehouseId: string; skuId: string; onHand: number; reserved: number; available: number; inTransfer: number; incoming: number; safetyStock: number; stockValue: number; status: InventoryStatus; updatedAt: string; warehouse: { id: string; code: string; name: string; store: { id: string; code: string; name: string } }; sku: { id: string; code: string; barcode: string; costPrice: number; sellingPrice: number; product: { id: string; code: string; name: string; unit: string; imageUrl: string | null; category: { id: string; code: string; name: string } } } };
export type InventoryList = { items: Inventory[]; pagination: { page: number; pageSize: number; total: number; totalPages: number }; summary: { totalSku: number; available: number; low: number; out: number; stockValue: number } };
export type InventoryTransaction = { id: string; inventoryId: string; type: string; quantity: number; beforeQuantity: number; afterQuantity: number; referenceType: string; referenceId: string; reason: string; occurredAt: string; warehouse: { id: string; code: string; name: string; store: { id: string; code: string; name: string } }; sku: { id: string; code: string; product: { code: string; name: string; unit: string; imageUrl: string | null } }; actor: { id: string; name: string; email: string } | null };
export type TransactionList = { items: InventoryTransaction[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } };
export type InventoryTransactionType = 'OPENING' | 'SALE' | 'SALE_CANCEL' | 'SALE_RETURN' | 'STOCKTAKE' | 'STOCK_ADJUSTMENT' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'PURCHASE_RECEIPT';
export function getInventory(filters: { q?: string; status?: 'all' | InventoryStatus; storeId?: string; warehouseId?: string; categoryId?: string; page?: number; pageSize?: number }) { const params = new URLSearchParams({ status: filters.status ?? 'all', page: String(filters.page ?? 1), pageSize: String(filters.pageSize ?? 20) }); Object.entries(filters).forEach(([key, value]) => { if (value && !['status', 'page', 'pageSize'].includes(key)) params.set(key, String(value)); }); return api<InventoryList>(`inventory?${params}`); }
export const getInventoryItem = (id: string) => api<Inventory>(`inventory/${id}`);
export const setSafetyStock = (id: string, safetyStock: number) => api<Inventory>(`inventory/${id}/safety-stock`, 'PATCH', { safetyStock });
export const adjustStock = (id: string, actualQuantity: number, reason: string) => api<Inventory>(`inventory/${id}/adjustments`, 'POST', { actualQuantity, reason });
export function getInventoryTransactions(id: string, page = 1, type: 'all' | InventoryTransaction['type'] = 'all') { return api<TransactionList>(`inventory/${id}/transactions?page=${page}&pageSize=20&type=${type}`); }
export function getInventoryLedger(filters: { q?: string; warehouseId?: string; type?: 'all' | InventoryTransactionType; page?: number }) {
  const params = new URLSearchParams({ type: filters.type ?? 'all', page: String(filters.page ?? 1), pageSize: '20' });
  if (filters.q) params.set('q', filters.q);
  if (filters.warehouseId) params.set('warehouseId', filters.warehouseId);
  return api<TransactionList>(`inventory-transactions?${params}`);
}
