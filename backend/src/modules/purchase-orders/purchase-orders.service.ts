import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../common/database.js';
import { nextDailyCode } from '../../common/daily-code.js';
import { AppError } from '../../common/app-error.js';
import type { CurrentUser } from '../auth/auth.repository.js';
import type { z } from 'zod';
import type { createPurchaseOrderInput, createSupplierReturnInput, goodsReceiptListInput, purchaseOrderListInput, receivePurchaseOrderInput, supplierReturnListInput } from './purchase-orders.schemas.js';
import { uploadOperationalEvidence } from '../products/cloudinary.service.js';
import { confirmIotEvents } from '../iot/iot.service.js';

const storeIds = (user: CurrentUser) => user.stores.map(store => store.id);
const person = { select: { id: true, name: true, email: true } } as const;
const include = {
  purchaseRequest: { select: { id: true, code: true, reason: true, storeId: true } },
  supplier: true,
  warehouse: { include: { store: { select: { id: true, code: true, name: true } } } },
  createdBy: person,
  items: { include: { sku: { include: { product: { select: { code: true, name: true, unit: true, imageUrl: true } } } } }, orderBy: { sku: { code: 'asc' as const } } },
  receipts: { include: { receivedBy: person, items: { include: { sku: { include: { product: { select: { code: true, name: true, unit: true, imageUrl: true } } } } } } }, orderBy: { receivedAt: 'desc' as const } },
} as const;

function assertScope(user: CurrentUser, storeId: string) {
  if (!user.globalAccess && !storeIds(user).includes(storeId)) throw new AppError(403, 'STORE_FORBIDDEN', 'Bạn không được thao tác đơn mua hàng của chi nhánh này.');
}

function present<T extends { status: string; expectedAt: Date | null; totalAmount: unknown; items: Array<{ orderedQuantity: number; receivedQuantity: number; unitCost: unknown; lineTotal: unknown }>; receipts?: Array<{ items: Array<{ unitCost: unknown }> }> }>(row: T) {
  const totalOrdered = row.items.reduce((sum, item) => sum + item.orderedQuantity, 0);
  const totalReceived = row.items.reduce((sum, item) => sum + item.receivedQuantity, 0);
  return {
    ...row,
    totalAmount: Number(row.totalAmount),
    items: row.items.map(item => ({ ...item, unitCost: Number(item.unitCost), lineTotal: Number(item.lineTotal), remainingQuantity: item.orderedQuantity - item.receivedQuantity })),
    receipts: row.receipts?.map(receipt => ({ ...receipt, items: receipt.items.map(item => ({ ...item, unitCost: Number(item.unitCost) })) })),
    totalOrdered,
    totalReceived,
    totalRemaining: totalOrdered - totalReceived,
    progressPercent: totalOrdered ? Math.round(totalReceived * 100 / totalOrdered) : 0,
    isOverdue: row.status !== 'COMPLETED' && row.expectedAt !== null && row.expectedAt.getTime() < Date.now(),
    overdueDays: row.status !== 'COMPLETED' && row.expectedAt !== null && row.expectedAt.getTime() < Date.now() ? Math.floor((Date.now() - row.expectedAt.getTime()) / 86_400_000) : 0,
  };
}

async function current(id: string) {
  const row = await prisma.purchaseOrder.findUnique({ where: { id }, include });
  if (!row) throw new AppError(404, 'PURCHASE_ORDER_NOT_FOUND', 'Không tìm thấy đơn mua hàng.');
  return row;
}

