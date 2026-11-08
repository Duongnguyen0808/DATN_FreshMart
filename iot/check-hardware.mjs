// Read-only preflight for the two FreshMart ESP32 demo devices.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { networkInterfaces } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checks = [];
const report = (ok, name, detail) => { checks.push({ ok, name, detail }); console.log(`${ok ? 'OK' : 'CHECK'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const header = path => existsSync(path) ? readFileSync(path, 'utf8') : '';
const value = (source, name) => source.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`))?.[1] ?? '';
const envValue = (source, name) => source.match(new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
const cam = header(resolve(root, 'iot/esp32-cam/config.local.h'));
const door = header(resolve(root, 'iot/esp32-rc522/config.local.h'));
const backend = header(resolve(root, 'backend/.env'));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const token = envValue(backend, 'IOT_INGEST_TOKEN');

report(!!cam, 'Cấu hình ESP32-CAM', cam ? 'đã tìm thấy' : 'sao chép config.example.h thành config.local.h');
report(!!door, 'Cấu hình ESP32 + RC522', door ? 'đã tìm thấy' : 'sao chép config.example.h thành config.local.h');
report(token.length >= 32, 'Token backend', token.length >= 32 ? 'đã cấu hình' : 'cần IOT_INGEST_TOKEN từ 32 ký tự');

for (const [name, source, urlKeys] of [['ESP32-CAM', cam, ['API_URL']], ['ESP32 + RC522', door, ['RFID_API_URL', 'DOOR_API_URL', 'HEARTBEAT_API_URL']]]) {
  if (!source) continue;
  const wifi = value(source, 'WIFI_SSID');
  const warehouse = value(source, 'WAREHOUSE_ID');
  const device = value(source, 'DEVICE_ID');
  report(!!wifi && !wifi.startsWith('YOUR_'), `${name}: Wi-Fi`, wifi && !wifi.startsWith('YOUR_') ? 'đã nhập SSID' : 'SSID còn trống hoặc mẫu');
  report(uuid.test(warehouse), `${name}: UUID kho`, uuid.test(warehouse) ? 'đúng định dạng' : 'phải là UUID của kho trong FreshMart');
  report(!!device && !device.startsWith('YOUR_'), `${name}: mã thiết bị`, device && !device.startsWith('YOUR_') ? device : 'chưa điền');
  const tokenMatches = !!token && value(source, 'IOT_INGEST_TOKEN') === token;
  report(tokenMatches, `${name}: token`, tokenMatches ? 'khớp backend/.env' : 'phải khớp backend/.env');
  for (const key of urlKeys) {
    const raw = value(source, key);
    let parsed;
    try { parsed = new URL(raw); } catch { /* Invalid URL is reported below. */ }
    const valid = parsed?.protocol === 'http:' && !['localhost', '127.0.0.1', 'YOUR_PC_LAN_IP'].includes(parsed.hostname);
    report(valid, `${name}: ${key}`, valid ? `${parsed.hostname}:${parsed.port || 80}${parsed.pathname}` : 'dùng IP LAN của máy chạy backend, không dùng localhost');
    if (valid) {
      const localIps = Object.values(networkInterfaces()).flat().filter(Boolean).map(address => address.address);
      report(localIps.includes(parsed.hostname), `${name}: IP máy backend`, localIps.includes(parsed.hostname) ? 'IP còn thuộc máy này' : `IP ${parsed.hostname} không còn trên máy này; cập nhật config.local.h`);
    }
  }
}

if (door) {
  report(!!value(door, 'DOOR_ID'), 'ESP32 + RC522: mã cửa', value(door, 'DOOR_ID') || 'chưa điền DOOR_ID');
  report(value(door, 'WAREHOUSE_ID') === value(cam, 'WAREHOUSE_ID'), 'Hai board cùng kho', 'đối chiếu UUID kho trên hai board');
}

try {
  const require = createRequire(resolve(root, 'backend/package.json'));
  const { Client } = require('pg');
  const databaseUrl = envValue(backend, 'DATABASE_URL');
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2500 });
  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    const rows = await client.query('SELECT d.code AS device, o.code AS door, d."warehouseId" AS warehouse FROM warehouse_access_devices d LEFT JOIN warehouse_access_doors o ON o."deviceId" = d.id WHERE d."warehouseId" = $1', [value(door, 'WAREHOUSE_ID')]);
    const match = rows.rows.some(row => row.device === value(door, 'DEVICE_ID') && row.door === value(door, 'DOOR_ID'));
    report(match, 'Đăng ký thiết bị/cửa trong PostgreSQL', match ? 'khớp cấu hình firmware' : rows.rows.length ? `đã có: ${rows.rows.map(row => `${row.device}/${row.door || 'chưa có cửa'}`).join(', ')}` : 'chưa có thiết bị và cửa cho kho này');
    const cards = await client.query('SELECT count(*)::int AS total FROM warehouse_access_cards WHERE "warehouseId" = $1 AND status = $2', [value(door, 'WAREHOUSE_ID'), 'ACTIVE']);
    report(cards.rows[0].total > 0, 'Thẻ nhân viên đang hoạt động', `${cards.rows[0].total} thẻ trong kho`);
    await client.query('COMMIT');
  } finally { await client.end(); }
} catch (error) { report(false, 'Dữ liệu cửa kho trong PostgreSQL', error.code || 'chưa đọc được; kiểm tra backend/.env và migration'); }

const cli = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['arduino-cli'], { encoding: 'utf8', windowsHide: true });
report(cli.status === 0, 'Arduino CLI', cli.status === 0 ? 'có thể biên dịch firmware' : 'chưa có trong PATH; cần Arduino IDE hoặc arduino-cli để nạp board');

if (process.platform === 'win32') {
  const ports = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_SerialPort -ErrorAction SilentlyContinue | Select-Object -ExpandProperty DeviceID'], { encoding: 'utf8', timeout: 6000, windowsHide: true });
  report(!!ports.stdout?.trim(), 'Cổng COM', ports.stdout?.trim().replace(/\s+/g, ', ') || 'chưa phát hiện board USB-serial');
}

for (const path of ['/health', '/api/v1/health']) {
  try {
    const response = await fetch(`http://127.0.0.1:4000${path}`, { signal: AbortSignal.timeout(2000) });
    if (response.ok) { report(true, 'Backend cổng 4000', `HTTP ${response.status} (${path})`); break; }
    if (path === '/health') continue;
    report(false, 'Backend cổng 4000', `HTTP ${response.status}`);
  } catch {
    if (path === '/health') continue;
    report(false, 'Backend cổng 4000', 'chưa kết nối được; chạy npm run dev:backend');
  }
}

console.log(`\n${checks.filter(item => item.ok).length}/${checks.length} bước sẵn sàng. Kết quả này chưa thay thế việc quét QR/thẻ và mở cửa trên board thật.`);
if (checks.some(item => !item.ok)) process.exitCode = 1;
