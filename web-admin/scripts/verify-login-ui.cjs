const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const dotenv = require('dotenv');

(async () => {
  const systemChrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await chromium.launch({ headless: true, executablePath: fs.existsSync(systemChrome) ? systemChrome : undefined });
  const output = path.join(__dirname, '..', 'artifacts', 'login-review');
  fs.mkdirSync(output, { recursive: true });
  const loginUrl = process.env.REVIEW_BASE_URL || 'http://localhost:3000/login';
  for (const [name, width, height] of [['desktop', 1440, 900], ['laptop', 1024, 768], ['tablet', 768, 1024], ['mobile', 390, 844], ['mobile-small', 320, 568], ['mobile-short', 390, 420]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Chào mừng trở lại' }).waitFor();
    await page.locator('.fm-login-frame').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(350);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) throw new Error(`${name}: horizontal overflow`);
    if (!await page.locator('#login-email').isVisible() || !await page.locator('#login-password').isVisible()) throw new Error(`${name}: login fields not visible`);
    if (!name.startsWith('mobile')) {
      const frame = await page.locator('.fm-login-frame').boundingBox();
      console.log(`${name} frame: ${Math.round(frame.x)}px / ${Math.round(frame.width)}px`);
      assert(frame.width >= 380 && frame.width <= 420, `${name}: form width outside requested range`);
      assert(frame.x >= 15 && frame.x + frame.width <= width - 15, `${name}: frame touches viewport edge`);
    }
    await page.locator('.fm-login-submit').scrollIntoViewIfNeeded();
    const surface = await page.locator('.fm-login-frame').evaluate(node => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, shadow: style.boxShadow, border: style.borderTopWidth, blur: style.backdropFilter };
    });
    assert.deepEqual(surface, { background: 'rgba(0, 0, 0, 0)', shadow: 'none', border: '0px', blur: 'none' });
    const submitBounds = await page.locator('.fm-login-submit').boundingBox();
    assert(submitBounds.y >= 0 && submitBounds.y + submitBounds.height <= height, `${name}: submit cannot be reached`);
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
    await page.close();
    console.log(`${name}: fields visible, no horizontal overflow`);
  }

  const interaction = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await interaction.goto(loginUrl, { waitUntil: 'domcontentloaded' });
  await interaction.evaluate(() => document.fonts.ready);
  await interaction.waitForTimeout(250);
  await interaction.locator('#login-email').focus();
  await interaction.keyboard.press('Tab');
  assert.equal(await interaction.evaluate(() => document.activeElement?.id), 'login-password', 'Tab must reach password field');
  await interaction.keyboard.press('Tab');
  assert.equal(await interaction.getByRole('button', { name: 'Hiện mật khẩu' }).evaluate(node => node === document.activeElement), true, 'Tab must reach visibility button');
  await interaction.getByRole('button', { name: 'Hiện mật khẩu' }).click();
  assert.equal(await interaction.locator('#login-password').getAttribute('type'), 'text');
  await interaction.getByRole('button', { name: 'Ẩn mật khẩu' }).click();
  assert.equal(await interaction.locator('#login-password').getAttribute('type'), 'password');
  console.log('keyboard and password visibility: passed');

  await interaction.locator('#login-email').fill('nonexistent-login-check@freshmart.invalid');
  await interaction.locator('#login-password').fill('incorrect-password');
  const rejectedLogin = interaction.waitForResponse(response => response.url().endsWith('/auth/login') && response.request().method() === 'POST');
  await interaction.locator('.fm-login-submit').click();
  assert.equal((await rejectedLogin).status(), 401);
  await interaction.locator('.fm-login-error').waitFor();
  await interaction.screenshot({ path: path.join(output, 'error.png'), fullPage: true });
  assert.equal(new URL(interaction.url()).pathname, '/login');
  console.log('incorrect credentials: error shown, remains on login');
  await interaction.close();

  const network = await browser.newPage();
  await network.emulateMedia({ reducedMotion: 'reduce' });
  await network.goto(loginUrl, { waitUntil: 'domcontentloaded' });
  await network.evaluate(() => document.fonts.ready);
  assert.equal(await network.locator('.fm-login-frame').evaluate(node => getComputedStyle(node).animationName), 'none');
  let releaseRequest;
  const pendingRequest = new Promise(resolve => { releaseRequest = resolve; });
  await network.route('**/auth/login', async route => { await pendingRequest; await route.abort('failed'); });
  await network.locator('#login-email').fill('network-check@freshmart.invalid');
  await network.locator('#login-password').fill('test-password');
  await network.locator('.fm-login-submit').click();
  await network.locator('.fm-login-submit[aria-busy="true"]').waitFor();
  assert.equal(await network.locator('.fm-login-submit').isDisabled(), true);
  await network.screenshot({ path: path.join(output, 'loading.png'), fullPage: true });
  releaseRequest();
  await network.locator('.fm-login-error').waitFor();
  assert.match(await network.locator('.fm-login-error').innerText(), /kết nối|máy chủ/i);
  console.log('loading, reduced motion and network failure: passed');
  await network.close();

  const autofill = await browser.newPage();
  await autofill.goto(loginUrl, { waitUntil: 'domcontentloaded' });
  await autofill.evaluate(() => document.fonts.ready);
  await autofill.waitForTimeout(250);
  const cdp = await autofill.context().newCDPSession(autofill);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  for (const selector of ['#login-email', '#login-password']) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['autofill'] });
    await autofill.locator(selector).focus();
    await autofill.waitForTimeout(220);
    const colors = await autofill.locator(selector).evaluate(node => {
      const style = getComputedStyle(node);
      return { text: style.webkitTextFillColor, caret: style.caretColor, shadow: style.boxShadow };
    });
    assert.equal(colors.text, 'rgb(38, 59, 55)');
    assert.equal(colors.caret, 'rgb(8, 127, 120)');
    assert.match(colors.shadow, /248, 250, 250/);
  }
  await autofill.screenshot({ path: path.join(output, 'autofill.png'), fullPage: true });
  await autofill.close();
  console.log('autofill CSS (Chrome forced state): text, caret and background passed');

  const envPath = path.join(__dirname, '..', '..', 'backend', '.env');
  if (fs.existsSync(envPath)) {
    const config = dotenv.parse(fs.readFileSync(envPath));
    const email = config.DEMO_MANAGER_EMAIL;
    const password = config.DEMO_MANAGER_PASSWORD;
    if (email && password) {
      const success = await browser.newPage();
      await success.goto(loginUrl, { waitUntil: 'domcontentloaded' });
      await success.locator('#login-email').fill(email);
      await success.locator('#login-password').fill(password);
      await success.locator('.fm-login-remember input').check();
      await success.locator('.fm-login-submit').click();
      await success.waitForURL(url => url.pathname !== '/login', { timeout: 10000 });
      assert.equal(await success.evaluate(() => localStorage.getItem('smartchain-login-email')), email);
      assert.equal(await success.evaluate(() => localStorage.getItem('smartchain-login-password')), null);
      assert.equal(await success.evaluate(secret => Object.values(localStorage).some(value => value.includes(secret)), password), false);
      console.log('real login: redirected; only email remembered');
      await success.close();
    } else console.log('real login: skipped (demo account not configured)');
  }
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
