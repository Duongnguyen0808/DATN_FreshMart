import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../common/database.js';
import { AppError } from '../../common/app-error.js';
import { payosConfigured } from '../payos/payos.client.js';
import type { CurrentUser } from '../auth/auth.repository.js';
import type { z } from 'zod';
import type { cancelInvoiceInput, createInvoiceInput, createSalesReturnInput, invoiceListInput, paymentListInput, salesReturnListInput } from './invoices.schemas.js';

const includeInvoice = {
  store: { select: { id: true, code: true, name: true } }, cashier: { select: { id: true, name: true, email: true } },
  customer: { select: { id: true, code: true, name: true, phone: true, email: true, active: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  shift: { select: { id: true, code: true, posCode: true, name: true, status: true } }, cancelledBy: { select: { id: true, name: true, email: true } },
  items: { orderBy: { productName: 'asc' as const }, select: { id: true, invoiceId: true, skuId: true, productCode: true, skuCode: true, productName: true, unit: true, quantity: true, unitPrice: true, lineTotal: true, sku: { select: { product: { select: { imageUrl: true } } } } } }, payments: { orderBy: { method: 'asc' as const } },
  receivable: { select: { id: true, code: true, totalAmount: true, paidAmount: true, dueDate: true, status: true } },
  salesReturns: { orderBy: { createdAt: 'desc' as const }, include: { processedBy: { select: { id: true, name: true, email: true } }, items: { orderBy: { id: 'asc' as const }, include: { invoiceItem: { select: { productCode: true, skuCode: true, productName: true, unit: true, sku: { select: { product: { select: { imageUrl: true } } } } } } } } } },
};
const scopeIds = (user: CurrentUser) => user.stores.map(store => store.id);
const canCancel = (user: CurrentUser) => user.permissions.includes('invoices.cancel');
const canViewAllInvoices = (user: CurrentUser) => canCancel(user) || user.roles.some(role => ['OWNER', 'BRANCH_MANAGER'].includes(role.code));
function assertStoreScope(user: CurrentUser, storeId: string) { if (!user.globalAccess && !scopeIds(user).includes(storeId)) throw new AppError(403, 'STORE_FORBIDDEN', 'Bạn không được thao tác hóa đơn tại chi nhánh này.'); }
const number = (value: unknown) => Number(value);
export function isInvoicePaymentBalanced(total: number, creditAmount: number, paymentAmounts: number[]) {
  return Math.abs(paymentAmounts.reduce((sum, amount) => sum + amount, 0) + creditAmount - total) <= 0.001;
}
function presentInvoice<T extends { subtotal: unknown; discount: unknown; total: unknown; refundedAmount: unknown; creditAmount: unknown; receivable?: { totalAmount: unknown; paidAmount: unknown } | null; items?: { unitPrice: unknown; lineTotal: unknown }[]; payments?: { amount: unknown }[]; salesReturns?: { refundAmount: unknown; items: { unitRefund: unknown; lineRefund: unknown }[] }[] }>(row: T) {
  return { ...row, subtotal: number(row.subtotal), discount: number(row.discount), total: number(row.total), refundedAmount: number(row.refundedAmount), creditAmount: number(row.creditAmount), receivable: row.receivable ? { ...row.receivable, totalAmount: number(row.receivable.totalAmount), paidAmount: number(row.receivable.paidAmount) } : row.receivable, items: row.items?.map(item => ({ ...item, unitPrice: number(item.unitPrice), lineTotal: number(item.lineTotal) })), payments: row.payments?.map(payment => ({ ...payment, amount: number(payment.amount) })), salesReturns: row.salesReturns?.map(salesReturn => ({ ...salesReturn, refundAmount: number(salesReturn.refundAmount), items: salesReturn.items.map(item => ({ ...item, unitRefund: number(item.unitRefund), lineRefund: number(item.lineRefund) })) })) };
}
function visibleWhere(user: CurrentUser): Prisma.InvoiceWhereInput { return { ...(user.globalAccess ? {} : { storeId: { in: scopeIds(user) } }), ...(canViewAllInvoices(user) ? {} : { cashierId: user.id }) }; }

export async function listInvoices(user: CurrentUser, input: z.infer<typeof invoiceListInput>) {
  if (input.storeId) assertStoreScope(user, input.storeId);
  const where: Prisma.InvoiceWhereInput = { ...visibleWhere(user), ...(input.status === 'all' ? {} : { status: input.status }), ...(input.storeId ? { storeId: input.storeId } : {}), ...(input.shiftId ? { shiftId: input.shiftId } : {}),
    ...(input.from || input.to ? { completedAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } } : {}),
    ...(input.q ? { OR: [{ code: { contains: input.q, mode: 'insensitive' } }, { customerName: { contains: input.q, mode: 'insensitive' } }, { customerPhone: { contains: input.q } }, { cashier: { name: { contains: input.q, mode: 'insensitive' } } }] } : {}) };
  const base = visibleWhere(user); const skip = (input.page - 1) * input.pageSize;
  const [items, total, completed, cancelled, revenue] = await Promise.all([
    prisma.invoice.findMany({ where, include: includeInvoice, orderBy: { completedAt: 'desc' }, skip, take: input.pageSize }), prisma.invoice.count({ where }),
    prisma.invoice.count({ where: { ...base, status: 'COMPLETED' } }), prisma.invoice.count({ where: { ...base, status: 'CANCELLED' } }),
    prisma.invoice.aggregate({ where: { ...base, status: 'COMPLETED' }, _sum: { total: true, refundedAmount: true } }),
  ]);
  return { items: items.map(presentInvoice), pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.max(1, Math.ceil(total / input.pageSize)) }, summary: { total: completed + cancelled, completed, cancelled, revenue: number(revenue._sum.total ?? 0) - number(revenue._sum.refundedAmount ?? 0) } };
}

