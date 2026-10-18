import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../common/database.js';
import { AppError } from '../../common/app-error.js';
import type { CurrentUser } from '../auth/auth.repository.js';
import type { z } from 'zod';
import type { inventoryListInput, transactionListInput } from './inventory.schemas.js';

const scopeIds = (user: CurrentUser) => user.stores.map(store => store.id);
function assertStoreScope(user: CurrentUser, storeId: string) { if (!user.globalAccess && !scopeIds(user).includes(storeId)) throw new AppError(403, 'STORE_FORBIDDEN', 'Bạn không được xem tồn kho của chi nhánh này.'); }
const scopeWhere = (user: CurrentUser): Prisma.InventoryWhereInput => user.globalAccess ? {} : { warehouse: { storeId: { in: scopeIds(user) } } };
const includeInventory = { warehouse: { include: { store: { select: { id: true, code: true, name: true } } } }, sku: { include: { product: { include: { category: true } } } } };
const present = <T extends { onHand: number; reserved: number; sku: { costPrice: unknown } }>(row: T) => ({ ...row, available: row.onHand - row.reserved, stockValue: row.onHand * Number(row.sku.costPrice), status: row.onHand - row.reserved <= 0 ? 'OUT' : row.onHand - row.reserved <= (row as T & { safetyStock: number }).safetyStock ? 'LOW' : 'AVAILABLE' });

export async function listInventory(user: CurrentUser, input: z.infer<typeof inventoryListInput>) {
  if (input.storeId) assertStoreScope(user, input.storeId);
  if (input.warehouseId) { const warehouse = await prisma.warehouse.findUnique({ where: { id: input.warehouseId }, select: { storeId: true } }); if (!warehouse) throw new AppError(404, 'WAREHOUSE_NOT_FOUND', 'Không tìm thấy kho.'); assertStoreScope(user, warehouse.storeId); }
  const where: Prisma.InventoryWhereInput = { ...scopeWhere(user), ...(input.storeId ? { warehouse: { storeId: input.storeId } } : {}), ...(input.warehouseId ? { warehouseId: input.warehouseId } : {}), ...(input.categoryId ? { sku: { product: { categoryId: input.categoryId } } } : {}), ...(input.q ? { OR: [{ sku: { code: { contains: input.q, mode: 'insensitive' } } }, { sku: { barcode: { contains: input.q } } }, { sku: { product: { name: { contains: input.q, mode: 'insensitive' } } } }, { warehouse: { name: { contains: input.q, mode: 'insensitive' } } }] } : {}) };
  const rows = await prisma.inventory.findMany({ where, include: includeInventory, orderBy: [{ warehouse: { name: 'asc' } }, { sku: { code: 'asc' } }] });
  const presented = rows.map(present).filter(row => input.status === 'all' || row.status === input.status); const skip = (input.page - 1) * input.pageSize;
  const all = (await prisma.inventory.findMany({ where: scopeWhere(user), include: { sku: { select: { costPrice: true } } } })).map(present);
  return { items: presented.slice(skip, skip + input.pageSize), pagination: { page: input.page, pageSize: input.pageSize, total: presented.length, totalPages: Math.max(1, Math.ceil(presented.length / input.pageSize)) }, summary: { totalSku: all.length, available: all.filter(row => row.status === 'AVAILABLE').length, low: all.filter(row => row.status === 'LOW').length, out: all.filter(row => row.status === 'OUT').length, stockValue: all.reduce((sum, row) => sum + row.stockValue, 0) } };
}

export async function getInventory(user: CurrentUser, id: string) {
  const row = await prisma.inventory.findUnique({ where: { id }, include: includeInventory }); if (!row) throw new AppError(404, 'INVENTORY_NOT_FOUND', 'Không tìm thấy tồn kho SKU.'); assertStoreScope(user, row.warehouse.storeId); return present(row);
}

export async function setSafetyStock(user: CurrentUser, id: string, safetyStock: number) {
  const current = await prisma.inventory.findUnique({ where: { id }, include: { warehouse: true } });
  if (!current) throw new AppError(404, 'INVENTORY_NOT_FOUND', 'Không tìm thấy tồn kho SKU.');
  assertStoreScope(user, current.warehouse.storeId);
  return prisma.$transaction(async tx => {
    const updated = await tx.inventory.update({ where: { id }, data: { safetyStock }, include: includeInventory });
    await tx.auditLog.create({ data: { actorId: user.id, action: 'inventory.safety_stock.update', targetId: id, metadata: { before: current.safetyStock, after: safetyStock } } });
    return present(updated);
  });
}

