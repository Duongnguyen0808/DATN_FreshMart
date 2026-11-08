// Visual smoke check: intercept all backend requests; never alter business data.
const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const output = path.resolve(__dirname, '../artifacts/retail-ui');
  fs.mkdirSync(output, { recursive: true });
  const baseUrl = process.env.REVIEW_BASE_URL || 'http://localhost:3000';
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const store = { id: 'store-review', code: 'CN001', name: 'Chi nhánh Ba Đình', active: true };
  const warehouse = { id: 'warehouse-review', code: 'KHO001', name: 'Kho Ba Đình', store, storeId: store.id, active: true };
  const category = { id: 'category-review', code: 'DO_UONG_SUA', name: 'Sữa', active: true };
  const categories = [category, ...[
    ['GIA_VI_THUC_PHAM', 'Gia vị & Thực phẩm'], ['BANH_KEO_DO_KHO', 'Bánh kẹo & Đồ khô'],
    ['TRA_CA_PHE', 'Trà & Cà phê'], ['MI_AN_LIEN', 'Mì & Thực phẩm ăn liền'],
    ['THUC_PHAM_DONG_LANH', 'Thực phẩm đông lạnh'], ['GIA_DUNG', 'Gia dụng'], ['CHAM_SOC_CA_NHAN', 'Chăm sóc cá nhân'],
  ].map(([code, name]) => ({ id: code, code, name, active: true }))];
  const product = { id: 'product-review', code: '100008', name: 'Sữa tươi hộp 1L', unit: 'Hộp', category, categoryId: category.id, active: true, imageUrl: '/products/prd-demo-008.png', createdAt: '2026-10-27T00:00:00Z', skus: [{ id: 'sku-review', code: '100008', barcode: '893000000008', costPrice: 12000, sellingPrice: 18000, active: true, inventories: [] }] };
  const stock = { id: 'stock-review', warehouseId: warehouse.id, warehouse, skuId: 'sku-review', onHand: 24, available: 24, reserved: 0, inTransfer: 0, incoming: 0, safetyStock: 5, stockValue: 288000, status: 'AVAILABLE', sku: { ...product.skus[0], product } };
  const pagination = { page: 1, pageSize: 20, total: 0, totalPages: 1 };
  const fixture = require('./retail-review-fixtures.cjs')({ store, warehouse, product, stock });
  let accessDoorOpen = false;
  let accessAlert = false;
  await page.route('**/api/v1/**', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': baseUrl, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' } });
    const resource = new URL(route.request().url()).pathname.split('/api/v1/')[1];
    let data = fixture(resource);
    if (resource === 'forecasts/experiment') data = {
      html: fs.readFileSync(path.resolve(__dirname, '../../ai-service/data/output/experiment_report.html'), 'utf8'),
      summary: JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../ai-service/data/output/experiment_summary.json'), 'utf8')),
    };
    if (resource === 'auth/refresh') data = { accessToken: 'visual-test-only', user: { id: 'review', name: 'Quản trị viên', email: 'review@example.test', globalAccess: true, active: true, permissions: ['*', 'inventory.read', 'products.read', 'products.manage', 'purchase_orders.read', 'purchase_orders.receive', 'transfers.read', 'transfers.create', 'users.manage', 'roles.manage', 'stocktakes.create', 'suppliers.manage', 'customers.manage'], roles: [], stores: [store] } };
    else if (resource === 'warehouses') data = [warehouse];
    else if (resource === 'stores') data = [store];
    else if (resource === 'categories') data = categories;
    else if (resource === 'payos/config') data = { enabled: false };
    else if (resource === 'shifts') data = { items: [{ id: 'shift-review', code: 'CA-001', storeId: store.id, store, cashierId: 'review', cashier: { id: 'review', name: 'Quản trị viên' }, status: 'OPEN', posCode: 'POS-01' }], pagination, summary: { total: 1, open: 1, pendingReview: 0, closed: 0 } };
    else if (resource === 'inventory') data = { items: [stock], pagination: { ...pagination, total: 1 }, summary: { totalSku: 1, available: 1, low: 0, out: 0, stockValue: 288000 } };
    else if (resource === 'products') data = { items: [product], pagination: { ...pagination, total: 1 }, summary: { total: 1, active: 1, inactive: 0 } };
    else if (resource === 'dashboard') data = {
      period: 30, from: '2026-09-28', to: '2026-10-27',
      summary: { revenue: 476000, costOfGoods: 371000, grossProfit: 105000, grossMargin: 22.1, invoiceCount: 3, stockValue: 558700000, lowStock: 35, outstandingDebt: 7027500, overdueDebt: 7027500, overdueCount: 3, outstandingReceivables: 70000, overdueReceivables: 70000, overdueReceivableCount: 1, pendingTransfers: 3 },
      revenueSeries: Array.from({ length: 30 }, (_, index) => ({ date: new Date(Date.UTC(2026, 8, 28 + index)).toISOString().slice(0,10), revenue: index === 7 ? 350000 : index === 13 ? 120000 : index === 18 ? 6000 : 0, invoices: [7,13,18].includes(index) ? 1 : 0 })),
      branches: [{ ...store, revenue: 476000, invoiceCount: 3 }], topProducts: [{ productCode: product.code, productName: product.name, imageUrl: null, unit: 'Chai', quantity: 12, revenue: 216000 }],
    };
    else if (resource === 'iot/events' || resource === 'iot/inbound-parcels') data = [];
    else if (resource === 'iot/access/monitor') data = { mode: 'SIMULATION', devices: [{ id: 'device-review', code: 'SIM-ACCESS-WH01', name: 'ESP32 cửa kho', lastSeenAt: null, online: false }], doors: [{ id: 'door-review', code: 'DOOR-WH01-01', name: 'Cửa kho chính', state: accessDoorOpen ? 'OPEN' : 'CLOSED', lastStateChangedAt: null, openSince: accessDoorOpen ? new Date().toISOString() : null, device: { code: 'SIM-ACCESS-WH01' } }], cards: [], events: accessDoorOpen ? [{ id: 'door-open-review', eventType: 'DOOR_OPEN', occurredAt: new Date().toISOString(), source: 'SIMULATION', door: { name: 'Cửa kho chính' } }] : [], alerts: accessAlert ? [{ id: 'alert-review', type: 'UNAUTHORIZED_ACCESS', message: 'Mở cửa không có thẻ hợp lệ.', status: 'OPEN', createdAt: new Date().toISOString() }] : [], employees: [{ id: 'review', name: 'Quản trị viên', email: 'review@example.test' }] };
    else if (resource === 'iot/access/simulate' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      if (body.action === 'DOOR') { accessDoorOpen = body.state === 'OPEN'; accessAlert = accessDoorOpen; }
      data = { duplicate: false, event: { eventType: body.action === 'DOOR' ? accessDoorOpen ? 'DOOR_OPEN' : 'DOOR_CLOSED' : 'ACCESS_DENIED' } };
    }
    await route.fulfill({ json: { success: true, data }, headers: { 'access-control-allow-origin': baseUrl, 'access-control-allow-credentials': 'true' } });
  });
  try {
    let resume = !process.env.REVIEW_FROM;
    for (const [name, url, heading] of [
      ['dashboard', '/', 'Tổng quan vận hành'],
      ['pos', '/hoa-don/tao', 'Tạo hóa đơn bán hàng'],
      ['products', '/san-pham', 'Danh sách hàng hóa'],
      ['transfers', '/dieu-chuyen', 'Điều chuyển hàng giữa các chi nhánh'],
      ['orders', '/don-mua-hang', 'Đơn mua hàng'],
      ['receipts', '/nhap-hang', 'Nhập hàng'],
      ['invoices', '/hoa-don', 'Tra cứu hóa đơn bán hàng'],
      ['inventory', '/ton-kho', 'Tồn kho toàn chuỗi'],
      ['customers', '/khach-hang', 'Quản lý khách hàng'],
      ['suppliers', '/nha-cung-cap', 'Hồ sơ nhà cung cấp'],
      ['warehouses', '/kho', 'Quản lý kho'],
      ['branches', '/chi-nhanh', 'Quản lý chi nhánh'],
      ['users', '/users', 'Người dùng'],
      ['roles', '/roles', 'Vai trò'],
      ['permissions', '/permissions', 'Danh sách quyền'],
      ['revenue-report', '/bao-cao-doanh-thu', 'Báo cáo doanh thu'],
      ['stock-report', '/bao-cao-ton-kho', 'Báo cáo tồn kho toàn chuỗi'],
      ['product-report', '/bao-cao-san-pham', 'Hiệu suất sản phẩm'],
      ['debt-report', '/bao-cao-cong-no', 'Báo cáo công nợ'],
      ['branch-report', '/so-sanh-chi-nhanh', 'So sánh hiệu quả chi nhánh'],
      ['payables', '/cong-no', 'Công nợ phải trả nhà cung cấp'],
      ['receivables', '/cong-no-phai-thu', 'Công nợ phải thu khách hàng'],
      ['reconciliation', '/doi-soat-cong-no', 'Đối soát công nợ'],
      ['payments', '/giao-dich', 'Tra cứu giao dịch thanh toán'],
      ['stocktakes', '/kiem-kho', 'Phiếu kiểm kho'],
      ['ledger', '/lich-su-ton-kho', 'Lịch sử biến động tồn kho'],
      ['lots', '/lo-han-dung', 'Lô hàng & hạn sử dụng'],
      ['returns', '/tra-hang', 'Lịch sử trả hàng và hoàn tiền'],
      ['supplier-returns', '/tra-hang-ncc', 'Trả hàng nhà cung cấp'],
      ['forecast', '/du-bao-nhu-cau', 'Dự báo nhu cầu sản phẩm'],
      ['ai-experiment', '/du-bao-nhu-cau/khao-sat', 'Khảo sát mô hình AI'],
      ['product-detail', '/san-pham/review', product.name],
      ['stock-detail', '/ton-kho/review', product.name],
      ['supplier-detail', '/nha-cung-cap/review', 'Nhà cung cấp kiểm thử'],
      ['customer-detail', '/khach-hang/review', 'Khách hàng kiểm thử'],
      ['order-detail', '/don-mua-hang/review', 'DH-TEST'],
      ['invoice-detail', '/hoa-don/review', 'HD-TEST'],
      ['transfer-detail', '/dieu-chuyen/review', 'DC-TEST'],
      ['stocktake-detail', '/kiem-kho/review', 'KK-TEST'],
      ['payable-detail', '/cong-no/review', 'CN-TEST'],
      ['receivable-detail', '/cong-no-phai-thu/review', 'CN-TEST'],
      ['payos', '/thanh-toan/payos', 'Chi tiết thanh toán'],
      ['scene', '/kho/mo-hinh-3d', 'Mô hình kho 3D · Vận hành & An ninh'],
      ['camera', '/kho/mo-hinh-3d/camera', 'Kiện hàng & tem QR'],
      ['preview', '/preview', 'Tổng quan vận hành'],
      ['request-detail', '/de-nghi-mua/review', 'DN-TEST'],
    ]) {
      if (name === process.env.REVIEW_FROM) resume = true;
      if (!resume) continue;
      if (process.env.REVIEW_ONLY && !name.includes(process.env.REVIEW_ONLY)) continue;
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${baseUrl}${url}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible({ timeout: 30000 });
      if (name === 'scene') await page.waitForTimeout(1200);
      const headingLayout = await page.getByRole('heading', { name: heading, exact: true }).evaluate(el => {
        const crumb = el.parentElement.querySelector('.breadcrumb');
        const description = [...el.parentElement.querySelectorAll('p')].find(p => p.getClientRects().length && (el.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING));
        const box = el.getBoundingClientRect();
        return { tag: el.tagName, size: getComputedStyle(el).fontSize,
          stacked: (!crumb || crumb.getBoundingClientRect().bottom <= box.top + 1)
            && (!description || description.getBoundingClientRect().top >= box.bottom - 1) };
      });
      if ((headingLayout.tag === 'H1' && headingLayout.size !== '26px') || !headingLayout.stacked) throw new Error(`${url}: inconsistent page heading ${JSON.stringify(headingLayout)}`);
      if (name === 'products') await expect(page.getByText(product.name, { exact: true }).first()).toBeVisible();
      if (name === 'products') {
        const tones = await page.locator('.products-category-tabs .ui-tab').evaluateAll(nodes => nodes.slice(1).map(node => getComputedStyle(node).backgroundColor));
        expect(new Set(tones).size).toBe(8);
        const categoryTab = page.locator('.products-category-tabs button').filter({ hasText: 'Sữa' });
        await categoryTab.click();
        await expect(categoryTab).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('button', { name: 'Bỏ lọc nhóm hàng' })).toBeVisible();
        const tabInk = await categoryTab.evaluate(node => getComputedStyle(node).color);
        expect(await page.locator('.category-badge').first().evaluate(node => getComputedStyle(node).color)).toBe(tabInk);
        await page.getByRole('button', { name: 'Bỏ lọc nhóm hàng' }).click();
        await expect(page.locator('.product-active-filters')).toHaveCount(0);
        expect(await page.locator('.products-page th').first().evaluate(node => getComputedStyle(node).fontWeight)).toBe('600');
        await page.getByRole('button', { name: 'Hình ảnh', exact: true }).click();
        await expect(page.locator('.product-gallery')).toBeVisible();
        await expect(page.locator('.products-page .table-scroll').first()).toBeHidden();
        await page.getByRole('button', { name: `Xem ${product.name}`, exact: true }).click();
        await expect(page.locator('.gallery-detail')).toBeVisible();
        for (const width of [1440, 768, 390]) {
          await page.setViewportSize({ width, height: 960 });
          await page.waitForTimeout(300); // Capture after responsive sidebar transition.
          await page.screenshot({ path: path.join(output, `products-gallery-${width}.png`), fullPage: true });
          if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error(`Gallery overflow at ${width}`);
          const filterWidth = await page.getByRole('combobox', { name: 'Lọc theo nhóm hàng' }).evaluate(el => el.getBoundingClientRect().width);
          if (filterWidth < 120) throw new Error(`Product filters collapsed at ${width}`);
        }
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.getByRole('button', { name: 'Danh sách', exact: true }).click();
      }
      if (name === 'dashboard') {
        const artwork = await page.locator('.dashboard-heading-art img').evaluate(image => ({ loaded: image.complete && image.naturalWidth > 0, visible: getComputedStyle(image).display }));
        if (!artwork.loaded || artwork.visible === 'none') throw new Error(`Dashboard artwork did not load: ${JSON.stringify(artwork)}`);
        await page.waitForTimeout(420);
        await page.locator('.dashboard-heading').screenshot({ path: path.join(output, 'dashboard-banner.png') });
        await expect(page.locator('.commerce-task-total')).toHaveText('42');
        await expect(page.locator('.dashboard-kpi-grid .metric-card')).toHaveCount(4);
        await expect(page.locator('.dashboard-kpi-grid')).toContainText('158.666,7');
        const colors = await page.locator('.dashboard-kpi-grid .metric-card-value').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).color));
        expect(new Set(colors).size).toBe(4);
        const expand = page.getByRole('button', { name: 'Mở rộng Quản lý kho', exact: true });
        await expand.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('button', { name: 'Thu gọn Quản lý kho', exact: true })).toHaveAttribute('aria-expanded', 'true');
        await page.keyboard.press('Enter');
        await expect(expand).toHaveAttribute('aria-expanded', 'false');
        await page.getByRole('button', { name: 'Thu gọn sidebar' }).click();
        await expect(page.locator('.commerce-shell')).toHaveClass(/sidebar-collapsed/);
        await expect(page.locator('.commerce-sidebar')).toHaveCSS('width', '76px');
        await page.screenshot({ path: path.join(output, 'dashboard-sidebar-collapsed.png') });
        await page.getByRole('button', { name: 'Mở rộng sidebar' }).click();
        await expect(page.locator('.commerce-shell')).not.toHaveClass(/sidebar-collapsed/);
        await page.waitForTimeout(420);
      }
      if (name === 'inventory') {
        const tabs = page.locator('.suite-panel .ui-tabbar');
        const second = tabs.locator('.ui-tab').nth(1);
        await second.click();
        await expect(second).toHaveAttribute('aria-pressed', 'true');
        const indicator = await tabs.evaluate(nav => ({
          x: parseFloat(nav.style.getPropertyValue('--tab-indicator-x')),
          width: parseFloat(nav.style.getPropertyValue('--tab-indicator-width')),
          selected: nav.querySelector('[aria-pressed=true]')?.offsetLeft,
        }));
        if (indicator.x !== indicator.selected || indicator.width < 40) throw new Error('Tab indicator did not follow selected tab');
        await tabs.locator('.ui-tab').first().click();
      }
      if (name === 'ai-experiment') {
        const report = page.frameLocator('iframe');
        await expect(report.getByRole('heading', { name: 'Khảo sát 7 mô hình dự báo lượng bán' })).toBeVisible();
        await expect(report.locator('svg')).toHaveCount(2);
        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Tải báo cáo để trình bày' }).click();
        const download = await downloadPromise;
        if (download.suggestedFilename() !== 'FreshMart-khao-sat-AI.html') throw new Error('Wrong experiment report filename');
      }
      if (name === 'stocktake-detail') {
        const progress = page.getByRole('progressbar', { name: 'Số mặt hàng đã kiểm đếm' });
        await expect(progress).toHaveAttribute('value', '0');
        await page.getByRole('spinbutton', { name: `Số thực tế ${product.code}` }).fill('23');
        await expect(progress).toHaveAttribute('value', '1');
        await expect(page.getByRole('button', { name: 'Hoàn thành kiểm kho', exact: true })).toBeDisabled();
        await page.getByRole('textbox', { name: `Nguyên nhân ${product.code}` }).fill('Thiếu một sản phẩm khi kiểm đếm');
        await expect(page.getByRole('button', { name: 'Hoàn thành kiểm kho', exact: true })).toBeEnabled();
      }
      if (name === 'pos') {
        await page.keyboard.press('F3');
        await expect(page.getByRole('textbox', { name: 'Tìm sản phẩm bán hàng' })).toBeFocused();
        await page.getByRole('button', { name: `Thêm ${product.name}`, exact: true }).click();
        await page.getByRole('button', { name: `Tăng số lượng ${product.name}`, exact: true }).click();
        await expect(page.getByRole('spinbutton', { name: `Số lượng ${product.name}`, exact: true })).toHaveValue('2');
        await expect(page.locator('.pos-ticket .sale-bill-total')).toContainText('36.000');
        await page.locator('.pos-ticket button[type=submit]').click();
        await expect(page.locator('.sale-checkout-modal')).toBeVisible();
        await page.locator('.sale-checkout-modal').getByRole('button', { name: 'Quay lại', exact: true }).click();
      }
      if (['users', 'roles', 'permissions'].includes(name)) {
        const search = page.getByRole('searchbox', { name: 'Tìm trong danh sách' });
        await search.fill('no-match-visual-test');
        await expect(page.getByText('Không có kết quả phù hợp.', { exact: true })).toBeVisible();
        await search.clear();
        await expect(page.locator('.admin-records tbody tr').first()).toBeVisible();
      }
      await page.waitForTimeout(350);
      if (errors.length) throw new Error(`${url}: ${errors.join('\n')}`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(output, `${name}-desktop.png`), fullPage: true });
      if (name === 'scene') {
        const flowSelect = page.getByRole('combobox', { name: 'Luồng demo' });
        await flowSelect.selectOption('access');
        const scenarioSelect = page.getByRole('combobox', { name: 'Tình huống' });
        await scenarioSelect.selectOption('authorized');
        await expect(page.locator('.li-timeline-list li')).toHaveCount(6);
        await expect(page.getByText('Thiết lập thiết bị, cửa và thẻ nhân viên')).toBeVisible();
        await page.screenshot({ path: path.join(output, 'scene-access-desktop.png'), fullPage: true });
        await scenarioSelect.selectOption('unauthorized');
        await expect(page.locator('.li-timeline-list li')).toHaveCount(5);
        await page.getByRole('button', { name: /Chạy demo/ }).click();
        await expect(page.getByText('không có thẻ hợp lệ', { exact: false })).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(1300);
        await page.screenshot({ path: path.join(output, 'scene-access-alert.png'), fullPage: true });
        await page.getByRole('button', { name: 'Đóng cửa kết thúc' }).click();
        await scenarioSelect.selectOption('open-too-long');
        await expect(page.locator('.li-timeline-list li')).toHaveCount(5);
        await flowSelect.selectOption('inbound');
      }
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error(`Desktop overflow: ${url}`);
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.screenshot({ path: path.join(output, `${name}-wide.png`), fullPage: true });
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error(`Wide desktop overflow: ${url}`);
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.screenshot({ path: path.join(output, `${name}-tablet.png`), fullPage: true });
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error(`Tablet overflow: ${url}`);
      if (!await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('14px "IBM Plex Sans"') && getComputedStyle(document.body).fontFamily.includes('IBM Plex Sans'); })) throw new Error(`Local font unavailable: ${url}`);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300); // Let the responsive sidebar finish sliding out.
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(output, `${name}-mobile.png`), fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      if (overflow) throw new Error(`Page overflow: ${url}`);
      if (name !== 'request-detail') {
        await page.getByRole('button', { name: 'Mở menu', exact: true }).click();
        await expect(page.locator('.commerce-sidebar')).toBeInViewport();
        await page.keyboard.press('Escape');
        await expect(page.locator('.commerce-shell')).not.toHaveClass(/navigation-open/);
      }
      if (name === 'users') {
        await page.getByRole('button', { name: /Thêm người dùng/ }).click();
        await expect(page.locator('.admin-editor-fields')).toBeVisible();
        await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, 'users-form-mobile.png'), fullPage: true });
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('User editor overflow');
      }
      const createLabels = { orders: 'Tạo đơn mua hàng', receipts: 'Nhập hàng mới', customers: 'Thêm khách hàng', transfers: 'Tạo phiếu điều chuyển', suppliers: 'Thêm nhà cung cấp', stocktakes: 'Tạo phiếu kiểm kho', 'invoice-detail': 'Tạo phiếu trả hàng', 'stock-detail': 'Chỉnh mức an toàn' };
      if (createLabels[name]) {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.getByRole('button', { name: new RegExp(createLabels[name]) }).first().click();
        await expect(page.locator('.ui-modal-card').first()).toBeVisible();
        if (name === 'receipts') {
          await page.getByRole('searchbox', { name: 'Tìm sản phẩm nhập kho' }).fill(product.name);
          await page.getByRole('option', { name: new RegExp(product.name) }).click();
          await expect(page.locator('.receive-line-subtotal')).toContainText('12.000');
          await page.locator('.receive-line input[type=number]').fill('3');
          await expect(page.locator('.receive-line-subtotal')).toContainText('36.000');
          await expect(page.locator('.receive-total')).toContainText('36.000');
        }
        await page.screenshot({ path: path.join(output, `${name}-form.png`) });
        await page.setViewportSize({ width: 390, height: 844 });
        const modal = page.locator('.ui-modal-card').first();
        await expect(modal).toBeVisible();
        const bounds = await modal.boundingBox();
        if (!bounds || bounds.x < 0 || bounds.x + bounds.width > 391) throw new Error(`Modal overflow: ${url}`);
        const saveButton = modal.locator('footer button:not([type=button])').last();
        await saveButton.scrollIntoViewIfNeeded();
        await expect(saveButton).toBeInViewport();
        await page.screenshot({ path: path.join(output, `${name}-form-mobile.png`) });
      }
      console.log(`PASS ${url}: desktop/mobile`);
    }
    if (!process.env.REVIEW_ONLY && !process.env.REVIEW_FROM) {
      // Every remaining route is an alias, or the unauthenticated login screen.
      for (const url of ['/ca-lam-viec', '/canh-bao-thieu-hang', '/de-nghi-mua', '/de-nghi-mua-hang', '/de-xuat', '/du-bao-nhu-cau/review', '/kho/mo-hinh-3d/rfid', '/kho/giam-sat-cua']) {
        await page.goto(`${baseUrl}${url}`);
        await expect(page.locator('h1').first()).toBeVisible();
        console.log(`PASS redirect ${url} -> ${new URL(page.url()).pathname}`);
      }
      await page.route('**/api/v1/auth/refresh', route => route.fulfill({ status: 401, json: { success: false, message: 'Unauthenticated fixture' } }));
      await page.goto(`${baseUrl}/login`);
      await expect(page.getByRole('heading', { name: 'Đăng nhập vào hệ thống' })).toBeVisible();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 960 });
        await page.screenshot({ path: path.join(output, `login-${width}.png`), fullPage: true });
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('Login overflow');
      }
      console.log('PASS /login: desktop/mobile');
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const motion = await page.locator('body').evaluate(body => {
      const probe = document.createElement('div');
      probe.className = 'ui-modal-card';
      body.append(probe);
      const name = getComputedStyle(probe).animationName;
      probe.remove();
      return name;
    });
    if (motion !== 'none') throw new Error('Reduced-motion preference was not respected');
    if (errors.length) throw new Error(errors.join('\n'));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
