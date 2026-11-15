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

let cachedWifiCreds: { ssid: string; password: string; hostIp: string; at: number } | null = null;

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
        if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('169.254.') && !addr.address.startsWith('26.')) {
          return addr.address;
        }
      }
    }
  }
  for (const [, addrs] of entries) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('169.254.') && !addr.address.startsWith('26.')) {
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
    ssid: latestCameraState?.ssid || cachedWifiCreds?.ssid || '',
    hostIp: detectHostLanIp() || latestCameraState?.hostIp || '',
    port: latestCameraState?.port || '',
    updatedAt: new Date().toISOString(),
  };
}

export async function getLaptopWifiCredentials(useCache = true): Promise<{ ssid: string; password: string; hostIp: string }> {
  const hostIp = detectHostLanIp();
  if (useCache && cachedWifiCreds && Date.now() - cachedWifiCreds.at < 15_000 && cachedWifiCreds.hostIp === hostIp && cachedWifiCreds.ssid) {
    return { ssid: cachedWifiCreds.ssid, password: cachedWifiCreds.password, hostIp };
  }
  if (process.platform !== 'win32') {
    return { ssid: '', password: '', hostIp };
  }
  try {
    const { stdout: ifaceOut } = await execFileAsync('netsh', ['wlan', 'show', 'interfaces'], { timeout: 2500, windowsHide: true });
    const ssidMatch = ifaceOut.match(/^\s*SSID\s*:\s*(.+)$/m);
    const profileMatch = ifaceOut.match(/^\s*Profile\s*:\s*(.+)$/m);
    const ssid = (ssidMatch?.[1] ?? '').trim();
    const profile = (profileMatch?.[1] ?? ssid).trim();
    if (!ssid) return { ssid: '', password: '', hostIp };

    const { stdout: profileOut } = await execFileAsync('netsh', ['wlan', 'show', 'profile', `name=${profile}`, 'key=clear'], {
      timeout: 2500,
      windowsHide: true,
    });
    const keyMatch =
      profileOut.match(/^\s*Key Content\s*:\s*(.+)$/m) ??
      profileOut.match(/^\s*Nội dung khóa\s*:\s*(.+)$/im);
    const password = (keyMatch?.[1] ?? '').trim();
    cachedWifiCreds = { ssid, password, hostIp, at: Date.now() };
    return { ssid, password, hostIp };
  } catch {
    return { ssid: cachedWifiCreds?.ssid ?? '', password: cachedWifiCreds?.password ?? '', hostIp };
  }
}