export async function listGoodsReceipts(user: CurrentUser, input: z.infer<typeof goodsReceiptListInput>) {
  const scope: Prisma.GoodsReceiptWhereInput = user.globalAccess ? {} : { purchaseOrder: { warehouse: { storeId: { in: storeIds(user) } } } };
  const where: Prisma.GoodsReceiptWhereInput = { AND: [scope, input.supplierId ? { purchaseOrder: { supplierId: input.supplierId } } : {}, input.warehouseId ? { purchaseOrder: { warehouseId: input.warehouseId } } : {}, input.q ? { OR: [{ code: { contains: input.q, mode: 'insensitive' } }, { purchaseOrder: { code: { contains: input.q, mode: 'insensitive' } } }, { purchaseOrder: { supplier: { name: { contains: input.q, mode: 'insensitive' } } } }, { purchaseOrder: { supplier: { code: { contains: input.q, mode: 'insensitive' } } } }] } : {}] };
  const include = { receivedBy: person, purchaseOrder: { select: { id: true, code: true, supplier: { select: { id: true, code: true, name: true } }, warehouse: { select: { id: true, code: true, name: true, store: { select: { id: true, code: true, name: true } } } } } }, items: { include: { sku: { include: { product: { select: { code: true, name: true, unit: true, imageUrl: true } } } } } } } as const;
  const skip = (input.page - 1) * input.pageSize;
  const [rows, total, all] = await Promise.all([
    prisma.goodsReceipt.findMany({ where, include, orderBy: { receivedAt: 'desc' }, skip, take: input.pageSize }),
    prisma.goodsReceipt.count({ where }),
    prisma.goodsReceipt.findMany({ where: scope, select: { items: { select: { quantity: true, unitCost: true } } } }),
  ]);
  const presentReceipt = (row: typeof rows[number]) => ({ ...row, totalQuantity: row.items.reduce((sum, item) => sum + item.quantity, 0), totalAmount: row.items.reduce((sum, item) => sum + item.quantity * Number(item.unitCost), 0), items: row.items.map(item => ({ ...item, unitCost: Number(item.unitCost) })) });
  const summary = all.reduce((totalValue, row) => ({ total: totalValue.total + 1, totalQuantity: totalValue.totalQuantity + row.items.reduce((sum, item) => sum + item.quantity, 0), totalAmount: totalValue.totalAmount + row.items.reduce((sum, item) => sum + item.quantity * Number(item.unitCost), 0) }), { total: 0, totalQuantity: 0, totalAmount: 0 });
  return { items: rows.map(presentReceipt), pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.max(1, Math.ceil(total / input.pageSize)) }, summary };
}

export async function listPurchaseOrders(user: CurrentUser, input: z.infer<typeof purchaseOrderListInput>) {
  if (input.warehouseId) {
    const warehouse = await prisma.warehouse.findUnique({ where: { id: input.warehouseId }, select: { storeId: true } });
    if (!warehouse) throw new AppError(404, 'WAREHOUSE_NOT_FOUND', 'Không tìm thấy kho nhận.');
    assertScope(user, warehouse.storeId);
  }
  const base: Prisma.PurchaseOrderWhereInput = user.globalAccess ? {} : { warehouse: { storeId: { in: storeIds(user) } } };
  const overdueWhere: Prisma.PurchaseOrderWhereInput = { status: { in: ['OPEN', 'PARTIALLY_RECEIVED'] }, expectedAt: { lt: new Date() } };
  const where: Prisma.PurchaseOrderWhereInput = { AND: [
    base,
    input.status === 'all' ? {} : input.status === 'OVERDUE' ? overdueWhere : { status: input.status },
    input.supplierId ? { supplierId: input.supplierId } : {},
    input.warehouseId ? { warehouseId: input.warehouseId } : {},
    input.q ? { OR: [
      { code: { contains: input.q, mode: 'insensitive' } },
      { supplier: { name: { contains: input.q, mode: 'insensitive' } } },
      { warehouse: { name: { contains: input.q, mode: 'insensitive' } } },
      { purchaseRequest: { code: { contains: input.q, mode: 'insensitive' } } },
    ] } : {},
  ] };
  const skip = (input.page - 1) * input.pageSize;
  const [rows, total, grouped, aggregate, overdue] = await Promise.all([
    prisma.purchaseOrder.findMany({ where, include, orderBy: input.status === 'OVERDUE' ? { expectedAt: 'asc' } : { createdAt: 'desc' }, skip, take: input.pageSize }),
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    prisma.purchaseOrder.aggregate({ where: base, _sum: { totalAmount: true } }),
    prisma.purchaseOrder.count({ where: { AND: [base, overdueWhere] } }),
  ]);
  const count = (status: string) => grouped.find(item => item.status === status)?._count._all ?? 0;
  return {
    items: rows.map(present),
    pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.max(1, Math.ceil(total / input.pageSize)) },
    summary: { total: grouped.reduce((sum, item) => sum + item._count._all, 0), open: count('OPEN'), partial: count('PARTIALLY_RECEIVED'), completed: count('COMPLETED'), overdue, totalAmount: Number(aggregate._sum.totalAmount ?? 0) },
  };
}

