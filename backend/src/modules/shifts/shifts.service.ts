import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../common/database.js';
import { AppError } from '../../common/app-error.js';
import type { CurrentUser } from '../auth/auth.repository.js';
import type { z } from 'zod';
import type { approveShiftInput, closeShiftInput, openShiftInput, shiftListInput, shiftStaffInput } from './shifts.schemas.js';

const includeShift = {
  store: { select: { id: true, code: true, name: true } },
  cashier: { select: { id: true, name: true, email: true } },
  approvedBy: { select: { id: true, name: true, email: true } },
};
const scopeIds = (user: CurrentUser) => user.stores.map(store => store.id);
const canApprove = (user: CurrentUser) => user.permissions.includes('shifts.approve');

function assertStoreScope(user: CurrentUser, storeId: string) {
  if (!user.globalAccess && !scopeIds(user).includes(storeId)) throw new AppError(403, 'STORE_FORBIDDEN', 'Bạn không được thao tác ca tại chi nhánh này.');
}

function presentShift<T extends { openingCash: unknown; cashRevenue: unknown; digitalRevenue: unknown; cashExpenses: unknown; closingCash: unknown; cashDiscrepancy: unknown }>(shift: T) {
  return {
    ...shift,
    openingCash: Number(shift.openingCash), cashRevenue: Number(shift.cashRevenue), digitalRevenue: Number(shift.digitalRevenue), cashExpenses: Number(shift.cashExpenses),
    closingCash: shift.closingCash === null ? null : Number(shift.closingCash), cashDiscrepancy: shift.cashDiscrepancy === null ? null : Number(shift.cashDiscrepancy),
  };
}

function visibleWhere(user: CurrentUser): Prisma.WorkShiftWhereInput {
  return {
    ...(user.globalAccess ? {} : { storeId: { in: scopeIds(user) } }),
    ...(canApprove(user) ? {} : { cashierId: user.id }),
  };
}

export async function listShiftStaff(user: CurrentUser, input: z.infer<typeof shiftStaffInput>) {
  if (input.storeId) assertStoreScope(user, input.storeId);
  return prisma.user.findMany({
    where: { active: true, ...(user.globalAccess ? { OR: [{ id: user.id }, ...(input.storeId ? [{ stores: { some: { storeId: input.storeId } } }] : [{ stores: { some: {} } }])] } : input.storeId ? { stores: { some: { storeId: input.storeId } } } : { stores: { some: { storeId: { in: scopeIds(user) } } } }) },
    select: { id: true, name: true, email: true, stores: { select: { store: { select: { id: true, code: true, name: true } } } } },
    orderBy: { name: 'asc' },
  });
}

export async function listShifts(user: CurrentUser, input: z.infer<typeof shiftListInput>) {
  if (input.storeId) assertStoreScope(user, input.storeId);
  const where: Prisma.WorkShiftWhereInput = {
    ...visibleWhere(user),
    ...(input.status === 'all' ? {} : { status: input.status }),
    ...(input.storeId ? { storeId: input.storeId } : {}),
    ...(input.cashierId ? { cashierId: input.cashierId } : {}),
    ...(input.q ? { OR: [
      { code: { contains: input.q, mode: 'insensitive' } }, { posCode: { contains: input.q, mode: 'insensitive' } },
      { cashier: { name: { contains: input.q, mode: 'insensitive' } } }, { store: { name: { contains: input.q, mode: 'insensitive' } } },
    ] } : {}),
  };
  const skip = (input.page - 1) * input.pageSize;
  const [items, total, grouped] = await Promise.all([
    prisma.workShift.findMany({ where, include: includeShift, orderBy: { openedAt: 'desc' }, skip, take: input.pageSize }),
    prisma.workShift.count({ where }),
    prisma.workShift.groupBy({ by: ['status'], where: visibleWhere(user), _count: { _all: true } }),
  ]);
  const count = (status: string) => grouped.find(row => row.status === status)?._count._all ?? 0;
  return { items: items.map(presentShift), pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.max(1, Math.ceil(total / input.pageSize)) }, summary: { total: grouped.reduce((sum, row) => sum + row._count._all, 0), open: count('OPEN'), pendingReview: count('PENDING_REVIEW'), closed: count('CLOSED') } };
}

export async function getShift(user: CurrentUser, id: string) {
  const shift = await prisma.workShift.findUnique({ where: { id }, include: includeShift });
  if (!shift) throw new AppError(404, 'SHIFT_NOT_FOUND', 'Không tìm thấy ca làm việc.');
  assertStoreScope(user, shift.storeId);
  if (!canApprove(user) && shift.cashierId !== user.id) throw new AppError(403, 'SHIFT_FORBIDDEN', 'Bạn chỉ được xem ca làm việc của mình.');
  return presentShift(shift);
}

