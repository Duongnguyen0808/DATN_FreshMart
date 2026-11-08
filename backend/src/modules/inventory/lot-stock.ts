import type { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../common/app-error.js';

type Tx = Prisma.TransactionClient;
export const warehouseToday = () => new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) + 'T00:00:00Z');
export const expired = (date: Date | null) => date !== null && date < warehouseToday();
// On the printed expiry date the lot remains usable through the end of that local day.
export async function initializeLots(tx: Tx, inventoryId: string) {
  if (await tx.inventoryLot.count({ where: { inventoryId } })) return;
  const stock = await tx.inventory.findUniqueOrThrow({ where: { id: inventoryId } });
  if (stock.reserved > 0) throw new AppError(409, 'LOT_RESERVED', 'Hoàn tất giao dịch giữ hàng trước khi bắt đầu quản lý lô.');
  await tx.inventoryLot.create({ data: { inventoryId, code: 'TON-CU-CHO-XAC-MINH', quantity: stock.onHand, status: 'LEGACY' } });
}

export async function blockedLotQuantity(tx: Tx, inventoryId: string) {
  const rows = await tx.inventoryLot.findMany({ where: { inventoryId, quantity: { gt: 0 } } });
  return rows.filter(lot => lot.status !== 'AVAILABLE' || expired(lot.expiresAt)).reduce((sum, lot) => sum + lot.quantity, 0);
}

export async function takeLots(tx: Tx, inventoryId: string, quantity: number, referenceType: string, referenceId: string, actorId: string, specific?: { lotId: string; purchaseOrderItemId: string }, ownReservation = 0) {
  const rows = await tx.inventoryLot.findMany({ where: { inventoryId }, orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }, { id: 'asc' }] });
  if (!rows.length) {
    if (specific) throw new AppError(409, 'LOT_NOT_FOUND', 'Không tìm thấy lô tại kho.');
    return;
  }
  const stock = await tx.inventory.findUniqueOrThrow({ where: { id: inventoryId } });
  const candidates = rows.filter(lot => specific ? lot.id === specific.lotId && lot.purchaseOrderItemId === specific.purchaseOrderItemId : lot.status === 'AVAILABLE' && !expired(lot.expiresAt));
  if (candidates.reduce((sum, lot) => sum + lot.quantity, 0) - Math.max(0, stock.reserved - ownReservation) < quantity) throw new AppError(409, 'LOT_STOCK_UNAVAILABLE', 'Không đủ hàng đúng lô/còn hạn. Hàng cách ly và tồn cũ chưa xác minh không được xuất bán.');
  let remaining = quantity;
  for (const lot of candidates) {
    const take = Math.min(remaining, lot.quantity);
    if (!take) continue;
    await tx.inventoryLot.update({ where: { id: lot.id }, data: { quantity: { decrement: take } } });
    await tx.lotMovement.create({ data: { lotId: lot.id, quantity: -take, referenceType, referenceId, actorId } });
    remaining -= take;
  }
}

export async function receiveLot(tx: Tx, inventoryId: string, quantity: number, actorId: string, referenceType: string, referenceId: string, details?: { code: string; expiresAt: Date | null; purchaseOrderItemId?: string | null; status?: string }) {
  const tracked = await tx.inventoryLot.count({ where: { inventoryId } });
  if (!tracked && !details) return;
  if (!tracked) await initializeLots(tx, inventoryId);
  const lot = await tx.inventoryLot.create({ data: { inventoryId, quantity, code: details?.code ?? 'HANG-TRA-CHO-XAC-MINH', expiresAt: details?.expiresAt, purchaseOrderItemId: details?.purchaseOrderItemId, status: details?.status ?? (details ? (expired(details.expiresAt) ? 'QUARANTINE' : 'AVAILABLE') : 'QUARANTINE') } });
  await tx.lotMovement.create({ data: { lotId: lot.id, quantity, referenceType, referenceId, actorId } });
}

export async function receiveTransferLots(tx: Tx, sourceId: string, destinationId: string, quantity: number, code: string, actorId: string) {
  const movements = await tx.lotMovement.findMany({ where: { referenceType: 'TRANSFER_OUT', referenceId: code, lot: { inventoryId: sourceId }, quantity: { lt: 0 } }, include: { lot: true }, orderBy: { createdAt: 'asc' } });
  if (!movements.length) { await receiveLot(tx, destinationId, quantity, actorId, 'TRANSFER_IN', code); return; }
  if (quantity !== movements.reduce((sum, row) => sum - row.quantity, 0)) throw new AppError(409, 'LOT_TRANSFER_DISCREPANCY', 'Điều chuyển có lô phải nhận đúng số đã xuất; cần kiểm tra và xử lý chênh lệch theo lô trước khi nhận.');
  for (const row of movements) await receiveLot(tx, destinationId, -row.quantity, actorId, 'TRANSFER_IN', code, { code: row.lot.code, expiresAt: row.lot.expiresAt, purchaseOrderItemId: row.lot.purchaseOrderItemId });
}

export async function restoreCancelledLots(tx: Tx, inventoryId: string, quantity: number, code: string, actorId: string) {
  const movements = await tx.lotMovement.findMany({ where: { referenceType: 'SALE', referenceId: code, lot: { inventoryId }, quantity: { lt: 0 } }, include: { lot: true } });
  if (!movements.length) { await receiveLot(tx, inventoryId, quantity, actorId, 'SALE_CANCEL', code); return; }
  for (const row of movements) {
    await tx.inventoryLot.update({ where: { id: row.lotId }, data: { quantity: { increment: -row.quantity } } });
    await tx.lotMovement.create({ data: { lotId: row.lotId, quantity: -row.quantity, referenceType: 'SALE_CANCEL', referenceId: code, actorId } });
  }
}

export async function requireUntrackedAdjustment(tx: Tx, inventoryId: string) {
  if (await tx.inventoryLot.count({ where: { inventoryId } })) throw new AppError(409, 'LOT_COUNT_REQUIRED', 'SKU đã quản lý lô: kiểm đếm và điều chỉnh từng lô tại mục Lô & hạn dùng.');
}