export async function getPurchaseOrder(user: CurrentUser, id: string) {
  const row = await current(id);
  assertScope(user, row.warehouse.store.id);
  return present(row);
}

export async function createPurchaseOrder(user: CurrentUser, input: z.infer<typeof createPurchaseOrderInput>) {
  const request = input.purchaseRequestId ? await prisma.purchaseRequest.findUnique({ where: { id: input.purchaseRequestId }, include: { items: true } }) : null;
  if (input.purchaseRequestId && !request) throw new AppError(404, 'PURCHASE_REQUEST_NOT_FOUND', '\u004b\u0068\u00f4\u006e\u0067 \u0074\u00ec\u006d \u0074\u0068\u1ea5\u0079 \u0111\u1ec1 \u006e\u0067\u0068\u1ecb \u006d\u0075\u0061 \u0068\u00e0\u006e\u0067.');
  if (request) {
    assertScope(user, request.storeId);
    if (request.status !== 'APPROVED') throw new AppError(409, 'PURCHASE_REQUEST_NOT_APPROVED', '\u0043\u0068\u1ec9 \u0063\u00f3 \u0074\u0068\u1ec3 \u0074\u1ea1\u006f \u0050\u004f \u0074\u1eeb \u0111\u1ec1 \u006e\u0067\u0068\u1ecb \u0111\u00e3 \u0064\u0075\u0079\u1ec7\u0074.');
    const approved = new Map(request.items.map(item => [item.skuId, item.approvedQuantity]));
    if (input.items.length !== request.items.length || input.items.some(item => approved.get(item.skuId) !== item.quantity)) throw new AppError(400, 'ORDER_ITEMS_MISMATCH', '\u0050\u004f \u0074\u1ea1\u006f \u0074\u1eeb \u0111\u1ec1 \u006e\u0067\u0068\u1ecb \u0070\u0068\u1ea3\u0069 \u0111\u00fa\u006e\u0067 \u0073\u1ed1 \u006c\u01b0\u1ee3\u006e\u0067 \u0111\u00e3 \u0111\u01b0\u1ee3\u0063 \u0064\u0075\u0079\u1ec7\u0074.');
  }
  const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId } });
  if (!supplier) throw new AppError(404, 'SUPPLIER_NOT_FOUND', '\u004b\u0068\u00f4\u006e\u0067 \u0074\u00ec\u006d \u0074\u0068\u1ea5\u0079 \u006e\u0068\u00e0 \u0063\u0075\u006e\u0067 \u0063\u1ea5\u0070.');
  if (!supplier.active) throw new AppError(409, 'SUPPLIER_INACTIVE', '\u004e\u0068\u00e0 \u0063\u0075\u006e\u0067 \u0063\u1ea5\u0070 \u0111\u00e3 \u006e\u0067\u1eeb\u006e\u0067 \u0068\u1ee3\u0070 \u0074\u00e1\u0063.');
  const warehouse = await prisma.warehouse.findUnique({ where: { id: input.warehouseId } });
  if (!warehouse) throw new AppError(404, 'WAREHOUSE_NOT_FOUND', '\u004b\u0068\u00f4\u006e\u0067 \u0074\u00ec\u006d \u0074\u0068\u1ea5\u0079 \u006b\u0068\u006f \u006e\u0068\u1ead\u006e.');
  if (!warehouse.active) throw new AppError(409, 'WAREHOUSE_INACTIVE', '\u004b\u0068\u006f \u006e\u0068\u1ead\u006e \u0111\u00e3 \u006e\u0067\u1eeb\u006e\u0067 \u0068\u006f\u1ea1\u0074 \u0111\u1ed9\u006e\u0067.');
  assertScope(user, warehouse.storeId);
  if (request && warehouse.storeId !== request.storeId) throw new AppError(400, 'WAREHOUSE_STORE_MISMATCH', '\u004b\u0068\u006f \u006e\u0068\u1ead\u006e \u0070\u0068\u1ea3\u0069 \u0074\u0068\u0075\u1ed9\u0063 \u0063\u0068\u0069 \u006e\u0068\u00e1\u006e\u0068 \u0111\u00e3 \u006c\u1ead\u0070 \u0111\u1ec1 \u006e\u0067\u0068\u1ecb \u006d\u0075\u0061.');
  const skus = await prisma.sku.findMany({ where: { id: { in: input.items.map(item => item.skuId) }, active: true, product: { active: true } }, select: { id: true } });
  if (skus.length !== input.items.length) throw new AppError(400, 'ORDER_SKU_INVALID', '\u004d\u1ed9\u0074 \u0068\u006f\u1eb7\u0063 \u006e\u0068\u0069\u1ec1\u0075 \u0073\u1ea3\u006e \u0070\u0068\u1ea9\u006d \u0111\u00e3 \u006e\u0067\u1eeb\u006e\u0067 \u006b\u0069\u006e\u0068 \u0064\u006f\u0061\u006e\u0068 \u0068\u006f\u1eb7\u0063 \u006b\u0068\u00f4\u006e\u0067 \u0074\u1ed3\u006e \u0074\u1ea1\u0069.');
  const totalAmount = input.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
  const row = await prisma.$transaction(async tx => {
    const code = await nextDailyCode(tx, 'PO', dayPrefix => tx.purchaseOrder.findMany({ where: { code: { startsWith: `${dayPrefix}-` } }, select: { code: true } }));
    if (request) {
      const changed = await tx.purchaseRequest.updateMany({ where: { id: request.id, status: 'APPROVED' }, data: { status: 'CONVERTED_TO_PO' } });
      if (changed.count !== 1) throw new AppError(409, 'PURCHASE_REQUEST_ALREADY_CONVERTED', '\u0110\u1ec1 \u006e\u0067\u0068\u1ecb \u0076\u1eeba \u0111\u01b0\u1ee3\u0063 \u0074\u1ea1\u006f \u0050\u004f \u0062\u1edf\u0069 \u006e\u0067\u01b0\u1eddi \u006b\u0068\u00e1\u0063.');
    }
    const created = await tx.purchaseOrder.create({ data: {
      code, purchaseRequestId: request?.id, supplierId: input.supplierId, warehouseId: input.warehouseId,
      createdById: user.id, expectedAt: input.expectedAt ? new Date(input.expectedAt) : null,
      paymentDueAt: input.paymentDueAt ? new Date(input.paymentDueAt) : new Date(Date.now() + 30 * 86_400_000), note: input.note, totalAmount,
      items: { create: input.items.map(item => ({ skuId: item.skuId, orderedQuantity: item.quantity, unitCost: item.unitCost, lineTotal: item.quantity * item.unitCost })) },
    }, include });
    await tx.auditLog.create({ data: { actorId: user.id, action: 'purchase_order.create', targetId: created.id } });
    return created;
  }, { isolationLevel: 'Serializable' });
  return present(row);
}

