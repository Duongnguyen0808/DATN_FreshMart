import { api } from './auth-api';

export type ReceivableStatus = 'OPEN' | 'PARTIALLY_PAID' | 'PAID';
export type ReceivableTiming = 'CURRENT' | 'DUE_SOON' | 'OVERDUE' | 'PAID';
export type CollectionMethod = 'CASH' | 'QR' | 'CARD';
export type ReceivablePayment = {
  id: string; code: string; amount: number; method: CollectionMethod; reference: string | null;
  note: string | null; paidAt: string; paidBy: { id: string; name: string; email: string };
};
export type Receivable = {
  id: string; code: string; invoiceId: string; customerId: string; storeId: string;
  totalAmount: number; paidAmount: number; outstandingAmount: number; dueDate: string;
  status: ReceivableStatus; timing: ReceivableTiming; createdAt: string;
  customer: { id: string; code: string; name: string; phone: string; email: string | null };
  store: { id: string; code: string; name: string };
  invoice: { id: string; code: string; completedAt: string; total: number; cashier: { id: string; name: string } };
  payments: ReceivablePayment[];
};
export type ReceivableList = {
  items: Receivable[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: { totalReceivable: number; collected: number; dueSoon: number; overdue: number };
};

export function getReceivables(filters: { q?: string; status?: 'all' | ReceivableStatus | 'DUE_SOON' | 'OVERDUE'; customerId?: string; storeId?: string; page?: number; pageSize?: number }) {
  const query = new URLSearchParams({ status: filters.status ?? 'all', page: String(filters.page ?? 1), pageSize: String(filters.pageSize ?? 20) });
  if (filters.q) query.set('q', filters.q);
  if (filters.customerId) query.set('customerId', filters.customerId);
  if (filters.storeId) query.set('storeId', filters.storeId);
  return api<ReceivableList>(`receivables?${query}`);
}
export const getReceivable = (id: string) => api<Receivable>(`receivables/${id}`);
export const collectReceivable = (id: string, data: { amount: number; method: CollectionMethod; reference?: string; note?: string }) => api<Receivable>(`receivables/${id}/payments`, 'POST', data);
export const collectCustomerReceivables = (customerId: string, data: { method: CollectionMethod; reference?: string; note?: string; allocations: { receivableId: string; amount: number }[] }) => api<Receivable[]>(`customers/${customerId}/receivable-payments`, 'POST', data);
