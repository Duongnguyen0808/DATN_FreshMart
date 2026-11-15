// Browser regression check. All API traffic is intercepted; no database writes occur.
const { chromium, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1560, height: 1150 }, deviceScaleFactor: 1 });
  const errors = [];
  const writes = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const branches = ['Ba Đình', 'Quận 1', 'Hải Châu'].map((name, i) => ({ id: `s${i + 1}`, code: `CN0${i + 1}`, name: `Chi nhánh ${name}`, active: true }));
  const warehouses = branches.map((store, i) => ({ id: `w${i + 1}`, code: `KH00${i + 1}`, name: `Kho ${store.name.slice(10)}`, storeId: store.id, store, active: true, address: '' }));
  const names = ['Nước tinh khiết', 'Sữa tươi Vinamilk', 'Bánh ChocoPie', 'Cà phê rang xay', 'Mì ăn liền', 'Bột giặt', 'Bánh quy', 'Dầu ăn', 'Nước ngọt'];
  const inventories = Object.fromEntries(warehouses.map((warehouse, wi) => [warehouse.id, names.map((name, i) => ({
    id: `${warehouse.id}-p${i}`, warehouseId: warehouse.id, skuId: `sku${i}`, onHand: 50 + wi * 20 + i, available: 50 + wi * 20 + i, reserved: 0, incoming: 0, inTransfer: 0, safetyStock: 10, stockValue: 100000, status: 'AVAILABLE', updatedAt: new Date().toISOString(), warehouse,
    sku: { id: `sku${i}`, code: `SKU${i}`, barcode: '', costPrice: 10000, sellingPrice: 15000, product: { id: `p${i}`, code: `10000${i}`, name, unit: 'Hộp', imageUrl: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect x="18" y="8" width="28" height="48" rx="7" fill="#189acc"/></svg>'), category: { id: 'c1', code: 'C1', name: 'Hàng tiêu dùng' } } },
  }))]));
  const pagination = { page: 1, pageSize: 100, total: 9, totalPages: 1 };
  let receiptConfirmed = false;
  const receiptRequests = [];
  const purchaseOrder = {
    id: 'po1', code: 'PO-REVIEW-01', status: 'OPEN', totalRemaining: 8,
    supplier: { name: 'Nhà cung cấp kiểm thử' }, warehouse: warehouses[0],
    items: [0, 1].map((i) => ({ id: `line${i}`, skuId: `sku${i}`, remainingQuantity: i === 0 ? 3 : 5,
      sku: { ...inventories.w1[i].sku, product: { ...inventories.w1[i].sku.product, unit: i === 0 ? 'Hộp' : 'Chai', imageUrl: i === 0 ? inventories.w1[i].sku.product.imageUrl : null } },
    })),
  };
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const headers = { 'access-control-allow-origin': 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type,authorization', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const url = new URL(request.url());
    const resource = url.pathname.split('/api/v1/')[1];
    let data;
    if (resource === 'auth/refresh') data = { accessToken: 'test-only', user: { id: 'test', email: 'review@example.test', name: 'Kiểm tra mô hình', active: true, globalAccess: true, roles: [], permissions: ['*'], stores: branches } };
    else if (resource === 'stores') data = branches;
    else if (resource === 'warehouses') data = warehouses;
    else if (resource === 'inventory') data = { items: inventories[url.searchParams.get('warehouseId')] ?? [], pagination, summary: { totalSku: 9, available: 9, low: 0, out: 0, stockValue: 900000 } };
    else if (resource === 'purchase-orders') data = { items: url.searchParams.get('warehouseId') === 'w1' && !receiptConfirmed ? [purchaseOrder] : [], pagination: { ...pagination, total: 1 } };
    else if (resource === 'iot/access/monitor') data = { mode: 'SIMULATION', devices: [], doors: [], cards: [], events: [], alerts: [], employees: [] };
    else if (resource === 'iot/events' || resource === 'iot/inbound-parcels' || resource === 'iot/inbound-parcels/prepare-orders') data = [];
    else if (resource === 'purchase-orders/po1/receipts' && request.method() === 'POST') {
      receiptRequests.push(request.postDataJSON());
      receiptConfirmed = true;
      data = { ...purchaseOrder, totalRemaining: 0, status: 'COMPLETED' };
    }
    else data = { items: [], pagination: { ...pagination, total: 0 }, summary: { unread: 0, total: 0 } };
    if (!['GET', 'OPTIONS'].includes(request.method()) && resource !== 'auth/refresh') writes.push(`${request.method()} ${resource}`);
    await route.fulfill({ json: { success: true, data }, headers });
  });
  const output = path.join(os.tmpdir(), 'freshmart-twin-review');
  fs.mkdirSync(output, { recursive: true });
  try {
    // The 3D scene keeps animation/realtime work active, so networkidle never settles.
    await page.goto(process.env.TWIN_REVIEW_URL ?? 'http://localhost:3000/kho/mo-hinh-3d', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Mô hình kho 3D · Vận hành & An ninh', exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.live-scene canvas')).toBeVisible({ timeout: 30000 });
    const flowSelect = page.getByRole('combobox', { name: 'Luồng demo', exact: true });
    await flowSelect.selectOption('transfer');
    await expect(page.locator('.li-timeline-list li')).toHaveCount(3);
    const startButton = page.locator('.live-demo-controls button', { hasText: /Chạy demo|Chạy lại/ });
    await expect(startButton).toBeEnabled({ timeout: 20000 });
    await startButton.click();
    const setupDialog = page.getByRole('dialog', { name: 'Chuẩn bị chuyển hàng' });
    await expect(setupDialog).toBeVisible();
    await setupDialog.getByLabel('Chi nhánh · kho đích').selectOption('w3');
    await setupDialog.getByRole('button', { name: 'Bắt đầu demo', exact: true }).click();
    await expect(setupDialog).not.toBeVisible();
    await expect(page.locator('.li-timeline-list li[aria-current="step"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Tạm dừng', exact: true }).click();
    await expect(page.locator('.live-scene-status strong')).toHaveText('Tạm dừng');
    await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await expect(page.locator('.live-scene-status strong')).toHaveText('Hoàn tất luồng', { timeout: 65000 });
    await expect(page.locator('.live-demo-controls button', { hasText: 'Chạy lại' })).toBeVisible();
    await page.locator('.live-scene').screenshot({ path: path.join(output, 'transfer-complete.png') });
    await flowSelect.selectOption('inbound');
    await expect(page.locator('.li-timeline-list li')).toHaveCount(5);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
    console.log('PASS 3D live scene: transfer simulation pause/resume + dispatch/receive confirm + inbound timeline; zero DB writes');
    console.log(`Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
