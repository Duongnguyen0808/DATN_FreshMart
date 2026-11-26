import { CurrentUser } from '../types';

export type RoleCategory = 'OWNER' | 'MANAGER' | 'WAREHOUSE' | 'CASHIER' | 'STAFF';

export function hasPermission(user: CurrentUser | null | undefined, code: string): boolean {
  if (!user) return false;
  if (user.globalAccess) return true;
  if (!Array.isArray(user.permissions)) return false;
  return user.permissions.includes('*') || user.permissions.includes(code);
}

export function getRoleCategory(user: CurrentUser | null | undefined): RoleCategory {
  if (!user) return 'STAFF';
  const roleCodes = (user.roles || []).map((r) => r.code.toUpperCase());
  if (user.globalAccess || roleCodes.includes('OWNER') || roleCodes.includes('ADMIN')) {
    return 'OWNER';
  }
  if (roleCodes.includes('BRANCH_MANAGER') || roleCodes.includes('STORE_MANAGER') || roleCodes.includes('MANAGER')) {
    return 'MANAGER';
  }
  if (roleCodes.includes('WAREHOUSE') || roleCodes.includes('WAREHOUSE_STAFF') || roleCodes.includes('INVENTORY')) {
    return 'WAREHOUSE';
  }
  if (roleCodes.includes('CASHIER')) {
    return 'CASHIER';
  }
  return 'STAFF';
}

export function getRoleDisplayName(user: CurrentUser | null | undefined): string {
  if (!user) return 'Nhân viên';
  if (user.roles && user.roles.length > 0) {
    return user.roles[0].name;
  }
  switch (getRoleCategory(user)) {
    case 'OWNER':
      return 'Chủ hệ thống';
    case 'MANAGER':
      return 'Quản lý chi nhánh';
    case 'WAREHOUSE':
      return 'Nhân viên kho';
    case 'CASHIER':
      return 'Thu ngân';
    default:
      return 'Nhân viên';
  }
}

export function canViewRevenue(user: CurrentUser | null | undefined): boolean {
  return hasPermission(user, 'dashboard.read') || hasPermission(user, 'reports.read');
}

export function canCreateStocktake(user: CurrentUser | null | undefined): boolean {
  return hasPermission(user, 'stocktakes.create');
}

export function canApproveStocktake(user: CurrentUser | null | undefined): boolean {
  return hasPermission(user, 'stocktakes.approve');
}

export function canAccessIoT(user: CurrentUser | null | undefined): boolean {
  return hasPermission(user, 'inventory.read') || hasPermission(user, 'warehouses.read');
}

export function canReportIncident(user: CurrentUser | null | undefined): boolean {
  return hasPermission(user, 'inventory.read') || hasPermission(user, 'products.read');
}
