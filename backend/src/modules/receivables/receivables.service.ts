import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../common/database.js';
import { AppError } from '../../common/app-error.js';
import type { CurrentUser } from '../auth/auth.repository.js';
import type { z } from 'zod';
import type { createReceivablePaymentInput, customerReceivablePaymentInput, receivableListInput } from './receivables.schemas.js';

const storeIds = (user: CurrentUser) => user.stores.map(store => store.id);
const scope = (user: CurrentUser): Prisma.ReceivableWhereInput => user.globalAccess ? {} : { storeId: { in: storeIds(user) } };
const include = { customer: { select: { id: true, code: true, name: true, phone: true, email: true } }, store: { select: { id: true, code: true, name: true } }, invoice: { select: { id: true, code: true, completedAt: true, total: true, cashier: { select: { id: true, name: true } } } }, payments: { include: { paidBy: { select: { id: true, name: true, email: true } } }, orderBy: { paidAt: 'desc' as const } } } as const;
function timing(dueDate: Date, outstanding: number) { if (outstanding <= 0) return 'PAID'; const now = new Date(); const sevenDays = new Date(now.getTime() + 7 * 86400000); if (dueDate < now) return 'OVERDUE'; if (dueDate <= sevenDays) return 'DUE_SOON'; return 'CURRENT'; }
function present<T extends { totalAmount: unknown; paidAmount: unknown; dueDate: Date; invoice: { total: unknown }; payments: Array<{ amount: unknown }> }>(row: T) { const totalAmount = Number(row.totalAmount); const paidAmount = Number(row.paidAmount); const outstandingAmount = totalAmount - paidAmount; return { ...row, totalAmount, paidAmount, outstandingAmount, timing: timing(row.dueDate, outstandingAmount), invoice: { ...row.invoice, total: Number(row.invoice.total) }, payments: row.payments.map(payment => ({ ...payment, amount: Number(payment.amount) })) }; }
async function current(user: CurrentUser, id: string) { const row = await prisma.receivable.findFirst({ where: { AND: [{ id }, scope(user)] }, include }); if (!row) throw new AppError(404, 'RECEIVABLE_NOT_FOUND', 'Không tìm thấy khoản phải thu.'); return row; }

