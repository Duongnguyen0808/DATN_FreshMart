import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../common/database.js';
import { AppError } from '../../common/app-error.js';
import { Prisma } from '../../generated/prisma/client.js';
import { publicUser, userInclude, type CurrentUser } from '../auth/auth.repository.js';
import { receivePurchaseOrderInTransaction } from '../purchase-orders/purchase-orders.service.js';
import { expired } from '../inventory/lot-stock.js';
import { uploadOperationalEvidence } from '../products/cloudinary.service.js';

export const parcelInput = z.object({
  tagId: z.string().trim().regex(/^(?:[0-9a-fA-F]{8,20}|QR-[0-9a-fA-F-]{36})$/).transform(v => v.toUpperCase()),
  palletCode: z.string().trim().min(1).max(100).optional(), deviceId: z.string().trim().min(1).max(100),
  purchaseOrderItemId: z.string().uuid(), quantity: z.number().int().positive().max(100_000_000),
  lotCode: z.string().trim().min(1).max(100).optional(), expiresAt: z.string().date().nullable(), noExpiry: z.boolean(),
  evidence: z.array(z.string().max(28_000_000)).max(1).default([]),
}).strict().refine(v => Boolean(v.expiresAt) !== v.noExpiry, 'Nhập hạn dùng hoặc xác nhận hàng không có hạn dùng.')
  .transform(value => ({
    ...value,
    // RFID UID gives this parcel a stable internal identifier; staff need not invent pallet or lot codes.
    palletCode: value.palletCode ?? (value.tagId.startsWith('QR-') ? value.tagId : `RFID-${value.tagId}`),
    lotCode: value.lotCode ?? (value.tagId.startsWith('QR-') ? value.tagId : `RFID-${value.tagId}`),
  }));

function receivePermission(user: CurrentUser, storeId: string) {
  if (!user.active || !user.permissions.includes('purchase_orders.receive')) throw new AppError(403, 'IOT_RECEIVE_PERMISSION', 'Tài khoản không có quyền nhận hàng.');
  if (!user.globalAccess && !user.stores.some(s => s.id === storeId)) throw new AppError(403, 'IOT_RECEIVE_SCOPE', 'Không có quyền nhận hàng tại chi nhánh này.');
}

// One provisional parcel per order line; expiry is confirmed when the goods arrive.
export async function createOrderCameraParcels(tx: Prisma.TransactionClient, orderId: string, userId: string) {
  const order = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
  if (order.status !== 'OPEN') return;
  for (const item of order.items) {
    const reserved = await tx.iotInboundParcel.aggregate({ where: { purchaseOrderItemId: item.id, status: 'READY' }, _sum: { quantity: true } });
    const quantity = item.orderedQuantity - item.receivedQuantity - (reserved._sum.quantity ?? 0);
    if (quantity <= 0) continue;
    const tagId = `QR-${randomUUID()}`.toUpperCase();
    await tx.iotTagMapping.create({ data: { tagId, skuId: item.skuId, warehouseId: order.warehouseId, palletCode: tagId, source: 'HARDWARE', createdById: userId } });
    await tx.iotInboundParcel.create({ data: { tagId, palletCode: tagId, lotCode: tagId, deviceId: 'FRESHMART-CAMERA-IN-01', warehouseId: order.warehouseId, purchaseOrderId: order.id, purchaseOrderItemId: item.id, skuId: item.skuId, quantity, expiresAt: null, noExpiry: false, registeredById: userId } });
  }
}

export async function prepareExistingCameraParcels(user: CurrentUser, warehouseId: string) {
  const warehouse = await prisma.warehouse.findUniqueOrThrow({ where: { id: warehouseId } });
  receivePermission(user, warehouse.storeId);
  await prisma.$transaction(async tx => {
    const orders = await tx.purchaseOrder.findMany({ where: { warehouseId, status: 'OPEN' }, select: { id: true } });
    for (const order of orders) await createOrderCameraParcels(tx, order.id, user.id);
  }, { isolationLevel: 'Serializable', timeout: 20000 });
  return listParcels(user, warehouseId);
}

