import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma, type PayosCheckout } from '../../generated/prisma/client.js';
import { prisma } from '../../common/database.js';
import { AppError } from '../../common/app-error.js';
import { env } from '../../config/env.js';
import { logger } from '../../common/logger.js';
import type { CurrentUser } from '../auth/auth.repository.js';
import { payosClient, payosConfigured } from './payos.client.js';

export const checkoutInput = z.object({
  checkoutId: z.string().uuid(), shiftId: z.string().uuid(), warehouseId: z.string().uuid(),
  customerId: z.string().uuid().optional(), discount: z.number().finite().min(0).max(999_999_999_999).default(0),
  note: z.string().trim().max(500).optional(),
  items: z.array(z.object({ skuId: z.string().uuid(), quantity: z.number().int().min(1).max(100000) }).strict()).min(1).max(100),
}).strict().refine(value => new Set(value.items.map(item => item.skuId)).size === value.items.length, 'SKU trùng lặp.');
type CheckoutInput = z.infer<typeof checkoutInput>;
type Snapshot = { requestHash: string; cashierId: string; customerId: string | null; customerName: string | null; customerPhone: string | null; subtotal: number; discount: number; note: string | null; items: { skuId: string; productCode: string; skuCode: string; productName: string; unit: string; quantity: number; unitPrice: number; costPrice: number; lineTotal: number }[] };
const activeStatuses = ['CREATING', 'PENDING'];
const snapshotOf = (row: PayosCheckout) => row.snapshot as unknown as Snapshot;
const notFoundAtProvider = (error: unknown) => typeof error === 'object' && error !== null && ('code' in error && error.code === '101');
export const presentCheckout = (row: PayosCheckout) => ({ id: row.id, orderCode: row.orderCode.toString(), amount: Number(row.amount), status: row.status, checkoutUrl: row.checkoutUrl, qrCode: row.qrCode, accountName: row.accountName, accountNumber: row.accountNumber, description: row.description, expiresAt: row.expiresAt, invoiceId: row.invoiceId });
function assertAccess(user: CurrentUser, row: PayosCheckout) {
  if ((!user.globalAccess && !user.stores.some(store => store.id === row.storeId)) || (row.actorId !== user.id && !user.globalAccess && !user.permissions.includes('invoices.cancel'))) throw new AppError(403, 'CHECKOUT_FORBIDDEN', 'Bạn không được thao tác đơn thanh toán này.');
}
async function serial<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(work, { isolationLevel: 'Serializable', timeout: 15000 }); }
    catch (error) { if (attempt < 2 && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') continue; throw error; }
  }
}

