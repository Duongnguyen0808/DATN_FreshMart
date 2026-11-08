import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
import { describe, expect, it, vi } from 'vitest';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { CurrentUser } from '../auth/auth.repository.js';

const state = vi.hoisted(() => ({ tx: null as unknown as Prisma.TransactionClient }));
vi.mock('../../common/database.js', () => ({ prisma: new Proxy({}, { get: (_, key) => key === '$transaction' ? (fn: (tx: Prisma.TransactionClient) => unknown) => fn(state.tx) : state.tx[key as keyof typeof state.tx] }) }));

describe.skipIf(process.env.RUN_RFID_DB_TEST !== '1')('RFID receiving and transfer on PostgreSQL (rolled back)', () => {
  it.each(['RFID_DETECTED', 'CAMERA_CODE_DETECTED'])('%s persists one receipt and ignores repeat scans', async (eventType) => {
    const { prisma } = await vi.importActual<{ prisma: PrismaClient }>('../../common/database.js');
    const { createPurchaseOrder } = await import('../purchase-orders/purchase-orders.service.js');
    const { registerParcel, parcelInput, processInboundEvent } = await import('./iot-inbound.service.js');
    const { createTransfer, dispatchTransfer, receiveTransfer } = await import('../transfers/transfers.service.js');
    const rollback = new Error('EXPECTED_TEST_ROLLBACK');
    try {
      await prisma.$transaction(async tx => {
        state.tx = tx;
        const suffix = randomUUID();
        const account = await tx.user.create({ data: { email: `${suffix}@test.invalid`, name: 'RFID verification', passwordHash: 'not-a-login' } });
        const user = { ...account, globalAccess: true, stores: [], roles: [], permissions: ['purchase_orders.receive', 'transfers.create'] } as unknown as CurrentUser;
        const store = await tx.store.create({ data: { code: suffix, name: 'Rollback test' } });
        const role = await tx.role.create({ data: { code: suffix, name: 'RFID test receiver', permissions: { create: { permission: { connectOrCreate: { where: { code: 'purchase_orders.receive' }, create: { code: 'purchase_orders.receive', name: 'Receive purchase orders' } } } } } } });
        await tx.userRole.create({ data: { userId: account.id, roleId: role.id } });
        await tx.userStore.create({ data: { userId: account.id, storeId: store.id } });
        const source = await tx.warehouse.create({ data: { code: `${suffix}-a`, name: 'A', storeId: store.id } });
        const target = await tx.warehouse.create({ data: { code: `${suffix}-b`, name: 'B', storeId: store.id } });
        const category = await tx.category.create({ data: { code: suffix, name: 'Test' } });
        const product = await tx.product.create({ data: { code: suffix, name: 'RFID test', unit: 'Can', categoryId: category.id, skus: { create: { code: suffix, barcode: suffix, sellingPrice: 20, costPrice: 10 } } }, include: { skus: true } });
        const skuId = product.skus[0]!.id;
        const targetStock = await tx.inventory.create({ data: { warehouseId: target.id, skuId } });
        const supplier = await tx.supplier.create({ data: { code: suffix, name: 'Test', contactName: '', phone: '', email: '', address: '' } });
        const order = await createPurchaseOrder(user, { supplierId: supplier.id, warehouseId: source.id, items: [{ skuId, quantity: 24, unitCost: 10 }] });
        // Current camera workflow creates the parcel as part of the PO.
        // Reuse that QR rather than registering a second full-quantity parcel.
        const cameraParcel = eventType === 'CAMERA_CODE_DETECTED' ? await tx.iotInboundParcel.findFirstOrThrow({ where: { purchaseOrderId: order.id, status: 'READY' } }) : null;
        if (cameraParcel) {
          cameraParcel.deviceId = `TEST-${suffix}`;
          await tx.iotInboundParcel.update({ where: { id: cameraParcel.id }, data: { deviceId: cameraParcel.deviceId } });
        }
        const tagId = cameraParcel?.tagId ?? suffix.replaceAll('-', '').slice(0, 16).toUpperCase();
        const deviceId = cameraParcel?.deviceId ?? 'TEST-READER';
        const parcel = cameraParcel ?? await registerParcel(user, parcelInput.parse({ tagId, deviceId, purchaseOrderItemId: order.items[0]!.id, quantity: 24, expiresAt: null, noExpiry: true }));
        if (eventType === 'CAMERA_CODE_DETECTED') {
          const { ingestEvent } = await import('./iot.service.js');
          const input = { eventId: randomUUID(), deviceId, tagId, warehouseId: source.id, eventType, timestamp: new Date(), payload: {} };
          const unknown = await ingestEvent({ ...input, eventId: randomUUID(), tagId: `QR-UNKNOWN-${suffix}` }, 'DEVICE', null);
          expect(unknown.event.automationStatus).toBe('UNREGISTERED');
          const wrongDevice = await ingestEvent({ ...input, eventId: randomUUID(), deviceId: 'WRONG-DEVICE' }, 'DEVICE', null);
          expect(wrongDevice.event.automationStatus).toBe('BLOCKED');
          const wrongWarehouse = await ingestEvent({ ...input, eventId: randomUUID(), warehouseId: target.id }, 'DEVICE', null);
          expect(wrongWarehouse.event.automationStatus).toBe('BLOCKED');
          const { startCameraDemo } = await import('./camera-demo-session.service.js');
          await startCameraDemo(user, parcel.id);
          // The portable device reports its physical warehouse; the explicit
          // authorized session resolves the selected parcel's destination.
          const fastInput = { ...input, warehouseId: target.id, payload: { resolveDemoSession: true } };
          const valid = await ingestEvent(fastInput, 'DEVICE', null);
          expect(valid.event.automationStatus).toBe('WAITING_CONFIRMATION');
          expect(valid.event.warehouseId).toBe(source.id);
          const retry = await ingestEvent(fastInput, 'DEVICE', null);
          expect(retry.duplicate).toBe(true);
          expect(retry.event.id).toBe(valid.event.id);
          const { ingestCameraFrame } = await import('./camera-image.service.js');
          const svg = renderToStaticMarkup(createElement(QRCodeSVG, { value: tagId, size: 240, marginSize: 4 }));
          const jpeg = await sharp(Buffer.from(svg)).resize(640, 480, { fit: 'contain', background: 'white' }).jpeg().toBuffer();
          const imageResult = await ingestCameraFrame({ eventId: randomUUID(), deviceId, warehouseId: target.id, timestamp: new Date() }, jpeg);
          expect(imageResult.decoded).toBe(true);
          expect(imageResult.event?.warehouseId).toBe(source.id);
          expect(imageResult.event?.automationStatus).toBe('WAITING_CONFIRMATION');
          expect(await tx.goodsReceipt.count({ where: { purchaseOrderId: order.id } })).toBe(0);
        }
        const mapping = await tx.iotTagMapping.findUniqueOrThrow({ where: { tagId } });
        const scan = () => tx.iotEvent.create({ data: { eventId: randomUUID(), deviceId, tagId, warehouseId: source.id, eventType, timestamp: new Date(), payload: {}, source: 'DEVICE', tagMappingId: mapping.id, mappedSkuId: skuId, inboundParcelId: parcel.id, automationStatus: 'PENDING' } });
        const event = await scan();
        const detected = await processInboundEvent(event.id);
        expect(detected.automationStatus, detected.automationMessage ?? '').toBe('WAITING_CONFIRMATION');
        expect(await tx.goodsReceipt.count({ where: { purchaseOrderId: order.id } })).toBe(0);
        expect((await processInboundEvent(event.id, user, { expiresAt: null, noExpiry: true })).automationStatus).toBe('RECEIVED');
        const stock = await tx.inventory.findUniqueOrThrow({ where: { warehouseId_skuId: { warehouseId: source.id, skuId } } });
        expect(stock.onHand).toBe(24);
        expect(stock.lastReceivedQuantity).toBe(24);
        expect(stock.lastReceivedAt).not.toBeNull();
        expect((await tx.product.findUniqueOrThrow({ where: { id: product.id } })).lastReceivedAt).not.toBeNull();
        await processInboundEvent(event.id, user);
        const repeated = await scan();
        expect((await processInboundEvent(repeated.id)).automationStatus).toBe('ALREADY_RECEIVED');
        expect(await tx.goodsReceipt.count({ where: { purchaseOrderId: order.id } })).toBe(1);
        expect((await tx.inventory.findUniqueOrThrow({ where: { id: stock.id } })).onHand).toBe(24);
        if (eventType === 'CAMERA_CODE_DETECTED') {
          const lots = await tx.inventoryLot.findMany({ where: { inventoryId: stock.id } });
          expect(lots.reduce((total, lot) => total + lot.quantity, 0)).toBe(24);
          expect((await tx.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('COMPLETED');
          expect((await tx.purchaseOrderItem.findUniqueOrThrow({ where: { id: order.items[0]!.id } })).receivedQuantity).toBe(24);
          expect((await tx.iotInboundParcel.findUniqueOrThrow({ where: { id: parcel.id } })).status).toBe('RECEIVED');
          throw rollback;
        }
        const input = { sourceWarehouseId: source.id, destinationWarehouseId: target.id, reason: 'RFID transfer test', items: [{ skuId, quantity: 5, rfidEventId: repeated.id }] };
        const transfer = await createTransfer(user, input);
        expect(transfer.items[0]!.rfidTagId).toBe(tagId);
        await expect(createTransfer(user, input)).rejects.toMatchObject({ code: 'TRANSFER_RFID_BUSY' });
        expect((await tx.inventory.findUniqueOrThrow({ where: { id: stock.id } })).onHand).toBe(24);
        await dispatchTransfer(user, transfer.id, { note: null, evidence: [] });
        await receiveTransfer(user, transfer.id, { note: null, evidence: [], items: [{ skuId, quantity: 5, discrepancyReason: null }] });
        const received = await tx.inventory.findUniqueOrThrow({ where: { id: targetStock.id } });
        expect(received.onHand).toBe(5);
        expect(received.lastReceivedQuantity).toBe(5);
        expect(received.lastReceivedAt).not.toBeNull();
        expect((await tx.iotTagMapping.findUniqueOrThrow({ where: { tagId } })).warehouseId).toBe(target.id);
        await expect(receiveTransfer(user, transfer.id, { note: null, evidence: [], items: [{ skuId, quantity: 5, discrepancyReason: null }] })).rejects.toMatchObject({ code: 'TRANSFER_NOT_IN_TRANSIT' });
        // Follow the received goods through supplier settlement and a credit sale.
        const { payPayable } = await import('../payables/payables.service.js');
        const payable = await tx.payable.findUniqueOrThrow({ where: { purchaseOrderId: order.id } });
        await expect(payPayable(user, payable.id, { amount: 241, method: 'CASH' })).rejects.toMatchObject({ code: 'PAYMENT_EXCEEDS_OUTSTANDING' });
        expect((await payPayable(user, payable.id, { amount: 100, method: 'CASH' })).outstandingAmount).toBe(140);
        expect((await payPayable(user, payable.id, { amount: 140, method: 'CASH' })).status).toBe('PAID');
        await expect(payPayable(user, payable.id, { amount: 1, method: 'CASH' })).rejects.toMatchObject({ code: 'PAYABLE_ALREADY_PAID' });
        expect(Number((await tx.supplier.findUniqueOrThrow({ where: { id: supplier.id } })).currentDebt)).toBe(0);
        const { createInvoice } = await import('../invoices/invoices.service.js');
        const { createInvoiceInput } = await import('../invoices/invoices.schemas.js');
        const { collectReceivable } = await import('../receivables/receivables.service.js');
        const shift = await tx.workShift.create({ data: { code: suffix, storeId: store.id, cashierId: account.id, posCode: 'TEST', name: 'Test', openingCash: 0 } });
        const customer = await tx.customer.create({ data: { code: suffix, name: 'Credit test', phone: suffix } });
        const sale = await createInvoice(user, createInvoiceInput.parse({ shiftId: shift.id, warehouseId: source.id, customerId: customer.id, items: [{ skuId, quantity: 2 }], payments: [], creditAmount: 40, creditDueDate: '2099-12-31' }));
        expect((await tx.inventory.findUniqueOrThrow({ where: { id: stock.id } })).onHand).toBe(17);
        const debt = await tx.receivable.findUniqueOrThrow({ where: { invoiceId: sale.id } });
        const payment = { amount: 40, method: 'CASH' as const, reference: null, note: null };
        await expect(collectReceivable(user, debt.id, { ...payment, amount: 41 })).rejects.toMatchObject({ code: 'PAYMENT_EXCEEDS_OUTSTANDING' });
        expect((await collectReceivable(user, debt.id, payment)).outstandingAmount).toBe(0);
        await expect(collectReceivable(user, debt.id, payment)).rejects.toMatchObject({ code: 'RECEIVABLE_ALREADY_PAID' });
        expect(await tx.receivablePayment.count({ where: { receivableId: debt.id } })).toBe(1);
        throw rollback;
      }, { timeout: 30000 });
    } catch (error) { if (error !== rollback) throw error; }
    finally { await prisma.$disconnect(); }
  });
});
