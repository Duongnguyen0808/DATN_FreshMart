// Fixture-only UI checks: no business database writes.
const { chromium, expect } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const base = process.env.REVIEW_BASE_URL || 'http://localhost:3105';
  const store = { id: 'store-review', code: 'CN001', name: 'Kho thử', active: true };
  const run = { id: 'test', model: 'SeasonalNaive7', generatedAt: new Date().toISOString(), horizonDays: 14, historyDays: 56, forecastFrom: '2026-10-29', forecastTo: '2026-11-12' };
  const row = { skuId: 'sku', skuCode: 'sku', productName: 'Nước tinh khiết Aquafina 500ml', productCode: '100011', unit: 'Chai', predictedQuantity: 10, observedQuantity: 8, available: 3, inTransfer: 0, incomingPurchase: 0, safetyStock: 31, shortageQuantity: 38, severity: 'HIGH', dataQuality: 'SPARSE', safetyStockEvidence: { source: 'CONFIGURED', basis: 'Tạm dùng mức tồn an toàn kho cấu hình do chưa đủ lịch sử bán hàng để kiểm thử.' }, timing: { leadTimeDays: null, basis: 'Chỉ tính hàng có lịch giao xác định trong kỳ dự báo.' } };
  await page.route('**/api/v1/**', async route => {
    const resource = new URL(route.request().url()).pathname.split('/api/v1/')[1];
    let data = [];
    if (resource === 'auth/refresh') data = { accessToken: 'ui-test', user: { id: 'review', name: 'Admin', email: 'test@example.test', globalAccess: true, permissions: ['*'], roles: [], stores: [store] } };
    if (resource === 'stores') data = [store];
    if (resource === 'forecasts/demand') data = { store, run, items: [row] };
    if (resource === 'forecasts/shortages') data = { store, run, items: [row], analysisItems: [row], summary: { total: 1, high: 1, medium: 0, low: 0, shortageQuantity: 38 } };
    if (resource === 'inventory') data = { items: [], pagination: { totalPages: 1, total: 0 }, summary: {} };
    await route.fulfill({ json: { success: true, data }, headers: { 'access-control-allow-origin': base, 'access-control-allow-credentials': 'true' } });
  });
  try {
    await page.goto(`${base}/du-bao-nhu-cau`);
    for (const title of ['Cơ sở mức dự phòng', 'Xem căn cứ']) {
      await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
      const cells = () => page.locator('.simple-forecast-table tbody tr:first-child td').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().width));
      const before = await cells();
      await page.getByRole('button', { name: title, exact: true }).click();
      await expect(page.locator('.forecast-evidence-dialog')).toBeVisible();
      expect((await page.locator('.forecast-evidence-dialog').boundingBox()).width).toBeGreaterThan(600);
      expect(await cells()).toEqual(before);
      await page.keyboard.press('Escape');
      await expect(page.locator('.forecast-evidence-dialog')).toHaveCount(0);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Xem căn cứ', exact: true }).click();
    const box = await page.locator('.forecast-evidence-dialog').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.locator('.commerce-sidebar').getByRole('link', { name: 'Quản lý kho', exact: true }).click();
    await expect(page.locator('.commerce-subnav').getByRole('link', { name: 'Mô hình kho 3D', exact: true })).toHaveAttribute('href', '/kho/mo-hinh-3d');
    await expect(page.locator('.commerce-subnav').getByRole('link', { name: 'Kiện hàng & tem QR' })).toBeVisible();
    expect(errors).toEqual([]);
    console.log('PASS: both evidence dialogs preserve table widths, mobile dialog fits, warehouse navigation exposes 3D and QR.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