async function reserveCheckout(user: CurrentUser, input: CheckoutInput) {
  const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return serial(async tx => {
    const existing = await tx.payosCheckout.findUnique({ where: { id: input.checkoutId } });
    if (existing) {
      assertAccess(user, existing);
      if (snapshotOf(existing).requestHash !== requestHash) throw new AppError(409, 'CHECKOUT_CHANGED', 'Giỏ hàng đã thay đổi. Hãy hủy đơn chờ trước khi tạo đơn khác.');
      return existing;
    }
    const shift = await tx.workShift.findUnique({ where: { id: input.shiftId } });
    if (!shift || shift.status !== 'OPEN') throw new AppError(409, 'SHIFT_NOT_OPEN', 'Cần ca bán hàng đang mở.');
    if (!user.globalAccess && !user.stores.some(store => store.id === shift.storeId)) throw new AppError(403, 'STORE_FORBIDDEN', 'Chi nhánh ngoài phạm vi tài khoản.');
    if (shift.cashierId !== user.id && !user.permissions.includes('invoices.cancel')) throw new AppError(403, 'SHIFT_FORBIDDEN', 'Bạn chỉ được bán hàng trong ca của mình.');
    const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, storeId: shift.storeId, active: true, store: { active: true } } });
    if (!warehouse) throw new AppError(409, 'WAREHOUSE_UNAVAILABLE', 'Kho không thuộc chi nhánh hoặc đã ngừng hoạt động.');
    const customer = input.customerId ? await tx.customer.findUnique({ where: { id: input.customerId } }) : null;
    if (input.customerId && !customer?.active) throw new AppError(409, 'CUSTOMER_UNAVAILABLE', 'Khách hàng không tồn tại hoặc đã ngừng hoạt động.');
    const skus = await tx.sku.findMany({ where: { id: { in: input.items.map(item => item.skuId) }, active: true, product: { active: true } }, include: { product: true } });
    if (skus.length !== input.items.length) throw new AppError(409, 'SKU_UNAVAILABLE', 'Sản phẩm không còn kinh doanh.');
    const items = input.items.map(line => {
      const sku = skus.find(sku => sku.id === line.skuId)!;
      return { skuId: sku.id, productCode: sku.product.code, skuCode: sku.code, productName: sku.product.name, unit: sku.product.unit, quantity: line.quantity, unitPrice: Number(sku.sellingPrice), costPrice: Number(sku.costPrice), lineTotal: Number(sku.sellingPrice) * line.quantity };
    });
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const amount = subtotal - input.discount;
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 999_999_999_999) throw new AppError(400, 'PAYOS_AMOUNT_INVALID', 'payOS yêu cầu tổng tiền là số nguyên VND lớn hơn 0; kiểm tra giảm giá.');
    for (const item of items) {
      const stock = await tx.inventory.findUnique({ where: { warehouseId_skuId: { warehouseId: warehouse.id, skuId: item.skuId } } });
      if (!stock || stock.onHand - stock.reserved < item.quantity) throw new AppError(409, 'INSUFFICIENT_STOCK', `${item.productName} không đủ tồn khả dụng.`);
      await tx.inventory.update({ where: { id: stock.id }, data: { reserved: { increment: item.quantity } } });
    }
    // Serialize checkout creation with shift closing; pending checkouts block closing.
    await tx.workShift.update({ where: { id: shift.id }, data: { updatedAt: new Date() } });
    const snapshot: Snapshot = { requestHash, cashierId: shift.cashierId, customerId: customer?.id ?? null, customerName: customer?.name ?? null, customerPhone: customer?.phone ?? null, subtotal, discount: input.discount, note: input.note ?? null, items };
    return tx.payosCheckout.create({ data: { id: input.checkoutId, actorId: user.id, shiftId: shift.id, storeId: shift.storeId, warehouseId: warehouse.id, amount, snapshot: snapshot as unknown as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 15 * 60000) } });
  });
}

async function ensureLink(row: PayosCheckout) {
  if (row.status !== 'CREATING') return row;
  const client = payosClient();
  const draft = snapshotOf(row);
  const urlFor = (base: string) => { const url = new URL(base); url.searchParams.set('checkoutId', row.id); return url.toString(); };
  try {
    const link = await client.paymentRequests.create({ orderCode: Number(row.orderCode), amount: Number(row.amount), description: `FM${row.orderCode.toString().slice(-7)}`, expiredAt: Math.floor(row.expiresAt.getTime() / 1000), returnUrl: urlFor(env.PAYOS_RETURN_URL), cancelUrl: urlFor(env.PAYOS_CANCEL_URL), items: draft.items.map(item => ({ name: item.productName, quantity: item.quantity, price: item.unitPrice })) });
    await prisma.payosCheckout.updateMany({ where: { id: row.id, status: 'CREATING' }, data: { status: 'PENDING', paymentLinkId: link.paymentLinkId, checkoutUrl: link.checkoutUrl, qrCode: link.qrCode, accountName: link.accountName, accountNumber: link.accountNumber, description: link.description } });
  } catch {
    // A timeout may hide a successfully created link. Keep the same order code and stock hold.
    try {
      const link = await client.paymentRequests.get(Number(row.orderCode));
      await prisma.payosCheckout.updateMany({ where: { id: row.id, status: 'CREATING' }, data: { status: 'PENDING', paymentLinkId: link.id, checkoutUrl: `https://pay.payos.vn/web/${encodeURIComponent(link.id)}` } });
    } catch { /* Reconciliation retries; never release stock after an ambiguous network failure. */ }
  }
  return prisma.payosCheckout.findUniqueOrThrow({ where: { id: row.id } });
}

