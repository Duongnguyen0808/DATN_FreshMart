import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../common/database.js';
import { AppError } from '../../common/app-error.js';
import type { CurrentUser } from '../auth/auth.repository.js';
import type { z } from 'zod';
import type { createPayablePaymentInput, payableListInput } from './payables.schemas.js';

const storeIds = (user: CurrentUser) => user.stores.map(store => store.id);
const include = {
  supplier: true,
  purchaseOrder: {
    include: {
      warehouse: { include: { store: { select: { id: true, code: true, name: true } } } },
      items: { include: { sku: { include: { product: { select: { code: true, name: true, unit: true, imageUrl: true } } } } } },
    },
  },
  payments: { include: { paidBy: { select: { id: true, name: true, email: true } } }, orderBy: { paidAt: 'desc' as const } },
} as const;
const scope = (user: CurrentUser): Prisma.PayableWhereInput => user.globalAccess ? {} : { purchaseOrder: { warehouse: { storeId: { in: storeIds(user) } } } };
function timing(dueDate: Date, outstanding: number) { if (outstanding <= 0) return 'PAID'; const now = new Date(); const sevenDays = new Date(now.getTime() + 7 * 86400000); if (dueDate < now) return 'OVERDUE'; if (dueDate <= sevenDays) return 'DUE_SOON'; return 'CURRENT'; }
function present<T extends { totalAmount: unknown; paidAmount: unknown; dueDate: Date; payments: Array<{ amount: unknown }> }>(row: T) { const totalAmount = Number(row.totalAmount); const paidAmount = Number(row.paidAmount); const outstandingAmount = totalAmount - paidAmount; return { ...row, totalAmount, paidAmount, outstandingAmount, timing: timing(row.dueDate, outstandingAmount), payments: row.payments.map(payment => ({ ...payment, amount: Number(payment.amount) })) }; }
async function current(user: CurrentUser, id: string) { const row = await prisma.payable.findFirst({ where: { AND: [{ id }, scope(user)] }, include }); if (!row) throw new AppError(404, 'PAYABLE_NOT_FOUND', 'Không tìm thấy khoản phải trả.'); return row; }

export async function listPayables(user: CurrentUser, input: z.infer<typeof payableListInput>) {
  const base = scope(user); const now = new Date(); const sevenDays = new Date(now.getTime() + 7 * 86400000);
  const statusWhere: Prisma.PayableWhereInput = input.status === 'all' ? {} : input.status === 'OVERDUE' ? { status: { not: 'PAID' }, dueDate: { lt: now } } : input.status === 'DUE_SOON' ? { status: { not: 'PAID' }, dueDate: { gte: now, lte: sevenDays } } : { status: input.status };
  const where: Prisma.PayableWhereInput = { AND: [base, statusWhere, input.supplierId ? { supplierId: input.supplierId } : {}, input.q ? { OR: [{ code: { contains: input.q, mode: 'insensitive' } }, { supplier: { name: { contains: input.q, mode: 'insensitive' } } }, { purchaseOrder: { code: { contains: input.q, mode: 'insensitive' } } }] } : {}] };
  const skip = (input.page - 1) * input.pageSize;
  const [rows, total, all] = await Promise.all([prisma.payable.findMany({ where, include, orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }], skip, take: input.pageSize }), prisma.payable.count({ where }), prisma.payable.findMany({ where: base, select: { totalAmount: true, paidAmount: true, dueDate: true, status: true } })]);
  const values = all.map(row => { const totalValue = Number(row.totalAmount); const paidValue = Number(row.paidAmount); return { ...row, totalValue, paidValue, outstanding: totalValue - paidValue }; });
  return { items: rows.map(present), pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.max(1, Math.ceil(total / input.pageSize)) }, summary: { totalPayable: values.reduce((sum, row) => sum + row.outstanding, 0), paid: values.reduce((sum, row) => sum + row.paidValue, 0), dueSoon: values.filter(row => timing(row.dueDate, row.outstanding) === 'DUE_SOON').reduce((sum, row) => sum + row.outstanding, 0), overdue: values.filter(row => timing(row.dueDate, row.outstanding) === 'OVERDUE').reduce((sum, row) => sum + row.outstanding, 0) } };
}
export async function getPayable(user: CurrentUser, id: string) { return present(await current(user, id)); }
export async function payPayable(user: CurrentUser, id: string, input: z.infer<typeof createPayablePaymentInput>) {
  await current(user, id);
  return prisma.$transaction(async tx => {
    const row = await tx.payable.findUniqueOrThrow({ where: { id }, include }); const outstanding = Number(row.totalAmount) - Number(row.paidAmount);
    if (row.status === 'PAID' || outstanding <= 0) throw new AppError(409, 'PAYABLE_ALREADY_PAID', 'Khoản phải trả đã được thanh toán đủ.');
    if (input.amount > outstanding) throw new AppError(400, 'PAYMENT_EXCEEDS_OUTSTANDING', 'Số tiền thanh toán vượt quá số dư còn lại.');
    const paidAmount = Number(row.paidAmount) + input.amount; const completed = Math.abs(paidAmount - Number(row.totalAmount)) < 0.01;
    const payment = await tx.payablePayment.create({ data: { code: `PAY-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${Date.now().toString().slice(-7)}`, payableId: id, amount: input.amount, method: input.method, reference: input.reference, note: input.note, paidById: user.id } });
    await tx.payable.update({ where: { id }, data: { paidAmount: { increment: input.amount }, status: completed ? 'PAID' : 'PARTIALLY_PAID' } });
    await tx.supplier.update({ where: { id: row.supplierId }, data: { currentDebt: { decrement: input.amount } } });
    await tx.auditLog.create({ data: { actorId: user.id, action: 'payable.payment.create', targetId: payment.id } });
    return present(await tx.payable.findUniqueOrThrow({ where: { id }, include }));
  }, { isolationLevel: 'Serializable' });
}
