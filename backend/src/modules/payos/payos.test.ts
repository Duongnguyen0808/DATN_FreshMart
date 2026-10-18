import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  prisma: { payosCheckout: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() }, workShift: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() }, warehouse: { findFirst: vi.fn() }, customer: { findUnique: vi.fn() }, sku: { findMany: vi.fn() }, inventory: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() }, invoice: { create: vi.fn() }, inventoryTransaction: { create: vi.fn() }, auditLog: { create: vi.fn() }, $transaction: vi.fn() },
  client: { paymentRequests: { create: vi.fn(), get: vi.fn(), cancel: vi.fn() }, webhooks: { verify: vi.fn() } },
}));
vi.mock('../../common/database.js', () => ({ prisma: mocks.prisma }));
vi.mock('./payos.client.js', () => ({ payosClient: () => mocks.client, payosConfigured: () => true }));
import { applyProviderLink, cancelCheckout, checkoutInput, createCheckout, getCheckout, handlePayosWebhook } from './payos.service.js';
import type { PayosCheckout } from '../../generated/prisma/client.js';
import type { CurrentUser } from '../auth/auth.repository.js';
const id = '11111111-1111-4111-8111-111111111111';
const user = { id, globalAccess: false, stores: [{ id }], permissions: ['invoices.create'], roles: [] } as unknown as CurrentUser;
const input = { checkoutId: id, shiftId: id, warehouseId: id, discount: 1000, items: [{ skuId: id, quantity: 2 }] };
const link = { id: 'provider-link', orderCode: 10, amount: 19000, amountPaid: 19000, amountRemaining: 0, status: 'PAID' as const, createdAt: '', transactions: [], cancellationReason: null, canceledAt: null };
let row: PayosCheckout | null;
let reserved: number;
let onHand: number;
let invoices: number;
let revenue: number;
let queue: Promise<unknown>;
beforeEach(() => {
  vi.clearAllMocks(); row = null; reserved = 0; onHand = 20; invoices = 0; revenue = 0; queue = Promise.resolve();
  mocks.prisma.$transaction.mockImplementation((callback) => {
    const next = queue.then(() => callback(mocks.prisma));
    queue = next.catch(() => {}); return next;
  });
  mocks.prisma.payosCheckout.findUnique.mockImplementation(() => row);
  mocks.prisma.payosCheckout.findUniqueOrThrow.mockImplementation(() => ({ ...row }));
  mocks.prisma.payosCheckout.create.mockImplementation(({ data }) => row = { ...data, orderCode: 10n, status: 'CREATING', invoiceId: null, paymentLinkId: null } as PayosCheckout);
  mocks.prisma.payosCheckout.updateMany.mockImplementation(({ where, data }) => {
    if (!row || (typeof where.status === 'string' ? row.status !== where.status : !where.status.in.includes(row.status))) return { count: 0 };
    Object.assign(row, data); return { count: 1 };
  });
  mocks.prisma.payosCheckout.update.mockImplementation(({ data }) => Object.assign(row!, data));
  mocks.prisma.workShift.findUnique.mockResolvedValue({ id, storeId: id, cashierId: id, status: 'OPEN' });
  mocks.prisma.workShift.update.mockResolvedValue({});
  mocks.prisma.workShift.updateMany.mockImplementation(({ data }) => { revenue += Number(data.digitalRevenue?.increment ?? 0); return { count: 1 }; });
  mocks.prisma.warehouse.findFirst.mockResolvedValue({ id });
  mocks.prisma.sku.findMany.mockResolvedValue([{ id, code: 'SKU01', sellingPrice: 10000, costPrice: 6000, product: { code: 'SP01', name: 'Sữa tươi', unit: 'Hộp' } }]);
  mocks.prisma.inventory.findUnique.mockImplementation(() => ({ id, reserved, onHand }));
  mocks.prisma.inventory.findUniqueOrThrow.mockImplementation(() => ({ id, reserved, onHand }));
  mocks.prisma.inventory.update.mockImplementation(({ data }) => { reserved += (data.reserved?.increment ?? 0) - (data.reserved?.decrement ?? 0); onHand -= data.onHand?.decrement ?? 0; return {}; });
  mocks.prisma.invoice.create.mockImplementation(() => { invoices++; return { id: `invoice-${invoices}` }; });
  mocks.client.paymentRequests.create.mockResolvedValue({ ...link, status: 'PENDING', paymentLinkId: link.id, checkoutUrl: 'https://pay.payos.vn/web/provider-link', qrCode: 'QR-payload', accountName: 'FreshMart', accountNumber: '123', description: 'FM10' });
  mocks.client.paymentRequests.get.mockResolvedValue(link);
  mocks.client.paymentRequests.cancel.mockResolvedValue({ ...link, status: 'CANCELLED', amountPaid: 0 });
  mocks.client.webhooks.verify.mockResolvedValue({ orderCode: 10, paymentLinkId: link.id, code: '00', currency: 'VND' });
});

