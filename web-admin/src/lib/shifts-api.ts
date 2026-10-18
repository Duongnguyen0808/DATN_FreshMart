import { api } from './auth-api';

export type ShiftStatus = 'OPEN' | 'PENDING_REVIEW' | 'CLOSED';
export type Denomination = { value: number; count: number };
export type Shift = {
  id: string; code: string; storeId: string; cashierId: string; posCode: string; name: string; status: ShiftStatus;
  openingCash: number; cashRevenue: number; digitalRevenue: number; cashExpenses: number; closingCash: number | null; cashDiscrepancy: number | null;
  discrepancyReason: string | null; denominations: Denomination[] | null; openedAt: string; closedAt: string | null; approvedAt: string | null; managerNote: string | null;
  store: { id: string; code: string; name: string }; cashier: { id: string; name: string; email: string }; approvedBy: { id: string; name: string; email: string } | null;
};
export type ShiftList = { items: Shift[]; pagination: { page: number; pageSize: number; total: number; totalPages: number }; summary: { total: number; open: number; pendingReview: number; closed: number } };
export type ShiftStaff = { id: string; name: string; email: string; stores: { store: { id: string; code: string; name: string } }[] };

export function getShifts(filters: { q?: string; status?: 'all' | ShiftStatus; storeId?: string; cashierId?: string; page?: number; pageSize?: number }) {
  const params = new URLSearchParams({ status: filters.status ?? 'all', page: String(filters.page ?? 1), pageSize: String(filters.pageSize ?? 20) });
  if (filters.q) params.set('q', filters.q);
  if (filters.storeId) params.set('storeId', filters.storeId);
  if (filters.cashierId) params.set('cashierId', filters.cashierId);
  return api<ShiftList>(`shifts?${params}`);
}
export const getShiftStaff = (storeId?: string) => api<ShiftStaff[]>(`shift-staff${storeId ? `?storeId=${encodeURIComponent(storeId)}` : ''}`);
export const getShift = (id: string) => api<Shift>(`shifts/${encodeURIComponent(id)}`);
export const openShift = (data: { storeId: string; cashierId: string; posCode: string; name: string; openingCash: number }) => api<Shift>('shifts', 'POST', data);
export const closeShift = (id: string, data: { closingCash: number; cashExpenses: number; discrepancyReason?: string; denominations: Denomination[] }) => api<Shift>(`shifts/${id}/close`, 'POST', data);
export const approveShift = (id: string, managerNote?: string) => api<Shift>(`shifts/${id}/approve`, 'POST', { managerNote: managerNote || null });