export async function getInvoice(user: CurrentUser, id: string) {
  const row = await prisma.invoice.findUnique({ where: { id }, include: includeInvoice });
  if (!row) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Không tìm thấy hóa đơn.');
  assertStoreScope(user, row.storeId); if (!canViewAllInvoices(user) && row.cashierId !== user.id) throw new AppError(403, 'INVOICE_FORBIDDEN', 'Bạn chỉ được xem hóa đơn do mình tạo.');
  return presentInvoice(row);
}

export async function listInvoicePayments(user: CurrentUser, input: z.infer<typeof paymentListInput>) {
  if (input.storeId) assertStoreScope(user, input.storeId);
  const from = input.from ? new Date(`${input.from}T00:00:00`) : undefined;
  const to = input.to ? new Date(`${input.to}T23:59:59.999`) : undefined;
  const invoiceWhere: Prisma.InvoiceWhereInput = {
    ...visibleWhere(user),
    ...(input.status === 'all' ? {} : { status: input.status }),
    ...(input.storeId ? { storeId: input.storeId } : {}),
    ...(from || to ? { completedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  const baseWhere: Prisma.InvoicePaymentWhereInput = {
    invoice: invoiceWhere,
    ...(input.q ? { OR: [
      { reference: { contains: input.q, mode: 'insensitive' } },
      { invoice: { code: { contains: input.q, mode: 'insensitive' } } },
      { invoice: { customerName: { contains: input.q, mode: 'insensitive' } } },
      { invoice: { customerPhone: { contains: input.q } } },
      { invoice: { cashier: { name: { contains: input.q, mode: 'insensitive' } } } },
    ] } : {}),
  };
  const where: Prisma.InvoicePaymentWhereInput = { ...baseWhere, ...(input.method === 'all' ? {} : { method: input.method }) };
  const skip = (input.page - 1) * input.pageSize;
  const [items, filteredTotal, summaryTotal, amount, methods] = await Promise.all([
    prisma.invoicePayment.findMany({ where, include: { invoice: { select: { id: true, code: true, status: true, completedAt: true, total: true, customerName: true, customerPhone: true, store: { select: { id: true, code: true, name: true } }, cashier: { select: { id: true, name: true } }, shift: { select: { id: true, code: true, posCode: true } } } } }, orderBy: { invoice: { completedAt: 'desc' } }, skip, take: input.pageSize }),
    prisma.invoicePayment.count({ where }),
    prisma.invoicePayment.count({ where: baseWhere }),
    prisma.invoicePayment.aggregate({ where: baseWhere, _sum: { amount: true } }),
    prisma.invoicePayment.groupBy({ by: ['method'], where: baseWhere, _count: { _all: true }, _sum: { amount: true } }),
  ]);
  const methodSummary = Object.fromEntries(['CASH', 'QR', 'CARD'].map(method => { const row = methods.find(item => item.method === method); return [method, { count: row?._count._all ?? 0, amount: Number(row?._sum.amount ?? 0) }]; }));
  return {
    items: items.map(item => ({ ...item, amount: Number(item.amount), invoice: { ...item.invoice, total: Number(item.invoice.total) } })),
    pagination: { page: input.page, pageSize: input.pageSize, total: filteredTotal, totalPages: Math.max(1, Math.ceil(filteredTotal / input.pageSize)) },
    summary: { total: summaryTotal, amount: Number(amount._sum.amount ?? 0), methods: methodSummary },
  };
}

export async function listSalesReturns(user: CurrentUser, input: z.infer<typeof salesReturnListInput>) {
  if (input.storeId) assertStoreScope(user, input.storeId);
  const from = input.from ? new Date(`${input.from}T00:00:00`) : undefined;
  const to = input.to ? new Date(`${input.to}T23:59:59.999`) : undefined;
  const where: Prisma.SalesReturnWhereInput = {
    invoice: { ...visibleWhere(user), ...(input.storeId ? { storeId: input.storeId } : {}) },
    ...(input.refundMethod === 'all' ? {} : { refundMethod: input.refundMethod }),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(input.q ? { OR: [
      { code: { contains: input.q, mode: 'insensitive' } },
      { invoice: { code: { contains: input.q, mode: 'insensitive' } } },
      { invoice: { customerName: { contains: input.q, mode: 'insensitive' } } },
      { invoice: { customerPhone: { contains: input.q } } },
      { processedBy: { name: { contains: input.q, mode: 'insensitive' } } },
    ] } : {}),
  };
  const itemWhere: Prisma.SalesReturnItemWhereInput = { salesReturn: where };
  const skip = (input.page - 1) * input.pageSize;
  const [items, total, amounts, restocked, rejected] = await Promise.all([
    prisma.salesReturn.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: input.pageSize, include: { invoice: { select: { id: true, code: true, customerName: true, customerPhone: true, store: { select: { id: true, code: true, name: true } } } }, processedBy: { select: { id: true, name: true, email: true } }, items: { include: { invoiceItem: { select: { productCode: true, skuCode: true, productName: true, unit: true } } } } } }),
    prisma.salesReturn.count({ where }),
    prisma.salesReturn.aggregate({ where, _sum: { refundAmount: true } }),
    prisma.salesReturnItem.aggregate({ where: { ...itemWhere, restock: true }, _sum: { quantity: true } }),
    prisma.salesReturnItem.aggregate({ where: { ...itemWhere, restock: false }, _sum: { quantity: true } }),
  ]);
  return {
    items: items.map(item => ({ ...item, refundAmount: Number(item.refundAmount), items: item.items.map(line => ({ ...line, unitRefund: Number(line.unitRefund), lineRefund: Number(line.lineRefund) })) })),
    pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.max(1, Math.ceil(total / input.pageSize)) },
    summary: { total, refundAmount: Number(amounts._sum.refundAmount ?? 0), restockedQuantity: restocked._sum.quantity ?? 0, nonRestockedQuantity: rejected._sum.quantity ?? 0 },
  };
}

