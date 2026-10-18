import { api } from './auth-api';

export type Customer = { id: string; code: string; name: string; phone: string; email: string | null; address: string | null; note: string | null; active: boolean; createdAt: string; updatedAt: string; orderCount: number; totalSpent: number; lastPurchaseAt: string | null };
export type CustomerDetail = Omit<Customer, 'orderCount' | 'totalSpent' | 'lastPurchaseAt'> & { summary: { orderCount: number; totalSpent: number; lastPurchaseAt: string | null }; invoices: { id: string; code: string; status: string; total: number; completedAt: string; store: { id: string; code: string; name: string }; cashier: { id: string; name: string } }[] };
export type CustomerList = { items: Customer[]; pagination: { page: number; pageSize: number; total: number; totalPages: number }; summary: { total: number; active: number; inactive: number } };
export type CustomerInput = { name: string; phone: string; email?: string | null; address?: string | null; note?: string | null };

export function getCustomers(filters: { q?: string; active?: 'true' | 'false' | 'all'; page?: number; pageSize?: number }) {
  const params = new URLSearchParams({ active: filters.active ?? 'all', page: String(filters.page ?? 1), pageSize: String(filters.pageSize ?? 20) });
  if (filters.q) params.set('q', filters.q);
  return api<CustomerList>(`customers?${params}`);
}
export const getCustomer = (id: string) => api<CustomerDetail>(`customers/${id}`);
export const createCustomer = (data: CustomerInput) => api<Customer>('customers', 'POST', data);
export const updateCustomer = (id: string, data: CustomerInput) => api<Customer>(`customers/${id}`, 'PUT', data);
export const setCustomerStatus = (id: string, active: boolean) => api<Customer>(`customers/${id}/status`, 'PATCH', { active });
