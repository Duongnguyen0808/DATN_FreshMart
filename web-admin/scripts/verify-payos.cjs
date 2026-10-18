// All backend traffic is mocked. This script never calls payOS or creates real payments.
const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const uuid = '11111111-1111-4111-8111-111111111111';
  const store = { id: uuid, code: 'CN01', name: 'Chi nhánh Ba Đình', active: true };
  const warehouse = { id: uuid, code: 'KH01', name: 'Kho Ba Đình', storeId: uuid, active: true, store };
  const user = { id: uuid, email: 'review@example.test', name: 'Thu ngân kiểm thử', active: true, globalAccess: true, permissions: ['*'], roles: [], stores: [store] };
  const shift = { id: uuid, code: 'SHIFT01', storeId: uuid, cashierId: uuid, status: 'OPEN', posCode: 'POS01', cashier: user, store };
  const stock = { id: uuid, skuId: uuid, warehouseId: uuid, onHand: 20, available: 20, reserved: 0, warehouse, sku: { id: uuid, code: 'SKU01', sellingPrice: 20000, product: { id: uuid, code: 'SP01', name: 'Sữa tươi', unit: 'Hộp', imageUrl: null } } };
  const pagination = { total: 1, totalPages: 1, page: 1, pageSize: 20 };
  const requests = [];
  let row = null;
  let enabled = true;
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const resource = new URL(request.url()).pathname.split('/api/v1/')[1];
    let data;
    if (resource === 'auth/refresh') data = { accessToken: 'test-only', user };
    else if (resource === 'payos/config') data = { enabled };
    else if (resource === 'stores') data = [store];
    else if (resource === 'warehouses') data = [warehouse];
    else if (resource === 'shifts') data = { items: [shift], pagination };
    else if (resource === 'inventory') data = { items: [stock], pagination };
    else if (resource === 'forecasts/shortages') data = { items: Array.from({ length: 4 }, (_, i) => ({ skuId: `${uuid}-${i}`, productCode: `SP0${i}`, productName: 'Sản phẩm kiểm tra tên dài và cảnh báo thiếu hàng', severity: 'HIGH', unit: 'Hộp', observedQuantity: 20, predictedQuantity: 32, available: 3, safetyStock: 32, inTransfer: 0, incomingPurchase: 0, shortageQuantity: 29 })), summary: {} };
    else if (resource === 'payos/checkouts' && request.method() === 'POST') {
      const input = request.postDataJSON(); requests.push(input);
      if (!row || row.id !== input.checkoutId) row = { id: input.checkoutId, orderCode: '10', amount: 20000, status: 'PENDING', checkoutUrl: 'https://pay.payos.vn/web/mock', qrCode: 'mock-qr-payload', accountName: 'FRESHMART', accountNumber: '123456789', description: 'FM10', expiresAt: new Date(Date.now() + 900000).toISOString(), invoiceId: null };
      data = row;
    } else if (resource.endsWith('/cancel') && resource.startsWith('payos/checkouts/')) data = row = { ...row, status: 'CANCELLED' };
    else if (resource.startsWith('payos/checkouts/')) data = row;
    else {
      expect(resource === 'invoices' && request.method() === 'POST').toBe(false);
      data = { items: [], run: null, pagination, summary: { total: 0, unread: 0 } };
    }
    await route.fulfill({ json: { success: true, data } });
  });
  const output = path.join(os.tmpdir(), 'freshmart-payos-review'); fs.mkdirSync(output, { recursive: true });
  async function checkout() {
    await page.goto('http://localhost:3000/hoa-don/tao', { waitUntil: 'networkidle' });
    await page.getByLabel(/Ca đang mở/).selectOption(uuid);
    await page.getByRole('button', { name: 'Thêm', exact: true }).click();
    await expect(page.locator('.sale-ai-shortage')).toHaveCount(4);
    for (const width of [1440, 1280, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const bounds = await page.locator('.sale-layout').evaluate(element => {
        const rect = element.getBoundingClientRect();
        const checkout = document.querySelector('.sale-checkout').getBoundingClientRect();
        return { right: rect.right, checkoutRight: checkout.right, viewport: innerWidth, scroll: element.scrollWidth, client: element.clientWidth };
      });
      expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
      expect(bounds.checkoutRight).toBeLessThanOrEqual(bounds.viewport);
      expect(bounds.scroll).toBeLessThanOrEqual(bounds.client + 1);
      await page.screenshot({ path: path.join(output, `sale-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'QR thanh toán', exact: true }).click();
    await page.getByRole('button', { name: 'Tiếp tục thanh toán', exact: true }).click();
    await expect(page.locator('.payos-qr svg')).toBeVisible({ timeout: 20000 });
  }
  try {
    await checkout();
    expect(requests[0].items).toEqual([{ skuId: uuid, quantity: 1 }]);
    expect(requests[0].amount).toBeUndefined(); expect(requests[0].payments).toBeUndefined();
    await page.locator('.payos-card').screenshot({ path: path.join(output, 'qr.png') });
    await page.goto(`http://localhost:3000/thanh-toan/payos?checkoutId=${row.id}&status=PAID`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'QR thanh toán' })).toBeVisible();
    row.status = 'PAID'; row.invoiceId = 'verified-invoice';
    await page.getByRole('button', { name: 'Kiểm tra lại', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Thanh toán thành công' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Xem hóa đơn' })).toHaveAttribute('href', '/hoa-don/verified-invoice');
    await page.locator('.payos-card').screenshot({ path: path.join(output, 'paid.png') });
    await checkout();
    await page.getByRole('button', { name: 'Hủy thanh toán', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Đã hủy thanh toán' })).toBeVisible();
    await expect(page.locator('.payos-card')).toContainText('chưa tạo hóa đơn');
    enabled = false;
    await page.goto('http://localhost:3000/hoa-don/tao', { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'QR thanh toán', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
    console.log('PASS QR checkout, server amount, reload, untrusted redirect status, verified payment, cancellation and disabled configuration; no real payments');
    console.log(`Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
