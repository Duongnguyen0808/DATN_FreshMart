import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type CameraEndpointState = {
  deviceId: string;
  cameraIp: string;
  ssid: string;
  hostIp: string;
  port: string;
  updatedAt: string;
};

let latestCameraState: CameraEndpointState | null = null;
let lastSyncedSignature = '';
let syncInProgress: Promise<{
  synced: boolean;
  ssid: string;
  hostIp: string;
  cameraIp: string;
  port: string;
  message: string;
}> | null = null;

export function normalizeIpv4(raw: string | undefined | null): string {
  if (!raw) return '';
  const cleaned = raw.trim().replace(/^::ffff:/i, '');
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(cleaned) && !cleaned.startsWith('127.') ? cleaned : '';
}

export function detectHostLanIp(): string {
  const interfaces = os.networkInterfaces();
  const preferredNames = [/wi-?fi/i, /wlan/i, /wireless/i, /ethernet/i];
  const entries = Object.entries(interfaces);
  for (const pattern of preferredNames) {
    for (const [name, addrs] of entries) {
      if (!pattern.test(name) || !addrs) continue;
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('169.254.')) {
          return addr.address;
        }
      }
    }
  }
  for (const [, addrs] of entries) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('169.254.')) {
        return addr.address;
      }
    }
  }
  return '';
}

export function recordCameraDeviceIp(deviceId: string, headerIp?: string | null, remoteIp?: string | null) {
  const ip = normalizeIpv4(headerIp) || normalizeIpv4(remoteIp);
  if (!ip) return;
  latestCameraState = {
    deviceId: deviceId || latestCameraState?.deviceId || 'FRESHMART-CAMERA-IN-01',
    cameraIp: ip,
    ssid: latestCameraState?.ssid || '',
    hostIp: detectHostLanIp() || latestCameraState?.hostIp || '',
    port: latestCameraState?.port || '',
    updatedAt: new Date().toISOString(),
  };
}

export async function getLaptopWifiCredentials(): Promise<{ ssid: string; password: string; hostIp: string }> {
  const hostIp = detectHostLanIp();
  if (process.platform !== 'win32') {
    return { ssid: '', password: '', hostIp };
  }
  try {
    const { stdout: ifaceOut } = await execFileAsync('netsh', ['wlan', 'show', 'interfaces'], { timeout: 4000, windowsHide: true });
    const ssidMatch = ifaceOut.match(/^\s*SSID\s*:\s*(.+)$/m);
    const profileMatch = ifaceOut.match(/^\s*Profile\s*:\s*(.+)$/m);
    const ssid = (ssidMatch?.[1] ?? '').trim();
    const profile = (profileMatch?.[1] ?? ssid).trim();
    if (!ssid) return { ssid: '', password: '', hostIp };

    const { stdout: profileOut } = await execFileAsync('netsh', ['wlan', 'show', 'profile', `name=${profile}`, 'key=clear'], {
      timeout: 4000,
      windowsHide: true,
    });
    const keyMatch =
      profileOut.match(/^\s*Key Content\s*:\s*(.+)$/m) ??
      profileOut.match(/^\s*Nội dung khóa\s*:\s*(.+)$/im);
    const password = (keyMatch?.[1] ?? '').trim();
    return { ssid, password, hostIp };
  } catch {
    return { ssid: '', password: '', hostIp };
  }
}

export function getCameraDeviceStatus() {
  const hostIp = detectHostLanIp();
  return {
    cameraIp: latestCameraState?.cameraIp ?? '',
    deviceId: latestCameraState?.deviceId ?? 'FRESHMART-CAMERA-IN-01',
    ssid: latestCameraState?.ssid ?? '',
    hostIp,
    port: latestCameraState?.port ?? '',
    updatedAt: latestCameraState?.updatedAt ?? null,
  };
}

