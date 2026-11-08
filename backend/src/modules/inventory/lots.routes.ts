import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../common/database.js';
import { AppError } from '../../common/app-error.js';
import { authenticate, requirePermission } from '../../middleware/authenticate.js';
import { expired, initializeLots, warehouseToday } from './lot-stock.js';
import type { CurrentUser } from '../auth/auth.repository.js';
import type { Prisma } from '../../generated/prisma/client.js';

export const lotsRoutes = Router();
lotsRoutes.use(authenticate);
const ok = (data: unknown) => ({ success: true, message: 'Success', data });
const id = z.string().uuid();
const scope = (user: CurrentUser) => user.globalAccess ? {} : { warehouse: { storeId: { in: user.stores.map(store => store.id) } } };
async function stockScope(tx: Prisma.TransactionClient, user: CurrentUser, inventoryId: string) {
  const stock = await tx.inventory.findFirst({ where: { id: inventoryId, ...scope(user) }, include: { warehouse: true } });
  if (!stock || !stock.warehouse.active) throw new AppError(404, 'INVENTORY_NOT_FOUND', 'Không tìm thấy tồn kho trong phạm vi của bạn.');
  return stock;
}
lotsRoutes.get('/inventory-lots', requirePermission('inventory.read'), async (req, res) => {
  const rows = await prisma.inventoryLot.findMany({ where: { inventory: scope(req.currentUser) }, include: { inventory: { include: { warehouse: true, sku: { include: { product: true } } } }, disposals: { orderBy: { createdAt: 'desc' } }, movements: { orderBy: { createdAt: 'desc' }, take: 20 } }, orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }], take: 1000 });
  const today = warehouseToday().getTime();
  res.json(ok(rows.map(row => ({ ...row, expired: expired(row.expiresAt), daysRemaining: row.expiresAt ? Math.ceil((row.expiresAt.getTime() - today) / 86400000) : null, zone: row.status === 'AVAILABLE' && !expired(row.expiresAt) ? 'Kệ hàng' : 'Khu cách ly / chờ xác minh' }))));
});

const classify = z.object({ quantity: z.number().int().positive(), code: z.string().trim().min(1).max(100), expiresAt: z.string().date().nullable(), reason: z.string().trim().min(3).max(500) }).strict();
lotsRoutes.post('/inventory/:id/lots/classify', requirePermission('stocktakes.approve'), async (req, res) => {
  const inventoryId = id.parse(req.params.id), input = classify.parse(req.body);
  const result = await prisma.$transaction(async tx => {
    const stock = await stockScope(tx, req.currentUser, inventoryId);
    if (stock.reserved) throw new AppError(409, 'STOCK_RESERVED', 'Hoàn tất giao dịch giữ hàng trước khi phân loại lô.');
    await initializeLots(tx, inventoryId);
    const legacy = await tx.inventoryLot.findFirst({ where: { inventoryId, status: 'LEGACY' } });
    if (!legacy || legacy.quantity < input.quantity) throw new AppError(409, 'LEGACY_EXCEEDED', 'Số lượng vượt tồn cũ chưa phân loại.');
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    await tx.inventoryLot.update({ where: { id: legacy.id }, data: { quantity: { decrement: input.quantity } } });
    const lot = await tx.inventoryLot.create({ data: { inventoryId, code: input.code, expiresAt, quantity: input.quantity, status: expired(expiresAt) ? 'QUARANTINE' : 'AVAILABLE' } });
    await tx.lotMovement.createMany({ data: [{ lotId: legacy.id, quantity: -input.quantity, referenceType: 'CLASSIFY', referenceId: lot.id, actorId: req.currentUser.id }, { lotId: lot.id, quantity: input.quantity, referenceType: 'CLASSIFY', referenceId: lot.id, actorId: req.currentUser.id }] });
    await tx.auditLog.create({ data: { actorId: req.currentUser.id, action: 'lot.classify', targetId: lot.id, metadata: { reason: input.reason } } });
    return lot;
  }, { isolationLevel: 'Serializable' });
  res.json(ok(result));
});

