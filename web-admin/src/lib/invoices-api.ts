import { api } from './auth-api';

export type PaymentMethod = 'CASH' | 'QR' | 'CARD';
export type InvoiceStatus = 'COMPLETED' | 'CANCELLED';
export type Invoice = {
  id: string; code: string; shiftId: string; storeId: string; cashierId: string; customerName: string | null; customerPhone: string | null;
  status: InvoiceStatus; subtotal: number; discount: number; total: number; refundedAmount: number; creditAmount: number; note: string | null; completedAt: string; cancelledAt: string | null; cancellationReason: string | null;
  store: { id: string; code: string; name: string }; cashier: { id: string; name: string; email: string }; shift: { id: string; code: string; posCode: string; name: string; status: string };
  cancelledBy: { id: string; name: string; email: string } | null; customer?: { id: string; code: string; name: string; phone: string; email: string | null; active: boolean } | null;
  items: { id: string; skuId: string; productCode: string; skuCode: string; productName: string; unit: string; quantity: number; unitPrice: number; lineTotal: number; sku: { product: { imageUrl: string | null } } }[];
  payments: { id: string; method: PaymentMethod; amount: number; reference: string | null }[];
  salesReturns: SalesReturn[];
  receivable?: { id: string; code: string; totalAmount: number; paidAmount: number; dueDate: string; status: 'OPEN' | 'PARTIALLY_PAID' | 'PAID' } | null;
};
export type SalesReturn = { id: string; code: string; reason: string; refundMethod: PaymentMethod; refundReference: string | null; refundAmount: number; createdAt: string; processedBy: { id: string; name: string; email: string }; items: { id: string; invoiceItemId: string; skuId: string; quantity: number; restock: boolean; unitRefund: number; lineRefund: number; invoiceItem: { productCode: string; skuCode: string; productName: string; unit: string; sku: { product: { imageUrl: string | null } } } }[] };
export type SalesReturnCreate = { reason: string; refundMethod: PaymentMethod; refundReference?: string | null; items: { invoiceItemId: string; quantity: number; restock: boolean }[] };
export type SalesReturnRecord = SalesReturn & { invoice: { id: string; code: string; customerName: string | null; customerPhone: string | null; store: { id: string; code: string; name: string } } };
export type SalesReturnList = { items: SalesReturnRecord[]; pagination: { page: number; pageSize: number; total: number; totalPages: number }; summary: { total: number; refundAmount: number; restockedQuantity: number; nonRestockedQuantity: number } };
export type InvoiceList = { items: Invoice[]; pagination: { page: number; pageSize: number; total: number; totalPages: number }; summary: { total: number; completed: number; cancelled: number; revenue: number } };
export type PaymentTransaction = { id: string; invoiceId: string; method: PaymentMethod; amount: number; reference: string | null; invoice: { id: string; code: string; status: InvoiceStatus; completedAt: string; total: number; customerName: string | null; customerPhone: string | null; store: { id: string; code: string; name: string }; cashier: { id: string; name: string }; shift: { id: string; code: string; posCode: string } } };
export type PaymentTransactionList = { items: PaymentTransaction[]; pagination: { page: number; pageSize: number; total: number; totalPages: number }; summary: { total: number; amount: number; methods: Record<PaymentMethod, { count: number; amount: number }> } };
export type InvoiceCreate = { shiftId: string; warehouseId?: string; customerId?: string; customerName?: string; customerPhone?: string; discount: number; creditAmount?: number; creditDueDate?: string; note?: string; items: { skuId: string; quantity: number }[]; payments: { method: PaymentMethod; amount: number; reference?: string }[] };
export function getInvoices(filters: { q?: string; status?: 'all' | InvoiceStatus; page?: number }) { const params = new URLSearchParams({ status: filters.status ?? 'all', page: String(filters.page ?? 1), pageSize: '20' }); if (filters.q) params.set('q', filters.q); return api<InvoiceList>(`invoices?${params}`); }
export const getInvoice = (id: string) => api<Invoice>(`invoices/${id}`);
export const createInvoice = (data: InvoiceCreate) => api<Invoice>('invoices', 'POST', data);
export const cancelInvoice = (id: string, reason: string) => api<Invoice>(`invoices/${id}/cancel`, 'POST', { reason });
export const createSalesReturn = (id: string, data: SalesReturnCreate) => api<Invoice>(`invoices/${id}/returns`, 'POST', data);
export function getSalesReturns(filters: { q?: string; refundMethod?: 'all' | PaymentMethod; storeId?: string; from?: string; to?: string; page?: number }) {
  const params = new URLSearchParams({ refundMethod: filters.refundMethod ?? 'all', page: String(filters.page ?? 1), pageSize: '20' });
  if (filters.q) params.set('q', filters.q); if (filters.storeId) params.set('storeId', filters.storeId); if (filters.from) params.set('from', filters.from); if (filters.to) params.set('to', filters.to);
  return api<SalesReturnList>(`returns?${params}`);
}
export function getPaymentTransactions(filters: { q?: string; method?: 'all' | PaymentMethod; status?: 'all' | InvoiceStatus; storeId?: string; from?: string; to?: string; page?: number }) {
  const params = new URLSearchParams({ method: filters.method ?? 'all', status: filters.status ?? 'all', page: String(filters.page ?? 1), pageSize: '20' });
  if (filters.q) params.set('q', filters.q);
  if (filters.storeId) params.set('storeId', filters.storeId);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  return api<PaymentTransactionList>(`invoice-payments?${params}`);
}
