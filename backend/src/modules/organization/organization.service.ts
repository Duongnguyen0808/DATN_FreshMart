import { z } from 'zod';
import { prisma } from '../../common/database.js';
import { AppError } from '../../common/app-error.js';
import type { CurrentUser } from '../auth/auth.repository.js';

const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,29}$/);
const nullableText = z.string().trim().max(100).optional().nullable().transform(value => value || null);
export const idInput = z.string().uuid();
export const storeListInput = z.object({ q: z.string().trim().max(100).optional(), active: z.enum(['true', 'false', 'all']).default('true'), region: z.enum(['MIEN_BAC', 'MIEN_TRUNG', 'MIEN_NAM']).optional() }).strict();
export const warehouseListInput = z.object({ q: z.string().trim().max(100).optional(), active: z.enum(['true', 'false', 'all']).default('true'), storeId: z.string().uuid().optional() }).strict();
export const warehouseInput = z.object({ code, name: z.string().trim().min(1).max(100), address: z.string().trim().min(1).max(250), storeId: z.string().uuid() }).strict();
export const warehouseUpdate = warehouseInput.omit({ code: true, storeId: true });
export const storeInput = z.object({
  code, name: z.string().trim().min(1).max(100), address: z.string().trim().min(1).max(250), region: z.enum(['MIEN_BAC', 'MIEN_TRUNG', 'MIEN_NAM']),
  phone: z.string().trim().regex(/^[0-9+(). -]{7,20}$/).optional().nullable().transform(value => value || null), managerName: nullableText,
  warehouse: z.object({ code, name: z.string().trim().min(1).max(100), address: z.string().trim().min(1).max(250) }).strict(),
}).strict();
export const storeUpdate = storeInput.omit({ code: true, warehouse: true });
export const statusInput = z.object({ active: z.boolean() }).strict();

const scopeIds = (user: CurrentUser) => user.stores.map(store => store.id);
function assertScope(user: CurrentUser, storeId: string) {
  if (!user.globalAccess && !scopeIds(user).includes(storeId)) throw new AppError(403, 'STORE_FORBIDDEN', 'Bạn không được truy cập chi nhánh này.');
}
const storeInclude = { warehouses: { orderBy: { code: 'asc' as const } }, _count: { select: { users: true, warehouses: true } } };
const presentStore = <T extends { _count: { users: number; warehouses: number } }>(store: T) => {
  const { _count, ...data } = store;
  return { ...data, userCount: _count.users, warehouseCount: _count.warehouses };
};