lotsRoutes.post('/inventory-lots/:id/quarantine', requirePermission('stocktakes.create'), async (req, res) => {
  const lotId = id.parse(req.params.id), reason = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body).reason;
  res.json(ok(await prisma.$transaction(async tx => {
    const lot = await tx.inventoryLot.findUniqueOrThrow({ where: { id: lotId } });
    const stock = await stockScope(tx, req.currentUser, lot.inventoryId);
    if (stock.reserved) throw new AppError(409, 'STOCK_RESERVED', 'Xử lý giao dịch đang giữ hàng trước khi cách ly.');
    const changed = await tx.inventoryLot.update({ where: { id: lotId }, data: { status: 'QUARANTINE' } });
    await tx.auditLog.create({ data: { actorId: req.currentUser.id, action: 'lot.quarantine', targetId: lotId, metadata: { reason } } });
    return changed;
  }, { isolationLevel: 'Serializable' })));
});

lotsRoutes.post('/inventory-lots/:id/count', requirePermission('stocktakes.approve'), async (req, res) => {
  const lotId = id.parse(req.params.id), input = z.object({ quantity: z.number().int().min(0).max(100_000_000), reason: z.string().trim().min(3).max(500) }).strict().parse(req.body);
  res.json(ok(await prisma.$transaction(async tx => {
    const lot = await tx.inventoryLot.findUniqueOrThrow({ where: { id: lotId } });
    const stock = await stockScope(tx, req.currentUser, lot.inventoryId);
    if (stock.reserved || await tx.lotDisposal.count({ where: { lotId, status: { in: ['READY'] } } })) throw new AppError(409, 'LOT_BUSY', 'Lô đang giữ hàng hoặc có phiếu xử lý chưa hoàn tất.');
    const delta = input.quantity - lot.quantity;
    await tx.inventoryLot.update({ where: { id: lotId }, data: { quantity: input.quantity } });
    await tx.inventory.update({ where: { id: stock.id }, data: { onHand: { increment: delta } } });
    await tx.lotMovement.create({ data: { lotId, quantity: delta, referenceType: 'LOT_COUNT', referenceId: lotId, actorId: req.currentUser.id } });
    await tx.inventoryTransaction.create({ data: { inventoryId: stock.id, warehouseId: stock.warehouseId, skuId: stock.skuId, type: 'STOCKTAKE', quantity: delta, beforeQuantity: stock.onHand, afterQuantity: stock.onHand + delta, referenceType: 'LOT_COUNT', referenceId: lotId, reason: input.reason, actorId: req.currentUser.id } });
    await tx.auditLog.create({ data: { actorId: req.currentUser.id, action: 'lot.count', targetId: lotId, metadata: { before: lot.quantity, after: input.quantity, reason: input.reason } } });
    return { delta };
  }, { isolationLevel: 'Serializable' })));
});

lotsRoutes.post('/inventory-lots/:id/disposals', requirePermission('stocktakes.create'), async (req, res) => {
  const lotId = id.parse(req.params.id), input = z.object({ quantity: z.number().int().positive(), reason: z.string().trim().min(3).max(500) }).strict().parse(req.body);
  res.json(ok(await prisma.$transaction(async tx => {
    const lot = await tx.inventoryLot.findUniqueOrThrow({ where: { id: lotId } });
    const stock = await stockScope(tx, req.currentUser, lot.inventoryId);
    if (stock.reserved) throw new AppError(409, 'STOCK_RESERVED', 'Xử lý giao dịch đang giữ hàng trước.');
    if (lot.status !== 'QUARANTINE' && !expired(lot.expiresAt)) throw new AppError(409, 'QUARANTINE_FIRST', 'Cách ly hàng hỏng trước khi lập phiếu xử lý.');
    const pending = await tx.lotDisposal.aggregate({ where: { lotId, status: { in: ['READY'] } }, _sum: { quantity: true } });
    if (input.quantity > lot.quantity - (pending._sum.quantity ?? 0)) throw new AppError(409, 'DISPOSAL_EXCEEDED', 'Vượt lượng chưa lập phiếu xử lý.');
    await tx.inventoryLot.update({ where: { id: lotId }, data: { status: 'QUARANTINE' } });
    const row = await tx.lotDisposal.create({ data: { lotId, ...input, status: 'READY', createdById: req.currentUser.id } });
    await tx.auditLog.create({ data: { actorId: req.currentUser.id, action: 'lot.disposal.create', targetId: row.id } });
    return row;
  }, { isolationLevel: 'Serializable' })));
});

