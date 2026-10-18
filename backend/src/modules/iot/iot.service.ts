import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../common/database.js';
import { AppError } from '../../common/app-error.js';
import type { CurrentUser } from '../auth/auth.repository.js';
import type { z } from 'zod';
import type { iotEventInput, iotEventListInput, iotSimulationInput, iotTagMappingInput } from './iot.schemas.js';
import { publishIotEvent } from './iot.realtime.js';

type EventInput = z.infer<typeof iotEventInput>;

export async function ingestEvent(input: EventInput, source: 'DEVICE' | 'SIMULATED', actorId: string | null, allowedStoreIds?: string[]) {
  const previous = await prisma.iotEvent.findUnique({ where: { deviceId_eventId: { deviceId: input.deviceId, eventId: input.eventId } } });
  if (previous) return { event: previous, duplicate: true };

  const warehouse = await prisma.warehouse.findUnique({ where: { id: input.warehouseId }, select: { id: true, active: true, storeId: true } });
  if (!warehouse?.active) throw new AppError(404, 'IOT_WAREHOUSE_NOT_FOUND', 'Không tìm thấy kho đang hoạt động cho thiết bị IoT.');
  if (allowedStoreIds && !allowedStoreIds.includes(warehouse.storeId)) throw new AppError(403, 'WAREHOUSE_FORBIDDEN', 'Bạn không có quyền gửi dữ liệu IoT cho kho này.');

  try {
    const event = await prisma.$transaction(async tx => {
      let mapping = await tx.iotTagMapping.findUnique({ where: { tagId: input.tagId } });
      const simulatedSkuId = source === 'SIMULATED' && typeof input.payload.skuId === 'string' ? input.payload.skuId : null;
      if (!mapping && simulatedSkuId && actorId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(simulatedSkuId)) {
        const sku = await tx.sku.findUnique({ where: { id: simulatedSkuId }, select: { id: true } });
        if (sku) {
          mapping = await tx.iotTagMapping.upsert({
            where: { tagId: input.tagId },
            create: {
              tagId: input.tagId,
              skuId: sku.id,
              warehouseId: input.warehouseId,
              palletCode: typeof input.payload.palletCode === 'string' ? input.payload.palletCode.slice(0, 100) : null,
              source: 'SIMULATED',
              createdById: actorId,
            },
            update: {},
          });
          await tx.auditLog.create({ data: { actorId, action: 'iot.tag_mapping.simulated', targetId: mapping.id } });
        }
      }
      const created = await tx.iotEvent.create({ data: {
        ...input,
        payload: input.payload as Prisma.InputJsonValue,
        ...(mapping?.active ? { tagMappingId: mapping.id, mappedSkuId: mapping.skuId, palletCode: mapping.palletCode } : {}),
        source,
        processed: false,
      }, include: { mappedSku: { select: { id: true, code: true, product: { select: { name: true, unit: true } } } } } });
      await tx.auditLog.create({ data: {
        actorId,
        action: source === 'SIMULATED' ? 'iot.event.simulated' : 'iot.event.received',
        targetId: created.id,
      } });
      return created;
    });
    publishIotEvent(event);
    return { event, duplicate: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.iotEvent.findUnique({ where: { deviceId_eventId: { deviceId: input.deviceId, eventId: input.eventId } } });
      if (existing) return { event: existing, duplicate: true };
    }
    throw error;
  }
}

export async function upsertTagMapping(user: CurrentUser, input: z.infer<typeof iotTagMappingInput>) {
  const warehouse = await prisma.warehouse.findUnique({ where: { id: input.warehouseId }, select: { id: true, active: true, storeId: true } });
  if (!warehouse?.active) throw new AppError(404, 'IOT_WAREHOUSE_NOT_FOUND', 'Không tìm thấy kho đang hoạt động.');
  if (!user.globalAccess && !user.stores.some(store => store.id === warehouse.storeId)) throw new AppError(403, 'WAREHOUSE_FORBIDDEN', 'Bạn không có quyền gán thẻ cho kho này.');
  const sku = await prisma.sku.findUnique({ where: { id: input.skuId }, select: { id: true, active: true } });
  if (!sku?.active) throw new AppError(404, 'IOT_SKU_NOT_FOUND', 'Không tìm thấy SKU đang hoạt động.');
  const mapping = await prisma.$transaction(async tx => {
    const row = await tx.iotTagMapping.upsert({
      where: { tagId: input.tagId },
      create: { ...input, source: 'HARDWARE', createdById: user.id },
      update: { skuId: input.skuId, warehouseId: input.warehouseId, palletCode: input.palletCode, source: 'HARDWARE', active: true },
      include: { sku: { include: { product: { select: { code: true, name: true, unit: true } } } }, warehouse: { select: { id: true, code: true, name: true } } },
    });
    await tx.auditLog.create({ data: { actorId: user.id, action: 'iot.tag_mapping.upsert', targetId: row.id } });
    return row;
  });
  return mapping;
}