export async function adjustStock(user: CurrentUser, id: string, actualQuantity: number, reason: string) {
  try { return await prisma.$transaction(async tx => {
    const current = await tx.inventory.findUnique({ where: { id }, include: { warehouse: true } });
    if (!current) throw new AppError(404, 'INVENTORY_NOT_FOUND', 'Không tìm thấy tồn kho SKU.');
    assertStoreScope(user, current.warehouse.storeId);
    if (!current.warehouse.active) throw new AppError(409, 'WAREHOUSE_INACTIVE', 'Kho đã ngừng hoạt động.');
    if (actualQuantity < current.reserved) throw new AppError(409, 'STOCK_RESERVED', 'Số tồn mới không được thấp hơn số lượng đã giữ chỗ.');
    if (actualQuantity === current.onHand) throw new AppError(400, 'STOCK_UNCHANGED', 'Số tồn mới phải khác số tồn hiện tại.');
    const openStocktake = await tx.stocktakeItem.count({ where: { inventoryId: id, stocktake: { status: { in: ['COUNTING', 'PENDING_APPROVAL'] } } } });
    if (openStocktake) throw new AppError(409, 'STOCKTAKE_IN_PROGRESS', 'SKU đang được kiểm kho; hãy hoàn tất phiếu kiểm kho trước.');
    const changed = await tx.inventory.updateMany({ where: { id, onHand: current.onHand }, data: { onHand: actualQuantity } });
    if (changed.count !== 1) throw new AppError(409, 'STOCK_CHANGED', 'Tồn kho vừa thay đổi; hãy tải lại và thử lại.');
    const transaction = await tx.inventoryTransaction.create({ data: {
      inventoryId: id, warehouseId: current.warehouseId, skuId: current.skuId,
      type: 'STOCK_ADJUSTMENT', quantity: actualQuantity - current.onHand,
      beforeQuantity: current.onHand, afterQuantity: actualQuantity,
      referenceType: 'STOCK_ADJUSTMENT', referenceId: id, reason, actorId: user.id,
    } });
    await tx.auditLog.create({ data: { actorId: user.id, action: 'inventory.adjust', targetId: id, metadata: { before: current.onHand, after: actualQuantity, reason, transactionId: transaction.id } } });
    return present(await tx.inventory.findUniqueOrThrow({ where: { id }, include: includeInventory }));
  }, { isolationLevel: 'Serializable' }); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') throw new AppError(409, 'STOCK_CHANGED', 'Tồn kho vừa thay đổi; hãy tải lại và thử lại.');
    throw error;
  }
}

export async function listTransactions(user: CurrentUser, input: z.infer<typeof transactionListInput>, inventoryId?: string) {
  let inventoryWhere: Prisma.InventoryTransactionWhereInput = user.globalAccess ? {} : { warehouse: { storeId: { in: scopeIds(user) } } };
  if (inventoryId) { const inventory = await prisma.inventory.findUnique({ where: { id: inventoryId }, include: { warehouse: true } }); if (!inventory) throw new AppError(404, 'INVENTORY_NOT_FOUND', 'Không tìm thấy tồn kho SKU.'); assertStoreScope(user, inventory.warehouse.storeId); inventoryWhere = { ...inventoryWhere, inventoryId }; }
  const where: Prisma.InventoryTransactionWhereInput = {
    ...inventoryWhere,
    ...(input.warehouseId ? { warehouseId: input.warehouseId } : {}),
    ...(input.skuId ? { skuId: input.skuId } : {}),
    ...(input.type === 'all' ? {} : { type: input.type }),
    ...(input.q ? { OR: [
      { sku: { code: { contains: input.q, mode: 'insensitive' } } },
      { sku: { barcode: { contains: input.q } } },
      { sku: { product: { name: { contains: input.q, mode: 'insensitive' } } } },
      { referenceId: { contains: input.q, mode: 'insensitive' } },
      { reason: { contains: input.q, mode: 'insensitive' } },
    ] } : {}),
  };
  const skip = (input.page - 1) * input.pageSize;
  const [items, total] = await Promise.all([prisma.inventoryTransaction.findMany({ where, include: { warehouse: { include: { store: { select: { id: true, code: true, name: true } } } }, sku: { include: { product: { select: { code: true, name: true, unit: true, imageUrl: true } } } }, actor: { select: { id: true, name: true, email: true } } }, orderBy: { occurredAt: 'desc' }, skip, take: input.pageSize }), prisma.inventoryTransaction.count({ where })]);
  return { items, pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.max(1, Math.ceil(total / input.pageSize)) } };
}