export async function createInvoice(user: CurrentUser, input: z.infer<typeof createInvoiceInput>) {
  if (payosConfigured() && input.payments.some(payment => payment.method === 'QR')) throw new AppError(409, 'PAYOS_VERIFICATION_REQUIRED', 'Thanh toán QR phải qua payOS và được xác minh trước khi hoàn tất hóa đơn.');
  const shift = await prisma.workShift.findUnique({ where: { id: input.shiftId } });
  if (!shift) throw new AppError(404, 'SHIFT_NOT_FOUND', 'Không tìm thấy ca làm việc.'); assertStoreScope(user, shift.storeId);
  if (shift.status !== 'OPEN') throw new AppError(409, 'SHIFT_NOT_OPEN', 'Chỉ có thể bán hàng trong ca đang mở.');
  if (shift.cashierId !== user.id && !canCancel(user)) throw new AppError(403, 'SHIFT_FORBIDDEN', 'Bạn chỉ được tạo hóa đơn trong ca của mình.');
  const warehouses = await prisma.warehouse.findMany({ where: { storeId: shift.storeId, active: true, ...(input.warehouseId ? { id: input.warehouseId } : {}) }, select: { id: true } });
  if (!warehouses.length) throw new AppError(409, 'WAREHOUSE_REQUIRED', 'Chi nhánh chưa có kho hoạt động phù hợp.');
  if (!input.warehouseId && warehouses.length > 1) throw new AppError(400, 'WAREHOUSE_REQUIRED', 'Chi nhánh có nhiều kho; vui lòng chọn kho xuất hàng.');
  const warehouseId = warehouses[0]!.id;
  const customer = input.customerId ? await prisma.customer.findUnique({ where: { id: input.customerId } }) : null;
  if (input.customerId && !customer) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Không tìm thấy khách hàng.');
  if (customer && !customer.active) throw new AppError(409, 'CUSTOMER_INACTIVE', 'Khách hàng đã ngừng hoạt động.');
  const skus = await prisma.sku.findMany({ where: { id: { in: input.items.map(item => item.skuId) }, active: true, product: { active: true } }, include: { product: true } });
  if (skus.length !== input.items.length) throw new AppError(409, 'SKU_UNAVAILABLE', 'Một hoặc nhiều SKU không tồn tại hoặc đã ngừng kinh doanh.');
  const quantity = new Map(input.items.map(item => [item.skuId, item.quantity]));
  const subtotal = skus.reduce((sum, sku) => sum + Number(sku.sellingPrice) * quantity.get(sku.id)!, 0);
  if (input.discount > subtotal) throw new AppError(400, 'DISCOUNT_TOO_LARGE', 'Giảm giá không được lớn hơn tiền hàng.');
  const total = subtotal - input.discount; const paid = input.payments.reduce((sum, payment) => sum + payment.amount, 0);
  if (input.creditAmount > total) throw new AppError(400, 'CREDIT_TOO_LARGE', 'Số tiền ghi nợ không được vượt tổng hóa đơn.');
  if (!isInvoicePaymentBalanced(total, input.creditAmount, input.payments.map(payment => payment.amount))) throw new AppError(400, 'PAYMENT_MISMATCH', `Tổng thanh toán và ghi nợ phải bằng ${total.toLocaleString('vi-VN')} đ.`);
  const cash = input.payments.filter(payment => payment.method === 'CASH').reduce((sum, payment) => sum + payment.amount, 0); const digital = paid - cash;
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', ''); const code = `HD-${date}-${Date.now().toString().slice(-7)}`;
  try {
    const row = await prisma.$transaction(async tx => {
      for (const sku of skus) {
        const stock = await tx.inventory.findUnique({ where: { warehouseId_skuId: { warehouseId, skuId: sku.id } } }); const sold = quantity.get(sku.id)!;
        if (!stock || stock.onHand - stock.reserved < sold) throw new AppError(409, 'INSUFFICIENT_STOCK', `SKU ${sku.code} không đủ tồn khả dụng.`);
        await tx.inventory.update({ where: { id: stock.id }, data: { onHand: { decrement: sold } } });
        await tx.inventoryTransaction.create({ data: { inventoryId: stock.id, warehouseId, skuId: sku.id, type: 'SALE', quantity: -sold, beforeQuantity: stock.onHand, afterQuantity: stock.onHand - sold, referenceType: 'INVOICE', referenceId: code, reason: `Bán hàng theo hóa đơn ${code}`, actorId: user.id } });
      }
      const locked = await tx.workShift.updateMany({ where: { id: shift.id, status: 'OPEN' }, data: { cashRevenue: { increment: cash }, digitalRevenue: { increment: digital } } });
      if (locked.count !== 1) throw new AppError(409, 'SHIFT_NOT_OPEN', 'Ca vừa được chốt. Vui lòng tải lại.');
      const invoice = await tx.invoice.create({ data: { code, shiftId: shift.id, warehouseId, storeId: shift.storeId, cashierId: shift.cashierId, customerId: customer?.id, customerName: customer?.name ?? input.customerName, customerPhone: customer?.phone ?? input.customerPhone, subtotal, discount: input.discount, total, creditAmount: input.creditAmount, note: input.note,
        items: { create: skus.map(sku => ({ skuId: sku.id, productCode: sku.product.code, skuCode: sku.code, productName: sku.product.name, unit: sku.product.unit, quantity: quantity.get(sku.id)!, unitPrice: sku.sellingPrice, costPrice: sku.costPrice, lineTotal: Number(sku.sellingPrice) * quantity.get(sku.id)! })) },
        payments: { create: input.payments.map(payment => ({ method: payment.method, amount: payment.amount, reference: payment.reference })) } }, include: includeInvoice });
      if (input.creditAmount > 0) await tx.receivable.create({ data: { code: `REC-${date}-${Date.now().toString().slice(-7)}`, invoiceId: invoice.id, customerId: customer!.id, storeId: shift.storeId, totalAmount: input.creditAmount, dueDate: new Date(`${input.creditDueDate}T23:59:59.999`) } });
      await tx.auditLog.create({ data: { actorId: user.id, action: 'invoice.create', targetId: invoice.id } }); return tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: includeInvoice });
    }, { isolationLevel: 'Serializable' }); return presentInvoice(row);
  } catch (error) { if (error instanceof AppError) throw error; if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034')) throw new AppError(409, 'INVOICE_CONFLICT', 'Giao dịch vừa thay đổi. Vui lòng thử lại.'); throw error; }
}

