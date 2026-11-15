'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/auth-api';

type Connection = { origin: string; id: number };
type CameraState = 'idle' | 'connecting' | 'connected' | 'error';
type CameraDeviceStatus = { cameraIp: string; ssid: string; hostIp: string; port: string; updatedAt: string | null };
type SyncWifiResult = { synced: boolean; ssid: string; hostIp: string; cameraIp: string; port: string; message: string };

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>(resolve => {
    const timer = window.setTimeout(done, ms);
    function done() {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });

/**
 * Extracts only the MOST RECENT complete JPEG frame (FFD8 ... FFD9) from the stream buffer
 * and discards any older queued frames so the video preview never lags behind real-time motion.
 */
function extractLatestJpeg(buffer: Uint8Array): { frame: Uint8Array | null; remaining: Uint8Array } {
  let lastEnd = -1;
  for (let i = buffer.length - 2; i >= 0; i--) {
    if (buffer[i] === 0xff && buffer[i + 1] === 0xd9) {
      lastEnd = i + 2;
      break;
    }
  }
  if (lastEnd < 0) return { frame: null, remaining: buffer };

  let lastStart = -1;
  for (let i = lastEnd - 2; i >= 0; i--) {
    if (buffer[i] === 0xff && buffer[i + 1] === 0xd8) {
      lastStart = i;
      break;
    }
  }
  if (lastStart < 0) {
    return { frame: null, remaining: buffer.slice(lastEnd) };
  }
  return {
    frame: buffer.subarray(lastStart, lastEnd),
    remaining: buffer.slice(lastEnd),
  };
}

export function CameraPreview({ onFrameBytes }: { onFrameBytes?: (bytes: Uint8Array) => void } = {}) {
  const [address, setAddress] = useState('');
  const [connection, setConnection] = useState<Connection | null>(null);
  const [status, setStatus] = useState<CameraState>('idle');
  const [frame, setFrame] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('Đang kết nối nhanh tới ESP32-CAM…');
  const autoConnectedIp = useRef('');
  const statusRef = useRef<CameraState>('idle');
  const currentBlobUrlRef = useRef('');
  const onFrameBytesRef = useRef(onFrameBytes);
  onFrameBytesRef.current = onFrameBytes;

  const updateStatus = useCallback((next: CameraState) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const openAddress = useCallback((rawAddress: string) => {
    try {
      const parsed = new URL(rawAddress.includes('://') ? rawAddress : `http://${rawAddress.trim()}`);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('invalid');
      parsed.port = parsed.port === '81' ? '' : parsed.port;
      localStorage.setItem('freshmart-camera-preview', rawAddress.trim());
      setAddress(rawAddress.trim());
      updateStatus('connecting');
      setMessage(`Đang kết nối luồng video tốc độ cao (${parsed.hostname})…`);
      setConnection({ origin: parsed.origin, id: Date.now() % 4294967295 });
    } catch {
      updateStatus('error');
      setMessage('Địa chỉ camera chưa đúng. Ví dụ: 192.168.1.86');
    }
  }, [updateStatus]);

  const syncWifiWithLaptop = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setMessage('Đang đồng bộ siêu tốc Wi-Fi & IP giữa Laptop và ESP32-CAM…');
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
    const saved = localStorage.getItem('freshmart-camera-preview')?.trim() ?? '';
    if (saved) {
      setAddress(saved);
      autoConnectedIp.current = saved;
      openAddress(saved);
    }
    let alive = true;
    const pollDeviceIp = async (triggerUsbIfEmpty: boolean) => {
      try {
        const info = await api<CameraDeviceStatus>('iot/camera-device-status');
        if (!alive) return;
        const currentState = statusRef.current;
        if (
          info.cameraIp &&
          (info.cameraIp !== autoConnectedIp.current || currentState === 'error' || currentState === 'idle')
        ) {
          autoConnectedIp.current = info.cameraIp;
          openAddress(info.cameraIp);
          return;
        }
        if (!info.cameraIp && triggerUsbIfEmpty && currentState !== 'connected') {
          const synced = await api<SyncWifiResult>('iot/camera-sync-wifi', 'POST', {});
          if (!alive) return;
          if (synced.cameraIp) {
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
    void pollDeviceIp(!saved);
    const timer = window.setInterval(() => {
      if (statusRef.current !== 'connected' && statusRef.current !== 'connecting') {
        void pollDeviceIp(false);
      }
    }, 2000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [openAddress]);

  useEffect(() => {
    return () => {
      if (currentBlobUrlRef.current) {
        URL.revokeObjectURL(currentBlobUrlRef.current);
        currentBlobUrlRef.current = '';
      }
    };
  }, []);

  useEffect(() => {
    if (!connection) return;
    const { origin, id } = connection;
    const controller = new AbortController();
    let active = true;
    let rendering = false;

    const showFrame = async (bytes: Uint8Array) => {
      if (!active || rendering || bytes.byteLength < 64) return;
      rendering = true;
      try {
        const next = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'image/jpeg' }));
        const image = new Image();
        image.src = next;
        try {
          await image.decode();
        } catch {
          URL.revokeObjectURL(next);
          return;
        }
        if (!active) {
          URL.revokeObjectURL(next);
          return;
        }
        const previous = currentBlobUrlRef.current;
        currentBlobUrlRef.current = next;
        setFrame(next);
        onFrameBytesRef.current?.(bytes);
        if (statusRef.current !== 'connected') {
          updateStatus('connected');
        }
        if (previous && previous !== next) {
          window.setTimeout(() => URL.revokeObjectURL(previous), 400);
        }
      } finally {
        rendering = false;
      }
    };

    const request = async (url: string, timeout = 3500) =>
      fetch(url, {
        cache: 'no-store',
        credentials: 'omit',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]),
      });

    const backendLatestUrl = () => {
      const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
      return `http://${host}:4000/api/v1/iot/camera-latest.jpg?t=${Date.now()}`;
    };

    const run = async () => {
      updateStatus('connecting');
      setMessage('Đang mở luồng video ESP32-CAM…');
      try {
        await request(`${origin}/preview/stop`, 700);
      } catch {
        /* Ignore if no prior viewer was active */
      }
      if (!active) return;

      const streamController = new AbortController();
      let lastFrame = Date.now();
      const watchdog = window.setInterval(() => {
        if (Date.now() - lastFrame > 4500) streamController.abort();
      }, 500);

      try {
        const streamUrl = new URL(origin);
        streamUrl.port = '81';
        streamUrl.pathname = '/stream';
        streamUrl.searchParams.set('sid', String(id));
        const response = await fetch(streamUrl, {
          cache: 'no-store',
          credentials: 'omit',
          signal: AbortSignal.any([controller.signal, streamController.signal]),
        });
        if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('multipart/')) {
          throw new Error('stream unavailable');
        }
        const reader = response.body.getReader();
        let pending: Uint8Array = new Uint8Array(0);
        try {
          while (active) {
            const { value, done } = await reader.read();
            if (done) break;
            const joined = new Uint8Array(pending.length + value.length);
            joined.set(pending);
            joined.set(value, pending.length);
            pending = joined;

            const extracted = extractLatestJpeg(pending);
            if (extracted.frame) {
              pending = extracted.remaining;
              lastFrame = Date.now();
              void showFrame(extracted.frame);
              if (active) {
                setMessage('Đã kết nối mượt (25 FPS) · Đưa mã QR vào khung ngắm, hệ thống tự động bắt mã tức thì.');
              }
            } else if (pending.length > 384 * 1024) {
              pending = new Uint8Array(0);
            }
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
      } catch {
        /* Fallback to rapid snapshot / backend relay if port 81 stream drops */
      } finally {
        window.clearInterval(watchdog);
        streamController.abort();
      }

      if (!active) return;
      let endpoint = 'snapshot';
      let failures = 0;
      while (active) {
        try {
          const response = await request(`${origin}/${endpoint}?t=${Date.now()}`, 2000);
          if (!response.ok || !response.headers.get('content-type')?.includes('image/')) throw new Error('no camera image');
          await showFrame(new Uint8Array(await response.arrayBuffer()));
          failures = 0;
          if (active) {
            setMessage('Đã kết nối ổn định · ESP32-CAM đang quét QR tự động.');
          }
        } catch {
          if (!active) return;
          // Try backend relay frame (pushed directly by ESP32-CAM) before counting a failure
          try {
            const relayResp = await request(backendLatestUrl(), 1500);
            if (relayResp.ok && relayResp.headers.get('content-type')?.includes('image/')) {
              await showFrame(new Uint8Array(await relayResp.arrayBuffer()));
              failures = 0;
              if (active) {
                setMessage('Đã kết nối qua luồng đồng bộ trực tiếp · Đưa mã QR vào khung ngắm.');
              }
              await pause(90, controller.signal);
              continue;
            }
          } catch {
            /* ignore relay error */
          }
          failures++;
          if (endpoint === 'snapshot' && failures === 1) endpoint = 'capture';
          if (failures >= 4) {
            updateStatus('error');
            setMessage('Không kết nối được camera. Hãy bấm "Đồng bộ Wi-Fi" hoặc kiểm tra cáp USB.');
            return;
          }
        }
        await pause(75, controller.signal);
      }
    };

    void run();
    return () => {
      active = false;
      controller.abort();
      void fetch(`${origin}/preview/stop?sid=${id}`, {
        cache: 'no-store',
        credentials: 'omit',
        keepalive: true,
        signal: AbortSignal.timeout(1000),
      }).catch(() => {});
    };
  }, [connection, updateStatus]);

  const connect = (event: React.FormEvent) => {
    event.preventDefault();
    openAddress(address);
  };

  return (
    <section className="li-camera-preview">
      <h3>Hình trực tiếp từ ESP32-CAM</h3>
      <p>Đồng bộ Wi-Fi & IP siêu tốc với Laptop (tự động lấy nét tương phản QR).</p>
      <form onSubmit={connect}>
        <label htmlFor="esp-camera-ip">Địa chỉ IP camera</label>
        <div>
          <input
            id="esp-camera-ip"
            value={address}
            onChange={event => setAddress(event.target.value)}
            placeholder="Tự động nhận IP (VD: 192.168.1.86)"
            autoComplete="off"
          />
          <button type="submit">
            {status === 'connected' ? 'Làm mới' : status === 'error' ? 'Thử lại' : status === 'connecting' ? 'Đang mở…' : 'Kết nối'}
          </button>
          <button
            type="button"
            onClick={() => void syncWifiWithLaptop()}
            disabled={syncing}
            style={{ background: '#0c5e58' }}
          >
            {syncing ? 'Đang đồng bộ…' : 'Đồng bộ Wi-Fi'}
          </button>
        </div>
      </form>
      <div className="li-camera-image" aria-busy={status === 'connecting'}>
        {frame && status !== 'error' && (
          <img
            src={frame}
            alt="Hình trực tiếp từ ESP32-CAM"
            onError={() => setFrame('')}
            style={{ filter: 'contrast(1.1) brightness(1.03)', willChange: 'contents' }}
          />
        )}
        <span className="li-camera-target" aria-hidden="true" />
        {(!frame || status === 'error') && (
          <span className="li-camera-placeholder">
            {status === 'connecting' && <i className="li-camera-spinner" />}
            {status === 'connecting'
              ? 'Đang kết nối camera…'
              : status === 'error'
                ? 'Chưa kết nối được camera'
                : 'Chưa kết nối camera'}
          </span>
        )}
      </div>
      <small className={`li-camera-status ${status}`} role="status">
        {message}
      </small>
    </section>
  );
}