export async function openShift(user: CurrentUser, input: z.infer<typeof openShiftInput>) {
  assertStoreScope(user, input.storeId);
  if (input.cashierId !== user.id && !canApprove(user)) throw new AppError(403, 'CASHIER_FORBIDDEN', 'Bạn chỉ được tự mở ca cho mình.');
  const [store, cashier] = await Promise.all([
    prisma.store.findUnique({ where: { id: input.storeId }, select: { active: true } }),
    prisma.user.findUnique({ where: { id: input.cashierId }, select: { active: true, stores: { where: { storeId: input.storeId }, select: { storeId: true } } } }),
  ]);
  if (!store) throw new AppError(404, 'STORE_NOT_FOUND', 'Không tìm thấy chi nhánh.');
  if (!store.active) throw new AppError(409, 'STORE_INACTIVE', 'Không thể mở ca tại chi nhánh đã ngừng hoạt động.');
  if (!cashier) throw new AppError(404, 'CASHIER_NOT_FOUND', 'Không tìm thấy nhân viên.');
  if (!cashier.active) throw new AppError(409, 'CASHIER_INACTIVE', 'Nhân viên đã bị khóa tài khoản.');
  if (!cashier.stores.length && !(input.cashierId === user.id && user.globalAccess)) throw new AppError(403, 'CASHIER_STORE_MISMATCH', 'Nhân viên chưa được phân công vào chi nhánh này.');
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const code = `SHIFT-${date}-${Date.now().toString().slice(-6)}`;
  try {
    const shift = await prisma.$transaction(async tx => {
      if (await tx.workShift.count({ where: { status: 'OPEN', OR: [{ cashierId: input.cashierId }, { storeId: input.storeId, posCode: input.posCode }] } })) {
        throw new AppError(409, 'SHIFT_ALREADY_OPEN', 'Thu ngân hoặc máy POS này đang có một ca mở.');
      }
      const row = await tx.workShift.create({ data: { ...input, code }, include: includeShift });
      await tx.auditLog.create({ data: { actorId: user.id, action: 'shift.open', targetId: row.id } });
      return row;
    }, { isolationLevel: 'Serializable' });
    return presentShift(shift);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034')) throw new AppError(409, 'SHIFT_ALREADY_OPEN', 'Thu ngân hoặc máy POS này vừa được mở ca. Vui lòng tải lại.');
    throw error;
  }
}

export async function closeShift(user: CurrentUser, id: string, input: z.infer<typeof closeShiftInput>) {
  const current = await prisma.workShift.findUnique({ where: { id } });
  if (!current) throw new AppError(404, 'SHIFT_NOT_FOUND', 'Không tìm thấy ca làm việc.');
  assertStoreScope(user, current.storeId);
  if (current.cashierId !== user.id && !canApprove(user)) throw new AppError(403, 'SHIFT_FORBIDDEN', 'Bạn chỉ được chốt ca của mình.');
  if (current.status !== 'OPEN') throw new AppError(409, 'SHIFT_NOT_OPEN', 'Ca làm việc không còn ở trạng thái đang mở.');
  const expected = Number(current.openingCash) + Number(current.cashRevenue) - input.cashExpenses;
  const discrepancy = input.closingCash - expected;
  if (discrepancy !== 0 && !input.discrepancyReason) throw new AppError(400, 'DISCREPANCY_REASON_REQUIRED', 'Vui lòng nhập lý do khi tiền thực tế bị chênh lệch.');
  const status = discrepancy === 0 ? 'CLOSED' : 'PENDING_REVIEW';
  const shift = await prisma.$transaction(async tx => {
    if (await tx.payosCheckout.count({ where: { shiftId: id, status: { in: ['CREATING', 'PENDING'] } } })) throw new AppError(409, 'SHIFT_HAS_PENDING_PAYMENTS', 'Ca còn đơn payOS đang chờ. Hoàn tất hoặc hủy thanh toán trước khi chốt ca.');
    const updated = await tx.workShift.updateMany({ where: { id, status: 'OPEN' }, data: {
      status, closingCash: input.closingCash, cashExpenses: input.cashExpenses, cashDiscrepancy: discrepancy, discrepancyReason: input.discrepancyReason,
      denominations: input.denominations as Prisma.InputJsonValue, closedAt: new Date(), ...(status === 'CLOSED' ? { approvedAt: new Date(), approvedById: user.id } : {}),
    } });
    if (updated.count !== 1) throw new AppError(409, 'SHIFT_NOT_OPEN', 'Ca vừa được người khác chốt. Vui lòng tải lại.');
    await tx.auditLog.create({ data: { actorId: user.id, action: status === 'CLOSED' ? 'shift.close' : 'shift.submit_review', targetId: id } });
    return tx.workShift.findUniqueOrThrow({ where: { id }, include: includeShift });
  }, { isolationLevel: 'Serializable' });
  return presentShift(shift);
}

export async function approveShift(user: CurrentUser, id: string, input: z.infer<typeof approveShiftInput>) {
  const current = await prisma.workShift.findUnique({ where: { id } });
  if (!current) throw new AppError(404, 'SHIFT_NOT_FOUND', 'Không tìm thấy ca làm việc.');
  assertStoreScope(user, current.storeId);
  if (current.status !== 'PENDING_REVIEW') throw new AppError(409, 'SHIFT_NOT_PENDING', 'Ca không ở trạng thái chờ duyệt.');
  const shift = await prisma.$transaction(async tx => {
    const updated = await tx.workShift.updateMany({ where: { id, status: 'PENDING_REVIEW' }, data: { status: 'CLOSED', approvedAt: new Date(), approvedById: user.id, managerNote: input.managerNote } });
    if (updated.count !== 1) throw new AppError(409, 'SHIFT_NOT_PENDING', 'Ca vừa được người khác duyệt. Vui lòng tải lại.');
    await tx.auditLog.create({ data: { actorId: user.id, action: 'shift.approve', targetId: id } });
    return tx.workShift.findUniqueOrThrow({ where: { id }, include: includeShift });
  }, { isolationLevel: 'Serializable' });
  return presentShift(shift);
}
