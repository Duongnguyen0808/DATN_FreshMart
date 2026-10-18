import { prisma } from '../../common/database.js';

export const userInclude = {
  roles: { include: { role: { include: { permissions: true } } } },
  stores: { include: { store: true } },
} as const;
export const findUser = (id: string) => prisma.user.findUnique({ where: { id }, include: userInclude });
export type FullUser = NonNullable<Awaited<ReturnType<typeof findUser>>>;
export function publicUser(user: FullUser) {
  const roles = user.roles.map(item => ({ id: item.role.id, code: item.role.code, name: item.role.name }));
  return {
    id: user.id, email: user.email, name: user.name, active: user.active,
    roles, globalAccess: roles.some(role => role.code === 'OWNER'),
    permissions: [...new Set(user.roles.flatMap(item => item.role.permissions.map(p => p.permissionCode)))],
    stores: user.stores.filter(item => item.store.active).map(item => item.store),
  };
}
export type CurrentUser = ReturnType<typeof publicUser>;