export async function listTagMappings(user: CurrentUser, warehouseId?: string) {
  const where = {
    ...(warehouseId ? { warehouseId } : {}),
    ...(user.globalAccess ? {} : { warehouse: { storeId: { in: user.stores.map(store => store.id) } } }),
  };
  if (warehouseId && !user.globalAccess) {
    const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId }, select: { storeId: true } });
    if (!warehouse || !user.stores.some(store => store.id === warehouse.storeId)) throw new AppError(403, 'WAREHOUSE_FORBIDDEN', 'Bạn không có quyền xem thẻ RFID của kho này.');
  }
  return prisma.iotTagMapping.findMany({ where, include: {
    sku: { include: { product: { select: { code: true, name: true, unit: true } } } },
    warehouse: { select: { id: true, code: true, name: true } },
  }, orderBy: [{ warehouse: { code: 'asc' } }, { tagId: 'asc' }] });
}

export async function confirmIotEvents(
  tx: Prisma.TransactionClient,
  eventIds: string[] | undefined,
  options: { warehouseId: string; skuIds: string[]; actorId: string; action: string; referenceType: string; referenceId: string; referenceCode: string; workflow: 'PURCHASE_RECEIPT' | 'STOCK_TRANSFER' },
) {
  if (!eventIds) return [];
  const events = await tx.iotEvent.findMany({ where: { id: { in: eventIds }, processed: false } });
  const expectedSkuIds = new Set(options.skuIds);
  const matchedSkuIds = new Set(events.map(event => event.mappedSkuId).filter((id): id is string => id !== null));
  const mismatchedPayload = events.some(event => {
    const payload = event.payload as Record<string, unknown>;
    return (typeof payload.reference === 'string' && payload.reference !== options.referenceCode)
      || (typeof payload.workflow === 'string' && payload.workflow !== options.workflow);
  });
  if (events.length !== eventIds.length
    || events.some(event => event.eventType !== 'RFID_DETECTED' || event.warehouseId !== options.warehouseId || !event.mappedSkuId || !expectedSkuIds.has(event.mappedSkuId))
    || mismatchedPayload
    || [...expectedSkuIds].some(skuId => !matchedSkuIds.has(skuId))) {
    throw new AppError(409, 'IOT_CONFIRMATION_MISMATCH', 'Sự kiện RFID chưa khớp kho/SKU của phiếu, đã xử lý hoặc còn thiếu thẻ. Hãy quét lại và đối chiếu trước khi xác nhận.');
  }
  const updated = await tx.iotEvent.updateMany({ where: { id: { in: eventIds }, processed: false }, data: { processed: true, processedAt: new Date(), processedById: options.actorId, confirmedReferenceType: options.referenceType, confirmedReferenceId: options.referenceId } });
  if (updated.count !== eventIds.length) throw new AppError(409, 'IOT_EVENT_ALREADY_PROCESSED', 'Một hoặc nhiều sự kiện RFID vừa được xác nhận ở nơi khác.');
  await tx.auditLog.createMany({ data: events.map(event => ({ actorId: options.actorId, action: options.action, targetId: event.id })) });
  return events;
}

export async function simulateEvent(user: CurrentUser, input: z.infer<typeof iotSimulationInput>) {
  const { eventId = randomUUID(), ...data } = input;
  return ingestEvent({ ...data, eventId }, 'SIMULATED', user.id, user.globalAccess ? undefined : user.stores.map(store => store.id));
}

export async function listEvents(user: CurrentUser, input: z.infer<typeof iotEventListInput>) {
  const where = {
    ...(input.warehouseId ? { warehouseId: input.warehouseId } : {}),
    ...(user.globalAccess ? {} : { warehouse: { storeId: { in: user.stores.map(store => store.id) } } }),
  };
  if (input.warehouseId && !user.globalAccess) {
    const warehouse = await prisma.warehouse.findUnique({ where: { id: input.warehouseId }, select: { storeId: true } });
    if (!warehouse || !user.stores.some(store => store.id === warehouse.storeId)) throw new AppError(403, 'WAREHOUSE_FORBIDDEN', 'Bạn không có quyền xem dữ liệu IoT của kho này.');
  }
  return prisma.iotEvent.findMany({ where, include: { mappedSku: { select: { id: true, code: true, product: { select: { name: true, unit: true } } } } }, orderBy: [{ timestamp: 'desc' }, { receivedAt: 'desc' }], take: input.limit });
}
