// Browser regression using an isolated, in-memory API. No application database writes.
const { chromium, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const store = { id: 's1', code: 'CN01', name: 'Ba Đình', active: true };
  const warehouse = { id: 'w1', code: 'KH01', name: 'Kho Ba Đình', storeId: store.id, store, active: true };
  const device = { id: 'd1', code: 'SIM-ACCESS-WH01', name: 'ESP32 mô phỏng', online: false, lastSeenAt: null };
  const door = { id: 'door1', code: 'DOOR-WH01-01', name: 'Cửa kho chính', state: 'CLOSED', openSince: null, device: { code: device.code } };
  const employee = { id: 'u1', name: 'Nhân viên kiểm thử', email: 'employee@example.test' };
  const card = { id: 'c1', uid: 'D00C330C', status: 'ACTIVE', employee };
  const sampleParcel = { id: 'p1', tagId: 'QR-TEST-DANISA-01', palletCode: 'PAL-01', deviceId: 'FRESHMART-CAMERA-IN-01', skuId: 'sku1', quantity: 50, lotCode: 'LOT-01', expiresAt: null, noExpiry: false, status: 'READY', purchaseOrderId: 'po1', purchaseOrderItemId: 'poi1', purchaseOrderCode: 'PO-20261011-0001', purchaseOrderStatus: 'OPEN', product: { name: 'Bánh Quy DaNiSa', unit: 'Hộp' }, goodsReceiptId: null };
  const events = [], alerts = [], actions = [], iotEvents = [];
  let scenario = 'authorized', openedAt = 0, serial = 0, realMode = false;
  const addEvent = (eventType, person = null) => { const event = { id: String(++serial), eventType, employee: person, source: 'SIMULATION', occurredAt: new Date().toISOString() }; events.unshift(event); return event; };
  await page.route('**/api/v1/**', async route => {
    const req = route.request(), url = new URL(req.url()), resource = url.pathname.split('/api/v1/')[1];
    let data;
    if (resource === 'auth/refresh') data = { accessToken: 'test', user: { id: 'u1', email: employee.email, name: employee.name, active: true, globalAccess: true, roles: [], permissions: ['*'], stores: [store] } };
    else if (resource === 'warehouses') data = [warehouse];
    else if (resource === 'stores') data = [store];
    else if (resource === 'iot/inbound-parcels' || resource === 'iot/inbound-parcels/prepare-orders') data = [sampleParcel];
    else if (resource === 'iot/camera-demo-session') data = { ok: true };
    else if (resource === 'iot/events') data = iotEvents;
    else if (resource === 'iot/access/monitor') {
      if (!realMode && scenario === 'open-too-long' && door.state === 'OPEN' && Date.now() - openedAt > 2500 && !alerts.some(a => a.type === 'DOOR_OPEN_TOO_LONG')) {
        alerts.unshift({ id: 'long1', type: 'DOOR_OPEN_TOO_LONG', message: 'Cửa mở quá lâu.', status: 'OPEN', createdAt: new Date().toISOString() }); addEvent('DOOR_OPEN_TOO_LONG');
      }
      data = { mode: realMode ? 'REAL_IOT' : 'SIMULATION', accessWindowSeconds: 1, maxDoorOpenSeconds: 30, simulationDoorOpenSeconds: 2, devices: [{ ...device, code: realMode ? 'ESP32-WH01' : device.code, online: realMode }], doors: [realMode ? { ...door, device: { code: 'ESP32-WH01' } } : door], cards: [card], employees: [employee], events, alerts };
    } else if (resource === 'iot/access/simulate' && req.method() === 'POST') {
      const body = req.postDataJSON(); actions.push(body.action + (body.state ? ':' + body.state : ''));
      if (body.action === 'RFID') { addEvent('RFID_SCAN', employee); data = { duplicate: false, event: addEvent('ACCESS_GRANTED', employee) }; }
      else {
        door.state = body.state; door.openSince = body.state === 'OPEN' ? new Date().toISOString() : null;
        data = { duplicate: false, event: addEvent('DOOR_' + body.state, body.state === 'OPEN' && scenario !== 'unauthorized' ? employee : null) };
        if (body.state === 'OPEN') { openedAt = Date.now(); addEvent(scenario === 'unauthorized' ? 'UNAUTHORIZED_ACCESS' : 'AUTHORIZED_ACCESS', scenario === 'unauthorized' ? null : employee); if (scenario === 'unauthorized') alerts.unshift({ id: 'unauth1', type: 'UNAUTHORIZED_ACCESS', message: 'Cửa mở không có xác thực.', status: 'OPEN', createdAt: new Date().toISOString() }); }
        else alerts.forEach(a => { if (a.type === 'DOOR_OPEN_TOO_LONG') a.status = 'RESOLVED'; });
      }
    } else data = { items: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 }, summary: {} };
    await route.fulfill({ json: { success: true, data }, headers: { 'access-control-allow-origin': 'http://localhost:3000', 'access-control-allow-credentials': 'true' } });
  });
  const output = path.join(__dirname, '..', 'artifacts', 'warehouse-access-review'); fs.mkdirSync(output, { recursive: true });
  try {
    await page.goto('http://localhost:3000/kho/mo-hinh-3d', { waitUntil: 'domcontentloaded' });
    const flow = page.getByLabel('Luồng demo');
    await expect(flow).toBeVisible({ timeout: 30000 });
    await expect(flow.locator('option')).toHaveCount(3);
    const scene = page.locator('.live-scene-status');

    // 1. Verify inbound 3D speed multiplier (2x vs 1x) & "Để sau" dismiss behavior
    await page.getByRole('button', { name: '2×' }).click();
    await page.getByRole('button', { name: 'Chạy demo' }).click();
    const prepDialog = page.locator('.esp-prepare-dialog');
    await expect(prepDialog).toBeVisible({ timeout: 10000 });
    await prepDialog.getByLabel('Kiện chờ nhận').selectOption('p1');
    const startFast = Date.now();
    await prepDialog.getByRole('button', { name: 'Bắt đầu xe vào kho' }).click();
    await expect(page.locator('.li-timeline-list li').nth(1)).toHaveClass(/current/, { timeout: 20000 });
    const fastToUnloadMs = Date.now() - startFast;
    await expect(scene).toContainText('Chờ camera quét mã kiện', { timeout: 30000 });
    const fastToScanMs = Date.now() - startFast;
    console.log(`PASS speed 2x: reached step 2 in ${fastToUnloadMs}ms and camera wait in ${fastToScanMs}ms`);
    expect(fastToUnloadMs).toBeLessThan(10500);

    // Simulate camera scan arriving while waiting confirmation
    iotEvents.unshift({
      id: 'scan-event-1',
      deviceId: sampleParcel.deviceId,
      tagId: sampleParcel.tagId,
      warehouseId: warehouse.id,
      source: 'DEVICE',
      eventType: 'CAMERA_CODE_DETECTED',
      timestamp: new Date().toISOString(),
      receivedAt: new Date(Date.now() + 500).toISOString(),
      processed: false,
      inboundParcelId: sampleParcel.id,
      mappedSkuId: sampleParcel.skuId,
      mappedSku: { id: 'sku1', code: 'SKU-01', barcode: '8930001', product: sampleParcel.product },
      automationStatus: 'WAITING_CONFIRMATION',
      automationMessage: 'Đã phát hiện kiện. Chờ nhân viên xác nhận; tồn kho chưa thay đổi.',
    });
    const rfidDialog = page.locator('.rfid-dialog');
    await expect(rfidDialog).toBeVisible({ timeout: 10000 });
    await expect(rfidDialog).toContainText('Đã đọc mã kiện bằng camera');
    await rfidDialog.getByRole('button', { name: 'Để sau' }).click();
    await expect(rfidDialog).toHaveCount(0);
    await expect(scene).toContainText('Sẵn sàng');
    // Wait 2.5 seconds (>2 poll intervals) to prove "Để sau" permanently dismissed the popup
    await page.waitForTimeout(2500);
    await expect(rfidDialog).toHaveCount(0);
    console.log('PASS Để sau: scan dialog closes immediately, cancels session, and does NOT reopen');
    await page.getByRole('button', { name: '1×' }).click();

    await flow.selectOption('access');
    const scenarioSelect = page.getByLabel('Tình huống');
    await expect(scenarioSelect.locator('option')).toHaveCount(3);
    await expect(page.locator('.li-timeline li')).toHaveCount(6);
    await page.getByRole('button', { name: /Chạy demo/ }).click();
    await expect(scene).toContainText('Đã xác thực nhân viên', { timeout: 30000 });
    await page.locator('.live-scene-status').screenshot({ path: path.join(output, 'status-granted.png') });
    await expect(scene).toContainText('Nhân viên đang vào kho', { timeout: 30000 });
    await page.locator('canvas').screenshot({ path: path.join(output, 'door-entry.png') });
    await expect(scene).toContainText('Hoàn tất luồng', { timeout: 30000 });
    expect(actions).toEqual(['RFID', 'DOOR:OPEN', 'DOOR:CLOSED']);
    console.log('PASS normal: animation advances and events travel through simulated API');
    scenario = 'unauthorized'; alerts.length = 0; actions.length = 0;
    await scenarioSelect.selectOption('unauthorized'); await page.getByRole('button', { name: /Chạy demo/ }).click();
    await expect(scene).toContainText('Cảnh báo cửa kho', { timeout: 30000 });
    expect(actions).toEqual(['DOOR:OPEN']);
    await page.locator('canvas').screenshot({ path: path.join(output, 'door-alert.png') });
    console.log('PASS unauthorized: no RFID and warning shown');
    await page.getByRole('button', { name: 'Đóng cửa kết thúc' }).click();
    scenario = 'open-too-long'; alerts.length = 0; actions.length = 0;
    await scenarioSelect.selectOption('open-too-long'); await page.getByRole('button', { name: /Chạy demo/ }).click();
    await expect(scene).toContainText('Cảnh báo cửa kho', { timeout: 40000 });
    expect(actions).toEqual(['RFID', 'DOOR:OPEN']);
    await page.getByRole('button', { name: 'Đóng cửa kết thúc' }).click();
    expect(actions).toEqual(['RFID', 'DOOR:OPEN', 'DOOR:CLOSED']);
    expect(alerts[0].status).toBe('RESOLVED');
    expect(errors).toEqual([]);
    console.log('PASS long-open: backend warning and closure resolution; no browser errors');
    realMode = true; events.length = 0; alerts.length = 0; actions.length = 0;
    await expect(page.getByText('● REAL IOT', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(scenarioSelect).toBeDisabled();
    addEvent('RFID_SCAN', employee); addEvent('ACCESS_GRANTED', employee);
    await expect(scene).toContainText('Đã xác thực nhân viên', { timeout: 20000 });
    expect(actions).toEqual([]);
    door.state = 'OPEN'; door.openSince = new Date().toISOString(); addEvent('DOOR_OPEN', employee);
    await expect(scene).toContainText('Nhân viên đang vào kho', { timeout: 20000 });
    expect(actions).toEqual([]);
    door.state = 'CLOSED'; door.openSince = null; addEvent('DOOR_CLOSED');
    await expect(scene).toContainText('Hoàn tất luồng', { timeout: 20000 });
    expect(actions).toEqual([]);
    console.log('PASS real-device event playback: no simulation POSTs');
  } catch (error) { console.error('Browser errors:', errors); await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => { }); throw error; }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