export async function receivePurchaseOrder(user: CurrentUser, id: string, input: z.infer<typeof receivePurchaseOrderInput>) {
  const row = await current(id);
  assertScope(user, row.warehouse.store.id);
  if (!['OPEN', 'PARTIALLY_RECEIVED'].includes(row.status)) throw new AppError(409, 'PURCHASE_ORDER_NOT_RECEIVABLE', 'Đơn mua hàng không còn ở trạng thái có thể nhận.');
  const lines = new Map(row.items.map(item => [item.id, item]));
  for (const inputItem of input.items) {
    const item = lines.get(inputItem.purchaseOrderItemId);
    if (!item) throw new AppError(400, 'RECEIPT_ITEM_NOT_IN_ORDER', 'Dòng nhận hàng không thuộc PO.');
    if (inputItem.quantity > item.orderedQuantity - item.receivedQuantity) throw new AppError(400, 'RECEIPT_EXCEEDS_REMAINING', `Số nhận của SKU ${item.sku.code} vượt quá số còn lại.`);
  }
  const evidenceUrls = await Promise.all(input.evidence.map(uploadOperationalEvidence));
  return prisma.$transaction(async tx => {
    const code = await nextDailyCode(tx, 'GRN', dayPrefix => tx.goodsReceipt.findMany({ where: { code: { startsWith: `${dayPrefix}-` } }, select: { code: true } }));
    const locked = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { items: true, warehouse: true } });
    if (!['OPEN', 'PARTIALLY_RECEIVED'].includes(locked.status)) throw new AppError(409, 'PURCHASE_ORDER_NOT_RECEIVABLE', 'Đơn mua hàng vừa được hoàn tất bởi người khác.');
    const lockedLines = new Map(locked.items.map(item => [item.id, item]));
    for (const inputItem of input.items) {
      const item = lockedLines.get(inputItem.purchaseOrderItemId);
      if (!item || inputItem.quantity > item.orderedQuantity - item.receivedQuantity) throw new AppError(409, 'RECEIPT_QUANTITY_CHANGED', 'Số lượng còn lại vừa thay đổi, vui lòng tải lại PO.');
    }
    await confirmIotEvents(tx, input.iotEventIds, { warehouseId: locked.warehouseId, skuIds: input.items.map(inputItem => lockedLines.get(inputItem.purchaseOrderItemId)!.skuId), actorId: user.id, action: 'iot.event.confirmed.purchase_receipt', referenceType: 'PURCHASE_ORDER', referenceId: id, referenceCode: locked.code, workflow: 'PURCHASE_RECEIPT' });
    const receipt = await tx.goodsReceipt.create({ data: {
      code, purchaseOrderId: id, receivedById: user.id, note: input.note,
      ...(evidenceUrls.length ? { evidenceUrls } : {}),
      items: { create: input.items.map(inputItem => { const item = lockedLines.get(inputItem.purchaseOrderItemId)!; return { purchaseOrderItemId: item.id, skuId: item.skuId, quantity: inputItem.quantity, unitCost: item.unitCost }; }) },
    } });
    const receiptAmount = input.items.reduce((sum, inputItem) => {
      const item = lockedLines.get(inputItem.purchaseOrderItemId)!;
      return sum + inputItem.quantity * Number(item.unitCost);
    }, 0);
    for (const inputItem of input.items) {
      const item = lockedLines.get(inputItem.purchaseOrderItemId)!;
      const inventory = await tx.inventory.upsert({ where: { warehouseId_skuId: { warehouseId: locked.warehouseId, skuId: item.skuId } }, create: { warehouseId: locked.warehouseId, skuId: item.skuId }, update: {} });
      await tx.inventory.update({ where: { id: inventory.id }, data: { onHand: { increment: inputItem.quantity } } });
      await tx.inventoryTransaction.create({ data: { inventoryId: inventory.id, warehouseId: locked.warehouseId, skuId: item.skuId, type: 'PURCHASE_RECEIPT', quantity: inputItem.quantity, beforeQuantity: inventory.onHand, afterQuantity: inventory.onHand + inputItem.quantity, referenceType: 'GOODS_RECEIPT', referenceId: receipt.id, reason: `Nhập hàng theo ${locked.code}`, actorId: user.id } });
      await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQuantity: { increment: inputItem.quantity } } });
    }
    const existingPayable = await tx.payable.findUnique({ where: { purchaseOrderId: id } });
    if (existingPayable) {
      await tx.payable.update({ where: { id: existingPayable.id }, data: { totalAmount: { increment: receiptAmount }, status: Number(existingPayable.paidAmount) > 0 ? 'PARTIALLY_PAID' : 'OPEN' } });
    } else {
      await tx.payable.create({ data: { code: await nextDailyCode(tx, 'AP', dayPrefix => tx.payable.findMany({ where: { code: { startsWith: `${dayPrefix}-` } }, select: { code: true } })), supplierId: locked.supplierId, purchaseOrderId: id, totalAmount: receiptAmount, dueDate: locked.paymentDueAt } });
    }
    await tx.supplier.update({ where: { id: locked.supplierId }, data: { currentDebt: { increment: receiptAmount } } });
    const updatedItems = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: id } });
    const completed = updatedItems.every(item => item.receivedQuantity >= item.orderedQuantity);
    await tx.purchaseOrder.update({ where: { id }, data: { status: completed ? 'COMPLETED' : 'PARTIALLY_RECEIVED' } });
    await tx.auditLog.create({ data: { actorId: user.id, action: 'purchase_order.receive', targetId: receipt.id } });
    const result = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include });
    return present(result);
  }, { isolationLevel: 'Serializable' });
}

