import { z } from 'zod';
import { prisma } from '../../common/database.js';
import { AppError } from '../../common/app-error.js';
import { hashPassword } from '../auth/password.js';
import { userInclude, publicUser, type CurrentUser, type FullUser } from '../auth/auth.repository.js';
import type { Prisma } from '../../generated/prisma/client.js';

const ids = z.array(z.string().uuid()).max(100).refine(items => new Set(items).size === items.length);
export const userInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254), name: z.string().trim().min(1).max(100),
  password: z.string().min(10).max(128), active: z.boolean().default(true),
  roleIds: ids.min(1), storeIds: ids,
}).strict();
export const userUpdate = userInput.omit({ password: true }).extend({ active: z.boolean(), password: z.string().min(10).max(128).optional() });
export const statusInput = z.object({ active: z.boolean() }).strict();
export const passwordInput = z.object({ password: z.string().min(10).max(128) }).strict();
export const listInput = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(), active: z.enum(['true', 'false']).optional(),
  roleId: z.string().uuid().optional(), storeId: z.string().uuid().optional(),
}).strict();

// Administration must retain inactive assignments so an edit never silently drops them.
export const managedUser = (user: FullUser) => ({ ...publicUser(user), stores: user.stores.map(item => item.store) });
export function userScope(actor: CurrentUser): Prisma.UserWhereInput {
  if (actor.globalAccess) return {};
  const ids = actor.stores.map(store => store.id);
  return { stores: { some: { storeId: { in: ids } }, every: { storeId: { in: ids } } }, roles: { none: { role: { code: 'OWNER' } } } };
}
function assertTarget(actor: CurrentUser, target: FullUser, write = false) {
  if (actor.globalAccess) return;
  if (target.roles.some(r => r.role.code === 'OWNER') || target.stores.length === 0 || target.stores.some(s => !actor.stores.some(a => a.id === s.storeId)) ||
      (write && target.roles.some(r => r.role.permissions.some(p => !actor.permissions.includes(p.permissionCode))))) {
    throw new AppError(403, 'FORBIDDEN', 'Người dùng hoặc quyền của người dùng nằm ngoài phạm vi quản lý.');
  }
}
async function currentActor(tx: Prisma.TransactionClient, actor: CurrentUser) {
  const current = await tx.user.findUnique({ where: { id: actor.id }, include: userInclude });
  if (!current?.active) throw new AppError(401, 'UNAUTHENTICATED', 'Tài khoản không còn hoạt động.');
  const result = publicUser(current);
  if (!result.permissions.includes('users.manage')) throw new AppError(403, 'FORBIDDEN', 'Bạn không còn quyền quản lý người dùng.');
  return result;
}
async function protectLastOwner(tx: Prisma.TransactionClient, target: FullUser, active: boolean, owner: boolean) {
  if (target.active && target.roles.some(r => r.role.code === 'OWNER') && (!active || !owner)) {
    const count = await tx.user.count({ where: { active: true, roles: { some: { role: { code: 'OWNER' } } } } });
    if (count <= 1) throw new AppError(409, 'LAST_OWNER', 'Phải giữ ít nhất một chủ doanh nghiệp đang hoạt động.');
  }
}
export async function getUser(actor: CurrentUser, id: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id }, include: userInclude });
  assertTarget(actor, user);
  return managedUser(user);
}
export async function listUsers(actor: CurrentUser, query: z.infer<typeof listInput>) {
  const where: Prisma.UserWhereInput = { AND: [userScope(actor),
    ...(query.q ? [{ OR: [{ name: { contains: query.q, mode: 'insensitive' as const } }, { email: { contains: query.q, mode: 'insensitive' as const } }] }] : []),
    ...(query.active ? [{ active: query.active === 'true' }] : []),
    ...(query.roleId ? [{ roles: { some: { roleId: query.roleId } } }] : []),
    ...(query.storeId ? [{ stores: { some: { storeId: query.storeId } } }] : []),
  ] };
  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({ where, include: userInclude, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    prisma.user.count({ where }),
  ], { isolationLevel: 'RepeatableRead' });
  return { data: users.map(managedUser), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
}
export async function changeUserStatus(actor: CurrentUser, id: string, active: boolean) {
  return prisma.$transaction(async tx => {
    actor = await currentActor(tx, actor);
    const user = await tx.user.findUniqueOrThrow({ where: { id }, include: userInclude });
    assertTarget(actor, user, true);
    await protectLastOwner(tx, user, active, user.roles.some(r => r.role.code === 'OWNER'));
    if (user.active === active) return managedUser(user);
    const updated = await tx.user.update({ where: { id }, data: { active }, include: userInclude });
    await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({ data: { actorId: actor.id, action: active ? 'user.enable' : 'user.disable', targetId: id } });
    return managedUser(updated);
  }, { isolationLevel: 'Serializable' });
}
export async function resetUserPassword(actor: CurrentUser, id: string, password: string) {
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async tx => {
    actor = await currentActor(tx, actor);
    const user = await tx.user.findUniqueOrThrow({ where: { id }, include: userInclude });
    assertTarget(actor, user, true);
    await tx.user.update({ where: { id }, data: { passwordHash } });
    await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({ data: { actorId: actor.id, action: 'user.password.reset', targetId: id } });
  }, { isolationLevel: 'Serializable' });
}

export async function saveUser(actor: CurrentUser, input: z.infer<typeof userUpdate>, id?: string) {
  const passwordHash = input.password ? await hashPassword(input.password) : undefined;
  return prisma.$transaction(async tx => {
    actor = await currentActor(tx, actor);
    const roles = await tx.role.findMany({ where: { id: { in: input.roleIds } }, include: { permissions: true } });
    const stores = await tx.store.findMany({ where: { id: { in: input.storeIds }, active: true } });
    if (roles.length !== input.roleIds.length || stores.length !== input.storeIds.length) throw new AppError(400, 'INVALID_ASSIGNMENT', 'Vai trò hoặc chi nhánh không hợp lệ.');
    const owner = roles.some(role => role.code === 'OWNER');
    if (!actor.globalAccess && (owner || roles.some(role => role.permissions.some(p => !actor.permissions.includes(p.permissionCode))) || stores.some(store => !actor.stores.some(s => s.id === store.id)))) {
      throw new AppError(403, 'FORBIDDEN', 'Không thể cấp quyền hoặc chi nhánh vượt phạm vi của bạn.');
    }
    if (!owner && input.storeIds.length === 0) throw new AppError(400, 'STORE_REQUIRED', 'Nhân viên cần được gán ít nhất một chi nhánh.');
    if (id) {
      const current = await tx.user.findUniqueOrThrow({ where: { id }, include: userInclude });
      assertTarget(actor, current, true);
      await protectLastOwner(tx, current, input.active, owner);
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userStore.deleteMany({ where: { userId: id } });
      // Changes to account access invalidate every existing session immediately.
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    const data = { email: input.email, name: input.name, active: input.active, passwordHash,
      roles: { create: input.roleIds.map(roleId => ({ roleId })) },
      stores: { create: input.storeIds.map(storeId => ({ storeId })) },
    };
    const user = id ? await tx.user.update({ where: { id }, data, include: userInclude })
      : await tx.user.create({ data: { ...data, passwordHash: passwordHash! }, include: userInclude });
    await tx.auditLog.create({ data: { actorId: actor.id, action: id ? 'user.update' : 'user.create', targetId: user.id } });
    if (id && passwordHash) await tx.auditLog.create({ data: { actorId: actor.id, action: 'user.password.reset', targetId: id } });
    return managedUser(user);
  }, { isolationLevel: 'Serializable' });
}
