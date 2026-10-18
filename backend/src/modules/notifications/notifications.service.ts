import { prisma } from '../../common/database.js';
import type { CurrentUser } from '../auth/auth.repository.js';

type Notice = { id: string; kind: 'stocktake' | 'transfer' | 'purchase_request' | 'shift'; title: string; description: string; href: string; createdAt: Date };

export async function listOperationalNotifications(user: CurrentUser) {
  const allowed = (resource: string) => user.permissions.includes(`${resource}.read`) && user.permissions.includes(`${resource}.approve`);
  const storeIds = user.stores.map(store => store.id);
  const stocktakeWhere = { status: 'PENDING_APPROVAL', ...(user.globalAccess ? {} : { warehouse: { storeId: { in: storeIds } } }) };
  const transferWhere = { status: 'PENDING_APPROVAL', ...(user.globalAccess ? {} : { AND: [{ sourceWarehouse: { storeId: { in: storeIds } } }, { destinationWarehouse: { storeId: { in: storeIds } } }] }) };
  const requestWhere = { status: 'PENDING_APPROVAL', ...(user.globalAccess ? {} : { storeId: { in: storeIds } }) };
  const shiftWhere = { status: 'PENDING_REVIEW', ...(user.globalAccess ? {} : { storeId: { in: storeIds } }) };
  const [stocktakes, transfers, requests, shifts, stocktakeCount, transferCount, requestCount, shiftCount] = await Promise.all([
    allowed('stocktakes') ? prisma.stocktake.findMany({ where: stocktakeWhere, select: { id: true, code: true, createdAt: true, warehouse: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 10 }) : [],
    allowed('transfers') ? prisma.stockTransfer.findMany({ where: transferWhere, select: { id: true, code: true, createdAt: true, sourceWarehouse: { select: { name: true } }, destinationWarehouse: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 10 }) : [],
    allowed('purchase_requests') ? prisma.purchaseRequest.findMany({ where: requestWhere, select: { id: true, code: true, createdAt: true, store: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 10 }) : [],
    allowed('shifts') ? prisma.workShift.findMany({ where: shiftWhere, select: { id: true, code: true, createdAt: true, closedAt: true, store: { select: { name: true } }, cashier: { select: { name: true } } }, orderBy: { closedAt: 'desc' }, take: 10 }) : [],
    allowed('stocktakes') ? prisma.stocktake.count({ where: stocktakeWhere }) : 0,
    allowed('transfers') ? prisma.stockTransfer.count({ where: transferWhere }) : 0,
    allowed('purchase_requests') ? prisma.purchaseRequest.count({ where: requestWhere }) : 0,
    allowed('shifts') ? prisma.workShift.count({ where: shiftWhere }) : 0,
  ]);
  const items: Notice[] = [
    ...stocktakes.map(row => ({ id: `stocktake:${row.id}`, kind: 'stocktake' as const, title: `Kiểm kho ${row.code} chờ duyệt`, description: row.warehouse.name, href: `/kiem-kho/${row.id}`, createdAt: row.createdAt })),
    ...transfers.map(row => ({ id: `transfer:${row.id}`, kind: 'transfer' as const, title: `Điều chuyển ${row.code} chờ duyệt`, description: `${row.sourceWarehouse.name} → ${row.destinationWarehouse.name}`, href: `/dieu-chuyen/${row.id}`, createdAt: row.createdAt })),
    ...requests.map(row => ({ id: `purchase_request:${row.id}`, kind: 'purchase_request' as const, title: `Đề nghị mua ${row.code} chờ duyệt`, description: row.store.name, href: `/de-nghi-mua/${row.id}`, createdAt: row.createdAt })),
    ...shifts.map(row => ({ id: `shift:${row.id}`, kind: 'shift' as const, title: `Ca ${row.code} ch\u1edd duy\u1ec7t ch\u00eanh l\u1ec7ch`, description: `${row.store.name} · ${row.cashier.name}`, href: `/ca-lam-viec?shift=${row.id}`, createdAt: row.closedAt ?? row.createdAt })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 10);
  return { total: stocktakeCount + transferCount + requestCount + shiftCount, items };
}
