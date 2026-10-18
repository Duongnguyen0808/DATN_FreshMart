export const permissionLabels: Record<string, string> = {
  'users.read': 'Xem danh m\u1ee5c ng\u01b0\u1eddi d\u00f9ng', 'users.manage': 'Qu\u1ea3n l\u00fd t\u00e0i kho\u1ea3n ng\u01b0\u1eddi d\u00f9ng',
  'roles.read': 'Xem vai tr\u00f2', 'roles.manage': 'Qu\u1ea3n l\u00fd vai tr\u00f2', 'permissions.read': 'Xem danh m\u1ee5c quy\u1ec1n',
  'stores.read': 'Xem chi nh\u00e1nh', 'stores.manage': 'Qu\u1ea3n l\u00fd chi nh\u00e1nh', 'warehouses.read': 'Xem kho h\u00e0ng', 'warehouses.manage': 'Qu\u1ea3n l\u00fd kho h\u00e0ng',
  'products.read': 'Xem s\u1ea3n ph\u1ea9m', 'products.manage': 'Qu\u1ea3n l\u00fd s\u1ea3n ph\u1ea9m', 'categories.manage': 'Qu\u1ea3n l\u00fd danh m\u1ee5c s\u1ea3n ph\u1ea9m',
  'shifts.read': 'Xem ca l\u00e0m vi\u1ec7c', 'shifts.manage': 'M\u1edf v\u00e0 ch\u1ed1t ca', 'shifts.approve': 'Duy\u1ec7t ch\u00eanh l\u1ec7ch ca',
  'invoices.read': 'Xem h\u00f3a \u0111\u01a1n', 'invoices.create': 'T\u1ea1o h\u00f3a \u0111\u01a1n v\u00e0 ghi nh\u1eadn thanh to\u00e1n', 'invoices.cancel': 'H\u1ee7y h\u00f3a \u0111\u01a1n',
  'inventory.read': 'Xem t\u1ed3n kho v\u00e0 bi\u1ebfn \u0111\u1ed9ng', 'returns.read': 'Xem h\u1ed3 s\u01a1 \u0111\u1ed5i tr\u1ea3', 'returns.manage': 'X\u1eed l\u00fd \u0111\u1ed5i tr\u1ea3',
  'customers.read': 'Xem kh\u00e1ch h\u00e0ng', 'customers.manage': 'Qu\u1ea3n l\u00fd kh\u00e1ch h\u00e0ng',
  'stocktakes.read': 'Xem phi\u1ebfu ki\u1ec3m kho', 'stocktakes.create': 'T\u1ea1o phi\u1ebfu ki\u1ec3m kho', 'stocktakes.approve': 'Duy\u1ec7t \u0111i\u1ec1u ch\u1ec9nh t\u1ed3n kho',
  'transfers.read': 'Xem phi\u1ebfu \u0111i\u1ec1u chuy\u1ec3n', 'transfers.create': 'T\u1ea1o phi\u1ebfu \u0111i\u1ec1u chuy\u1ec3n', 'transfers.approve': 'Duy\u1ec7t phi\u1ebfu \u0111i\u1ec1u chuy\u1ec3n', 'transfers.dispatch': 'X\u00e1c nh\u1eadn xu\u1ea5t kho', 'transfers.receive': 'X\u00e1c nh\u1eadn nh\u1eadn h\u00e0ng',
  'suppliers.read': 'Xem nh\u00e0 cung c\u1ea5p', 'suppliers.manage': 'Qu\u1ea3n l\u00fd nh\u00e0 cung c\u1ea5p',
  'purchase_requests.read': 'Xem \u0111\u1ec1 ngh\u1ecb mua h\u00e0ng', 'purchase_requests.create': 'T\u1ea1o \u0111\u1ec1 ngh\u1ecb mua h\u00e0ng', 'purchase_requests.approve': 'Duy\u1ec7t \u0111\u1ec1 ngh\u1ecb mua h\u00e0ng',
  'purchase_orders.read': 'Xem \u0111\u01a1n mua h\u00e0ng', 'purchase_orders.create': 'T\u1ea1o \u0111\u01a1n mua h\u00e0ng', 'purchase_orders.receive': 'Nh\u1eadn h\u00e0ng theo \u0111\u01a1n mua',
  'payables.read': 'Xem c\u00f4ng n\u1ee3 ph\u1ea3i tr\u1ea3', 'payables.pay': 'Ghi nh\u1eadn thanh to\u00e1n c\u00f4ng n\u1ee3', 'receivables.read': 'Xem c\u00f4ng n\u1ee3 ph\u1ea3i thu', 'receivables.pay': 'Ghi nh\u1eadn thu ti\u1ec1n',
  'dashboard.read': 'Xem t\u1ed5ng quan', 'reports.read': 'Xem b\u00e1o c\u00e1o',
};
export const permissionLabel = (code: string) => permissionLabels[code] ?? 'Quy\u1ec1n nghi\u1ec7p v\u1ee5';