async function probeCameraOverHttp(candidateIp: string, hostIp: string): Promise<{ ip: string; ssid: string; deviceId: string } | null> {
  const ip = normalizeIpv4(candidateIp);
  if (!ip) return null;
  try {
    const url = `http://${ip}/status${hostIp ? `?hostIp=${encodeURIComponent(hostIp)}` : ''}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(700),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { ip?: string; ssid?: string; deviceId?: string; ready?: boolean };
    const resolvedIp = normalizeIpv4(data.ip) || ip;
    return {
      ip: resolvedIp,
      ssid: data.ssid || '',
      deviceId: data.deviceId || 'FRESHMART-CAMERA-IN-01',
    };
  } catch {
    return null;
  }
}

export function getCameraDeviceStatus() {
  const hostIp = detectHostLanIp();
  return {
    cameraIp: latestCameraState?.cameraIp ?? '',
    deviceId: latestCameraState?.deviceId ?? 'FRESHMART-CAMERA-IN-01',
    ssid: latestCameraState?.ssid || cachedWifiCreds?.ssid || '',
    hostIp,
    port: latestCameraState?.port ?? '',
    updatedAt: latestCameraState?.updatedAt ?? null,
  };
}

export async function syncLaptopWifiOverUsb(force = false) {
  if (syncInProgress) return syncInProgress;
  syncInProgress = (async () => {
    const { ssid, password, hostIp } = await getLaptopWifiCredentials(!force);
    const signature = `${ssid}|${password}|${hostIp}`;

    // Fast path 1: Check if ESP32-CAM is ALREADY reachable over HTTP on LAN (takes <60ms, avoids CH340 USB reset!)
    const candidateIps = Array.from(
      new Set([
        latestCameraState?.cameraIp ?? '',
        hostIp.startsWith('192.168.1.') ? '192.168.1.86' : '',
      ].filter(Boolean)),
    );

    for (const candidate of candidateIps) {
      const httpProbe = await probeCameraOverHttp(candidate, hostIp);
      if (httpProbe && (!ssid || !httpProbe.ssid || httpProbe.ssid === ssid)) {
        lastSyncedSignature = signature;
        latestCameraState = {
          deviceId: httpProbe.deviceId,
          cameraIp: httpProbe.ip,
          ssid: httpProbe.ssid || ssid,
          hostIp,
          port: latestCameraState?.port || 'LAN',
          updatedAt: new Date().toISOString(),
        };
        return {
          synced: true,
          ssid: httpProbe.ssid || ssid,
          hostIp,
          cameraIp: httpProbe.ip,
          port: latestCameraState.port,
          message: `Đã kết nối nhanh Wi-Fi "${httpProbe.ssid || ssid}" · Camera IP: ${httpProbe.ip}`,
        };
      }
    }

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

    // Reset-aware USB Serial provisioning:
    // CH340 pulses DTR/RTS on Open(), resetting ESP32-CAM. We send immediately AND resend right after boot.
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
  $sp.ReadTimeout = 250
  $sp.WriteTimeout = 600
  try {
    $sp.Open()
    $sp.DiscardInBuffer()
    $sp.Write($cmdLine)
    $sp.Write("FM_PING\`n")
    $openedAt = Get-Date
    $resentAfterBoot = $false
    $deadline = $openedAt.AddMilliseconds(4200)
    while ((Get-Date) -lt $deadline) {
      $elapsed = ((Get-Date) - $openedAt).TotalMilliseconds
      if (-not $resentAfterBoot -and $elapsed -ge 1450) {
        $resentAfterBoot = $true
        $sp.Write($cmdLine)
        $sp.Write("FM_PING\`n")
      }
      try {
        $line = $sp.ReadLine().Trim()
        if ($line -match 'FM_BOOT_READY|Camera initialized') {
          $resentAfterBoot = $true
          $sp.Write($cmdLine)
          $sp.Write("FM_PING\`n")
        } elseif ($line -match 'FM_(SYNC_ACK|STATUS):(\\{.+\\})') {
          $obj = $Matches[2] | ConvertFrom-Json
          $result.synced = $true
          $result.port = $p
          if ($obj.deviceId) { $result.deviceId = $obj.deviceId }
          if ($obj.ip -and $obj.ip -ne '0.0.0.0' -and $obj.ip -ne '') {
            $result.ip = $obj.ip
            break
          }
        } elseif ($line -match 'Wi-Fi IP:\\s*(\\d+\\.\\d+\\.\\d+\\.\\d+)') {
          $result.synced = $true
          $result.port = $p
          $result.ip = $Matches[1]
          break
        }
      } catch {
        if ($result.synced -and -not $result.ip) {
          $sp.Write("FM_PING\`n")
        }
      }
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
        timeout: 7500,
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
  // Warm up Wi-Fi credential cache and probe camera immediately on startup
  setTimeout(() => {
    void getLaptopWifiCredentials(false)
      .then(() => syncLaptopWifiOverUsb(false))
      .catch(() => {});
  }, 800);
  // Periodically verify if camera is reachable or laptop switched Wi-Fi
  setInterval(() => {
    void getLaptopWifiCredentials(false)
      .then(() => {
        if (!latestCameraState?.cameraIp) {
          return syncLaptopWifiOverUsb(false);
        }
      })
      .catch(() => {});
  }, 15_000);
}
