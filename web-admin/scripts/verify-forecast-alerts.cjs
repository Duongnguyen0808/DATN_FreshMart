// Isolated browser test: all API requests are intercepted and no data is written.
const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const store = { id: 's1', code: 'CN01', name: 'Chi nhánh Ba Đình', active: true };
  const warehouse = { id: 'w1', code: 'WH01', name: 'Kho Ba Đình', active: true, storeId: store.id, store };
  const category = { id: 'c1', code: 'C01', name: 'Thực phẩm', active: true };
  const products = ['Phở bò', 'Nước suối'].map((name, i) => ({ id: `p${i}`, code: `10000${i}`, name, unit: 'Gói', active: true, category, categoryId: category.id, imageUrl: null, availableStock: 3, unitsPerUnit: 1, skus: [{ id: `sku${i}`, code: `S${i}`, barcode: '12345678', costPrice: 1000, sellingPrice: 2000 }] }));
  const inventory = products.map((product, i) => ({ id: `inv${i}`, skuId: `sku${i}`, warehouseId: warehouse.id, warehouse, onHand: 3, reserved: 0, available: 3, inTransfer: 0, incoming: 0, safetyStock: 10, stockValue: 3000, status: 'LOW', sku: { ...product.skus[0], product: { ...product, category } } }));
  const row = { skuId: 'sku0', skuCode: 'S0', productId: 'p0', productCode: '100000', productName: 'Phở bò', unit: 'Gói', imageUrl: null, predictedQuantity: 0, observedQuantity: 0, available: 3, safetyStock: 10, inTransfer: 0, incomingPurchase: 0, shortageQuantity: 7, severity: 'HIGH', dataQuality: 'NO_SALES', required: 10, plannedSupply: 3, surplusQuantity: 0 };
  const run = { id: 'run1', model: 'Live-test', generatedAt: new Date().toISOString(), horizonDays: 14, historyDays: 366, forecastFrom: new Date().toISOString(), forecastTo: new Date().toISOString() };
  const report = { store, run, items: [row], analysisItems: [row], summary: { total: 1, high: 1, medium: 0, low: 0, shortageQuantity: 7 } };
  const summary = { revenue: 0, costOfGoods: 0, grossProfit: 0, grossMargin: 0, invoiceCount: 0, stockValue: 0, lowStock: 0, outstandingDebt: 0, overdueDebt: 0, overdueCount: 0, outstandingReceivables: 0, overdueReceivables: 0, overdueReceivableCount: 0, pendingTransfers: 0 };
  const pagination = { page: 1, pageSize: 20, total: 2, totalPages: 1 };
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), resource = url.pathname.split('/api/v1/')[1];
    let data;
    if (resource === 'auth/refresh') data = { accessToken:'test', user: { id:'u1', email:'test@example.test', name:'Kiểm thử', active:true, globalAccess:true, roles:[], permissions:['*'], stores:[store] } };
    else if (resource === 'stores') data = [store];
    else if (resource === 'warehouses') data = [warehouse];
    else if (resource === 'categories') data = [category];
    else if (resource === 'products') data = { items: products, pagination, summary: { total:2, active:2, inactive:0 } };
    else if (resource === 'inventory') data = { items: inventory, pagination, summary: { totalSku:2, available:0, low:2, out:0, stockValue:6000 } };
    else if (resource === 'inventory/forecast-alerts') data = url.searchParams.get('horizonDays') === '7' ? { ...report, run:null, items:[], analysisItems:[] } : report;
    else if (resource === 'forecasts/demand') data = { store, run, items:[row] };
    else if (resource === 'forecasts/shortages') data = report;
    else if (resource === 'dashboard') data = { period:30, from:'2026-10-01', to:'2026-11-01', summary, revenueSeries:[], branches:[], topProducts:[] };
    else data = { items:[], pagination:{ page:1,pageSize:20,total:0,totalPages:1 }, summary:{} };
    await route.fulfill({ json:{ success:true, data }, headers:{ 'access-control-allow-origin':'http://localhost:3000', 'access-control-allow-credentials':'true' } });
  });
  const output = path.join(__dirname, '..', 'artifacts', 'forecast-alert-review'); fs.mkdirSync(output, { recursive:true });
  try {
    for (const route of ['/', '/san-pham', '/ton-kho', '/du-bao-nhu-cau']) {
      await page.goto(`http://localhost:3000${route}`, { waitUntil:'domcontentloaded' });
      const banner = page.getByRole('region', { name:'Cảnh báo dự báo thiếu hàng' });
      await expect(banner).toContainText('14 ngày', { timeout:20000 });
      await expect(banner).toContainText('1 lượt');
      await banner.screenshot({ path:path.join(output, (route === '/' ? 'dashboard' : route.slice(1)) + '.png') });
      if (route === '/san-pham' || route === '/ton-kho') {
        await expect(page.getByText('Cần xử lý gấp · 7 Gói')).toBeVisible();
        await banner.getByRole('button', { name:'Chỉ xem hàng cần bổ sung' }).click();
        await expect(page.getByText('Nước suối', { exact:true })).toHaveCount(0);
        await expect(page.getByText('Phở bò', { exact:true }).first()).toBeVisible();
      }
      console.log(`PASS ${route}: actual horizon displayed and shortage visible`);
    }
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
