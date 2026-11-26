import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  extractBarcodeQueryFromText,
  isExternalHttpUrl,
  PosScannerEngine,
  type NativeBarcodeDetector,
} from '../../lib/pos-camera-scanner';
import { extractInvoiceReturnTarget, type InvoiceReturnTarget } from '../../lib/invoice-receipt';
import { ProductImage } from '../ui/product-image';
import { Icon } from '../ui/icon';
import type { Inventory } from '../../lib/inventory-api';
import { categoryTheme } from '../../lib/category-theme';
import { CategoryBadge } from '../products/category-badge';
import { api } from '../../lib/auth-api';
import { CameraPreview } from '../../app/kho/mo-hinh-3d/camera-preview';
import '../../app/kho/mo-hinh-3d/live-inbound.css';

function uint8ToBase64DataUrl(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

type PosScanResult = {
  decoded: boolean;
  reason?: string;
  code: string | null;
  format: string | null;
  resolvedSkuId: string | null;
  resolvedBarcode: string | null;
};

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1').replace(/\/$/, '');

let sharedAudioCtx: AudioContext | null = null;
function playPosScanSound(kind: 'success' | 'error') {
  if (typeof window === 'undefined') return;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;
  try {
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') sharedAudioCtx = new AudioCtx();
    if (sharedAudioCtx.state === 'suspended') void sharedAudioCtx.resume();
    const ctx = sharedAudioCtx;
    const playTone = (freq: number, startOffset: number, duration: number, type: OscillatorType, gainPeak: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startOffset);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + startOffset);
      gain.gain.exponentialRampToValueAtTime(gainPeak, ctx.currentTime + startOffset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startOffset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + startOffset);
      osc.stop(ctx.currentTime + startOffset + duration + 0.02);
    };
    if (kind === 'success') {
      // Tiếng "tít!" gọn đặc trưng của máy quét mã vạch siêu thị (~1850 Hz)
      playTone(1850, 0, 0.11, 'sine', 0.22);
    } else {
      // Hai tiếng trầm cảnh báo khi mã không khớp hoặc hết tồn khả dụng
      playTone(420, 0, 0.11, 'triangle', 0.2);
      playTone(320, 0.15, 0.16, 'triangle', 0.2);
    }
  } catch {
    // Bỏ qua nếu trình duyệt chặn phát âm thanh trước khi có tương tác
  }
}

export function PosQuantity({ name, value, max, onChange }: { name: string; value: number; max: number; onChange: (value: number) => void }) {
  return <div className="pos-quantity">
    <button type="button" aria-label={`Giảm số lượng ${name}`} disabled={value <= 1} onClick={() => onChange(value - 1)}>−</button>
    <input aria-label={`Số lượng ${name}`} type="number" min={1} max={max} step={1} value={value} onChange={event => onChange(Number(event.target.value))}/>
    <button type="button" aria-label={`Tăng số lượng ${name}`} disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
  </div>;
}