describe('payOS checkout', () => {
  it('prices on server, reserves stock, and does not book a sale when creating QR; retries reuse the checkout', async () => {
    const created = await createCheckout(user, input);
    expect(created.amount).toBe(19000); expect(created.status).toBe('PENDING');
    expect(reserved).toBe(2); expect(onHand).toBe(20); expect(invoices).toBe(0); expect(revenue).toBe(0);
    await createCheckout(user, input);
    expect(reserved).toBe(2); expect(mocks.client.paymentRequests.create).toHaveBeenCalledTimes(1);
    expect(checkoutInput.safeParse({ ...input, amount: 1 }).success).toBe(false);
  });
  it('creates exactly one invoice and revenue entry across concurrent webhook/poll requests, using frozen prices', async () => {
    await createCheckout(user, input);
    await Promise.all([getCheckout(user, id), handlePayosWebhook({}), handlePayosWebhook({})]);
    expect(invoices).toBe(1); expect(revenue).toBe(19000); expect(onHand).toBe(18); expect(reserved).toBe(0);
    expect(row?.invoiceId).toBe('invoice-1');
    expect(mocks.prisma.invoice.create.mock.calls[0][0].data.items.create[0].unitPrice).toBe(10000);
    expect(mocks.prisma.inventoryTransaction.create).toHaveBeenCalledTimes(1);
  });
  it('rejects forged webhook signatures before looking up a checkout', async () => {
    mocks.client.webhooks.verify.mockRejectedValue(new Error('bad signature'));
    await expect(handlePayosWebhook({ success: true })).rejects.toMatchObject({ code: 'PAYOS_INVALID_SIGNATURE' });
    expect(mocks.prisma.payosCheckout.findUnique).not.toHaveBeenCalled();
  });
  it('does not trust mismatched amounts or payment link IDs', async () => {
    await createCheckout(user, input);
    await expect(applyProviderLink(row!, { ...link, amount: 1 })).rejects.toMatchObject({ code: 'PAYOS_PAYMENT_MISMATCH' });
    await expect(applyProviderLink(row!, { ...link, id: 'wrong-link' })).rejects.toMatchObject({ code: 'PAYOS_PAYMENT_MISMATCH' });
    expect(invoices).toBe(0); expect(reserved).toBe(2);
  });
  it('keeps underpaid orders reserved and does not finalize or release them', async () => {
    await createCheckout(user, input);
    await applyProviderLink(row!, { ...link, status: 'UNDERPAID', amountPaid: 1000 });
    expect(row?.status).toBe('PENDING'); expect(invoices).toBe(0); expect(reserved).toBe(2);
    mocks.client.paymentRequests.cancel.mockResolvedValue({ ...link, status: 'CANCELLED', amountPaid: 1000 });
    await expect(cancelCheckout(user, id)).rejects.toMatchObject({ code: 'CHECKOUT_UNDERPAID' });
    expect(reserved).toBe(2);
  });
  it('releases an unpaid cancellation once without changing physical stock or revenue', async () => {
    await createCheckout(user, input);
    await cancelCheckout(user, id); await cancelCheckout(user, id);
    expect(row?.status).toBe('CANCELLED'); expect(reserved).toBe(0); expect(onHand).toBe(20); expect(revenue).toBe(0); expect(invoices).toBe(0);
  });
  it('expires only after reconciling with the provider, not from a browser countdown', async () => {
    await createCheckout(user, input);
    row!.expiresAt = new Date(Date.now() - 1000);
    mocks.client.paymentRequests.get.mockResolvedValue({ ...link, status: 'PENDING', amountPaid: 0 });
    await getCheckout(user, id);
    expect(mocks.client.paymentRequests.cancel).toHaveBeenCalledTimes(1); expect(reserved).toBe(0);
  });
  it('retains stock after ambiguous timeouts and allows retrying the same order code', async () => {
    mocks.client.paymentRequests.create.mockRejectedValueOnce(new Error('timeout'));
    mocks.client.paymentRequests.get.mockRejectedValueOnce(new Error('network'));
    expect((await createCheckout(user, input)).status).toBe('CREATING');
    expect(reserved).toBe(2);
    await createCheckout(user, input);
    expect(reserved).toBe(2); expect(row?.status).toBe('PENDING');
    expect(mocks.client.paymentRequests.create.mock.calls.map(call => call[0].orderCode)).toEqual([10, 10]);
  });
  it('releases an expired uncreated checkout only on confirmed provider code 101', async () => {
    mocks.client.paymentRequests.create.mockRejectedValue(new Error('timeout'));
    mocks.client.paymentRequests.get.mockRejectedValue(new Error('network'));
    await createCheckout(user, input);
    row!.expiresAt = new Date(Date.now() - 1000);
    await expect(getCheckout(user, id)).rejects.toThrow('network');
    expect(reserved).toBe(2);
    mocks.client.paymentRequests.get.mockRejectedValue({ code: '101', status: 200 });
    expect((await getCheckout(user, id)).status).toBe('EXPIRED');
    expect(reserved).toBe(0); expect(onHand).toBe(20); expect(invoices).toBe(0);
  });
  it('denies other cashiers and reused checkout IDs with changed carts', async () => {
    await createCheckout(user, input);
    await expect(getCheckout({ ...user, id: 'other' }, id)).rejects.toMatchObject({ code: 'CHECKOUT_FORBIDDEN' });
    await expect(createCheckout(user, { ...input, discount: 2000 })).rejects.toMatchObject({ code: 'CHECKOUT_CHANGED' });
    expect(reserved).toBe(2);
  });
  it('rejects closed shifts before reserving stock', async () => {
    mocks.prisma.workShift.findUnique.mockResolvedValue({ status: 'CLOSED' });
    await expect(createCheckout(user, input)).rejects.toMatchObject({ code: 'SHIFT_NOT_OPEN' });
    expect(reserved).toBe(0);
  });
});