type RegisterParcelInput = Omit<z.infer<typeof parcelInput>, 'evidence'> & { evidence?: string[] };
export async function registerParcel(user: CurrentUser, input: RegisterParcelInput) {
  const evidence = input.evidence ?? [];
  const evidenceUrls = await Promise.all(evidence.map(uploadOperationalEvidence));
  return prisma.$transaction(async tx => {
    const item = await tx.purchaseOrderItem.findUniqueOrThrow({ where: { id: input.purchaseOrderItemId }, include: { purchaseOrder: { include: { warehouse: true } }, sku: { include: { product: true } } } });
    const po = item.purchaseOrder;
    receivePermission(user, po.warehouse.storeId);
    if (!po.warehouse.active || !item.sku.active || !item.sku.product.active || item.sku.product.archivedAt) throw new AppError(409, 'IOT_INACTIVE', 'Kho hoặc sản phẩm đã ngừng hoạt động.');
    if (po.status !== 'OPEN') throw new AppError(409, 'IOT_PO_CLOSED', 'Đơn mua hàng không còn nhận hàng.');
    const reserved = await tx.iotInboundParcel.aggregate({ where: { purchaseOrderItemId: item.id, status: 'READY' }, _sum: { quantity: true } });
    if (input.quantity > item.orderedQuantity - item.receivedQuantity - (reserved._sum.quantity ?? 0)) throw new AppError(409, 'IOT_PARCEL_EXCESS', 'Số lượng vượt phần đơn mua hàng chưa nhận/chưa đăng ký kiện.');
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expired(expiresAt)) throw new AppError(409, 'IOT_PARCEL_EXPIRED', 'Hàng hết hạn phải xử lý ngoại lệ, không đăng ký tự nhập.');
    if (await tx.iotInboundParcel.findUnique({ where: { tagId: input.tagId } })) throw new AppError(409, 'IOT_TAG_REGISTERED', 'Thẻ đã đăng ký kiện. Không ghi đè lịch sử; dùng thẻ khác cho kiện mới.');
    const oldMapping = await tx.iotTagMapping.findUnique({ where: { tagId: input.tagId } });
    if (oldMapping && (oldMapping.skuId !== item.skuId || oldMapping.warehouseId !== po.warehouseId)) throw new AppError(409, 'IOT_TAG_MISMATCH', 'Thẻ đang gắn sản phẩm/kho khác.');
    await tx.iotTagMapping.upsert({ where: { tagId: input.tagId }, create: { tagId: input.tagId, skuId: item.skuId, warehouseId: po.warehouseId, palletCode: input.palletCode, source: 'HARDWARE', createdById: user.id }, update: { active: true, source: 'HARDWARE', palletCode: input.palletCode } });
    const { evidence: _evidence, ...parcelData } = input;
    void _evidence;
    const parcel = await tx.iotInboundParcel.create({ data: { ...parcelData, evidenceUrls, expiresAt, warehouseId: po.warehouseId, purchaseOrderId: po.id, skuId: item.skuId, registeredById: user.id } });
    await tx.auditLog.create({ data: { actorId: user.id, action: 'iot.parcel.register', targetId: parcel.id, metadata: { ...parcelData, purchaseOrderId: po.id, evidenceCount: evidence.length } } });
    return parcel;
  }, { isolationLevel: 'Serializable' });
}

export async function listParcels(user: CurrentUser, warehouseId: string) {
  const warehouse = await prisma.warehouse.findUniqueOrThrow({ where: { id: warehouseId } });
  if (!user.globalAccess && !user.stores.some(s => s.id === warehouse.storeId)) throw new AppError(403, 'WAREHOUSE_FORBIDDEN', 'Không có quyền xem kho.');
  const parcels = await prisma.iotInboundParcel.findMany({ where: { warehouseId }, orderBy: { createdAt: 'desc' }, take: 200 });
  const [skus, orders] = await Promise.all([
    prisma.sku.findMany({ where: { id: { in: parcels.map(p => p.skuId) } }, select: { id: true, product: { select: { name: true, unit: true } } } }),
    prisma.purchaseOrder.findMany({ where: { id: { in: parcels.map(p => p.purchaseOrderId) } }, select: { id: true, code: true, status: true } }),
  ]);
  return parcels.map(p => ({ ...p, product: skus.find(s => s.id === p.skuId)?.product, purchaseOrderCode: orders.find(o => o.id === p.purchaseOrderId)?.code, purchaseOrderStatus: orders.find(o => o.id === p.purchaseOrderId)?.status }));
}

