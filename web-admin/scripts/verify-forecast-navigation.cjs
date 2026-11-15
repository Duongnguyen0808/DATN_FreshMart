// Fixture-only UI checks: no business database writes.
const { chromium, expect } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const base = process.env.REVIEW_BASE_URL || 'http://localhost:3000';
  const store = { id: 'store-review', code: 'CN001', name: 'Kho thử', active: true, userCount: 1, warehouseCount: 1 };
  const run = { id: 'test', model: 'SeasonalNaive7', generatedAt: new Date().toISOString(), horizonDays: 14, historyDays: 56, forecastFrom: '2026-10-29', forecastTo: '2026-11-12' };
  const row = { skuId: 'sku', skuCode: 'sku', productName: 'Nước tinh khiết Aquafina 500ml', productCode: '100011', unit: 'Chai', predictedQuantity: 10, observedQuantity: 8, available: 3, inTransfer: 0, incomingPurchase: 0, safetyStock: 31, shortageQuantity: 38, severity: 'HIGH', dataQuality: 'SPARSE', required: 41, plannedSupply: 3, surplusQuantity: 0, safetyStockEvidence: { source: 'CONFIGURED', basis: 'Tạm dùng mức tồn an toàn kho cấu hình do chưa đủ lịch sử bán hàng để kiểm thử.' }, timing: { leadTimeDays: null, basis: 'Chỉ tính hàng có lịch giao xác định trong kỳ dự báo.' }, smartRebalancing: { totalShortage: 38, totalTransferQty: 20, remainingPurchaseQty: 18, unitCost: 4000, estimatedCapitalSaved: 80000, strategy: 'HYBRID_TRANSFER_PURCHASE', headline: 'Điều chuyển 20 Chai + Mua NCC 18 Chai', transfers: [{ sourceWarehouseId: 'wh2', sourceWarehouseCode: 'KH002', sourceWarehouseName: 'Kho Quận 1', sourceStoreId: 'store2', sourceStoreName: 'Chi nhánh Quận 1', availableStock: 50, ownRequired: 20, surplusAvailable: 30, suggestedTransferQty: 20 }] } };
  await page.route('**/api/v1/**', async route => {
    const headers = { 'access-control-allow-origin': base, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const resource = new URL(route.request().url()).pathname.split('/api/v1/')[1];
    let data = [];
    if (resource === 'auth/refresh') data = { accessToken: 'ui-test', user: { id: 'review', name: 'Admin', email: 'test@example.test', globalAccess: true, permissions: ['*'], roles: [], stores: [store] } };
    else if (resource === 'stores') data = [store];
    else if (resource === 'forecasts/demand') data = { store, run, items: [row] };
    else if (resource === 'forecasts/shortages') data = { store, run, items: [row], analysisItems: [row], summary: { total: 1, high: 1, medium: 0, low: 0, shortageQuantity: 38, transferableQuantity: 20, netPurchaseQuantity: 18, estimatedCapitalSaved: 80000 } };
    else if (resource === 'forecasts/recommendations') data = { items: [], summary: { pending: 0, applied: 0, dismissed: 0 } };
    else if (resource === 'inventory-lots/fefo-ai-risks') data = { summary: { totalTrackedLots: 0, atRiskLotsCount: 0, criticalLotsCount: 0, totalAtRiskUnits: 0, totalAtRiskValue: 0, totalRecoverableValue: 0 }, items: [] };
    else if (resource === 'inventory') data = { items: [], pagination: { totalPages: 1, total: 0 }, summary: {} };
    await route.fulfill({ json: { success: true, data }, headers });
  });
  try {
    await page.goto(`${base}/du-bao-nhu-cau`);
    await expect(page.getByRole('heading', { name: 'Dự báo nhu cầu & điều phối chuỗi', exact: true })).toBeVisible();
    await expect(page.locator('.simple-forecast-table tbody tr')).toHaveCount(1);
    const formulaSummary = page.locator('.forecast-method-toggle > summary');
    await expect(formulaSummary).toBeVisible();
    await formulaSummary.click();
    await expect(page.locator('.forecast-explainer')).toBeVisible();
    await expect(page.locator('.simple-forecast-table')).toContainText('Điều chuyển 20 Chai từ Kho Quận 1');
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('Mobile overflow on /du-bao-nhu-cau');
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.locator('.commerce-sidebar').getByRole('link', { name: 'Quản lý kho', exact: true }).click();
    await expect(page.locator('.commerce-subnav').getByRole('link', { name: 'Mô hình kho 3D', exact: true })).toHaveAttribute('href', '/kho/mo-hinh-3d');
    await expect(page.locator('.commerce-subnav').getByRole('link', { name: 'Kiện hàng & tem QR' })).toBeVisible();
    expect(errors).toEqual([]);
    console.log('PASS: forecast & smart rebalancing render cleanly on desktop/mobile, formula explainer toggles, and warehouse navigation exposes 3D and QR.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