const supplierReturnInclude = {
  supplier: { select: { id: true, code: true, name: true } },
  warehouse: { select: { id: true, code: true, name: true, store: { select: { id: true, code: true, name: true } } } },
  purchaseOrder: { select: { id: true, code: true } },
  processedBy: person,
  items: { include: { sku: { include: { product: { select: { name: true, unit: true } } } } } },
} as const;
const presentSupplierReturn = <T extends { totalAmount: unknown; items: Array<{ unitCost: unknown; lineTotal: unknown }> }>(row: T) => ({ ...row, totalAmount: Number(row.totalAmount), items: row.items.map(item => ({ ...item, unitCost: Number(item.unitCost), lineTotal: Number(item.lineTotal) })) });

export async function listSupplierReturns(user: CurrentUser, input: z.infer<typeof supplierReturnListInput>) {
  const base: Prisma.SupplierReturnWhereInput = user.globalAccess ? {} : { warehouse: { storeId: { in: storeIds(user) } } };
  const where: Prisma.SupplierReturnWhereInput = { AND: [base, input.supplierId ? { supplierId: input.supplierId } : {}, input.q ? { OR: [{ code: { contains: input.q, mode: 'insensitive' } }, { purchaseOrder: { code: { contains: input.q, mode: 'insensitive' } } }, { supplier: { name: { contains: input.q, mode: 'insensitive' } } }] } : {}] };
  const [items, total, aggregate] = await Promise.all([
    prisma.supplierReturn.findMany({ where, include: supplierReturnInclude, orderBy: { createdAt: 'desc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
    prisma.supplierReturn.count({ where }),
    prisma.supplierReturn.aggregate({ where, _sum: { totalAmount: true } }),
  ]);
  return { items: items.map(presentSupplierReturn), pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.max(1, Math.ceil(total / input.pageSize)) }, summary: { total, totalAmount: Number(aggregate._sum.totalAmount ?? 0) } };
}

export async function createSupplierReturn(user: CurrentUser, id: string, input: z.infer<typeof createSupplierReturnInput>) {
  const row = await current(id);
  assertScope(user, row.warehouse.store.id);
  const returned = await prisma.supplierReturnItem.groupBy({ by: ['purchaseOrderItemId'], where: { supplierReturn: { purchaseOrderId: id } }, _sum: { quantity: true } });
  const returnedMap = new Map(returned.map(item => [item.purchaseOrderItemId, item._sum.quantity ?? 0]));
  const lines = new Map(row.items.map(item => [item.id, item]));
  for (const request of input.items) {
    const line = lines.get(request.purchaseOrderItemId);
    if (!line) throw new AppError(400, 'RETURN_ITEM_NOT_IN_ORDER', 'Dòng trả hàng không thuộc PO.');
    if (request.quantity > line.receivedQuantity - (returnedMap.get(line.id) ?? 0)) throw new AppError(400, 'RETURN_EXCEEDS_RECEIVED', `Số trả của SKU ${line.sku.code} vượt quá số đã nhận còn lại.`);
  }
  const returnAmount = input.items.reduce((sum, request) => sum + request.quantity * Number(lines.get(request.purchaseOrderItemId)!.unitCost), 0);
  const payable = await prisma.payable.findUnique({ where: { purchaseOrderId: id } });
  if (!payable || returnAmount > Number(payable.totalAmount) - Number(payable.paidAmount)) throw new AppError(409, 'RETURN_EXCEEDS_OUTSTANDING', 'Giá trị trả vượt quá công nợ chưa thanh toán. Cần xử lý hoàn tiền NCC riêng.');
  return prisma.$transaction(async tx => {
    const code = await nextDailyCode(tx, 'SRN', dayPrefix => tx.supplierReturn.findMany({ where: { code: { startsWith: `${dayPrefix}-` } }, select: { code: true } }));
    const created = await tx.supplierReturn.create({ data: { code, purchaseOrderId: id, supplierId: row.supplierId, warehouseId: row.warehouseId, processedById: user.id, reason: input.reason, totalAmount: returnAmount, items: { create: input.items.map(request => { const line = lines.get(request.purchaseOrderItemId)!; return { purchaseOrderItemId: line.id, skuId: line.skuId, quantity: request.quantity, unitCost: line.unitCost, lineTotal: request.quantity * Number(line.unitCost) }; }) } }, include: supplierReturnInclude });
    for (const request of input.items) {
      const line = lines.get(request.purchaseOrderItemId)!;
      const inventory = await tx.inventory.findUnique({ where: { warehouseId_skuId: { warehouseId: row.warehouseId, skuId: line.skuId } } });
      if (!inventory || inventory.onHand < request.quantity) throw new AppError(409, 'RETURN_STOCK_NOT_ENOUGH', `Tồn kho của SKU ${line.sku.code} không đủ để trả NCC.`);
      await tx.inventory.update({ where: { id: inventory.id }, data: { onHand: { decrement: request.quantity } } });
      await tx.inventoryTransaction.create({ data: { inventoryId: inventory.id, warehouseId: row.warehouseId, skuId: line.skuId, type: 'SUPPLIER_RETURN', quantity: -request.quantity, beforeQuantity: inventory.onHand, afterQuantity: inventory.onHand - request.quantity, referenceType: 'SUPPLIER_RETURN', referenceId: created.id, reason: input.reason, actorId: user.id } });
    }
    const newTotal = Number(payable.totalAmount) - returnAmount;
    await tx.payable.update({ where: { id: payable.id }, data: { totalAmount: { decrement: returnAmount }, status: Math.abs(newTotal - Number(payable.paidAmount)) < 0.01 ? 'PAID' : Number(payable.paidAmount) > 0 ? 'PARTIALLY_PAID' : 'OPEN' } });
    await tx.supplier.update({ where: { id: row.supplierId }, data: { currentDebt: { decrement: returnAmount } } });
    await tx.auditLog.create({ data: { actorId: user.id, action: 'supplier_return.create', targetId: created.id, metadata: { purchaseOrderId: id } } });
    return presentSupplierReturn(created);
  }, { isolationLevel: 'Serializable' });
}
