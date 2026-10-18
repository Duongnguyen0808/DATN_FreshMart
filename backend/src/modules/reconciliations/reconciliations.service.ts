import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../common/database.js';
import { AppError } from '../../common/app-error.js';
import type { CurrentUser } from '../auth/auth.repository.js';
import type { z } from 'zod';
import type { reconciliationListInput } from './reconciliations.schemas.js';

type Row = {
  id: string; type: 'PAYABLE' | 'RECEIVABLE'; code: string; documentId: string; documentCode: string;
  counterpartyId: string; counterpartyCode: string; counterpartyName: string;
  store: { id: string; code: string; name: string }; totalAmount: number; recordedPaidAmount: number;
  transactionAmount: number; outstandingAmount: number; recordedStatus: string; expectedStatus: string;
  difference: number; result: 'MATCHED' | 'DISCREPANCY'; issues: string[]; dueDate: Date; updatedAt: Date;
};
const scopedStoreIds = (user: CurrentUser, requested?: string) => {
  const assigned = user.stores.map(store => store.id);
  if (requested && !user.globalAccess && !assigned.includes(requested)) throw new AppError(403, 'STORE_FORBIDDEN', 'Bạn không được đối soát chi nhánh này.');
  return requested ? [requested] : user.globalAccess ? undefined : assigned;
};
const status = (total: number, paid: number) => total - paid <= 0.005 ? 'PAID' : paid > 0.005 ? 'PARTIALLY_PAID' : 'OPEN';
const issues = (total: number, paid: number, transactions: number, actualStatus: string) => {
  const values: string[] = [];
  if (Math.abs(paid - transactions) > 0.005) values.push('PAYMENT_TOTAL_MISMATCH');
  if (actualStatus !== status(total, transactions)) values.push('STATUS_MISMATCH');
  if (total - paid < -0.005) values.push('NEGATIVE_BALANCE');
  return values;
};

export async function listReconciliations(user: CurrentUser, input: z.infer<typeof reconciliationListInput>) {
  const storeIds = scopedStoreIds(user, input.storeId);
  const payableWhere: Prisma.PayableWhereInput = storeIds ? { purchaseOrder: { warehouse: { storeId: { in: storeIds } } } } : {};
  const receivableWhere: Prisma.ReceivableWhereInput = storeIds ? { storeId: { in: storeIds } } : {};
  const [payables, receivables] = await Promise.all([
    input.type === 'RECEIVABLE' ? Promise.resolve([]) : prisma.payable.findMany({ where: payableWhere, include: { payments: { select: { amount: true } }, supplier: { select: { id: true, code: true, name: true } }, purchaseOrder: { select: { id: true, code: true, warehouse: { select: { store: { select: { id: true, code: true, name: true } } } } } } } }),
    input.type === 'PAYABLE' ? Promise.resolve([]) : prisma.receivable.findMany({ where: receivableWhere, include: { payments: { select: { amount: true } }, customer: { select: { id: true, code: true, name: true } }, store: { select: { id: true, code: true, name: true } }, invoice: { select: { id: true, code: true } } } }),
  ]);
  const payableRows: Row[] = payables.map(row => { const total = Number(row.totalAmount); const paid = Number(row.paidAmount); const transactionAmount = row.payments.reduce((sum, payment) => sum + Number(payment.amount), 0); const rowIssues = issues(total, paid, transactionAmount, row.status); return { id: row.id, type: 'PAYABLE', code: row.code, documentId: row.purchaseOrder.id, documentCode: row.purchaseOrder.code, counterpartyId: row.supplier.id, counterpartyCode: row.supplier.code, counterpartyName: row.supplier.name, store: row.purchaseOrder.warehouse.store, totalAmount: total, recordedPaidAmount: paid, transactionAmount, outstandingAmount: total - paid, recordedStatus: row.status, expectedStatus: status(total, transactionAmount), difference: paid - transactionAmount, result: rowIssues.length ? 'DISCREPANCY' : 'MATCHED', issues: rowIssues, dueDate: row.dueDate, updatedAt: row.updatedAt }; });
  const receivableRows: Row[] = receivables.map(row => { const total = Number(row.totalAmount); const paid = Number(row.paidAmount); const transactionAmount = row.payments.reduce((sum, payment) => sum + Number(payment.amount), 0); const rowIssues = issues(total, paid, transactionAmount, row.status); return { id: row.id, type: 'RECEIVABLE', code: row.code, documentId: row.invoice.id, documentCode: row.invoice.code, counterpartyId: row.customer.id, counterpartyCode: row.customer.code, counterpartyName: row.customer.name, store: row.store, totalAmount: total, recordedPaidAmount: paid, transactionAmount, outstandingAmount: total - paid, recordedStatus: row.status, expectedStatus: status(total, transactionAmount), difference: paid - transactionAmount, result: rowIssues.length ? 'DISCREPANCY' : 'MATCHED', issues: rowIssues, dueDate: row.dueDate, updatedAt: row.updatedAt }; });
  const all = [...payableRows, ...receivableRows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const searched = input.q ? all.filter(row => `${row.code} ${row.documentCode} ${row.counterpartyCode} ${row.counterpartyName} ${row.store.code} ${row.store.name}`.toLocaleLowerCase('vi').includes(input.q!.toLocaleLowerCase('vi'))) : all;
  const filtered = input.result === 'all' ? searched : searched.filter(row => row.result === input.result);
  const skip = (input.page - 1) * input.pageSize;
  return {
    checkedAt: new Date(),
    summary: { total: all.length, matched: all.filter(row => row.result === 'MATCHED').length, discrepancy: all.filter(row => row.result === 'DISCREPANCY').length, affectedAmount: all.filter(row => row.result === 'DISCREPANCY').reduce((sum, row) => sum + Math.abs(row.difference), 0), payables: payableRows.length, receivables: receivableRows.length },
    items: filtered.slice(skip, skip + input.pageSize),
    pagination: { page: input.page, pageSize: input.pageSize, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / input.pageSize)) },
  };
}