export async function listReceivables(user: CurrentUser, input: z.infer<typeof receivableListInput>) {
  if (input.storeId && !user.globalAccess && !storeIds(user).includes(input.storeId)) throw new AppError(403, 'STORE_FORBIDDEN', 'Bạn không được xem công nợ của chi nhánh này.');
  const base: Prisma.ReceivableWhereInput = { AND: [scope(user), input.storeId ? { storeId: input.storeId } : {}] };
  const now = new Date(); const sevenDays = new Date(now.getTime() + 7 * 86400000);
  const statusWhere: Prisma.ReceivableWhereInput = input.status === 'all' ? {} : input.status === 'OVERDUE' ? { status: { not: 'PAID' }, dueDate: { lt: now } } : input.status === 'DUE_SOON' ? { status: { not: 'PAID' }, dueDate: { gte: now, lte: sevenDays } } : { status: input.status };
  const where: Prisma.ReceivableWhereInput = { AND: [base, statusWhere, input.customerId ? { customerId: input.customerId } : {}, input.q ? { OR: [{ code: { contains: input.q, mode: 'insensitive' } }, { customer: { name: { contains: input.q, mode: 'insensitive' } } }, { customer: { phone: { contains: input.q } } }, { invoice: { code: { contains: input.q, mode: 'insensitive' } } }] } : {}] };
  const skip = (input.page - 1) * input.pageSize;
  const [rows, total, all] = await Promise.all([prisma.receivable.findMany({ where, include, orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }], skip, take: input.pageSize }), prisma.receivable.count({ where }), prisma.receivable.findMany({ where: base, select: { totalAmount: true, paidAmount: true, dueDate: true } })]);
  const values = all.map(row => { const totalAmount = Number(row.totalAmount); const paidAmount = Number(row.paidAmount); return { totalAmount, paidAmount, outstanding: totalAmount - paidAmount, dueDate: row.dueDate }; });
  return { items: rows.map(present), pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.max(1, Math.ceil(total / input.pageSize)) }, summary: { totalReceivable: values.reduce((sum, row) => sum + row.outstanding, 0), collected: values.reduce((sum, row) => sum + row.paidAmount, 0), dueSoon: values.filter(row => timing(row.dueDate, row.outstanding) === 'DUE_SOON').reduce((sum, row) => sum + row.outstanding, 0), overdue: values.filter(row => timing(row.dueDate, row.outstanding) === 'OVERDUE').reduce((sum, row) => sum + row.outstanding, 0) } };
}
export async function getReceivable(user: CurrentUser, id: string) { return present(await current(user, id)); }
export async function collectReceivable(user: CurrentUser, id: string, input: z.infer<typeof createReceivablePaymentInput>) {
  await current(user, id);
  try {
    return await prisma.$transaction(async tx => {
      const row = await tx.receivable.findUniqueOrThrow({ where: { id }, include }); const outstanding = Number(row.totalAmount) - Number(row.paidAmount);
      if (row.status === 'PAID' || outstanding <= 0) throw new AppError(409, 'RECEIVABLE_ALREADY_PAID', 'Khoản phải thu đã được thanh toán đủ.');
      if (input.amount > outstanding) throw new AppError(400, 'PAYMENT_EXCEEDS_OUTSTANDING', 'Số tiền thu vượt quá số dư còn lại.');
      const paidAmount = Number(row.paidAmount) + input.amount; const completed = Math.abs(paidAmount - Number(row.totalAmount)) < 0.01;
      const payment = await tx.receivablePayment.create({ data: { code: `COL-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${Date.now().toString().slice(-7)}`, receivableId: id, amount: input.amount, method: input.method, reference: input.reference, note: input.note, paidById: user.id } });
      await tx.receivable.update({ where: { id }, data: { paidAmount: { increment: input.amount }, status: completed ? 'PAID' : 'PARTIALLY_PAID' } });
      await tx.auditLog.create({ data: { actorId: user.id, action: 'receivable.payment.create', targetId: payment.id } });
      return present(await tx.receivable.findUniqueOrThrow({ where: { id }, include }));
    }, { isolationLevel: 'Serializable' });
  } catch (error) { if (error instanceof AppError) throw error; if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') throw new AppError(409, 'RECEIVABLE_CONFLICT', 'Khoản công nợ vừa thay đổi. Vui lòng tải lại.'); throw error; }
}

export async function collectCustomerReceivables(user: CurrentUser, customerId: string, input: z.infer<typeof customerReceivablePaymentInput>) {
  const ids = input.allocations.map(row => row.receivableId);
  const scopedWhere: Prisma.ReceivableWhereInput = { AND: [{ id: { in: ids } }, { customerId }, scope(user)] };
  const existing = await prisma.receivable.findMany({ where: scopedWhere, select: { id: true, totalAmount: true, paidAmount: true, status: true } });
  if (existing.length !== ids.length) throw new AppError(404, 'RECEIVABLE_NOT_FOUND', 'Không tìm thấy khoản phải thu của khách hàng này.');
  const byId = new Map(existing.map(row => [row.id, row]));
  for (const allocation of input.allocations) {
    const row = byId.get(allocation.receivableId)!;
    const outstanding = Number(row.totalAmount) - Number(row.paidAmount);
    if (row.status === 'PAID' || outstanding <= 0) throw new AppError(409, 'RECEIVABLE_ALREADY_PAID', 'Một hóa đơn đã được thanh toán đủ.');
    if (allocation.amount > outstanding) throw new AppError(400, 'PAYMENT_EXCEEDS_OUTSTANDING', 'Số tiền phân bổ vượt quá công nợ của hóa đơn.');
  }
  try {
    return await prisma.$transaction(async tx => {
      const updated = [];
      for (const allocation of input.allocations) {
        const row = await tx.receivable.findUniqueOrThrow({ where: { id: allocation.receivableId } });
        const paidAmount = Number(row.paidAmount) + allocation.amount;
        const completed = Math.abs(paidAmount - Number(row.totalAmount)) < 0.01;
        const payment = await tx.receivablePayment.create({ data: { code: `COL-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${Date.now().toString().slice(-7)}-${updated.length + 1}`, receivableId: row.id, amount: allocation.amount, method: input.method, reference: input.reference, note: input.note, paidById: user.id } });
        await tx.receivable.update({ where: { id: row.id }, data: { paidAmount: { increment: allocation.amount }, status: completed ? 'PAID' : 'PARTIALLY_PAID' } });
        await tx.auditLog.create({ data: { actorId: user.id, action: 'receivable.payment.create', targetId: payment.id } });
        updated.push(present(await tx.receivable.findUniqueOrThrow({ where: { id: row.id }, include })));
      }
      return updated;
    }, { isolationLevel: 'Serializable' });
  } catch (error) { if (error instanceof AppError) throw error; if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') throw new AppError(409, 'RECEIVABLE_CONFLICT', 'Khoản công nợ vừa thay đổi. Vui lòng tải lại.'); throw error; }
}