export async function createCheckout(user: CurrentUser, input: CheckoutInput) {
  payosClient();
  const row = await reserveCheckout(user, input);
  if (row.expiresAt.getTime() <= Date.now()) return presentCheckout(await reconcileCheckout(row));
  return presentCheckout(await ensureLink(row));
}

type ProviderLink = Awaited<ReturnType<ReturnType<typeof payosClient>['paymentRequests']['get']>>;
export function assertProviderLink(row: Pick<PayosCheckout, 'orderCode' | 'amount' | 'paymentLinkId'>, link: ProviderLink) {
  if (link.orderCode !== Number(row.orderCode) || link.amount !== Number(row.amount) || (row.paymentLinkId && link.id !== row.paymentLinkId)) throw new AppError(409, 'PAYOS_PAYMENT_MISMATCH', 'Thông tin thanh toán không khớp đơn hàng.');
}

export async function applyProviderLink(row: PayosCheckout, link: ProviderLink) {
  assertProviderLink(row, link);
  const paid = link.status === 'PAID' && link.amountPaid >= Number(row.amount);
  const closed = ['CANCELLED', 'EXPIRED'].includes(link.status) && link.amountPaid === 0;
  if (!paid && !closed) return prisma.payosCheckout.findUniqueOrThrow({ where: { id: row.id } });
  return serial(async tx => {
    const current = await tx.payosCheckout.findUniqueOrThrow({ where: { id: row.id } });
    if (!activeStatuses.includes(current.status)) return current;
    const draft = snapshotOf(current);
    const status = paid ? 'PAID' : link.status === 'EXPIRED' ? 'EXPIRED' : 'CANCELLED';
    const changed = await tx.payosCheckout.updateMany({ where: { id: current.id, status: { in: activeStatuses } }, data: { status, paymentLinkId: link.id } });
    if (!changed.count) return tx.payosCheckout.findUniqueOrThrow({ where: { id: row.id } });
    const invoiceCode = `HD-PAYOS-${row.orderCode}`;
    for (const item of draft.items) {
      const stock = await tx.inventory.findUniqueOrThrow({ where: { warehouseId_skuId: { warehouseId: row.warehouseId, skuId: item.skuId } } });
      if (stock.reserved < item.quantity || (paid && stock.onHand < item.quantity)) throw new AppError(409, 'CHECKOUT_STOCK_CONFLICT', 'Tồn giữ chỗ đã thay đổi. Cần đối soát đơn thanh toán.');
      await tx.inventory.update({ where: { id: stock.id }, data: { reserved: { decrement: item.quantity }, ...(paid ? { onHand: { decrement: item.quantity } } : {}) } });
      if (paid) await tx.inventoryTransaction.create({ data: { inventoryId: stock.id, warehouseId: row.warehouseId, skuId: item.skuId, type: 'SALE', quantity: -item.quantity, beforeQuantity: stock.onHand, afterQuantity: stock.onHand - item.quantity, referenceType: 'INVOICE', referenceId: invoiceCode, reason: `Thanh toán payOS ${row.orderCode}`, actorId: row.actorId } });
    }
    if (paid) {
      const shift = await tx.workShift.updateMany({ where: { id: row.shiftId, status: 'OPEN' }, data: { digitalRevenue: { increment: row.amount } } });
      if (!shift.count) throw new AppError(409, 'SHIFT_CLOSED', 'Ca đã đóng. Cần đối soát thanh toán payOS.');
      const invoice = await tx.invoice.create({ data: { code: invoiceCode, shiftId: row.shiftId, warehouseId: row.warehouseId, storeId: row.storeId, cashierId: draft.cashierId, customerId: draft.customerId, customerName: draft.customerName, customerPhone: draft.customerPhone, subtotal: draft.subtotal, discount: draft.discount, total: row.amount, note: draft.note, items: { create: draft.items }, payments: { create: { method: 'QR', amount: row.amount, reference: `PAYOS:${link.id}` } } } });
      await tx.payosCheckout.update({ where: { id: row.id }, data: { invoiceId: invoice.id, paidAt: new Date() } });
    }
    await tx.auditLog.create({ data: { actorId: row.actorId, action: `payos.${status.toLowerCase()}`, targetId: row.id } });
    return tx.payosCheckout.findUniqueOrThrow({ where: { id: row.id } });
  });
}