export async function cancelInvoice(user: CurrentUser, id: string, input: z.infer<typeof cancelInvoiceInput>) {
  const current = await prisma.invoice.findUnique({ where: { id }, include: { payments: true, items: true, salesReturns: { select: { id: true } }, receivable: { include: { payments: { select: { id: true } } } } } });
  if (!current) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Không tìm thấy hóa đơn.'); assertStoreScope(user, current.storeId);
  if (current.status !== 'COMPLETED') throw new AppError(409, 'INVOICE_ALREADY_CANCELLED', 'Hóa đơn đã được hủy trước đó.');
  if (current.salesReturns.length) throw new AppError(409, 'INVOICE_HAS_RETURNS', 'Không thể hủy hóa đơn đã phát sinh trả hàng.');
  if (current.receivable && Number(current.receivable.paidAmount) > 0) throw new AppError(409, 'INVOICE_HAS_DEBT_PAYMENTS', 'Không thể hủy hóa đơn khi công nợ đã phát sinh thu tiền.');
  const shift = await prisma.workShift.findUniqueOrThrow({ where: { id: current.shiftId } });
  if (shift.status !== 'OPEN') throw new AppError(409, 'SHIFT_CLOSED', 'Không thể hủy hóa đơn sau khi ca đã chốt.');
  const cash = current.payments.filter(payment => payment.method === 'CASH').reduce((sum, payment) => sum + Number(payment.amount), 0); const digital = current.payments.filter(payment => payment.method !== 'CASH').reduce((sum, payment) => sum + Number(payment.amount), 0);
  const row = await prisma.$transaction(async tx => {
    const openShift = await tx.workShift.updateMany({ where: { id: current.shiftId, status: 'OPEN' }, data: { cashRevenue: { decrement: cash }, digitalRevenue: { decrement: digital } } });
    if (openShift.count !== 1) throw new AppError(409, 'SHIFT_CLOSED', 'Ca vừa được chốt. Không thể hủy hóa đơn.');
    const changed = await tx.invoice.updateMany({ where: { id, status: 'COMPLETED' }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancellationReason: input.reason } });
    if (changed.count !== 1) throw new AppError(409, 'INVOICE_ALREADY_CANCELLED', 'Hóa đơn vừa được hủy bởi người khác.');
    if (current.receivable) await tx.receivable.delete({ where: { id: current.receivable.id } });
    if (current.warehouseId) for (const item of current.items) {
      const stock = await tx.inventory.findUnique({ where: { warehouseId_skuId: { warehouseId: current.warehouseId, skuId: item.skuId } } });
      if (!stock) throw new AppError(409, 'INVENTORY_NOT_FOUND', `Không tìm thấy tồn kho cho SKU ${item.skuCode}.`);
      await tx.inventory.update({ where: { id: stock.id }, data: { onHand: { increment: item.quantity } } });
      await tx.inventoryTransaction.create({ data: { inventoryId: stock.id, warehouseId: current.warehouseId, skuId: item.skuId, type: 'SALE_CANCEL', quantity: item.quantity, beforeQuantity: stock.onHand, afterQuantity: stock.onHand + item.quantity, referenceType: 'INVOICE', referenceId: current.code, reason: `Hoàn tồn do hủy hóa đơn: ${input.reason}`, actorId: user.id } });
    }
    await tx.auditLog.create({ data: { actorId: user.id, action: 'invoice.cancel', targetId: id } }); return tx.invoice.findUniqueOrThrow({ where: { id }, include: includeInvoice });
  }, { isolationLevel: 'Serializable' }); return presentInvoice(row);
}