export async function listStores(user: CurrentUser, input: z.infer<typeof storeListInput>) {
  const stores = await prisma.store.findMany({ where: {
    ...(user.globalAccess ? {} : { id: { in: scopeIds(user) } }), ...(input.active === 'all' ? {} : { active: input.active === 'true' }),
    ...(input.region ? { region: input.region } : {}), ...(input.q ? { OR: [{ code: { contains: input.q, mode: 'insensitive' } }, { name: { contains: input.q, mode: 'insensitive' } }, { address: { contains: input.q, mode: 'insensitive' } }] } : {}),
  }, include: storeInclude, orderBy: { code: 'asc' } });
  return stores.map(presentStore);
}
export async function getStore(user: CurrentUser, id: string) {
  assertScope(user, id);
  const store = await prisma.store.findUnique({ where: { id }, include: storeInclude });
  if (!store) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy chi nhánh.');
  return presentStore(store);
}
export async function createStore(user: CurrentUser, input: z.infer<typeof storeInput>) {
  if (!user.globalAccess) throw new AppError(403, 'GLOBAL_ACCESS_REQUIRED', 'Chỉ chủ doanh nghiệp được thêm chi nhánh.');
  return prisma.$transaction(async tx => {
    const store = await tx.store.create({ data: { code: input.code, name: input.name, address: input.address, region: input.region, phone: input.phone, managerName: input.managerName,
      warehouses: { create: { code: input.warehouse.code, name: input.warehouse.name, address: input.warehouse.address } } }, include: storeInclude });
    const skus = await tx.sku.findMany({ where: { active: true }, select: { id: true } });
    if (skus.length) await tx.inventory.createMany({ data: skus.map(sku => ({ warehouseId: store.warehouses[0]!.id, skuId: sku.id })) });
    await tx.auditLog.create({ data: { actorId: user.id, action: 'store.create', targetId: store.id } });
    return presentStore(store);
  });
}
export async function updateStore(user: CurrentUser, id: string, input: z.infer<typeof storeUpdate>) {
  assertScope(user, id);
  return prisma.$transaction(async tx => {
    const store = await tx.store.update({ where: { id }, data: input, include: storeInclude });
    await tx.auditLog.create({ data: { actorId: user.id, action: 'store.update', targetId: id } });
    return presentStore(store);
  });
}
export async function changeStoreStatus(user: CurrentUser, id: string, active: boolean) {
  assertScope(user, id);
  return prisma.$transaction(async tx => {
    const store = await tx.store.update({ where: { id }, data: { active }, include: storeInclude });
    await tx.auditLog.create({ data: { actorId: user.id, action: active ? 'store.activate' : 'store.deactivate', targetId: id } });
    return presentStore(store);
  });
}
export async function listWarehouses(user: CurrentUser, input: z.infer<typeof warehouseListInput>) {
  if (input.storeId) assertScope(user, input.storeId);
  return prisma.warehouse.findMany({ where: {
    ...(input.storeId ? { storeId: input.storeId } : user.globalAccess ? {} : { storeId: { in: scopeIds(user) } }),
    ...(input.active === 'all' ? {} : { active: input.active === 'true' }),
    ...(input.q ? { OR: [{ code: { contains: input.q, mode: 'insensitive' } }, { name: { contains: input.q, mode: 'insensitive' } }, { address: { contains: input.q, mode: 'insensitive' } }] } : {}),
  }, include: { store: { select: { id: true, code: true, name: true, active: true } } }, orderBy: [{ store: { code: 'asc' } }, { code: 'asc' }] });
}
export async function createWarehouse(user: CurrentUser, input: z.infer<typeof warehouseInput>) {
  assertScope(user, input.storeId);
  const store = await prisma.store.findUnique({ where: { id: input.storeId }, select: { active: true } });
  if (!store) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy chi nhánh.');
  if (!store.active) throw new AppError(409, 'STORE_INACTIVE', 'Không thể thêm kho vào chi nhánh đã ngưng hoạt động.');
  return prisma.$transaction(async tx => {
    const warehouse = await tx.warehouse.create({ data: input, include: { store: true } });
    const skus = await tx.sku.findMany({ where: { active: true }, select: { id: true } });
    if (skus.length) await tx.inventory.createMany({ data: skus.map(sku => ({ warehouseId: warehouse.id, skuId: sku.id })) });
    await tx.auditLog.create({ data: { actorId: user.id, action: 'warehouse.create', targetId: warehouse.id } });
    return warehouse;
  });
}
export async function updateWarehouse(user: CurrentUser, id: string, input: z.infer<typeof warehouseUpdate>) {
  const current = await prisma.warehouse.findUnique({ where: { id } });
  if (!current) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy kho.');
  assertScope(user, current.storeId);
  return prisma.$transaction(async tx => {
    const warehouse = await tx.warehouse.update({ where: { id }, data: input, include: { store: true } });
    await tx.auditLog.create({ data: { actorId: user.id, action: 'warehouse.update', targetId: id } });
    return warehouse;
  });
}
export async function changeWarehouseStatus(user: CurrentUser, id: string, active: boolean) {
  const current = await prisma.warehouse.findUnique({ where: { id }, include: { store: true } });
  if (!current) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy kho.');
  assertScope(user, current.storeId);
  if (!active && current.active && current.store.active && await prisma.warehouse.count({ where: { storeId: current.storeId, active: true } }) <= 1) throw new AppError(409, 'LAST_ACTIVE_WAREHOUSE', 'Chi nhánh đang hoạt động phải còn ít nhất một kho hoạt động.');
  return prisma.$transaction(async tx => {
    const warehouse = await tx.warehouse.update({ where: { id }, data: { active }, include: { store: true } });
    await tx.auditLog.create({ data: { actorId: user.id, action: active ? 'warehouse.activate' : 'warehouse.deactivate', targetId: id } });
    return warehouse;
  }, { isolationLevel: 'Serializable' });
}
