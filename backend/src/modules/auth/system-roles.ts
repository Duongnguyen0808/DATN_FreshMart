import type { Prisma } from '../../generated/prisma/client.js';

export const systemRoles = [
  { code: 'OWNER', name: 'Chủ hệ thống', permissions: null },
  { code: 'BRANCH_MANAGER', name: 'Quản lý chi nhánh', permissions: [
    'stores.read', 'warehouses.read', 'products.read', 'customers.read', 'customers.manage',
    'shifts.read', 'shifts.manage', 'shifts.approve', 'invoices.read', 'invoices.create', 'invoices.cancel',
    'returns.read', 'returns.manage', 'inventory.read', 'stocktakes.read', 'stocktakes.create', 'stocktakes.approve',
    'transfers.read', 'transfers.create', 'transfers.approve', 'transfers.dispatch', 'transfers.receive',
    'suppliers.read', 'purchase_requests.read', 'purchase_requests.create', 'purchase_requests.approve',
    'purchase_orders.read', 'purchase_orders.create', 'purchase_orders.receive', 'suppliers.manage', 'payables.read', 'payables.pay',
    'receivables.read', 'receivables.pay', 'dashboard.read', 'reports.read',
  ] },
  { code: 'EMPLOYEE', name: 'Nhân viên', permissions: [
    'stores.read', 'warehouses.read', 'products.read', 'customers.read', 'customers.manage',
    'shifts.read', 'shifts.manage', 'invoices.read', 'invoices.create', 'returns.read', 'inventory.read',
    'stocktakes.read', 'stocktakes.create', 'transfers.read', 'transfers.dispatch', 'transfers.receive',
    'purchase_requests.read', 'purchase_requests.create', 'purchase_orders.read', 'purchase_orders.receive',
  ] },
] as const;

const legacyRoleTargets: Record<string, 'BRANCH_MANAGER' | 'EMPLOYEE'> = {
  REGIONAL_MANAGER: 'BRANCH_MANAGER',
  CASHIER: 'EMPLOYEE', WAREHOUSE_STAFF: 'EMPLOYEE', PURCHASING_STAFF: 'EMPLOYEE', ACCOUNTANT: 'EMPLOYEE',
};

/** Enforce the three built-in roles while preserving every user's assignments and custom roles. */
export async function synchronizeSystemRoles(tx: Prisma.TransactionClient) {
  const roleIds = new Map<string, string>();
  for (const preset of systemRoles) {
    const row = await tx.role.upsert({
      where: { code: preset.code },
      update: { name: preset.name, system: true },
      create: { code: preset.code, name: preset.name, system: true },
    });
    roleIds.set(preset.code, row.id);
    const permissions = preset.permissions ?? (await tx.permission.findMany({ select: { code: true } })).map(item => item.code);
    const found = await tx.permission.count({ where: { code: { in: [...permissions] } } });
    if (found !== permissions.length) throw new Error(`Permission catalog is missing grants for ${preset.code}`);
    await tx.rolePermission.deleteMany({ where: { roleId: row.id } });
    if (permissions.length) await tx.rolePermission.createMany({ data: permissions.map(permissionCode => ({ roleId: row.id, permissionCode })) });
  }

  for (const [legacyCode, targetCode] of Object.entries(legacyRoleTargets)) {
    const legacy = await tx.role.findUnique({ where: { code: legacyCode }, select: { id: true } });
    if (!legacy) continue;
    const targetRoleId = roleIds.get(targetCode)!;
    const assignments = await tx.userRole.findMany({ where: { roleId: legacy.id }, select: { userId: true } });
    for (const assignment of assignments) {
      await tx.userRole.upsert({ where: { userId_roleId: { userId: assignment.userId, roleId: targetRoleId } }, create: { userId: assignment.userId, roleId: targetRoleId }, update: {} });
    }
    await tx.userRole.deleteMany({ where: { roleId: legacy.id } });
    await tx.rolePermission.deleteMany({ where: { roleId: legacy.id } });
    await tx.role.delete({ where: { id: legacy.id } });
  }

  const usersWithBuiltInRoles = await tx.userRole.findMany({
    where: { roleId: { in: [...roleIds.values()] } },
    select: { userId: true, role: { select: { code: true } } },
  });
  const roleCodesByUser = new Map<string, Set<string>>();
  for (const assignment of usersWithBuiltInRoles) {
    const codes = roleCodesByUser.get(assignment.userId) ?? new Set<string>();
    codes.add(assignment.role.code);
    roleCodesByUser.set(assignment.userId, codes);
  }
  for (const [userId, codes] of roleCodesByUser) {
    if (codes.has('OWNER')) {
      await tx.userRole.deleteMany({ where: { userId, roleId: { in: [roleIds.get('BRANCH_MANAGER')!, roleIds.get('EMPLOYEE')!] } } });
    } else if (codes.has('BRANCH_MANAGER')) {
      await tx.userRole.deleteMany({ where: { userId, roleId: roleIds.get('EMPLOYEE')! } });
    }
  }
  return roleIds;
}