export async function createSalesReturn(user: CurrentUser, invoiceId: string, input: z.infer<typeof createSalesReturnInput>) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const code = `TH-${date}-${Date.now().toString().slice(-7)}`;
  try {
    const row = await prisma.$transaction(async tx => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: { items: true, salesReturns: { select: { items: { select: { invoiceItemId: true, quantity: true } } } }, receivable: { select: { totalAmount: true, paidAmount: true } } },
      });
      if (!invoice) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Không tìm thấy hóa đơn gốc.');
      assertStoreScope(user, invoice.storeId);
      if (invoice.status !== 'COMPLETED') throw new AppError(409, 'INVOICE_NOT_RETURNABLE', 'Không thể trả hàng từ hóa đơn đã hủy.');
      if (invoice.receivable && Number(invoice.receivable.paidAmount) < Number(invoice.receivable.totalAmount)) throw new AppError(409, 'RECEIVABLE_OUTSTANDING', 'Cần thu đủ công nợ trước khi hoàn tiền trả hàng.');
      if (!invoice.warehouseId) throw new AppError(409, 'INVOICE_WAREHOUSE_MISSING', 'Hóa đơn không có kho xuất hàng để xử lý trả hàng.');

      const requested = new Map(input.items.map(item => [item.invoiceItemId, item]));
      const selected = invoice.items.filter(item => requested.has(item.id));
      if (selected.length !== input.items.length) throw new AppError(400, 'RETURN_ITEM_INVALID', 'Một hoặc nhiều dòng hàng không thuộc hóa đơn gốc.');
      const returned = new Map<string, number>();
      for (const previous of invoice.salesReturns) for (const item of previous.items) returned.set(item.invoiceItemId, (returned.get(item.invoiceItemId) ?? 0) + item.quantity);
      for (const item of selected) {
        const quantity = requested.get(item.id)!.quantity;
        if (quantity > item.quantity - (returned.get(item.id) ?? 0)) throw new AppError(409, 'RETURN_QUANTITY_EXCEEDED', `Số lượng trả của SKU ${item.skuCode} vượt quá số còn có thể trả.`);
      }

      const ratio = Number(invoice.subtotal) > 0 ? Number(invoice.total) / Number(invoice.subtotal) : 0;
      const returnItems = selected.map(item => {
        const quantity = requested.get(item.id)!.quantity;
        const lineRefund = Math.round(Number(item.unitPrice) * ratio * quantity);
        return { invoiceItemId: item.id, skuId: item.skuId, quantity, restock: requested.get(item.id)!.restock, unitRefund: lineRefund / quantity, lineRefund };
      });
      const isFullReturn = invoice.items.every(item => { const remaining = item.quantity - (returned.get(item.id) ?? 0); return remaining === 0 || requested.get(item.id)?.quantity === remaining; });
      let refundAmount = returnItems.reduce((sum, item) => sum + item.lineRefund, 0);
      if (isFullReturn && returnItems.length) {
        const remainingRefund = Number(invoice.total) - Number(invoice.refundedAmount);
        const last = returnItems.at(-1)!;
        last.lineRefund += remainingRefund - refundAmount;
        last.unitRefund = last.lineRefund / last.quantity;
        refundAmount = remainingRefund;
      }
      if (refundAmount <= 0 || Number(invoice.refundedAmount) + refundAmount > Number(invoice.total)) throw new AppError(409, 'REFUND_AMOUNT_INVALID', 'Số tiền hoàn vượt quá giá trị còn lại của hóa đơn.');

      const salesReturn = await tx.salesReturn.create({ data: { code, invoiceId, warehouseId: invoice.warehouseId, processedById: user.id, reason: input.reason, refundMethod: input.refundMethod, refundReference: input.refundReference, refundAmount, items: { create: returnItems } } });
      for (const item of returnItems.filter(value => value.restock)) {
        const stock = await tx.inventory.findUnique({ where: { warehouseId_skuId: { warehouseId: invoice.warehouseId, skuId: item.skuId } } });
        if (!stock) throw new AppError(409, 'INVENTORY_NOT_FOUND', 'Không tìm thấy tồn kho của mặt hàng được nhập lại.');
        await tx.inventory.update({ where: { id: stock.id }, data: { onHand: { increment: item.quantity } } });
        await tx.inventoryTransaction.create({ data: { inventoryId: stock.id, warehouseId: invoice.warehouseId, skuId: item.skuId, type: 'SALE_RETURN', quantity: item.quantity, beforeQuantity: stock.onHand, afterQuantity: stock.onHand + item.quantity, referenceType: 'SALES_RETURN', referenceId: salesReturn.id, reason: `Nhập lại hàng theo phiếu trả ${code}: ${input.reason}`, actorId: user.id } });
      }
      await tx.invoice.update({ where: { id: invoiceId }, data: { refundedAmount: { increment: refundAmount } } });
      await tx.auditLog.create({ data: { actorId: user.id, action: 'sales-return.create', targetId: salesReturn.id } });
      return tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: includeInvoice });
    }, { isolationLevel: 'Serializable' });
    return presentInvoice(row);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034')) throw new AppError(409, 'RETURN_CONFLICT', 'Dữ liệu trả hàng vừa thay đổi. Vui lòng tải lại và thử lại.');
    throw error;
  }
}
