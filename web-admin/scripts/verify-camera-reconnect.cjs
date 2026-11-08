// Exercises the real preview component against a connected ESP32. No stock writes.
const http = require('node:http');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium, expect } = require('@playwright/test');

(async () => {
  const ip = process.argv[2] || '192.168.1.86';
  const bundle = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {CameraPreview} from './src/app/kho/mo-hinh-3d/camera-preview'; function App(){const [open,setOpen]=React.useState(true);return <><button id="toggle" onClick={()=>setOpen(v=>!v)}>Toggle popup</button>{open&&<CameraPreview/>}</>};createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' },
    bundle: true, write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  });
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundle.outputFiles[0].contents); }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><div id="root"></div><script src="/app.js"></script>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage();
    const failures = []; page.on('pageerror', error => failures.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#esp-camera-ip').fill(ip);
    for (let i = 1; i <= 3; i++) {
      await page.locator('form button').click();
      await expect(page.locator('.li-camera-status')).toHaveClass(/connected/, { timeout: 20000 });
      await expect(page.locator('.li-camera-status')).toContainText('ESP32-CAM');
      await expect(page.locator('.li-camera-image img')).toBeVisible();
      await expect.poll(() => page.locator('.li-camera-image img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
      console.log(`PASS reconnect ${i}: ` + await page.locator('.li-camera-status').innerText());
    }
    await page.locator('#toggle').click();
    await page.locator('#toggle').click();
    await page.locator('form button').click();
    await expect(page.locator('.li-camera-status')).toHaveClass(/connected/, { timeout: 20000 });
    console.log('PASS close and reopen popup');
    await page.locator('#toggle').click();
    await page.locator('#toggle').click();
    await page.locator('#esp-camera-ip').fill('invalid address');
    await page.locator('form button').click();
    await expect(page.locator('.li-camera-status')).toHaveClass(/error/);
    if (failures.length) throw new Error(failures.join('\n'));
    console.log('PASS invalid address feedback and no browser errors');
  } finally { if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