lotsRoutes.post('/lot-disposals/:id/:action', requirePermission('stocktakes.approve'), async (req, res) => {
  const disposalId = id.parse(req.params.id), action = z.enum(['complete']).parse(req.params.action);
  const evidence = action === 'complete' ? z.object({ evidence: z.string().trim().min(3).max(2000) }).parse(req.body).evidence : undefined;
  res.json(ok(await prisma.$transaction(async tx => {
    const row = await tx.lotDisposal.findUniqueOrThrow({ where: { id: disposalId }, include: { lot: true } });
    const stock = await stockScope(tx, req.currentUser, row.lot.inventoryId);
    if (row.status !== 'READY') throw new AppError(409, 'DISPOSAL_STATE', 'Phiếu không còn chờ xử lý.');
    if (action === 'complete') {
      if (stock.reserved || row.lot.quantity < row.quantity || stock.onHand < row.quantity) throw new AppError(409, 'STOCK_CHANGED', 'Tồn kho đã thay đổi; cần đối soát trước khi hoàn tất.');
      await tx.inventoryLot.update({ where: { id: row.lotId }, data: { quantity: { decrement: row.quantity } } });
      await tx.inventory.update({ where: { id: stock.id }, data: { onHand: { decrement: row.quantity } } });
      await tx.lotMovement.create({ data: { lotId: row.lotId, quantity: -row.quantity, referenceType: 'DISPOSAL', referenceId: row.id, actorId: req.currentUser.id } });
      await tx.inventoryTransaction.create({ data: { inventoryId: stock.id, warehouseId: stock.warehouseId, skuId: stock.skuId, type: 'DISPOSAL', quantity: -row.quantity, beforeQuantity: stock.onHand, afterQuantity: stock.onHand - row.quantity, referenceType: 'LOT_DISPOSAL', referenceId: row.id, reason: row.reason, actorId: req.currentUser.id } });
    }
    const result = await tx.lotDisposal.update({ where: { id: row.id }, data: { status: 'COMPLETED', ...(action === 'complete' ? { completedById: req.currentUser.id, completedAt: new Date(), evidence } : { approvedById: req.currentUser.id }) } });
    await tx.auditLog.create({ data: { actorId: req.currentUser.id, action: `lot.disposal.${action}`, targetId: row.id } });
    return result;
  }, { isolationLevel: 'Serializable' })));
});

lotsRoutes.patch('/products/:id/procurement', requirePermission('products.manage'), async (req, res) => {
  const productId = id.parse(req.params.id);
  const input = z.object({ purchaseUnit: z.string().trim().min(1).max(30), purchasePackSize: z.number().int().min(1).max(100000), leadTimeDays: z.number().int().min(0).max(365).nullable() }).strict().parse(req.body);
  res.json(ok(await prisma.$transaction(async tx => {
    const row = await tx.product.update({ where: { id: productId, archivedAt: null }, data: input });
    await tx.auditLog.create({ data: { actorId: req.currentUser.id, action: 'product.procurement.update', targetId: productId, metadata: input } });
    return row;
  })));
});
