import { Prisma } from '../../generated/prisma/client.js';
import { z } from 'zod';
import { prisma } from '../../common/database.js';
import { AppError } from '../../common/app-error.js';
import type { CurrentUser } from '../auth/auth.repository.js';

export const customerIdInput = z.string().uuid();
export const customerListInput = z.object({
  q: z.string().trim().max(100).optional(),
  active: z.enum(['true', 'false', 'all']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform(value => value || null);
export const customerInput = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(20).regex(/^[0-9+ .()-]+$/),
  email: z.string().trim().email().max(254).optional().nullable().transform(value => value || null),
  address: optionalText(300),
  note: optionalText(500),
}).strict();
export const customerStatusInput = z.object({ active: z.boolean() }).strict();

const normalizePhone = (value: string) => value.replace(/[ .()-]/g, '');
const customerCode = () => `CUS-${new Date().toISOString().slice(2, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
const duplicate = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

export async function listCustomers(input: z.infer<typeof customerListInput>) {
  const where: Prisma.CustomerWhereInput = {
    ...(input.active === 'all' ? {} : { active: input.active === 'true' }),
    ...(input.q ? { OR: [{ code: { contains: input.q, mode: 'insensitive' } }, { name: { contains: input.q, mode: 'insensitive' } }, { phone: { contains: input.q } }, { email: { contains: input.q, mode: 'insensitive' } }] } : {}),
  };
  const skip = (input.page - 1) * input.pageSize;
  const [rows, total, active, inactive] = await Promise.all([
    prisma.customer.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { code: 'asc' }], skip, take: input.pageSize }),
    prisma.customer.count({ where }), prisma.customer.count({ where: { active: true } }), prisma.customer.count({ where: { active: false } }),
  ]);
  const ids = rows.map(row => row.id);
  const sales = ids.length ? await prisma.invoice.groupBy({ by: ['customerId'], where: { customerId: { in: ids }, status: 'COMPLETED' }, _count: { _all: true }, _sum: { total: true, refundedAmount: true }, _max: { completedAt: true } }) : [];
  const salesMap = new Map(sales.map(row => [row.customerId, { orderCount: row._count._all, totalSpent: Number(row._sum.total ?? 0) - Number(row._sum.refundedAmount ?? 0), lastPurchaseAt: row._max.completedAt }]));
  return {
    items: rows.map(row => ({ ...row, ...(salesMap.get(row.id) ?? { orderCount: 0, totalSpent: 0, lastPurchaseAt: null }) })),
    pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.max(1, Math.ceil(total / input.pageSize)) },
    summary: { total: active + inactive, active, inactive },
  };
}

export async function getCustomer(id: string) {
  const row = await prisma.customer.findUnique({ where: { id }, include: { invoices: { orderBy: { completedAt: 'desc' }, take: 50, select: { id: true, code: true, status: true, total: true, completedAt: true, store: { select: { id: true, code: true, name: true } }, cashier: { select: { id: true, name: true } } } } } });
  if (!row) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Không tìm thấy khách hàng.');
  const sales = await prisma.invoice.aggregate({
    where: { customerId: id, status: 'COMPLETED' },
    _count: { _all: true },
    _sum: { total: true, refundedAmount: true },
    _max: { completedAt: true },
  });
  const invoices = row.invoices.map(invoice => ({ ...invoice, total: Number(invoice.total) }));
  return { ...row, invoices, summary: { orderCount: sales._count._all, totalSpent: Number(sales._sum.total ?? 0) - Number(sales._sum.refundedAmount ?? 0), lastPurchaseAt: sales._max.completedAt } };
}

export async function createCustomer(user: CurrentUser, input: z.infer<typeof customerInput>) {
  try {
    return await prisma.$transaction(async tx => {
      const row = await tx.customer.create({ data: { code: customerCode(), ...input, phone: normalizePhone(input.phone) } });
      await tx.auditLog.create({ data: { actorId: user.id, action: 'customer.create', targetId: row.id } });
      return row;
    });
  } catch (error) { if (duplicate(error)) throw new AppError(409, 'CUSTOMER_PHONE_EXISTS', 'Số điện thoại đã được sử dụng cho khách hàng khác.'); throw error; }
}

export async function updateCustomer(user: CurrentUser, id: string, input: z.infer<typeof customerInput>) {
  if (!await prisma.customer.count({ where: { id } })) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Không tìm thấy khách hàng.');
  try {
    return await prisma.$transaction(async tx => {
      const row = await tx.customer.update({ where: { id }, data: { ...input, phone: normalizePhone(input.phone) } });
      await tx.auditLog.create({ data: { actorId: user.id, action: 'customer.update', targetId: id } });
      return row;
    });
  } catch (error) { if (duplicate(error)) throw new AppError(409, 'CUSTOMER_PHONE_EXISTS', 'Số điện thoại đã được sử dụng cho khách hàng khác.'); throw error; }
}

export async function changeCustomerStatus(user: CurrentUser, id: string, active: boolean) {
  if (!await prisma.customer.count({ where: { id } })) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Không tìm thấy khách hàng.');
  return prisma.$transaction(async tx => {
    const row = await tx.customer.update({ where: { id }, data: { active } });
    await tx.auditLog.create({ data: { actorId: user.id, action: active ? 'customer.activate' : 'customer.deactivate', targetId: id } });
    return row;
  });
}
