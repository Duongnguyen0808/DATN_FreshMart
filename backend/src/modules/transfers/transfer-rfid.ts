import type { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../common/app-error.js';

/** A creation scan identifies a tag; it is not proof of dispatch or receipt. */
export async function attachTransferTags(tx: Prisma.TransactionClient, warehouseId: string, actorId: string, items: { skuId: string; rfidEventId?: string }[]) {
  const attachments = new Map<string, { rfidTagId: string; rfidEventId: string; rfidDeviceId: string }>();
  const usedTags = new Set<string>();
  for (const item of items) {
    if (!item.rfidEventId) continue;
    const event = await tx.iotEvent.findUnique({ where: { id: item.rfidEventId } });
    if (!event || event.source !== 'DEVICE' || event.eventType !== 'RFID_DETECTED' || event.warehouseId !== warehouseId || Date.now() - event.receivedAt.getTime() > 15 * 60_000) {
      throw new AppError(409, 'TRANSFER_RFID_SCAN_INVALID', 'Hãy quét thẻ thật tại kho nguồn trong vòng 15 phút trước khi lưu phiếu.');
    }
    if (usedTags.has(event.tagId)) throw new AppError(409, 'TRANSFER_RFID_DUPLICATE', 'Một thẻ chỉ được gắn với một dòng sản phẩm trong phiếu.');
    usedTags.add(event.tagId);
    const [mapping, parcel, assigned] = await Promise.all([
      tx.iotTagMapping.findUnique({ where: { tagId: event.tagId } }),
      tx.iotInboundParcel.findUnique({ where: { tagId: event.tagId } }),
      tx.stockTransferItem.findFirst({ where: { rfidTagId: event.tagId, transfer: { status: { in: ['READY', 'IN_TRANSIT'] } } } }),
    ]);
    if (assigned || parcel?.status === 'READY') throw new AppError(409, 'TRANSFER_RFID_BUSY', 'Thẻ đang thuộc kiện chờ nhập hoặc phiếu điều chuyển chưa kết thúc.');
    if ((event.mappedSkuId && event.mappedSkuId !== item.skuId) || (mapping && (mapping.skuId !== item.skuId || mapping.warehouseId !== warehouseId))) {
      throw new AppError(409, 'TRANSFER_RFID_MISMATCH', 'Thẻ đang gắn với sản phẩm hoặc kho khác. Kiểm tra lại kiện hàng.');
    }
    await tx.iotTagMapping.upsert({ where: { tagId: event.tagId }, create: { tagId: event.tagId, skuId: item.skuId, warehouseId, source: 'HARDWARE', createdById: actorId }, update: { active: true, source: 'HARDWARE' } });
    attachments.set(item.skuId, { rfidTagId: event.tagId, rfidEventId: event.id, rfidDeviceId: event.deviceId });
  }
  return attachments;
}
