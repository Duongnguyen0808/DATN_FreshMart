'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/auth-api';

type Connection = { origin: string; id: number };
type CameraState = 'idle' | 'connecting' | 'connected' | 'error';
type CameraDeviceStatus = { cameraIp: string; ssid: string; hostIp: string; port: string; updatedAt: string | null };
type SyncWifiResult = { synced: boolean; ssid: string; hostIp: string; cameraIp: string; port: string; message: string };
const pause = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => { const timer = window.setTimeout(done, ms); function done() { window.clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); } signal.addEventListener('abort', done, { once: true }); });

export function CameraPreview() {
  const [address, setAddress] = useState('');
  const [connection, setConnection] = useState<Connection | null>(null);
  const [status, setStatus] = useState<CameraState>('idle');
  const [frame, setFrame] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('Đang tự động dò IP ESP32-CAM theo Wi-Fi của Laptop…');
  const autoConnectedIp = useRef('');

  const openAddress = useCallback((rawAddress: string) => {
    try {
      const parsed = new URL(rawAddress.includes('://') ? rawAddress : `http://${rawAddress.trim()}`);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('invalid');
      parsed.port = parsed.port === '81' ? '' : parsed.port;
      localStorage.setItem('freshmart-camera-preview', rawAddress.trim());
      setAddress(rawAddress.trim());
      setStatus('connecting');
      setFrame('');
      setMessage(`Đang kết nối tới ESP32-CAM (${parsed.hostname})…`);
      setConnection({ origin: parsed.origin, id: Date.now() % 4294967295 });
    } catch {
      setStatus('error');
      setMessage('Địa chỉ camera chưa đúng. Ví dụ: 192.168.1.86');
    }
  }, []);

  const syncWifiWithLaptop = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setMessage('Đang đồng bộ Wi-Fi & IP từ Laptop sang ESP32 qua cổng USB…');
    try {
      const result = await api<SyncWifiResult>('iot/camera-sync-wifi', 'POST', {});
      if (result.cameraIp) {
        autoConnectedIp.current = result.cameraIp;
        openAddress(result.cameraIp);
      } else {
        setMessage(result.message || 'Đã gửi cấu hình Wi-Fi xuống ESP32. Đang chờ thiết bị nhận IP…');
      }
    } catch {
      setMessage('Không gọi được đồng bộ tự động. Bạn vẫn có thể nhập IP camera để kết nối.');
    } finally {
      setSyncing(false);
    }
  }, [openAddress, syncing]);

  useEffect(() => {
    const saved = localStorage.getItem('freshmart-camera-preview') ?? '';
    if (saved) setAddress(saved);
    let alive = true;
    const pollDeviceIp = async (triggerUsbIfEmpty: boolean) => {
      try {
        const info = await api<CameraDeviceStatus>('iot/camera-device-status');
        if (!alive) return;
        if (info.cameraIp && info.cameraIp !== autoConnectedIp.current) {
          autoConnectedIp.current = info.cameraIp;
          openAddress(info.cameraIp);
          return;
        }
        if (!info.cameraIp && triggerUsbIfEmpty) {
          const synced = await api<SyncWifiResult>('iot/camera-sync-wifi', 'POST', {});
          if (!alive) return;
          if (synced.cameraIp && synced.cameraIp !== autoConnectedIp.current) {
            autoConnectedIp.current = synced.cameraIp;
            openAddress(synced.cameraIp);
          } else if (synced.message) {
            setMessage(synced.message);
          }
        }
      } catch {
        // Keep manual IP fallback working in isolated tests.
      }
    };
    void pollDeviceIp(true);
    const timer = window.setInterval(() => {
      if (status !== 'connected') void pollDeviceIp(false);
    }, 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [openAddress, status]);
  useEffect(() => {
    if (!connection) return;
    const { origin, id } = connection;
    const controller = new AbortController();
    let objectUrl = '', active = true;
    const showFrame = async (bytes: Uint8Array) => {
      if (!active) return;
      const next = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'image/jpeg' }));
      // Decode before replacing the visible frame to avoid a blank flash between JPEGs.
      const image = new Image(); image.src = next;
      try { await image.decode(); } catch { URL.revokeObjectURL(next); return; }
      if (!active) { URL.revokeObjectURL(next); return; }
      const previous = objectUrl; objectUrl = next; setFrame(next); setStatus('connected');
      if (previous) URL.revokeObjectURL(previous);
    };
    const request = async (url: string, timeout = 7000) => fetch(url, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]) });
    const run = async () => {
      setStatus('connecting'); setFrame(''); setMessage('Đang kết nối tới ESP32-CAM…');
      // Port 80 remains available while port 81 streams. Release a previous viewer
      // before opening another stream; old firmware may return 404 here.
      try { await request(`${origin}/preview/stop`, 1500); } catch { /* Use snapshot fallback if the old stream cannot be stopped. */ }
      if (!active) return;
      const streamController = new AbortController();
      let lastFrame = Date.now();
      const watchdog = window.setInterval(() => { if (Date.now() - lastFrame > 7000) streamController.abort(); }, 500);
      try {
        const streamUrl = new URL(origin); streamUrl.port = '81'; streamUrl.pathname = '/stream'; streamUrl.searchParams.set('sid', String(id));
        const response = await fetch(streamUrl, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.any([controller.signal, streamController.signal]) });
        if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('multipart/')) throw new Error('stream unavailable');
        const reader = response.body.getReader();
        let pending = new Uint8Array(0);
        try {
          while (active) {
            const { value, done } = await reader.read(); if (done) break;
            const joined = new Uint8Array(pending.length + value.length); joined.set(pending); joined.set(value, pending.length); pending = joined;
            let start = -1;
            for (let i = 0; i + 1 < pending.length; i++) {
              if (start < 0 && pending[i] === 255 && pending[i + 1] === 216) start = i;
              if (start >= 0 && pending[i] === 255 && pending[i + 1] === 217) {
                await showFrame(pending.subarray(start, i + 2)); lastFrame = Date.now();
                if (active) setMessage('Đã kết nối · ESP32-CAM đang quét QR tự động. Giữ mã rõ nét trước camera; không cần bấm chụp.');
                pending = pending.slice(i + 2); i = -1; start = -1;
              }
            }
            if (pending.length > 512 * 1024) throw new Error('invalid camera frame');
          }
        } finally { await reader.cancel().catch(() => {}); }
      } catch { /* A snapshot still lets the user align the camera if streaming fails. */ }
      finally { window.clearInterval(watchdog); streamController.abort(); }
      if (!active) return;
      setStatus('connecting'); setMessage('Đang thử kết nối bằng ảnh camera…');
      let endpoint = 'snapshot', failures = 0;
      while (active) {
        try {
          const response = await request(`${origin}/${endpoint}?t=${Date.now()}`, 4000);
          if (!response.ok || !response.headers.get('content-type')?.includes('image/')) throw new Error('no camera image');
          await showFrame(new Uint8Array(await response.arrayBuffer())); failures = 0;
          if (active) setMessage(endpoint === 'capture' ? 'Đã có hình CameraWebServer thử nghiệm; cần firmware FreshMart để nhận QR.' : 'Video bị gián đoạn, đang cập nhật ảnh xem trước. ESP32 vẫn quét QR tự động; bấm Kết nối lại để mở video.');
        } catch {
          if (!active) return;
          failures++;
          if (endpoint === 'snapshot' && failures === 1) endpoint = 'capture';
          if (failures >= 3) { setStatus('error'); setMessage('Không kết nối được camera. Kiểm tra IP và nguồn ESP32, rồi bấm Kết nối lại.'); return; }
        }
        await pause(500, controller.signal);
      }
    };
    void run();
    return () => {
      active = false; controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      // Session ID prevents cleanup from an old popup stopping a newer viewer.
      void fetch(`${origin}/preview/stop?sid=${id}`, { cache: 'no-store', credentials: 'omit', keepalive: true, signal: AbortSignal.timeout(1500) }).catch(() => {});
    };
  }, [connection]);
  const connect = (event: React.FormEvent) => {
    event.preventDefault();
    openAddress(address);
  };
  return <section className="li-camera-preview"><h3>Hình từ ESP32-CAM</h3><p>Tự động đồng bộ Wi-Fi & IP với Laptop qua USB (hoặc nhập IP thủ công).</p><form onSubmit={connect}><label htmlFor="esp-camera-ip">Địa chỉ IP camera</label><div><input id="esp-camera-ip" value={address} onChange={event => setAddress(event.target.value)} placeholder="Tự động nhận IP khi cắm USB" autoComplete="off"/><button type="submit">{status === 'connecting' ? 'Thử lại' : connection ? 'Kết nối lại' : 'Kết nối'}</button><button type="button" onClick={() => void syncWifiWithLaptop()} disabled={syncing} style={{ background: '#0f766e' }}>{syncing ? 'Đang đồng bộ…' : 'Đồng bộ Wi-Fi'}</button></div></form><div className="li-camera-image" aria-busy={status === 'connecting'}>{frame && status !== 'error' && <img src={frame} alt="Hình trực tiếp từ ESP32-CAM"/>}<span className="li-camera-target" aria-hidden="true"/>{(!frame || status === 'error') && <span className="li-camera-placeholder">{status === 'connecting' && <i className="li-camera-spinner"/>}{status === 'connecting' ? 'Đang kết nối camera…' : status === 'error' ? 'Chưa kết nối được camera' : 'Chưa kết nối camera'}</span>}</div><small className={`li-camera-status ${status}`} role="status">{message}</small></section>;
}