export async function syncLaptopWifiOverUsb(force = false) {
  if (syncInProgress) return syncInProgress;
  syncInProgress = (async () => {
    const { ssid, password, hostIp } = await getLaptopWifiCredentials();
    if (!ssid || !hostIp) {
      return {
        synced: false,
        ssid,
        hostIp,
        cameraIp: latestCameraState?.cameraIp ?? '',
        port: '',
        message: 'Chưa phát hiện kết nối Wi-Fi trên Laptop.',
      };
    }
    const signature = `${ssid}|${password}|${hostIp}`;
    if (!force && signature === lastSyncedSignature && latestCameraState?.cameraIp) {
      return {
        synced: true,
        ssid,
        hostIp,
        cameraIp: latestCameraState.cameraIp,
        port: latestCameraState.port,
        message: `Đã đồng bộ Wi-Fi ${ssid} (${latestCameraState.cameraIp}).`,
      };
    }
    if (process.platform !== 'win32') {
      return {
        synced: false,
        ssid,
        hostIp,
        cameraIp: latestCameraState?.cameraIp ?? '',
        port: '',
        message: 'Chỉ hỗ trợ đồng bộ cổng USB tự động trên Windows.',
      };
    }

    const payload = JSON.stringify({
      ssid,
      password,
      hostIp,
      apiUrl: `http://${hostIp}:4000/api/v1/iot/events`,
    });
    const payloadB64 = Buffer.from(`FM_WIFI_SYNC:${payload}\n`, 'utf8').toString('base64');

    const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$cmdLine = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payloadB64}'))
$usbPorts = Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\\((COM\\d+)\\)' -and ($_.Name -match 'CH340|CP210|USB|Serial|UART|JTAG') } | ForEach-Object {
  if ($_.Name -match '\\((COM\\d+)\\)') { $Matches[1] }
} | Select-Object -Unique
if (-not $usbPorts) { $usbPorts = [System.IO.Ports.SerialPort]::GetPortNames() }
$result = @{ synced = $false; port = ''; ip = ''; deviceId = '' }
foreach ($p in $usbPorts) {
  $sp = New-Object System.IO.Ports.SerialPort $p, 115200
  $sp.DtrEnable = $false
  $sp.RtsEnable = $false
  $sp.ReadTimeout = 500
  $sp.WriteTimeout = 1000
  try {
    $sp.Open()
    $sp.DiscardInBuffer()
    $sp.Write($cmdLine)
    $sp.Write("FM_PING\`n")
    $deadline = (Get-Date).AddMilliseconds(5500)
    while ((Get-Date) -lt $deadline) {
      try {
        $line = $sp.ReadLine().Trim()
        if ($line -match 'FM_(SYNC_ACK|STATUS):(\\{.+\\})') {
          $obj = $Matches[2] | ConvertFrom-Json
          $result.synced = $true
          $result.port = $p
          if ($obj.deviceId) { $result.deviceId = $obj.deviceId }
          if ($obj.ip -and $obj.ip -ne '0.0.0.0') {
            $result.ip = $obj.ip
            break
          }
        } elseif ($line -match 'Wi-Fi IP:\\s*(\\d+\\.\\d+\\.\\d+\\.\\d+)') {
          $result.synced = $true
          $result.port = $p
          $result.ip = $Matches[1]
          break
        }
      } catch {}
    }
  } catch {} finally {
    if ($sp.IsOpen) { $sp.Close() }
  }
  if ($result.synced) { break }
}
$result | ConvertTo-Json -Compress
`;

    try {
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
        timeout: 12000,
        windowsHide: true,
      });
      const jsonLine = stdout.trim().split(/\r?\n/).findLast(line => line.trim().startsWith('{')) ?? '{}';
      const parsed = JSON.parse(jsonLine) as { synced?: boolean; port?: string; ip?: string; deviceId?: string };
      const cameraIp = normalizeIpv4(parsed.ip) || latestCameraState?.cameraIp || '';
      if (parsed.synced) {
        lastSyncedSignature = signature;
        latestCameraState = {
          deviceId: parsed.deviceId || latestCameraState?.deviceId || 'FRESHMART-CAMERA-IN-01',
          cameraIp,
          ssid,
          hostIp,
          port: parsed.port || '',
          updatedAt: new Date().toISOString(),
        };
        return {
          synced: true,
          ssid,
          hostIp,
          cameraIp,
          port: parsed.port || '',
          message: cameraIp
            ? `Đã đồng bộ Wi-Fi "${ssid}" qua ${parsed.port} · Camera IP: ${cameraIp}`
            : `Đã gửi cấu hình Wi-Fi "${ssid}" qua ${parsed.port}. Đang chờ ESP32 nhận IP…`,
        };
      }
    } catch {
      // Ignore serial errors when port is busy or unplugged.
    }

    return {
      synced: Boolean(latestCameraState?.cameraIp),
      ssid,
      hostIp,
      cameraIp: latestCameraState?.cameraIp ?? '',
      port: latestCameraState?.port ?? '',
      message: latestCameraState?.cameraIp
        ? `ESP32-CAM đang kết nối tại ${latestCameraState.cameraIp}`
        : `Đã lấy Wi-Fi "${ssid}" (${hostIp}), nhưng cổng USB đang bận hoặc chưa phản hồi.`,
    };
  })().finally(() => {
    syncInProgress = null;
  });
  return syncInProgress;
}

let watcherStarted = false;
export function startAutomaticUsbWifiSyncWatcher() {
  if (watcherStarted || process.env.NODE_ENV === 'test') return;
  watcherStarted = true;
  // Initial check shortly after backend starts
  setTimeout(() => {
    void syncLaptopWifiOverUsb(false).catch(() => {});
  }, 2500);
  // Periodically check if laptop switched Wi-Fi or ESP32 hasn't reported its IP yet
  setInterval(() => {
    void syncLaptopWifiOverUsb(false).catch(() => {});
  }, 20000);
}