export async function cancelParcel(user: CurrentUser, id: string) {
  return prisma.$transaction(async tx => {
    const parcel = await tx.iotInboundParcel.findUniqueOrThrow({ where: { id } });
    const warehouse = await tx.warehouse.findUniqueOrThrow({ where: { id: parcel.warehouseId } });
    receivePermission(user, warehouse.storeId);
    const result = await tx.iotInboundParcel.updateMany({ where: { id, status: 'READY' }, data: { status: 'CANCELLED' } });
    if (!result.count) throw new AppError(409, 'IOT_PARCEL_STATE', 'Chỉ hủy kiện chưa nhận.');
    await tx.auditLog.create({ data: { actorId: user.id, action: 'iot.parcel.cancel', targetId: id } });
    return { id, status: 'CANCELLED' };
  }, { isolationLevel: 'Serializable' });
}

const eventInclude = { mappedSku: { select: { id: true, code: true, product: { select: { name: true, unit: true } } } } } as const;
export async function processInboundEvent(eventId: string, confirmingUser?: CurrentUser, expiry?: { expiresAt: string | null; noExpiry: boolean }) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        const event = await tx.iotEvent.findUniqueOrThrow({ where: { id: eventId }, include: eventInclude });
        if (confirmingUser) {
          const scope = await tx.warehouse.findUniqueOrThrow({ where: { id: event.warehouseId } });
          receivePermission(confirmingUser, scope.storeId);
        }
        if (event.source !== 'DEVICE' || !event.inboundParcelId || !['PENDING', 'WAITING_CONFIRMATION'].includes(event.automationStatus ?? '')) {
          if (confirmingUser && !['RECEIVED', 'ALREADY_RECEIVED'].includes(event.automationStatus ?? '')) throw new AppError(409, 'IOT_NOT_CONFIRMABLE', 'Sự kiện chưa đủ điều kiện nhận hàng.');
          return event;
        }
        const parcel = await tx.iotInboundParcel.findUniqueOrThrow({ where: { id: event.inboundParcelId } });
        if (parcel.deviceId !== event.deviceId || parcel.warehouseId !== event.warehouseId || parcel.skuId !== event.mappedSkuId) throw new AppError(409, 'IOT_PARCEL_MISMATCH', 'Sai thiết bị, kho hoặc sản phẩm của kiện.');
        if (parcel.status === 'RECEIVED') {
          await tx.auditLog.create({ data: { actorId: confirmingUser?.id, action: 'iot.parcel.duplicate_scan', targetId: event.id } });
          return tx.iotEvent.update({ where: { id: event.id }, data: { automationStatus: 'ALREADY_RECEIVED', automationMessage: 'Kiện đã nhận; không cộng tồn lần nữa.', goodsReceiptId: parcel.goodsReceiptId, processed: true, processedAt: new Date(), processedById: confirmingUser?.id ?? null }, include: eventInclude });
        }
        if (parcel.status !== 'READY') throw new AppError(409, 'IOT_PARCEL_CANCELLED', 'Kiện đã hủy.');
        if (event.processed) throw new AppError(409, 'IOT_EVENT_USED', 'Sự kiện đã được dùng cho chứng từ khác. Kiểm tra phiếu trước khi nhận kiện.');
        if (event.timestamp < parcel.createdAt) throw new AppError(409, 'IOT_OLD_SCAN', 'Lượt quét cũ hơn đăng ký kiện; quét lại thẻ.');
        const expiresAt = expiry ? (expiry.expiresAt ? new Date(expiry.expiresAt) : null) : parcel.expiresAt;
        const noExpiry = expiry ? expiry.noExpiry : parcel.noExpiry;
        if (confirmingUser && !expiresAt && !noExpiry) throw new AppError(400, 'IOT_EXPIRY_REQUIRED', 'Nhập hạn sử dụng hoặc xác nhận sản phẩm không có hạn sử dụng.');
        if (expired(expiresAt)) throw new AppError(409, 'IOT_PARCEL_EXPIRED', 'Kiện đã hết hạn; cần xử lý ngoại lệ.');
        const account = await tx.user.findUniqueOrThrow({ where: { id: parcel.registeredById }, include: userInclude });
        const user = confirmingUser ?? publicUser(account);
        const warehouse = await tx.warehouse.findUniqueOrThrow({ where: { id: parcel.warehouseId } });
        if (confirmingUser) receivePermission(user, warehouse.storeId);
        const sku = await tx.sku.findUniqueOrThrow({ where: { id: parcel.skuId }, include: { product: true } });
        if (!sku.active || !sku.product.active || sku.product.archivedAt) throw new AppError(409, 'IOT_INACTIVE', 'Sản phẩm đã ngừng hoạt động.');
        const line = await tx.purchaseOrderItem.findUniqueOrThrow({ where: { id: parcel.purchaseOrderItemId }, include: { purchaseOrder: true } });
        if (!warehouse.active || line.purchaseOrder.status !== 'OPEN' || parcel.quantity > line.orderedQuantity - line.receivedQuantity) throw new AppError(409, 'IOT_PO_UNAVAILABLE', 'Kho hoặc số lượng còn lại của đơn mua hàng không cho phép nhận kiện này.');
        if (!confirmingUser) {
          return tx.iotEvent.update({ where: { id: event.id }, data: { automationStatus: 'WAITING_CONFIRMATION', automationMessage: 'Đã phát hiện kiện. Chờ nhân viên xác nhận; tồn kho chưa thay đổi.' }, include: eventInclude });
        }
        const result = await receivePurchaseOrderInTransaction(tx, user, parcel.purchaseOrderId, {
          note: `${event.eventType === 'CAMERA_CODE_DETECTED' ? 'Camera' : 'RFID'} xác nhận kiện ${parcel.palletCode}; xác nhận bởi ${user.name}; event ${event.eventId}`,
          evidence: [], iotEventIds: [event.id], items: [{ purchaseOrderItemId: parcel.purchaseOrderItemId, quantity: parcel.quantity, lotCode: parcel.lotCode, ...(expiresAt ? { expiresAt: expiresAt.toISOString().slice(0, 10) } : {}) }],
        });
        const receiptId = result.createdReceiptId;
        const changed = await tx.iotInboundParcel.updateMany({ where: { id: parcel.id, status: 'READY' }, data: { status: 'RECEIVED', receivedAt: new Date(), goodsReceiptId: receiptId, expiresAt, noExpiry } });
        if (changed.count !== 1) throw new AppError(409, 'IOT_PARCEL_STATE', 'Kiện vừa được xử lý.');
        await tx.auditLog.create({ data: { actorId: user.id, action: 'iot.parcel.confirmed_received', targetId: parcel.id, metadata: { eventId: event.id, receiptId, quantity: parcel.quantity } } });
        return tx.iotEvent.update({ where: { id: event.id }, data: { automationStatus: 'RECEIVED', automationMessage: `Đã nhập ${parcel.quantity} ${sku.product.unit} · ${parcel.palletCode}`, goodsReceiptId: receiptId }, include: eventInclude });
      }, { isolationLevel: 'Serializable', timeout: 20000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 3) continue;
      if (confirmingUser || !(error instanceof AppError)) throw error; // Transport/server failures remain pending for same-event retry.
      return prisma.$transaction(async tx => {
        await tx.iotEvent.updateMany({ where: { id: eventId, automationStatus: { in: ['PENDING', 'WAITING_CONFIRMATION'] }, processed: false }, data: { automationStatus: 'BLOCKED', automationMessage: error.message } });
        await tx.auditLog.create({ data: { action: 'iot.parcel.blocked', targetId: eventId, metadata: { code: error.code, reason: error.message } } });
        return tx.iotEvent.findUniqueOrThrow({ where: { id: eventId }, include: eventInclude });
      });
    }
  }
  throw new Error('IoT receipt retry exhausted');
}
