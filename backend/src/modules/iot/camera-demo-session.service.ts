import { z } from 'zod';
import { prisma } from '../../common/database.js';
import { AppError } from '../../common/app-error.js';
import type { CurrentUser } from '../auth/auth.repository.js';

const action = 'iot.camera.demo_session';
const ttlMs = 15 * 60 * 1000;
const context = z.object({ parcelId: z.string().uuid(), warehouseId: z.string().uuid(), tagId: z.string(), deviceId: z.string() });

// Persist the temporary binding in the audit trail; the device's physical
// warehouse stays unchanged outside this explicitly started parcel demo.
async function latest(deviceId: string) {
  return prisma.auditLog.findFirst({ where: { action, targetId: deviceId, createdAt: { gt: new Date(Date.now() - ttlMs) } }, orderBy: { createdAt: 'desc' } });
}

export async function startCameraDemo(user: CurrentUser, parcelId: string) {
  return prisma.$transaction(async tx => {
    const parcel = await tx.iotInboundParcel.findUniqueOrThrow({ where: { id: parcelId } });
    const warehouse = await tx.warehouse.findUniqueOrThrow({ where: { id: parcel.warehouseId } });
    if (!user.globalAccess && !user.stores.some(s => s.id === warehouse.storeId)) throw new AppError(403, 'WAREHOUSE_FORBIDDEN', 'Bạn không có quyền nhận hàng tại kho này.');
    if (!warehouse.active || parcel.status !== 'READY' || !parcel.tagId.startsWith('QR-')) throw new AppError(409, 'CAMERA_DEMO_NOT_READY', 'Kiện không còn sẵn sàng để quét QR.');
    const previous = await tx.auditLog.findFirst({ where: { action, targetId: parcel.deviceId, createdAt: { gt: new Date(Date.now() - ttlMs) } }, orderBy: { createdAt: 'desc' } });
    if (previous && previous.actorId !== user.id) throw new AppError(409, 'CAMERA_DEMO_BUSY', 'Camera đang được người khác sử dụng cho một phiên demo.');
    const row = await tx.auditLog.create({ data: { actorId: user.id, action, targetId: parcel.deviceId, metadata: { parcelId: parcel.id, warehouseId: warehouse.id, tagId: parcel.tagId, deviceId: parcel.deviceId } } });
    return { sessionId: row.id, expiresAt: new Date(row.createdAt.getTime() + ttlMs).toISOString() };
  }, { isolationLevel: 'Serializable' });
}

export async function getCameraDemo(deviceId: string, tagId: string) {
  const row = await latest(deviceId);
  const parsed = context.safeParse(row?.metadata);
  if (!row || !parsed.success || parsed.data.tagId !== tagId || parsed.data.deviceId !== deviceId) return null;
  const parcel = await prisma.iotInboundParcel.findUnique({ where: { id: parsed.data.parcelId } });
  if (!parcel || parcel.status !== 'READY' || parcel.warehouseId !== parsed.data.warehouseId || parcel.deviceId !== deviceId || parcel.tagId !== tagId) return null;
  return { sessionId: row.id, warehouseId: parcel.warehouseId, tagId, expiresAt: new Date(row.createdAt.getTime() + ttlMs).toISOString() };
}