export function PosCatalog({ rows, ready, loading, query, onQuery, onAdd, onBarcodeScanned, onInvoiceReturnScanned, quantities, promoBadges }: {
  rows: Inventory[]; ready: boolean; loading: boolean; query: string;
  onQuery: (value: string) => void; onAdd: (stock: Inventory) => void;
  onBarcodeScanned?: (code: string, resolvedSkuId?: string | null) => boolean | Promise<boolean>;
  onInvoiceReturnScanned?: (target: InvoiceReturnTarget) => void | Promise<void>;
  quantities: Record<string, number>;
  promoBadges?: Record<string, { label: string; isBogo: boolean }>;
}) {
  const [category, setCategory] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [cameraMode, setCameraMode] = useState<'esp32' | 'webcam'>('esp32');
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [scanTone, setScanTone] = useState<'idle' | 'ok' | 'warn'>('idle');
  const [scanStatus, setScanStatus] = useState('Đưa mã vạch / QR sản phẩm vào khung camera để thêm vào giỏ');
  const searchRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastCodeRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const latestEspBytesRef = useRef<{ bytes: Uint8Array; at: number } | null>(null);
  const barcodeDetectorRef = useRef<NativeBarcodeDetector | null>(null);
  const scannerEngineRef = useRef<PosScannerEngine | null>(null);
  const scanCounterRef = useRef<number>(0);
  const scanInFlightRef = useRef(false);

  // Fresh refs keep the live timer loop free of stale React closures
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const onBarcodeScannedRef = useRef(onBarcodeScanned);
  onBarcodeScannedRef.current = onBarcodeScanned;
  const onInvoiceReturnScannedRef = useRef(onInvoiceReturnScanned);
  onInvoiceReturnScannedRef.current = onInvoiceReturnScanned;
  const onAddRef = useRef(onAdd);
  onAddRef.current = onAdd;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  useEffect(() => {
    try {
      scannerEngineRef.current = new PosScannerEngine();
    } catch {
      scannerEngineRef.current = null;
    }

    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      void (async () => {
        try {
          const BD = (window as unknown as {
            BarcodeDetector: {
              new (opts?: { formats: string[] }): NativeBarcodeDetector;
              getSupportedFormats?: () => Promise<string[]>;
            };
          }).BarcodeDetector;
          let formats = ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code'];
          if (typeof BD.getSupportedFormats === 'function') {
            const supported = await BD.getSupportedFormats();
            formats = formats.filter(f => supported.includes(f));
          }
          if (formats.length > 0) {
            barcodeDetectorRef.current = new BD({ formats });
          }
        } catch {
          barcodeDetectorRef.current = null;
        }
      })();
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== 'F3' || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, [ready]);

  const matchesLoadedRow = (rawCode: string, resolvedSkuId?: string | null) => {
    const clean = extractBarcodeQueryFromText(rawCode);
    return rowsRef.current.find(r =>
      (resolvedSkuId && r.skuId === resolvedSkuId) ||
      r.sku.barcode?.toLowerCase() === clean ||
      r.sku.code.toLowerCase() === clean ||
      r.sku.product.code.toLowerCase() === clean
    );
  };

  const handleDetectedCode = async (code: string, format = 'BARCODE', resolvedSkuId?: string | null) => {
    const raw = code.trim();
    if (!raw) return;

    // Recognize FreshMart receipt return QR right at POS camera (jumps straight to /hoa-don/[id]?return=1)
    const returnTarget = extractInvoiceReturnTarget(raw);
    if (returnTarget && onInvoiceReturnScannedRef.current) {
      const now = Date.now();
      const dedupeKey = returnTarget.kind === 'id' ? `inv:${returnTarget.invoiceId}` : `inv:${returnTarget.invoiceCode}`;
      if (lastCodeRef.current.code === dedupeKey && now - lastCodeRef.current.at < 2500) return;
      lastCodeRef.current = { code: dedupeKey, at: now };
      if (soundEnabledRef.current) playPosScanSound('success');
      setScanTone('ok');
      setScanStatus('✅ Đã nhận diện QR hóa đơn — Đang mở màn hình đổi trả hàng…');
      await onInvoiceReturnScannedRef.current(returnTarget);
      return;
    }

    const clean = extractBarcodeQueryFromText(raw);
    const now = Date.now();
    if (lastCodeRef.current.code === clean && now - lastCodeRef.current.at < 1800) return;

    // Ignore unrelated third-party QR URLs (e.g. packaging traceability links printed next to EAN-13)
    // unless the user specifically resolved a SKU or the code matches inventory
    const localHit = matchesLoadedRow(raw, resolvedSkuId);
    if (!localHit && !resolvedSkuId && isExternalHttpUrl(raw)) {
      setScanTone('warn');
      setScanStatus('Đã thấy mã QR bao bì — tiếp tục căn mã vạch (Barcode) vào khung xanh…');
      return;
    }

    lastCodeRef.current = { code: clean, at: now };

    const callback = onBarcodeScannedRef.current;
    if (callback) {
      const matched = await callback(clean, resolvedSkuId);
      if (soundEnabledRef.current) playPosScanSound(matched ? 'success' : 'error');
      setScanTone(matched ? 'ok' : 'warn');
      setScanStatus(matched
        ? `✅ Đã thêm mã ${raw} (${format}) vào giỏ hàng`
        : `⚠️ Đọc được ${raw} (${format}) nhưng không khớp sản phẩm còn tồn trong kho này`);
      return;
    }

    if (localHit && localHit.available > 0) {
      onAddRef.current(localHit);
      if (soundEnabledRef.current) playPosScanSound('success');
      setScanTone('ok');
      setScanStatus(`✅ Đã thêm "${localHit.sku.product.name}" (${raw})`);
    } else {
      if (soundEnabledRef.current) playPosScanSound('error');
      setScanTone('warn');
      setScanStatus(`⚠️ Đọc được mã ${raw} nhưng chưa khớp hàng còn tồn`);
    }
  };

  useEffect(() => {
    if (!scannerOpen) {
      scanInFlightRef.current = false;
      return;
    }
    let active = true;
    let stream: MediaStream | null = null;

    if (cameraMode === 'webcam' && typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      const constraints: MediaStreamConstraints = {
        video: selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      };
      navigator.mediaDevices.getUserMedia(constraints)
        .then(mediaStream => {
          if (!active) { mediaStream.getTracks().forEach(t => t.stop()); return; }
          stream = mediaStream;
          // Enable continuous autofocus where supported (mobile back cameras)
          const track = mediaStream.getVideoTracks()[0];
          if (track && typeof track.applyConstraints === 'function') {
            void track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {});
          }
          if (videoRef.current) {
            videoRef.current.srcObject = mediaStream;
            void videoRef.current.play().catch(() => {});
          }
          if (navigator.mediaDevices.enumerateDevices) {
            navigator.mediaDevices.enumerateDevices().then(devices => {
              const videoInputs = devices.filter(d => d.kind === 'videoinput');
              if (active && videoInputs.length > 0) setVideoDevices(videoInputs);
            }).catch(() => {});
          }
        })
        .catch(() => {
          if (active) {
            setScanTone('warn');
            setScanStatus('Không mở được Webcam trình duyệt — hãy chuyển sang ESP32-CAM');
          }
        });
    }

    const timer = window.setInterval(async () => {
      if (!active || scanInFlightRef.current) return;
      scanInFlightRef.current = true;
      try {
        if (cameraMode === 'esp32') {
          // 1. Try zero-network client-side Native BarcodeDetector directly on the live ESP32-CAM <img> element (<3ms, 0 bandwidth!)
          const espImg = document.querySelector<HTMLImageElement>('.pos-inline-scanner .li-camera-image img');
          if (espImg && espImg.complete && espImg.naturalWidth > 32 && barcodeDetectorRef.current) {
            try {
              const detected = await barcodeDetectorRef.current.detect(espImg);
              for (const item of detected) {
                const val = item.rawValue?.trim();
                if (!val) continue;
                const fmt = (item.format ?? '').toLowerCase();
                if (fmt && fmt !== 'qr_code') {
                  await handleDetectedCode(val, item.format ?? 'ESP32-CAM');
                  return;
                }
                if (
                  Boolean(extractInvoiceReturnTarget(val)) ||
                  Boolean(matchesLoadedRow(val)) ||
                  val.toUpperCase().startsWith('QR-')
                ) {
                  await handleDetectedCode(val, 'QR_CODE');
                  return;
                }
              }
            } catch {
              // Fall through to lightweight backend memory scan
            }
          }

          // 2. Ask backend to decode its in-memory latestFrame (0 base64 upload overhead, keeps MJPEG stream 100% smooth!)
          const res = await api<PosScanResult>('iot/camera/pos-scan', 'POST', { source: 'esp32' }, 2500);
          if (active && res.decoded && (res.resolvedBarcode || res.code)) {
            await handleDetectedCode(res.resolvedBarcode ?? res.code!, res.format ?? 'ESP32-CAM', res.resolvedSkuId);
            return;
          }

          // 3. Only send client frame bytes if backend reports NO_CAMERA_FRAME (e.g. direct LAN stream without backend tap)
          if (active && res.reason === 'NO_CAMERA_FRAME') {
            const recentEspFrame = latestEspBytesRef.current;
            if (recentEspFrame && Date.now() - recentEspFrame.at < 2000) {
              const fallbackRes = await api<PosScanResult>(
                'iot/camera/pos-scan',
                'POST',
                { source: 'image', imageDataUrl: uint8ToBase64DataUrl(recentEspFrame.bytes) },
                2500,
              );
              if (active && fallbackRes.decoded && (fallbackRes.resolvedBarcode || fallbackRes.code)) {
                await handleDetectedCode(
                  fallbackRes.resolvedBarcode ?? fallbackRes.code!,
                  fallbackRes.format ?? 'ESP32-CAM',
                  fallbackRes.resolvedSkuId,
                );
              }
            }
          }
        } else if (cameraMode === 'webcam' && videoRef.current && videoRef.current.readyState >= 2) {
          const video = videoRef.current;
          const engine = scannerEngineRef.current;
          if (engine) {
            scanCounterRef.current = (scanCounterRef.current + 1) % 1000;
            const { outcome, reticleJpegDataUrl } = await engine.scanVideoFrame(
              video,
              barcodeDetectorRef.current,
              scanCounterRef.current,
            );
            if (!active) return;

            if (outcome.oneD) {
              await handleDetectedCode(outcome.oneD.code, outcome.oneD.format);
              return;
            }

            // Prefer any QR code that actually matches an invoice return QR, inventory item, or FreshMart tag
            const matchingQr = outcome.qrList.find(q =>
              Boolean(extractInvoiceReturnTarget(q.code)) ||
              Boolean(matchesLoadedRow(q.code)) ||
              q.code.toUpperCase().startsWith('QR-'),
            );
            if (matchingQr) {
              await handleDetectedCode(matchingQr.code, matchingQr.format);
              return;
            }

            // Periodic server-side sharp enhancement fallback (~every 1.4s using compact cropped JPEG ~28KB)
            if (reticleJpegDataUrl) {
              try {
                const res = await api<PosScanResult>(
                  'iot/camera/pos-scan',
                  'POST',
                  { source: 'image', imageDataUrl: reticleJpegDataUrl },
                  2500,
                );
                if (active && res.decoded && (res.resolvedBarcode || res.code)) {
                  await handleDetectedCode(res.resolvedBarcode ?? res.code!, res.format ?? 'WEBCAM', res.resolvedSkuId);
                  return;
                }
              } catch {
                // Ignore fallback network timeout
              }
            }

            if (outcome.qrList.length > 0 && active) {
              await handleDetectedCode(outcome.qrList[0]!.code, outcome.qrList[0]!.format);
            }
          }
        }
      } catch {
        // Ignore transient frame poll errors
      } finally {
        scanInFlightRef.current = false;
      }
    }, 220);

    return () => {
      active = false;
      scanInFlightRef.current = false;
      window.clearInterval(timer);
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, [scannerOpen, cameraMode, selectedDeviceId]);

  const categories = useMemo(() => {
    type Cat = NonNullable<Inventory['sku']['product']['category']>;
    const map = new Map<string, Cat>();
    for (const row of rows) {
      if (row.sku.product.category) map.set(row.sku.product.category.id, row.sku.product.category);
    }
    return Array.from(map.values());
  }, [rows]);
  const selectedCategory = categories.some(item => item.id === category) ? category : '';
  const shown = useMemo(() => (selectedCategory ? rows.filter(row => row.sku.product.category?.id === selectedCategory) : rows), [rows, selectedCategory]);

  const handleSearchKeyDown = async (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    const clean = query.trim();
    if (!clean) return;
    event.preventDefault();
    const returnTarget = extractInvoiceReturnTarget(clean);
    if (returnTarget && onInvoiceReturnScanned) {
      if (soundEnabled) playPosScanSound('success');
      onQuery('');
      await onInvoiceReturnScanned(returnTarget);
      return;
    }
    if (onBarcodeScanned && await onBarcodeScanned(clean)) {
      if (soundEnabled) playPosScanSound('success');
      onQuery('');
      return;
    }
    const exact = rows.find(r =>
      r.sku.barcode?.toLowerCase() === clean.toLowerCase() ||
      r.sku.code.toLowerCase() === clean.toLowerCase() ||
      r.sku.product.code.toLowerCase() === clean.toLowerCase()
    ) ?? (shown.length === 1 ? shown[0] : undefined);
    if (exact && exact.available > 0) {
      onAdd(exact);
      if (soundEnabled) playPosScanSound('success');
      onQuery('');
    } else if (soundEnabled) {
      playPosScanSound('error');
    }
  };

  return <div className="pos-catalog">
    <header className="pos-catalog-heading">
      <h2>Hàng đang bán</h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => {
            const next = !soundEnabled;
            setSoundEnabled(next);
            if (next) playPosScanSound('success');
          }}
          className="ui-action-button action-more"
          title={soundEnabled ? 'Đang bật tiếng tít khi quét POS (bấm để tắt)' : 'Đang tắt tiếng tít khi quét POS (bấm để bật & thử tiếng)'}
          style={{ padding: '6px 10px', fontSize: '12px', fontWeight: 600 }}
        >
          {soundEnabled ? 'Tiếng tít: Bật' : 'Tiếng tít: Tắt'}
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={() => setScannerOpen(open => !open)}
          className={`ui-action-button ${scannerOpen ? 'action-danger' : 'action-approve'}`}
          style={{ padding: '6px 12px', fontSize: '12.5px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          {scannerOpen ? 'Tắt Camera POS' : 'Quét Camera (Barcode / QR)'}
        </button>
        <span>{ready ? `${shown.length} sản phẩm trong kho` : 'Chọn ca và kho để bắt đầu'}</span>
      </div>
    </header>
    <div className="pos-search">
      <Icon name="search" size={20}/>
      <input
        ref={searchRef}
        aria-label="Tìm sản phẩm bán hàng"
        aria-keyshortcuts="F3"
        disabled={!ready}
        value={query}
        onChange={event => onQuery(event.target.value)}
        onKeyDown={handleSearchKeyDown}
        placeholder="Tìm tên sản phẩm, mã SP hoặc quét mã vạch (nhấn Enter để thêm ngay)…"
      />
      {query && <button type="button" aria-label="Xóa tìm kiếm" onClick={() => onQuery('')}>×</button>}
      <kbd aria-label="Phím tắt F3">F3</kbd>
    </div>
    {scannerOpen && ready && (
      <section className="pos-inline-scanner" aria-label="Camera quét mã sản phẩm">
        <div className="pos-inline-scanner-head">
          <div className="pos-inline-scanner-tabs">
            <button
              type="button"
              className={`ui-action-button ${cameraMode === 'esp32' ? 'action-approve' : 'action-more'}`}
              onClick={() => setCameraMode('esp32')}
            >
              ESP32-CAM
            </button>
            <button
              type="button"
              className={`ui-action-button ${cameraMode === 'webcam' ? 'action-approve' : 'action-more'}`}
              onClick={() => setCameraMode('webcam')}
              title="Dùng Webcam laptop hoặc Camera iPhone"
            >
              Webcam / iPhone
            </button>
          </div>
          <button type="button" className="ui-action-button action-more" onClick={() => setScannerOpen(false)}>✕</button>
        </div>
        {cameraMode === 'webcam' && videoDevices.length > 1 && (
          <div style={{ width: '100%', maxWidth: 280, display: 'flex', gap: 6, alignItems: 'center' }}>
            <select
              aria-label="Chọn thiết bị camera"
              value={selectedDeviceId}
              onChange={event => setSelectedDeviceId(event.target.value)}
              style={{ flex: 1, minHeight: 26, height: 26, fontSize: 11, padding: '2px 6px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff' }}
            >
              <option value="">Tự động (Ưu tiên camera sau / iPhone)</option>
              {videoDevices.map((d, index) => (
                <option key={d.deviceId || index} value={d.deviceId}>
                  {d.label || `Camera ${index + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}
        {cameraMode === 'esp32' ? (
          <CameraPreview compact onFrameBytes={bytes => { latestEspBytesRef.current = { bytes, at: Date.now() }; }} />
        ) : (
          <div className="pos-inline-scanner-video">
            <video ref={videoRef} autoPlay muted playsInline />
            <div className="pos-inline-scanner-guide" />
          </div>
        )}
        <div className={`pos-inline-scanner-status${scanTone === 'warn' ? ' is-warn' : ''}`} role="status">
          <span>{scanStatus}</span>
        </div>
      </section>
    )}
    {ready && <div className="pos-categories" aria-label="Nhóm sản phẩm"><button type="button" className="category-filter" style={categoryTheme().style} aria-pressed={!selectedCategory} onClick={() => setCategory('')}><Icon name="grid" size={16}/>Tất cả <span>{rows.length}</span></button>{categories.map(item => <button type="button" className="category-filter" style={categoryTheme(item).style} aria-pressed={item.id === selectedCategory} key={item.id} onClick={() => setCategory(item.id)}><Icon name={categoryTheme(item).icon} size={16}/>{item.name}</button>)}</div>}
    {!ready ? <div className="pos-empty"><Icon name="store" size={40}/><h3>Bắt đầu phiên bán hàng</h3><p>Chọn ca làm việc và kho ở phía trên.<br/>Sản phẩm có trong kho sẽ xuất hiện tại đây.</p><Link href="/ca-lam-viec">Quản lý ca làm việc →</Link></div>
      : loading ? <div className="pos-product-grid" role="status" aria-label="Đang tải sản phẩm">{Array.from({ length: 8 }, (_, index) => <div className="pos-product-skeleton" key={index}/>)}</div>
      : !shown.length ? <div className="pos-empty"><Icon name="search" size={36}/><h3>{query ? 'Không tìm thấy sản phẩm' : 'Kho chưa có sản phẩm'}</h3><p>{query ? 'Thử tên khác hoặc kiểm tra lại mã vạch.' : 'Kiểm tra kho đã chọn hoặc nhập hàng trước khi bán.'}</p>{query && <button type="button" onClick={() => onQuery('')}>Xóa tìm kiếm</button>}</div>
      : <><div className="pos-product-grid">{shown.map(stock => {
        const quantity = quantities[stock.skuId] ?? 0;
        const badgeCategory = stock.sku.product.category;
        const promoBadge = promoBadges?.[stock.skuId];
        return <button type="button" className="pos-product" style={badgeCategory ? categoryTheme(badgeCategory).style : undefined} key={stock.id} disabled={stock.available <= quantity} onClick={() => onAdd(stock)} aria-label={`Thêm ${stock.sku.product.name}`}>
          <div className="pos-product-image">
            <ProductImage src={stock.sku.product.imageUrl} name={stock.sku.product.name} size="md"/>
            {promoBadge && <span className={`pos-promo-pill${promoBadge.isBogo ? ' is-bogo' : ''}`}>{promoBadge.label}</span>}
            {quantity > 0 && <span key={quantity} className="pos-added">{quantity} trong giỏ</span>}
          </div>
          {badgeCategory && <CategoryBadge category={badgeCategory}/>}
          <span className="pos-product-name">{stock.sku.product.name}</span><small>{stock.sku.product.unit} · {stock.available > 0 ? `Còn ${stock.available}` : 'Hết hàng'}</small>
          <div className="pos-product-bottom"><strong>{new Intl.NumberFormat('vi-VN').format(stock.sku.sellingPrice)}<small>đ</small></strong><span aria-hidden="true">+</span></div>
        </button>;
      })}</div><p className="pos-catalog-foot">Đang hiển thị {shown.length} sản phẩm · Bấm vào sản phẩm hoặc quét Barcode/QR để thêm vào giỏ</p></>}
  </div>;
}
