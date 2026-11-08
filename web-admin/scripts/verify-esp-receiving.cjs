// ESP event fixtures + UI; all backend traffic intercepted, no hardware or database writes.
const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const base = process.env.REVIEW_BASE_URL || 'http://localhost:3000';
  const output = path.resolve('artifacts/camera-review'); fs.mkdirSync(output, { recursive: true });
  const store = { id: 'store-review', name: 'Chi nhánh thử', active: true };
  const warehouse = { id: 'warehouse-review', code: 'KHO001', name: 'Kho thử', store, storeId: store.id, active: true };
  const product = { id: 'product-review', name: 'Coca-Cola', unit: 'Lon', code: 'COCA', imageUrl: null, skus: [{ id: 'sku-review', code: 'COCA', barcode: '8931234567890' }] };
  const stock = { id: 'stock-review', warehouseId: warehouse.id, warehouse, skuId: 'sku-review', onHand: 0, available: 0, sku: { ...product.skus[0], product } };
  const fixtures = require('./retail-review-fixtures.cjs')({ store, warehouse, product, stock });
  let parcel = null, scanned = null, received = false, scanPosts = 0, confirmPosts = 0;
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    // Permission-denied fallback must work without access to a developer's physical camera.
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (!window.__allowTestCamera) throw new DOMException('Denied for test', 'NotAllowedError');
      const media = await original(constraints);
      window.__testCameraTracks = media.getTracks();
      return media;
    };
  });
  await page.route('**/api/v1/**', async route => {
    const headers = { 'access-control-allow-origin': base, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const resource = new URL(route.request().url()).pathname.split('/api/v1/')[1];
    let data = fixtures(resource);
    if (resource === 'auth/refresh') data = { accessToken: 'test-only', user: { id: 'review', name: 'Tester', active: true, globalAccess: true, permissions: ['*', 'inventory.read', 'purchase_orders.read', 'purchase_orders.receive'], stores: [store], roles: [] } };
    else if (resource === 'warehouses') data = [warehouse];
    else if (resource === 'purchase-orders') data = { items: [fixtures('purchase-orders/review')], pagination: { totalPages: 1 } };
    else if (resource === 'inventory') data = { items: [stock], pagination: { totalPages: 1 }, summary: {} };
    else if (resource === 'iot/inbound-parcels' || resource === 'iot/inbound-parcels/prepare-orders') {
      if (!parcel) {
        parcel = { id: 'parcel-review', tagId: 'QR-REVIEW-0001', deviceId: 'FRESHMART-CAMERA-IN-01', quantity: 24, status: 'READY', warehouseId: warehouse.id, purchaseOrderId: 'review', purchaseOrderCode: 'DH-TEST', purchaseOrderStatus: 'OPEN', expiresAt: null, noExpiry: false, product, goodsReceiptId: null };
      }
      data = [parcel];
    } else if (resource === 'iot/camera-demo-session') {
      data = { active: true, parcelId: parcel?.id ?? 'parcel-review' };
    } else if (resource === 'purchase-orders/forecast-replenishment') {
      data = { forecastRunId: null, horizonDays: 7, storeName: store.name, suppliers: [], items: [] };
    } else if (resource === 'iot/camera-device-status') {
      data = { lastCameraIp: null, hostWifi: null, usbPorts: [], preferredPort: null };
    } else if (resource === 'iot/access/monitor') {
      data = { mode: 'SIMULATION', accessWindowSeconds: 1, maxDoorOpenSeconds: 30, simulationDoorOpenSeconds: 2, devices: [], doors: [], cards: [], employees: [], events: [], alerts: [] };
    } else if (resource === 'iot/events') data = scanned ? [scanned] : [];
    else if (resource === 'iot/camera-scans') {
      const body = route.request().postDataJSON();
      expect(body.code).toBe(parcel.tagId); expect(body.capture).toBe('IMAGE');
      scanPosts++;
      scanned = { id: `event-${scanPosts}`, eventId: body.eventId, tagId: body.code, deviceId: 'FRESHMART-CAMERA-WEB', eventType: 'CAMERA_CODE_DETECTED', source: 'DEVICE', warehouseId: warehouse.id, timestamp: new Date().toISOString(), receivedAt: new Date().toISOString(), processed: received, automationStatus: received ? 'ALREADY_RECEIVED' : 'WAITING_CONFIRMATION', automationMessage: received ? 'Kiện đã nhận; không cộng tồn lần nữa.' : 'Đã đọc kiện; chờ xác nhận.', inboundParcelId: parcel.id, mappedSkuId: 'sku-review', mappedSku: { ...product.skus[0], product }, goodsReceiptId: received ? 'receipt-review' : null, payload: {} };
      data = { event: scanned };
    } else if (resource.startsWith('iot/events/') && resource.endsWith('/confirm')) {
      confirmPosts++; received = true; parcel.status = 'RECEIVED'; parcel.goodsReceiptId = 'receipt-review'; stock.onHand = parcel.quantity;
      scanned = { ...scanned, processed: true, automationStatus: 'RECEIVED', goodsReceiptId: 'receipt-review', automationMessage: 'Đã nhập kho' }; data = scanned;
    }
    await route.fulfill({ json: { success: true, data }, headers });
  });
  try {
    await page.goto(`${base}/kho/mo-hinh-3d/camera`);
    await page.getByRole('button', { name: 'Xem mã QR' }).click();
    await expect(page.locator('.camera-parcel-label svg')).toBeVisible();
    expect(parcel.deviceId).toBe('FRESHMART-CAMERA-IN-01');
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(output, `esp-${width}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${base}/kho/mo-hinh-3d`);
    await expect(page.getByRole('button', { name: 'Mở camera quét kiện' })).toHaveCount(0);
    await page.getByRole('button', { name: '2×' }).click();
    await page.getByRole('button', { name: 'Chạy demo', exact: false }).click();
    await page.getByLabel('Kiện chờ nhận').selectOption('parcel-review');
    await page.getByRole('button', { name: 'Bắt đầu xe vào kho' }).click();
    await expect(page.locator('.esp-station.is-waiting')).toBeVisible({ timeout: 60000 });
    await page.locator('canvas').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'esp-scene-waiting.png'), fullPage: true });
    const event = { id: 'esp-event', eventId: 'esp-1', tagId: parcel.tagId, deviceId: parcel.deviceId, eventType: 'CAMERA_CODE_DETECTED', source: 'DEVICE', warehouseId: warehouse.id, timestamp: new Date().toISOString(), receivedAt: new Date().toISOString(), automationStatus: 'WAITING_CONFIRMATION', inboundParcelId: parcel.id, mappedSkuId: 'sku-review', mappedSku: { ...product.skus[0], product }, payload: {} };
    scanned = { ...event, deviceId: 'FRESHMART-CAMERA-WEB' };
    await page.waitForTimeout(3000);
    await expect(page.locator('.rfid-dialog')).toHaveCount(0);
    scanned = { ...event, tagId: 'QR-WRONG-PARCEL' };
    await page.waitForTimeout(3000);
    await expect(page.locator('.rfid-dialog')).toHaveCount(0);
    scanned = event;
    await expect(page.locator('.rfid-dialog')).toBeVisible({ timeout: 10000 });
    await page.locator('.rfid-dialog').getByLabel('Sản phẩm không có hạn sử dụng').check();
    await page.getByRole('button', { name: 'Xác nhận nhập kho', exact: true }).click();
    await expect(page.locator('.rfid-dialog.is-processed')).toContainText('Đã lưu phiếu nhập và cập nhật tồn kho.');
    await page.screenshot({ path: path.join(output, 'esp-processed-dialog.png') });
    await page.getByRole('button', { name: 'Đóng', exact: true }).click();
    await expect(page.locator('.li-timeline-heading')).toContainText('Hoàn tất 5/5 bước', { timeout: 30000 });
    expect(stock.onHand).toBe(24);
    expect(parcel.status).toBe('RECEIVED');
    await page.locator('canvas').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'esp-scene-complete.png'), fullPage: true });
    scanned = { ...scanned, id: 'esp-repeat', eventId: 'esp-repeat', automationStatus: 'ALREADY_RECEIVED' };
    await page.waitForTimeout(3000);
    await expect(page.locator('.rfid-dialog')).toHaveCount(0);
    await expect(page.locator('.li-timeline-heading')).toContainText('Hoàn tất 5/5 bước');
    expect(confirmPosts).toBe(1); expect(scanPosts).toBe(0); expect(errors).toEqual([]);
    console.log('PASS ESP: QR registration -> wrong device/code rejected -> confirmation -> storage animation -> 5/5 complete; one confirmation, 24 units, no webcam requests. Browser uses mocked API; PostgreSQL is tested separately.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
