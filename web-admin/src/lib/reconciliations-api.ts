import { api } from './auth-api';

export type DebtType = 'PAYABLE' | 'RECEIVABLE';
export type ReconciliationResult = 'MATCHED' | 'DISCREPANCY';
export type ReconciliationIssue = 'PAYMENT_TOTAL_MISMATCH' | 'STATUS_MISMATCH' | 'NEGATIVE_BALANCE';
export type ReconciliationRow = {
  id: string; type: DebtType; code: string; documentId: string; documentCode: string;
  counterpartyId: string; counterpartyCode: string; counterpartyName: string;
  store: { id: string; code: string; name: string }; totalAmount: number; recordedPaidAmount: number;
  transactionAmount: number; outstandingAmount: number; recordedStatus: string; expectedStatus: string;
  difference: number; result: ReconciliationResult; issues: ReconciliationIssue[]; dueDate: string; updatedAt: string;
};
export type ReconciliationReport = {
  checkedAt: string;
  summary: { total: number; matched: number; discrepancy: number; affectedAmount: number; payables: number; receivables: number };
  items: ReconciliationRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};
export function getDebtReconciliation(filters: { q?: string; type?: 'all' | DebtType; result?: 'all' | ReconciliationResult; storeId?: string; page?: number }) {
  const params = new URLSearchParams({ type: filters.type ?? 'all', result: filters.result ?? 'all', page: String(filters.page ?? 1), pageSize: '20' });
  if (filters.q) params.set('q', filters.q);
  if (filters.storeId) params.set('storeId', filters.storeId);
  return api<ReconciliationReport>(`reconciliations/debt?${params}`);
}
