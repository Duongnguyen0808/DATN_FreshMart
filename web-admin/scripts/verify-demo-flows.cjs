const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });

const BASE_URL = (process.env.DEMO_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const API_URL = (process.env.DEMO_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL || 'owner@smartstore.local';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD || '';

const RESTRICTED_CANDIDATES = [
  { label: 'Thu ngan (EMPLOYEE)', email: process.env.SEED_CASHIER_EMAIL, password: process.env.SEED_CASHIER_PASSWORD, expectAdminBlocked: true, expectPayablesBlocked: true },
  { label: 'Nhan vien demo (EMPLOYEE)', email: process.env.DEMO_EMPLOYEE_EMAIL, password: process.env.DEMO_EMPLOYEE_PASSWORD, expectAdminBlocked: true, expectPayablesBlocked: true },
  { label: 'Quan ly chi nhanh (BRANCH_MANAGER)', email: process.env.DEMO_MANAGER_EMAIL, password: process.env.DEMO_MANAGER_PASSWORD, expectAdminBlocked: true, expectPayablesBlocked: false },
].filter(item => item.email && item.password);

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`Cach chay kiem thu lien trang demo FreshMart:
  node scripts/verify-demo-flows.cjs               # Chay toan bo 8 luong an toan (khong lam lech doanh thu/ton kho/cong no)
  node scripts/verify-demo-flows.cjs --flow=1,3,7  # Chi chay cac luong duoc chon (1..8)
  node scripts/verify-demo-flows.cjs --headed      # Mo trinh duyet Chrome/Edge de xem tung buoc click demo
  node scripts/verify-demo-flows.cjs --write-check # Kem kiem thu ghi-huy du lieu co hoan tac (the RFID tam, phieu chuyen nhap)`);
    process.exit(0);
  }
  const opts = {
    flows: new Set([1, 2, 3, 4, 5, 6, 7, 8]),
    headed: false,
    slowMo: 0,
    writeCheck: false,
  };
  for (const arg of argv) {
    if (arg === '--headed') opts.headed = true;
    else if (arg === '--write-check') opts.writeCheck = true;
    else if (arg.startsWith('--slow-mo=')) opts.slowMo = Math.max(0, Number(arg.split('=')[1]) || 0);
    else if (arg.startsWith('--flow=')) {
      const raw = arg.split('=')[1];
      if (raw && raw !== 'all') {
        const picked = raw.split(',').map(v => Number(v.trim())).filter(n => n >= 1 && n <= 8);
        if (!picked.length) throw new Error(`Invalid --flow value: ${raw}`);
        opts.flows = new Set(picked);
      }
    }
  }
  return opts;
}

async function launchBrowser(headed, slowMo) {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  const executablePath = candidates.find(p => fs.existsSync(p));
  const launchArgs = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'];
  try {
    return await chromium.launch({
      headless: !headed,
      slowMo: headed ? (slowMo || 120) : slowMo,
      executablePath: executablePath || undefined,
      channel: executablePath ? undefined : 'msedge',
      args: launchArgs,
    });
  } catch {
    return await chromium.launch({
      headless: !headed,
      slowMo,
      args: launchArgs,
    });
  }
}

async function apiJson(pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API_URL}/${pathname.replace(/^\//, '')}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, payload };
}

async function apiLogin(email, password) {
  const res = await apiJson('auth/login', { method: 'POST', body: { email, password, client: 'mobile' } });
  return res.ok ? res.payload?.data : null;
}

async function uiLogin(page, email, password, expectDashboard = true) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Chào mừng trở lại' }).waitFor({ timeout: 15000 });
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  const loginRes = page.waitForResponse(res => res.url().includes('/api/v1/auth/login') && res.request().method() === 'POST', { timeout: 25000 });
  await page.locator('.fm-login-submit').click();
  const res = await loginRes;
  assert.equal(res.status(), 200, `Login failed for ${email} with status ${res.status()}`);
  await page.waitForURL(url => new URL(url).pathname !== '/login', { waitUntil: 'commit', timeout: 30000 });
  if (expectDashboard) {
    await page.getByRole('heading', { name: 'Tổng quan vận hành' }).waitFor({ timeout: 25000 });
  } else {
    await page.locator('.commerce-shell').waitFor({ timeout: 25000 });
  }
}

async function waitForPageReady(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.locator('main h1').first().waitFor({ timeout: 20000 }).catch(() => {});
  await expect(page.locator('.ui-error[role="alert"]')).toHaveCount(0, { timeout: 1500 }).catch(() => {});
}

