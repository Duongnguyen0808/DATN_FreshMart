import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../common/database.js';
import { AppError } from '../../common/app-error.js';
import { authenticate, requirePermission } from '../../middleware/authenticate.js';
import { saveUser, userInput, userUpdate, getUser, listUsers, listInput, changeUserStatus, statusInput, resetUserPassword, passwordInput } from './users.service.js';

export const adminRoutes = Router();
adminRoutes.use(authenticate);
adminRoutes.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
const uuid = z.string().uuid();
const roleInput = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,49}$/), name: z.string().trim().min(1).max(100),
  permissionCodes: z.array(z.string()).max(100).refine(items => new Set(items).size === items.length),
}).strict();
const ok = (data: unknown) => ({ success: true, message: 'Success', data });

adminRoutes.get('/users', requirePermission('users.read'), async (request, response) => {
  response.json({ success: true, message: 'Success', ...await listUsers(request.currentUser, listInput.parse(request.query)) });
});
adminRoutes.get('/users/:id', requirePermission('users.read'), async (request, response) => {
  response.json(ok(await getUser(request.currentUser, uuid.parse(request.params.id))));
});
adminRoutes.patch('/users/:id/status', requirePermission('users.manage'), async (request, response) => {
  response.json(ok(await changeUserStatus(request.currentUser, uuid.parse(request.params.id), statusInput.parse(request.body).active)));
});
adminRoutes.put('/users/:id/password', requirePermission('users.manage'), async (request, response) => {
  await resetUserPassword(request.currentUser, uuid.parse(request.params.id), passwordInput.parse(request.body).password);
  response.json({ success: true, message: 'Đã đổi mật khẩu. Người dùng cần đăng nhập lại.', data: null });
});
adminRoutes.post('/users', requirePermission('users.manage'), async (request, response) => {
  response.status(201).json(ok(await saveUser(request.currentUser, userInput.parse(request.body))));
});
adminRoutes.put('/users/:id', requirePermission('users.manage'), async (request, response) => {
  response.json(ok(await saveUser(request.currentUser, userUpdate.parse(request.body), uuid.parse(request.params.id))));
});
adminRoutes.get('/roles', requirePermission('roles.read'), async (_request, response) => {
  response.json(ok(await prisma.role.findMany({ include: { permissions: true, _count: { select: { users: true } } }, orderBy: { code: 'asc' } })));
});
adminRoutes.get('/permissions', requirePermission('permissions.read'), async (_request, response) => {
  response.json(ok(await prisma.permission.findMany({ orderBy: { code: 'asc' } })));
});
// Role mutations affect all assigned users, so they require global administration.
adminRoutes.use('/roles', (request, _response, next) => {
  if (request.method !== 'GET' && !request.currentUser.globalAccess) throw new AppError(403, 'FORBIDDEN', 'Chỉ chủ doanh nghiệp được thay đổi vai trò toàn hệ thống.');
  next();
});
adminRoutes.post('/roles', requirePermission('roles.manage'), async (_request, _response) => {
  throw new AppError(409, 'SYSTEM_ROLE_PRESETS_ONLY', 'H? th?ng ch? s? d?ng ba vai tr? chu?n: Ch? h? th?ng, Qu?n l? chi nh�nh v� Nh�n vi�n.');
});
adminRoutes.put('/roles/:id', requirePermission('roles.manage'), async (request, response) => {
  const id = uuid.parse(request.params.id);
  const input = roleInput.parse(request.body);
  const role = await prisma.$transaction(async tx => {
    const current = await tx.role.findUniqueOrThrow({ where: { id } });
    if (current.code === 'OWNER' || (current.system && current.code !== input.code)) throw new AppError(409, 'SYSTEM_ROLE', 'Không thể thay đổi vai trò chủ doanh nghiệp hoặc mã vai trò hệ thống.');
    if (await tx.permission.count({ where: { code: { in: input.permissionCodes } } }) !== input.permissionCodes.length) throw new AppError(400, 'INVALID_PERMISSION', 'Quyền không hợp lệ.');
    await tx.rolePermission.deleteMany({ where: { roleId: id } });
    const role = await tx.role.update({ where: { id }, data: { code: input.code, name: input.name, permissions: { create: input.permissionCodes.map(permissionCode => ({ permissionCode })) } } });
    await tx.auditLog.create({ data: { actorId: request.currentUser.id, action: 'role.update', targetId: id } });
    return role;
  }, { isolationLevel: 'Serializable' });
  response.json(ok(role));
});
adminRoutes.delete('/roles/:id', requirePermission('roles.manage'), async (request, response) => {
  const id = uuid.parse(request.params.id);
  await prisma.$transaction(async tx => {
    const role = await tx.role.findUniqueOrThrow({ where: { id }, include: { _count: { select: { users: true } } } });
    if (role.system || role._count.users > 0) throw new AppError(409, 'ROLE_IN_USE', 'Không thể xóa vai trò hệ thống hoặc vai trò đang được sử dụng.');
    await tx.role.delete({ where: { id } });
    await tx.auditLog.create({ data: { actorId: request.currentUser.id, action: 'role.delete', targetId: id } });
  });
  response.json(ok(null));
});
adminRoutes.get('/stores', requirePermission('stores.read'), async (request, response) => {
  response.json(ok(await prisma.store.findMany({ where: {
    active: true, ...(request.currentUser.globalAccess ? {} : { id: { in: request.currentUser.stores.map(s => s.id) } }),
  }, orderBy: { code: 'asc' } })));
});
adminRoutes.get('/stores/:id', requirePermission('stores.read'), async (request, response) => {
  const id = uuid.parse(request.params.id);
  if (!request.currentUser.globalAccess && !request.currentUser.stores.some(s => s.id === id)) throw new AppError(403, 'STORE_FORBIDDEN', 'Bạn không được truy cập chi nhánh này.');
  const store = await prisma.store.findFirst({ where: { id, active: true } });
  if (!store) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy chi nhánh.');
  response.json(ok(store));
});