export async function reconcileCheckout(row: PayosCheckout) {
  if (!activeStatuses.includes(row.status)) return row;
  const client = payosClient();
  try {
    let link = await client.paymentRequests.get(Number(row.orderCode));
    if (row.expiresAt.getTime() <= Date.now() && !['PAID', 'CANCELLED', 'EXPIRED'].includes(link.status) && link.amountPaid === 0) link = await client.paymentRequests.cancel(Number(row.orderCode), 'Hết thời gian thanh toán');
    return applyProviderLink(row, link);
  } catch (error) {
    if (row.status === 'CREATING' && row.expiresAt.getTime() <= Date.now() && notFoundAtProvider(error)) {
      return applyProviderLink(row, { id: row.paymentLinkId ?? `not-created-${row.id}`, orderCode: Number(row.orderCode), amount: Number(row.amount), amountPaid: 0, amountRemaining: Number(row.amount), status: 'EXPIRED', createdAt: '', transactions: [], canceledAt: null, cancellationReason: null });
    }
    throw error;
  }
}
export async function getCheckout(user: CurrentUser, id: string) {
  const row = await prisma.payosCheckout.findUnique({ where: { id } });
  if (!row) throw new AppError(404, 'CHECKOUT_NOT_FOUND', 'Không tìm thấy đơn thanh toán.');
  assertAccess(user, row);
  return presentCheckout(await reconcileCheckout(row));
}
export async function cancelCheckout(user: CurrentUser, id: string) {
  const row = await prisma.payosCheckout.findUnique({ where: { id } });
  if (!row) throw new AppError(404, 'CHECKOUT_NOT_FOUND', 'Không tìm thấy đơn thanh toán.');
  assertAccess(user, row);
  if (!activeStatuses.includes(row.status)) return presentCheckout(row);
  if (row.status === 'CREATING') throw new AppError(409, 'CHECKOUT_CREATING', 'Đang xác minh trạng thái tạo QR. Vui lòng thử lại sau.');
  const link = await payosClient().paymentRequests.cancel(Number(row.orderCode), 'Thu ngân hủy yêu cầu thanh toán');
  if (link.amountPaid > 0 && link.status !== 'PAID') throw new AppError(409, 'CHECKOUT_UNDERPAID', 'Đã nhận một phần tiền. Không giải phóng hàng; cần thanh toán đủ hoặc đối soát.');
  return presentCheckout(await applyProviderLink(row, link));
}
export async function handlePayosWebhook(body: unknown) {
  const client = payosClient();
  let event;
  try { event = await client.webhooks.verify(body as Parameters<ReturnType<typeof payosClient>['webhooks']['verify']>[0]); }
  catch { throw new AppError(400, 'PAYOS_INVALID_SIGNATURE', 'Webhook payOS không hợp lệ.'); }
  if (event.code !== '00' || event.currency !== 'VND' || !Number.isSafeInteger(event.orderCode) || event.orderCode < 1) return;
  const row = await prisma.payosCheckout.findUnique({ where: { orderCode: BigInt(event.orderCode) } });
  // payOS sends a sample event when registering the endpoint.
  if (!row) return;
  if (row.paymentLinkId && row.paymentLinkId !== event.paymentLinkId) throw new AppError(400, 'PAYOS_PAYMENT_MISMATCH', 'Link thanh toán không khớp.');
  await reconcileCheckout(row);
}
export function startPayosReconciliation() {
  if (!payosConfigured()) return () => {};
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const rows = await prisma.payosCheckout.findMany({ where: { status: { in: activeStatuses } }, orderBy: { updatedAt: 'asc' }, take: 20 });
      for (const row of rows) {
        try { await reconcileCheckout(row); }
        catch { logger.warn({ checkoutId: row.id }, 'payOS reconciliation will retry'); }
        await prisma.payosCheckout.update({ where: { id: row.id }, data: { updatedAt: new Date() } });
      }
    } catch { logger.warn('payOS reconciliation unavailable'); }
    finally { running = false; }
  };
  const timer = setInterval(() => void tick(), 30000).unref();
  void tick();
  return () => clearInterval(timer);
}