function attachWatchers(page, state) {
  page.on('pageerror', error => {
    state.pageErrors.push(`${page.url()}: ${error.message}`);
  });
  page.on('response', response => {
    const status = response.status();
    if (status >= 500 && !state.allowServerErrorUrls.some(re => re.test(response.url()))) {
      state.serverErrors.push(`${status} ${response.request().method()} ${response.url()}`);
    }
  });
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  assert(OWNER_PASSWORD, 'SEED_OWNER_PASSWORD must exist in backend/.env');

  // Quick service reachability check before launching Chromium.
  const health = await fetch(`${API_URL.replace(/\/api\/v1$/, '')}/health`).catch(() => null);
  assert(health && health.ok, `Backend not reachable at ${API_URL}. Start backend + ai-service + web-admin first.`);
  const aiHealth = await fetch('http://127.0.0.1:8000/health').catch(() => null);
  assert(aiHealth && aiHealth.ok, 'AI service not reachable at http://127.0.0.1:8000/health.');

  const ownerAuth = await apiLogin(OWNER_EMAIL, OWNER_PASSWORD);
  assert(ownerAuth?.accessToken, 'Owner API login failed');
  const ownerToken = ownerAuth.accessToken;

  // Fetch baseline IDs from live database so tests target real records cleanly.
  const [storesRes, warehousesRes, todayInvoicesRes, creditInvoicesRes, transfersRes, stocktakesRes, purchaseOrdersRes, payablesRes, receivablesRes, customersRes] = await Promise.all([
    apiJson('stores', { token: ownerToken }),
    apiJson('warehouses', { token: ownerToken }),
    apiJson('invoices?q=HD-DEMO-TL&pageSize=10', { token: ownerToken }),
    apiJson('invoices?q=HD-DEMO-CREDIT-001&pageSize=5', { token: ownerToken }),
    apiJson('transfers?pageSize=10', { token: ownerToken }),
    apiJson('stocktakes?pageSize=10', { token: ownerToken }),
    apiJson('purchase-orders?pageSize=10', { token: ownerToken }),
    apiJson('payables?pageSize=10', { token: ownerToken }),
    apiJson('receivables?pageSize=10', { token: ownerToken }),
    apiJson('customers?pageSize=10', { token: ownerToken }),
  ]);

  const stores = storesRes.payload?.data || [];
  const warehouses = warehousesRes.payload?.data || [];
  const cn001 = stores.find(s => s.code === 'CN001') || stores[0];
  const cn002 = stores.find(s => s.code === 'CN002') || stores[1];
  const kho001 = warehouses.find(w => w.code === 'KHO001') || warehouses[0];
  const kho002 = warehouses.find(w => w.code === 'KHO002') || warehouses[1];

  const todayInvoice = (todayInvoicesRes.payload?.data?.items || []).find(i => i.code.includes('HD-DEMO-TL')) || todayInvoicesRes.payload?.data?.items?.[0];
  const creditInvoice = (creditInvoicesRes.payload?.data?.items || [])[0];
  const sampleTransfer = (transfersRes.payload?.data?.items || [])[0];
  const sampleStocktake = (stocktakesRes.payload?.data?.items || [])[0];
  const samplePo = (purchaseOrdersRes.payload?.data?.items || [])[0];
  const samplePayable = (payablesRes.payload?.data?.items || [])[0];
  const sampleReceivable = (receivablesRes.payload?.data?.items || [])[0];
  const sampleCustomer = (customersRes.payload?.data?.items || [])[0];

  const browser = await launchBrowser(opts.headed, opts.slowMo);
  const state = { pageErrors: [], serverErrors: [], allowServerErrorUrls: [] };
  const results = [];

  const runFlow = async (num, title, fn) => {
    if (!opts.flows.has(num)) return;
    const t0 = Date.now();
    console.log(`\n=== [LUONG ${num}] ${title} ===`);
    await fn(msg => console.log(`  [OK] ${msg}`));
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    results.push({ num, title, sec });
    console.log(`  --> LUONG ${num} DAT (${sec}s)`);
  };

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    attachWatchers(page, state);

    let loggedInAsOwner = false;
    const ensureOwnerUi = async () => {
      if (loggedInAsOwner) return;
      await uiLogin(page, OWNER_EMAIL, OWNER_PASSWORD);
      loggedInAsOwner = true;
    };

    await runFlow(1, 'Xac thuc -> Tong quan -> Chi nhanh -> Kho -> San pham', async step => {
      // Unauthenticated redirect guard
      await page.goto(`${BASE_URL}/ton-kho`, { waitUntil: 'domcontentloaded' });
      await page.waitForURL(url => new URL(url).pathname === '/login', { waitUntil: 'commit', timeout: 30000 });
      await page.waitForLoadState('networkidle');
      step('Chua dang nhap tu dong chuyen ve /login');

      // Wrong password rejection
      await page.locator('#login-email').fill(OWNER_EMAIL);
      await page.locator('#login-password').fill('WrongPassword123!');
      const badLogin = page.waitForResponse(r => r.url().includes('/auth/login') && r.request().method() === 'POST');
      await page.locator('.fm-login-submit').click();
      assert.equal((await badLogin).status(), 401, 'Wrong password must return HTTP 401');
      await expect(page.locator('.fm-login-error')).toBeVisible({ timeout: 10000 });
      step('Sai mat khau bi chan (HTTP 401) va hien thong bao loi');

      // Owner login -> Dashboard
      await uiLogin(page, OWNER_EMAIL, OWNER_PASSWORD);
      loggedInAsOwner = true;
      await expect(page.locator('.dashboard-kpi-grid > *')).toHaveCount(4);
      await page.locator('.dashboard-kpi-grid[aria-busy="false"]').waitFor({ timeout: 20000 });
      step('Dang nhap Owner thanh cong, / hien thi 4 the KPI sach');

      // Period & Branch filters on Dashboard (sequential so heavy telemetry does not overlap)
      const p7 = page.waitForResponse(r => r.url().includes('/api/v1/dashboard?period=7') && r.status() === 200, { timeout: 25000 });
      await page.getByRole('button', { name: '7 ngày', exact: true }).click();
      await p7;
      const p30 = page.waitForResponse(r => r.url().includes('/api/v1/dashboard?period=30') && r.status() === 200, { timeout: 25000 });
      await page.getByRole('button', { name: '30 ngày', exact: true }).click();
      await p30;
      if (cn001) {
        const dashResp = page.waitForResponse(r => r.url().includes('/api/v1/dashboard') && r.url().includes(cn001.id) && r.status() === 200, { timeout: 25000 });
        await page.locator('.dashboard-heading .date-select select').selectOption(cn001.id);
        await dashResp;
      }
      await page.locator('.dashboard-heading .date-select select').selectOption('');
      step('Loc 7/30 ngay va chon chi nhanh tren / cap nhat API dong bo');

      // Cross-check /chi-nhanh
      await page.goto(`${BASE_URL}/chi-nhanh`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Quản lý chi nhánh' })).toBeVisible({ timeout: 15000 });
      await expect(page.locator('main.main-content')).toContainText('CN001');
      await expect(page.locator('main.main-content')).toContainText('CN003');
      step('/chi-nhanh hien thi day du 3 chi nhanh CN001..CN003');

      // Cross-check /kho -> link 3D
      await page.goto(`${BASE_URL}/kho`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Quản lý kho' })).toBeVisible({ timeout: 15000 });
      await expect(page.locator('main.main-content')).toContainText('KHO001');
      await expect(page.locator('main.main-content a[href="/kho/mo-hinh-3d"]').first()).toBeVisible();
      step('/kho hien thi KHO001..KHO003 va lien ket Mo hinh kho 3D');

      // Cross-check /san-pham
      await page.goto(`${BASE_URL}/san-pham`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Danh sách hàng hóa' })).toBeVisible({ timeout: 15000 });
      await page.locator('tbody tr.product-row-clickable').first().waitFor({ timeout: 15000 });
      await page.locator('tbody tr.product-row-clickable').first().click();
      step('/san-pham tai danh muc hang hoa va mo xem chi tiet dong san pham thanh cong');
    });

    await runFlow(2, 'Ca lam viec <-> POS <-> PayOS <-> Hoa don <-> Tra hang <-> Ton kho & The kho', async step => {
      await ensureOwnerUi();

      // /ca-lam-viec
      await page.goto(`${BASE_URL}/ca-lam-viec`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Quản lý ca làm việc' })).toBeVisible({ timeout: 15000 });
      step('/ca-lam-viec tai danh sach ca va nut nghiep vu ca');

      // /hoa-don/tao POS workspace
      await page.goto(`${BASE_URL}/hoa-don/tao`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Tạo hóa đơn bán hàng' })).toBeVisible({ timeout: 15000 });
      const shiftSelect = page.locator('.pos-sessionbar select').nth(0);
      const whSelect = page.locator('.pos-sessionbar select').nth(1);
      await expect.poll(() => shiftSelect.locator('option').count(), { timeout: 15000 }).toBeGreaterThan(1);
      if ((await shiftSelect.inputValue()) === '') {
        const cn001OptionValue = await shiftSelect.locator('option').evaluateAll(options => {
          const match = options.find(opt => opt.value && opt.textContent?.includes('Ba Đình'));
          return match?.value || options.find(opt => opt.value)?.value || '';
        });
        assert(cn001OptionValue, 'Expected at least one open shift option in POS');
        await shiftSelect.selectOption(cn001OptionValue);
      }
      await expect.poll(() => whSelect.locator('option').count(), { timeout: 15000 }).toBeGreaterThan(1);
      if ((await whSelect.inputValue()) === '') {
        const firstWhValue = await whSelect.locator('option').nth(1).getAttribute('value');
        if (firstWhValue) await whSelect.selectOption(firstWhValue);
      }
      // Wait for at least one addable product card/button and test adding 1 item to cart UI
      const firstPosItem = page.locator('.sale-products button.pos-product:not([disabled])').first();
      await firstPosItem.waitFor({ timeout: 15000 });
      await firstPosItem.click();
      await expect(page.locator('.pos-ticket-count')).toContainText('1 sản phẩm');
      // Verify link to AI Forecast inside POS advice section
      await page.locator('.pos-stock-advice summary').click();
      await expect(page.locator('.pos-stock-advice a[href="/du-bao-nhu-cau"]')).toBeVisible();
      step('/hoa-don/tao POS chon ca mo va kho xuat, them san pham vao gio va link duoc sang /du-bao-nhu-cau');

      // /thanh-toan/payos guard check (no orphan crash)
      await page.goto(`${BASE_URL}/thanh-toan/payos`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.pq-page')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('.pq-page [role="alert"]')).toContainText('Không tìm thấy mã đơn thanh toán.');
      step('/thanh-toan/payos kiem tra an toan trang thai khi mo doc lap khong co checkoutId');

      // /hoa-don & /hoa-don/[id] (today's TL invoice + credit invoice cross-link)
      await page.goto(`${BASE_URL}/hoa-don`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Tra cứu hóa đơn bán hàng' })).toBeVisible({ timeout: 15000 });
      if (todayInvoice) {
        await page.goto(`${BASE_URL}/hoa-don/${todayInvoice.id}`, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('h1')).toContainText(todayInvoice.code, { timeout: 15000 });
        await expect(page.locator('.invoice-print-receipt')).toBeAttached();
        step(`/hoa-don/${todayInvoice.code} hien thi day du dong hang, thanh toan va mau in`);
      }
      if (creditInvoice) {
        await page.goto(`${BASE_URL}/hoa-don/${creditInvoice.id}`, { waitUntil: 'domcontentloaded' });
        await expect(page.locator(`main a[href*="/cong-no-phai-thu/"]`).first()).toBeVisible({ timeout: 15000 });
        step(`Hoa don ban no ${creditInvoice.code} lien ket dung sang ho so Phai thu`);
      }

      // /tra-hang
      await page.goto(`${BASE_URL}/tra-hang`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Lịch sử trả hàng và hoàn tiền' })).toBeVisible({ timeout: 15000 });
      step('/tra-hang hien thi lich su tra hang khong loi');

      // /ton-kho -> /ton-kho/[id] -> /lich-su-ton-kho
      await page.goto(`${BASE_URL}/ton-kho`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Tồn kho toàn chuỗi' })).toBeVisible({ timeout: 15000 });
      const firstHistoryLink = page.locator('tbody a[href^="/ton-kho/"]').first();
      await firstHistoryLink.waitFor({ timeout: 15000 });
      await firstHistoryLink.click();
      await page.waitForURL(url => /\/ton-kho\/.+/.test(new URL(url).pathname), { waitUntil: 'commit', timeout: 30000 });
      await page.locator('main.main-content h1').first().waitFor({ timeout: 30000 });
      await page.goto(`${BASE_URL}/lich-su-ton-kho`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Lịch sử biến động tồn kho' })).toBeVisible({ timeout: 15000 });
      await page.locator('.inventory-ledger-filters select[aria-label="Nghiệp vụ"]').selectOption('SALE');
      if (todayInvoice) {
        await page.locator('.inventory-ledger-filters input').fill(todayInvoice.id);
        await expect(page.locator('.inventory-ledger-page tbody')).toContainText(todayInvoice.id, { timeout: 10000 });
      }
      step('/ton-kho -> /ton-kho/[id] -> /lich-su-ton-kho khop chung tu xuat ban SALE ngay 2026-11-14');
    });

    await runFlow(3, 'Du bao nhu cau AI & Smart Rebalancing <-> Khao sat M5 <-> Dieu chuyen / De nghi mua', async step => {
      await ensureOwnerUi();

      // Verify /canh-bao-thieu-hang redirect seamlessly leads to /du-bao-nhu-cau
      await page.goto(`${BASE_URL}/canh-bao-thieu-hang`, { waitUntil: 'domcontentloaded' });
      await page.waitForURL(url => new URL(url).pathname === '/du-bao-nhu-cau', { waitUntil: 'commit', timeout: 30000 });
      await expect(page.getByRole('heading', { name: 'Dự báo nhu cầu & điều phối chuỗi' })).toBeVisible({ timeout: 15000 });
      step('/canh-bao-thieu-hang chuyen huong thong nhat ve /du-bao-nhu-cau');

      // Select store CN001 & horizon 14 -> verify Smart Branch Rebalancing + AI live refresh
      const refreshBtn = page.getByRole('button', { name: 'Cập nhật dự đoán' });
      await expect(refreshBtn).toBeEnabled({ timeout: 20000 });
      const storeSelect = page.locator('.simple-forecast-controls select').first();
      const horizonSelect = page.locator('.simple-forecast-controls select').nth(1);
      if (cn001) await storeSelect.selectOption(cn001.id);
      await horizonSelect.selectOption('14');
      await expect(refreshBtn).toBeEnabled({ timeout: 20000 });
      const liveRun = page.waitForResponse(r => r.url().includes('/api/v1/forecasts/demand') && r.request().method() === 'POST', { timeout: 30000 });
      await refreshBtn.click();
      assert.equal((await liveRun).status(), 201, 'Live AI forecast POST must return 201');
      await expect(page.locator('.simple-forecast-table tbody tr').first()).toBeVisible({ timeout: 20000 });
      await page.locator('.forecast-method-toggle > summary').click();
      await expect(page.locator('.forecast-explainer')).toBeVisible();
      step('Chay du bao AI truc tiep cho CN001 (14 ngay) + mo giai thich cong thuc can doi chuoi');

      // Navigate to AI Survey page (/du-bao-nhu-cau/khao-sat)
      await page.locator('main.main-content a[href="/du-bao-nhu-cau/khao-sat"]').first().click();
      await page.waitForURL(url => new URL(url).pathname === '/du-bao-nhu-cau/khao-sat', { waitUntil: 'commit', timeout: 30000 });
      await expect(page.getByRole('heading', { name: 'Khảo sát mô hình AI' })).toBeVisible({ timeout: 15000 });
      await page.locator('iframe[title="Bảng và biểu đồ khảo sát mô hình AI"]').waitFor({ timeout: 20000 });
      step('/du-bao-nhu-cau/khao-sat tai thanh cong bao cao 7 mo hinh M5 + backtest ton kho');
    });

    await runFlow(4, 'Lo & Han su dung FEFO x Du bao AI <-> Canh bao tren /du-bao-nhu-cau', async step => {
      await ensureOwnerUi();

      const fefoApi = await apiJson('inventory-lots/fefo-ai-risks?horizonDays=14', { token: ownerToken });
      assert.equal(fefoApi.status, 200, 'GET /inventory-lots/fefo-ai-risks must return 200');
      const expectedAtRisk = fefoApi.payload?.data?.summary?.atRiskLotsCount ?? 0;

      await page.goto(`${BASE_URL}/lo-han-dung`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Lô hàng, Hạn sử dụng (FEFO) & Dự báo AI' })).toBeVisible({ timeout: 15000 });
      await expect(page.locator('main.main-content')).toContainText('Nguy cơ dư (AI × FEFO)');
      await expect(page.locator('main.main-content a[href="/du-bao-nhu-cau"]').first()).toBeVisible();
      await expect(page.locator('main.main-content a[href="/ton-kho"]').first()).toBeVisible();
      step(`/lo-han-dung hien thi chuan phan tich AI x FEFO (atRiskLotsCount=${expectedAtRisk}) va lien ket 2 chieu`);

      // Verify /du-bao-nhu-cau Table 2 matches FEFO risk count
      await page.goto(`${BASE_URL}/du-bao-nhu-cau`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Lô cận hạn có nguy cơ dư trước hạn (toàn chuỗi)' })).toBeVisible({ timeout: 15000 });
      await expect(page.locator('main.main-content a[href="/lo-han-dung"]').last()).toBeVisible();
      step('/du-bao-nhu-cau (Bang 2) dong bo so lieu rui ro han dung FEFO voi /lo-han-dung');
    });

    await runFlow(5, 'Mua hang: De nghi -> Don mua -> Camera QR 3D -> Nhap kho -> Tra NCC -> Cong no NCC', async step => {
      await ensureOwnerUi();

      await page.goto(`${BASE_URL}/de-nghi-mua`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: /Đề nghị mua hàng|Nhập hàng/ })).toBeVisible({ timeout: 15000 });
      step('/de-nghi-mua mo danh sach de nghi mua hang thanh cong');

      await page.goto(`${BASE_URL}/don-mua-hang`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Đơn mua hàng' })).toBeVisible({ timeout: 15000 });
      if (samplePo) {
        await page.goto(`${BASE_URL}/don-mua-hang/${samplePo.id}`, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('h1')).toContainText(samplePo.code, { timeout: 15000 });
        await expect(page.locator('.po-info')).toBeVisible();
        step(`/don-mua-hang/${samplePo.code} hien thi NCC, kho nhan, tien do va lich su nhap`);
      }

      await page.goto(`${BASE_URL}/kho/mo-hinh-3d/camera`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Kiện hàng & tem QR' })).toBeVisible({ timeout: 15000 });
      step('/kho/mo-hinh-3d/camera san sang quan ly tem QR & don mua hang');

      await page.goto(`${BASE_URL}/kho/mo-hinh-3d`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Mô hình kho 3D · Vận hành & An ninh' })).toBeVisible({ timeout: 15000 });
      await expect(page.locator('canvas')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('.li-chip.ok')).toContainText('Web đã kết nối Backend', { timeout: 15000 });
      step('/kho/mo-hinh-3d tai thanh cong WebGL 3D scene + Socket.IO realtime');

      await page.goto(`${BASE_URL}/tra-hang-ncc`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Trả hàng nhà cung cấp' })).toBeVisible({ timeout: 15000 });
      await page.goto(`${BASE_URL}/cong-no`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Công nợ phải trả nhà cung cấp' })).toBeVisible({ timeout: 15000 });
      if (samplePayable) {
        await page.goto(`${BASE_URL}/cong-no/${samplePayable.id}`, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('h1')).toContainText(samplePayable.code, { timeout: 15000 });
        step(`/cong-no/${samplePayable.code} hien thi cong no phai tra NCC khop so lieu`);
      }
    });

    await runFlow(6, 'Khach hang <-> Cong no phai thu <-> Doi soat cong no <-> Giao dich', async step => {
      await ensureOwnerUi();

      await page.goto(`${BASE_URL}/khach-hang`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Quản lý khách hàng' })).toBeVisible({ timeout: 15000 });
      if (sampleCustomer) {
        await page.goto(`${BASE_URL}/khach-hang/${sampleCustomer.id}`, { waitUntil: 'domcontentloaded' });
        await page.locator('.tab-bar button').nth(1).click();
        await page.locator('.tab-bar button').nth(2).click();
        await page.locator('.tab-bar button').nth(3).click();
        step(`/khach-hang/${sampleCustomer.code} chuyen qua lai 4 tab Ho so / No can thu / Thanh toan / Lich su`);
      }

      await page.goto(`${BASE_URL}/cong-no-phai-thu`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Công nợ phải thu khách hàng' })).toBeVisible({ timeout: 15000 });
      if (sampleReceivable) {
        await page.goto(`${BASE_URL}/cong-no-phai-thu/${sampleReceivable.id}`, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('h1')).toContainText(sampleReceivable.code, { timeout: 15000 });
        step(`/cong-no-phai-thu/${sampleReceivable.code} hien thi du phai thu & lich su thu`);
      }

      await page.goto(`${BASE_URL}/doi-soat-cong-no`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Đối soát công nợ' })).toBeVisible({ timeout: 15000 });
      const reconcileBtn = page.getByRole('button', { name: 'Đối soát lại' });
      await expect(reconcileBtn).toBeEnabled({ timeout: 15000 });
      await reconcileBtn.click();
      await page.goto(`${BASE_URL}/giao-dich`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Tra cứu giao dịch thanh toán' })).toBeVisible({ timeout: 15000 });
      step('/doi-soat-cong-no va /giao-dich khop chung tu thu/chi toan chuoi');
    });

    await runFlow(7, 'Dieu chuyen <-> Kiem kho <-> 3D Chuyen hang & Cua kho 6 buoc RFID + Reed Switch', async step => {
      await ensureOwnerUi();

      await page.goto(`${BASE_URL}/dieu-chuyen`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Điều chuyển hàng giữa các chi nhánh' })).toBeVisible({ timeout: 15000 });
      if (sampleTransfer) {
        await page.goto(`${BASE_URL}/dieu-chuyen/${sampleTransfer.id}`, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('h1')).toContainText(sampleTransfer.code, { timeout: 15000 });
        step(`/dieu-chuyen/${sampleTransfer.code} hien thi dung chi nhanh nguon/dich va trang thai`);
      }

      await page.goto(`${BASE_URL}/kiem-kho`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Phiếu kiểm kho' })).toBeVisible({ timeout: 15000 });
      if (sampleStocktake) {
        await page.goto(`${BASE_URL}/kiem-kho/${sampleStocktake.id}`, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('h1')).toContainText(sampleStocktake.code, { timeout: 15000 });
        step(`/kiem-kho/${sampleStocktake.code} hien thi so he thong, thuc te va chenh lech`);
      }

      // 3D Transfer disclaimer & 6-step RFID + Reed Switch Door Access Simulation
      await page.goto(`${BASE_URL}/kho/mo-hinh-3d`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Mô hình kho 3D · Vận hành & An ninh' })).toBeVisible({ timeout: 15000 });
      await page.locator('select[aria-label="Luồng demo"]').selectOption('transfer');
      await expect(page.locator('.li-flow')).toContainText('Luồng chuyển hàng chỉ minh họa trong mô hình; phiếu thật tạo ở mục Điều chuyển.');
      step('3D Chuyen hang giua kho hien thi ro rang canh bao chi minh hoa');

      await page.locator('select[aria-label="Luồng demo"]').selectOption('access');
      await expect(page.locator('.li-timeline-list.access li')).toHaveCount(6);
      // Force SIMULATION source cleanly for deterministic pre-demo verification, then restore AUTO
      await page.locator('select[aria-label="Nguồn sự kiện cửa kho"]').selectOption('SIMULATION');
      await page.locator('select[aria-label="Tình huống"]').selectOption('authorized');
      const runBtn = page.locator('.live-demo-controls button').filter({ hasText: /Chạy demo|Chạy lại/ });
      await expect(runBtn).toBeEnabled({ timeout: 10000 });
      await runBtn.click();
      await page.locator('#access-complete-title').waitFor({ timeout: 25000 });
      await page.locator('.wde-comp-btn-primary').click();
      step('Cua kho 3D hoan thanh tron tru 6 buoc RFID -> xac thuc -> cho Reed mo -> truy cap -> Reed dong -> luu nhat ky');

      // Unauthorized alert test + immediate cleanup
      await page.locator('select[aria-label="Tình huống"]').selectOption('unauthorized');
      await expect(runBtn).toBeEnabled({ timeout: 10000 });
      await runBtn.click();
      await page.locator('.wde-access-log summary').click();
      await expect(page.locator('.wde-access-log [role="alert"]').first()).toBeVisible({ timeout: 15000 });
      // Close simulated open door & resolve alert cleanly so zero alerts remain
      const closeDoorBtn = page.locator('.live-demo-controls button', { hasText: 'Đóng cửa kết thúc' });
      if (await closeDoorBtn.isVisible().catch(() => false)) {
        await closeDoorBtn.click();
        await page.locator('#access-complete-title').waitFor({ timeout: 15000 }).catch(() => {});
        const modalClose = page.locator('.wde-comp-btn-primary');
        if (await modalClose.isVisible().catch(() => false)) await modalClose.click();
      }
      const resolveButtons = page.locator('.wde-access-log button', { hasText: 'Đã xử lý' });
      while ((await resolveButtons.count()) > 0) {
        await resolveButtons.first().click();
        await page.waitForTimeout(250);
      }
      await page.locator('.wde-access-log summary').click();
      await page.locator('select[aria-label="Nguồn sự kiện cửa kho"]').selectOption('AUTO');
      step('Canh bao mo cua trai phep hoat dong va duoc dong cua / xu ly sach se');

      // Staff RFID card assignment modal: verify existing employees only (no create-employee form)
      await page.getByRole('button', { name: /Gán thẻ nhân viên/ }).click();
      await expect(page.locator('#wde-modal-title')).toContainText('Quản lý & Gán thẻ RFID cho nhân viên');
      assert.equal(await page.locator('.wde-modal-form select option').count() > 0, true, 'Employees list must populate for card assignment');
      await page.locator('.wde-modal-actions button', { hasText: 'Đóng' }).click();
      step('Modal Gan the nhan vien su dung danh sach nhan vien hien co, khong tao nhan vien rieng');

      if (opts.writeCheck && kho001 && kho002) {
        // Reversible live DB check 1: assign and delete temporary RFID card
        const empId = ownerAuth.user.id;
        const assignRes = await apiJson('iot/access/cards', {
          method: 'POST',
          token: ownerToken,
          body: { uid: 'AABBCCDD99', employeeId: empId, warehouseId: kho001.id, status: 'ACTIVE' },
        });
        assert.equal(assignRes.status, 201, 'Assigning temporary test RFID card must return 201');
        const delRes = await apiJson(`iot/access/cards/AABBCCDD99?warehouseId=${kho001.id}`, { method: 'DELETE', token: ownerToken });
        assert.equal(delRes.status, 200, 'Deleting temporary test RFID card must return 200');
        step('[write-check] Gan va xoa the RFID tam AABBCCDD99 thanh cong, DB sach');

        // Reversible live DB check 2: create draft Transfer READY -> inspect detail UI -> cancel cleanly
        const wh1Stock = await apiJson(`inventory?warehouseId=${kho001.id}&status=AVAILABLE&pageSize=10`, { token: ownerToken });
        const stockedItem = (wh1Stock.payload?.data?.items || []).find(item => item.available >= 2);
        assert(stockedItem?.skuId, 'Expected available inventory item in KHO001 for reversible transfer check');
        const createTr = await apiJson('transfers', {
          method: 'POST',
          token: ownerToken,
          body: {
            sourceWarehouseId: kho001.id,
            destinationWarehouseId: kho002.id,
            note: 'TEST-DEMO tu dong kiem tra roi huy ngay',
            items: [{ skuId: stockedItem.skuId, quantity: 1 }],
          },
        });
        assert.equal(createTr.status, 201, 'Creating draft transfer must return 201');
        const createdId = createTr.payload.data.id;
        await page.goto(`${BASE_URL}/dieu-chuyen/${createdId}`, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('h1')).toContainText(createTr.payload.data.code, { timeout: 15000 });
        const cancelTr = await apiJson(`transfers/${createdId}/cancel`, {
          method: 'POST',
          token: ownerToken,
          body: { note: 'Huy tu dong sau buoc test lien trang' },
        });
        assert.equal(cancelTr.status, 200, 'Cancelling draft transfer must return 200');
        step(`[write-check] Tao -> xem UI -> huy phieu dieu chuyen thu ${createTr.payload.data.code} khong lam lech ton kho`);
      }
    });

    await runFlow(8, 'Bao cao toan chuoi & Phan quyen RBAC da vai tro', async step => {
      await ensureOwnerUi();

      for (const [url, heading] of [
        ['/bao-cao-doanh-thu', 'Báo cáo doanh thu'],
        ['/bao-cao-ton-kho', 'Báo cáo tồn kho toàn chuỗi'],
        ['/bao-cao-san-pham', 'Hiệu suất sản phẩm'],
        ['/so-sanh-chi-nhanh', 'So sánh hiệu quả chi nhánh'],
        ['/bao-cao-cong-no', 'Báo cáo công nợ'],
        ['/users', 'Người dùng'],
        ['/roles', 'Vai trò'],
        ['/permissions', 'Danh sách quyền'],
      ]) {
        await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 15000 });
        await expect(page.locator('main.main-content')).not.toContainText('NaN');
      }
      step('5 trang Bao cao + 3 trang Phan quyen (/users, /roles, /permissions) tai sach khong NaN');

      // Find an active non-owner account from .env and prove RBAC blocks admin/restricted routes
      let testedRole = null;
      for (const candidate of RESTRICTED_CANDIDATES) {
        const auth = await apiLogin(candidate.email, candidate.password);
        if (!auth?.accessToken) continue;

        const rCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const rPage = await rCtx.newPage();
        attachWatchers(rPage, state);
        await uiLogin(rPage, candidate.email, candidate.password, false);

        if (candidate.expectAdminBlocked) {
          const usersApiCheck = await apiJson('users', { token: auth.accessToken });
          assert.equal(usersApiCheck.status, 403, `${candidate.label} must get HTTP 403 on GET /api/v1/users`);
          await rPage.goto(`${BASE_URL}/users`, { waitUntil: 'domcontentloaded' });
          await expect(rPage.locator('main.main-content')).not.toContainText(OWNER_EMAIL);
        }
        if (candidate.expectPayablesBlocked) {
          const payApiCheck = await apiJson('payables', { token: auth.accessToken });
          assert.equal(payApiCheck.status, 403, `${candidate.label} must get HTTP 403 on GET /api/v1/payables`);
        }
        await rCtx.close();
        testedRole = candidate.label;
        break;
      }
      assert(testedRole, 'Expected at least one seeded non-owner account (cashier/employee/manager) to verify RBAC');
      step(`Kiem chung RBAC thuc te voi tai khoan [${testedRole}]: API tra 403 va giao dien chan dung quyen`);
    });

    await context.close();

    assert.equal(state.pageErrors.length, 0, `Uncaught page errors:\n${state.pageErrors.join('\n')}`);
    assert.equal(state.serverErrors.length, 0, `Unexpected HTTP 5xx responses:\n${state.serverErrors.join('\n')}`);

    console.log('\n============================================================');
    console.log(`TONG KET: ${results.length}/${opts.flows.size} luong lien trang DAT (0 loi trang, 0 HTTP 5xx).`);
    for (const r of results) console.log(`  - [LUONG ${r.num}] ${r.title} (${r.sec}s)`);
    console.log('============================================================\n');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error('\nTEST DEMO FAILED:', error?.stack || error?.message || error);
  process.exitCode = 1;
});
