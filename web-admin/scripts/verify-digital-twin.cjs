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
    const url = new URL(request.url());
    const resource = url.pathname.split('/api/v1/')[1];
    let data;
    if (resource === 'auth/refresh') data = { accessToken: 'test-only', user: { id: 'test', email: 'review@example.test', name: 'Kiểm tra mô hình', active: true, globalAccess: true, roles: [], permissions: ['*'], stores: branches } };
    else if (resource === 'stores') data = branches;
    else if (resource === 'warehouses') data = warehouses;
    else if (resource === 'inventory') data = { items: inventories[url.searchParams.get('warehouseId')] ?? [], pagination, summary: { totalSku: 9, available: 9, low: 0, out: 0, stockValue: 900000 } };
    else if (resource === 'purchase-orders') data = { items: url.searchParams.get('warehouseId') === 'w1' && !receiptConfirmed ? [purchaseOrder] : [], pagination: { ...pagination, total: 1 } };
    else if (resource === 'purchase-orders/po1/receipts' && request.method() === 'POST') {
      receiptRequests.push(request.postDataJSON());
      receiptConfirmed = true;
      data = { ...purchaseOrder, totalRemaining: 0, status: 'COMPLETED' };
    }
    else data = { items: [], pagination: { ...pagination, total: 0 }, summary: { unread: 0, total: 0 } };
    if (!['GET', 'OPTIONS'].includes(request.method()) && resource !== 'auth/refresh') writes.push(`${request.method()} ${resource}`);
    await route.fulfill({ json: { success: true, data }, headers: { 'access-control-allow-origin': 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type,authorization', 'access-control-allow-methods': 'GET,POST,OPTIONS' } });
  });
  const output = path.join(os.tmpdir(), 'freshmart-twin-review');
  fs.mkdirSync(output, { recursive: true });
  try {
    await page.goto(process.env.TWIN_REVIEW_URL ?? 'http://localhost:3000/kho/mo-hinh-3d', { waitUntil: 'networkidle' });
    const start = page.locator('.twin-stage-demo-controls .primary-button');
    await expect(start).toBeEnabled({ timeout: 30000 });
    const progress = page.getByRole('complementary', { name: 'Tiến trình demo' });
    await expect(progress).toBeVisible();
    await expect(progress.locator('li')).toHaveCount(0);
    const progressBounds = await progress.boundingBox();
    const sceneBounds = await page.locator('.twin-scene-stage').boundingBox();
    expect(Math.abs(progressBounds.x - sceneBounds.x - 16)).toBeLessThan(3);
    expect(Math.abs(progressBounds.y - sceneBounds.y - 16)).toBeLessThan(3);
    await page.locator('.twin-scene-stage').scrollIntoViewIfNeeded();
    await page.waitForTimeout(2500);
    await page.locator('.twin-scene-stage').screenshot({ path: path.join(output, 'overview.png') });
    if (!process.argv.includes('--receipt-only')) {
    const sourceName = await page.locator('.twin-overview-title strong').innerText();
    await page.locator('label').filter({ hasText: 'KHO ĐÍCH' }).locator('select').selectOption('w3');
    await expect(page.locator('.twin-overview-title strong')).toHaveText(sourceName);
    await start.click();
    await expect(progress.locator('li[aria-current="step"]')).toHaveCount(1);
    await expect(progress.locator('li')).toHaveCount(1);
    await page.waitForTimeout(5500);
    expect(await progress.locator('li').count()).toBeGreaterThan(1);
    await expect(progress.locator('li[aria-current="step"]')).toHaveCount(1);
    await page.locator('.twin-scene-stage').screenshot({ path: path.join(output, 'forklift.png') });
    if (process.argv.includes('--snapshot-only')) {
      console.log(`Screenshots: ${output}`);
      return;
    }
    await page.getByRole('button', { name: 'Tạm dừng', exact: true }).click();
    const pausedStep = await page.locator('.twin-overview-title small').innerText();
    await page.waitForTimeout(800);
    await expect(page.locator('.twin-overview-title small')).toHaveText(pausedStep);
    await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await expect(start).toContainText('Chạy lại demo', { timeout: 65000 });
    await expect(progress.locator('li.done')).toHaveCount(6);
    await expect(page.locator('.twin-overview-title strong')).toHaveText(sourceName);
    await page.locator('.twin-scene-stage').screenshot({ path: path.join(output, 'transfer-complete.png') });
    const transferResult = page.getByRole('dialog', { name: 'Chuyển hàng hoàn tất' });
    await expect(transferResult).toBeVisible();
    await expect(transferResult).toContainText('Chi nhánh Hải Châu');
    await expect(transferResult.locator('.twin-result-items li')).toHaveCount(1);
    await expect(transferResult.locator('.twin-result-quantity')).toHaveText('1 Hộp');
    await expect(transferResult.locator('img')).toHaveAttribute('alt', names[0]);
    await expect(transferResult).toContainText('Không ghi giao dịch');
    await transferResult.screenshot({ path: path.join(output, 'transfer-result.png') });
    await transferResult.getByRole('button', { name: 'Đã hiểu', exact: true }).click();
    await expect(transferResult).not.toBeVisible();
    console.log('PASS transfer to third warehouse; source identity unchanged; pause/resume');
    await page.locator('.twin-scene-controls select').first().selectOption('inbound');
    await page.locator('label').filter({ hasText: 'NGUỒN NHẬP' }).locator('select').selectOption('visual');
    await start.click();
    const stepStatus = page.locator('.twin-overview-title small');
    await expect(stepStatus).toContainText('bửng nâng', { timeout: 20000 });
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Tạm dừng', exact: true }).click();
    await page.locator('.twin-scene-stage').screenshot({ path: path.join(output, 'truck-unloading.png') });
    await expect(stepStatus).toContainText('bửng nâng');
    await page.waitForTimeout(500);
    await expect(stepStatus).toContainText('bửng nâng');
    await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await expect(stepStatus).toContainText('tiếp cận dock', { timeout: 10000 });
    await page.waitForTimeout(1800);
    await page.locator('.twin-scene-stage').screenshot({ path: path.join(output, 'forklift-collecting.png') });
    await expect(start).toContainText('Chạy lại demo', { timeout: 65000 });
    await page.locator('.twin-scene-stage').screenshot({ path: path.join(output, 'inbound-complete.png') });
    const inboundResult = page.getByRole('dialog', { name: 'Nhập hàng hoàn tất' });
    await expect(inboundResult).toBeVisible();
    await expect(inboundResult.locator('.twin-result-items li')).toHaveCount(1);
    await expect(inboundResult.locator('.twin-result-quantity')).toHaveText('1 Hộp');
    await inboundResult.screenshot({ path: path.join(output, 'inbound-result.png') });
    await page.keyboard.press('Escape');
    await expect(inboundResult).not.toBeVisible();
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
    console.log('PASS inbound workflow; zero database writes; zero browser runtime errors');
    }
    await page.locator('.twin-scene-controls select').first().selectOption('inbound');
    const inboundResult = page.getByRole('dialog', { name: 'Nhập hàng hoàn tất' });
    await page.locator('label').filter({ hasText: 'NGUỒN NHẬP' }).locator('select').selectOption('po1');
    await start.click();
    await page.getByRole('button', { name: 'Xác nhận nhận hàng', exact: true }).click({ timeout: 65000 });
    await expect(inboundResult).toBeVisible({ timeout: 20000 });
    await expect(inboundResult.locator('.twin-result-items li')).toHaveCount(2);
    await expect(inboundResult.locator('.twin-result-quantity')).toHaveText(['3 Hộp', '5 Chai']);
    await expect(inboundResult).toContainText('PO-REVIEW-01');
    await expect(inboundResult).toContainText('Đã xác nhận nghiệp vụ');
    await expect(inboundResult.locator('.twin-result-image')).toHaveCount(2);
    await expect(inboundResult).toContainText('Chưa có ảnh');
    expect(receiptRequests[0].items).toEqual([{ purchaseOrderItemId: 'line0', quantity: 3 }, { purchaseOrderItemId: 'line1', quantity: 5 }]);
    expect(writes).toEqual(['POST purchase-orders/po1/receipts']);
    expect(errors).toEqual([]);
    await inboundResult.screenshot({ path: path.join(output, 'multi-product-result.png') });
    console.log('PASS mocked purchase receipt: two products, exact quantities, unit totals and missing-image fallback; no real backend accessed');
    console.log(`Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
