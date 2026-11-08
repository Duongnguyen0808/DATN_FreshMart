import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ db: { warehouse: { findUniqueOrThrow: vi.fn() }, purchaseOrderItem: { findMany: vi.fn() }, sku: { findMany: vi.fn() }, supplier: { findMany: vi.fn() }, auditLog: { findUnique: vi.fn(), create: vi.fn() } }, forecast: vi.fn(), create: vi.fn(), get: vi.fn() }));
vi.mock('../../common/database.js', () => ({ prisma: mocks.db }));
vi.mock('../forecasts/forecasts.service.js', () => ({ getShortageAlerts: mocks.forecast }));
vi.mock('./purchase-orders.service.js', () => ({ createPurchaseOrder: mocks.create, getPurchaseOrder: mocks.get }));
import { createForecastReplenishment, forecastReplenishmentOptions, uncoveredShortage } from './forecast-replenishment.service.js';
import type { CurrentUser } from '../auth/auth.repository.js';

const user = { id: 'actor', globalAccess: false, stores: [{ id: 'store' }] } as CurrentUser;
const input = { requestId: '11111111-1111-4111-8111-111111111111', warehouseId: 'warehouse', supplierId: 'supplier', forecastRunId: 'run', items: [{ skuId: 'sku', quantity: 42, unitCost: 5000 }] };
describe('purchase from shortage alerts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.db.warehouse.findUniqueOrThrow.mockResolvedValue({ id: 'warehouse', storeId: 'store', active: true, store: { active: true, name: 'Chi nhánh' } });
    mocks.forecast.mockResolvedValue({ run: { id: 'run', horizonDays: 7 }, items: [{ skuId: 'sku', shortageQuantity: 42, incomingPurchase: 0 }] });
    mocks.db.purchaseOrderItem.findMany.mockResolvedValue([]);
    mocks.db.sku.findMany.mockResolvedValue([{ id: 'sku', costPrice: 5000 }]);
    mocks.db.supplier.findMany.mockResolvedValue([{ id: 'supplier', name: 'Supplier' }]);
    mocks.db.auditLog.findUnique.mockResolvedValue(null);
    mocks.create.mockImplementation(async (_user, _input, hooks) => { await hooks.beforeCreate(mocks.db); await hooks.afterCreate(mocks.db, 'po'); return { id: 'po' }; });
    mocks.get.mockResolvedValue({ id: 'po' });
  });
  it('subtracts outstanding orders once, including orders outside the forecast horizon', () => {
    expect(uncoveredShortage(42, 0, 42)).toBe(0);
    expect(uncoveredShortage(42, 10, 10)).toBe(42);
    expect(uncoveredShortage(42, 10, 20)).toBe(32);
    expect(uncoveredShortage(2.2, 0, 0)).toBe(3);
  });
  it('does not expose another branch or allow inactive warehouses', async () => {
    await expect(forecastReplenishmentOptions({ ...user, stores: [] }, 'warehouse')).rejects.toMatchObject({ status: 403 });
    expect(mocks.forecast).not.toHaveBeenCalled();
  });
  it('creates through the existing PO/QR workflow and records a replay key', async () => {
    await expect(createForecastReplenishment(user, input)).resolves.toEqual({ id: 'po' });
    expect(mocks.create.mock.calls[0][1].items).toEqual(input.items);
    expect(mocks.db.auditLog.create.mock.calls[0][0].data.id).toBe(input.requestId);
    const saved = mocks.db.auditLog.create.mock.calls[0][0].data;
    mocks.db.auditLog.findUnique.mockResolvedValue(saved);
    await expect(createForecastReplenishment(user, input)).resolves.toEqual({ id: 'po' });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    await expect(createForecastReplenishment(user, { ...input, supplierId: 'changed' })).rejects.toMatchObject({ code: 'ORDER_REQUEST_REUSED' });
  });
  it('checks outstanding PO quantities again inside the creation transaction', async () => {
    mocks.db.purchaseOrderItem.findMany.mockResolvedValueOnce([]).mockResolvedValue([{ skuId: 'sku', orderedQuantity: 42, receivedQuantity: 0 }]);
    await expect(createForecastReplenishment(user, input)).rejects.toMatchObject({ code: 'REPLENISHMENT_CHANGED' });
    expect(mocks.db.auditLog.create).not.toHaveBeenCalled();
  });
  it('rejects a superseded forecast before making any order', async () => {
    await expect(createForecastReplenishment(user, { ...input, forecastRunId: 'old' })).rejects.toMatchObject({ code: 'FORECAST_CHANGED' });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
