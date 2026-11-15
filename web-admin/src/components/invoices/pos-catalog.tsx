import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
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

export function PosQuantity({ name, value, max, onChange }: { name: string; value: number; max: number; onChange: (value: number) => void }) {
  return <div className="pos-quantity">
    <button type="button" aria-label={`Giảm số lượng ${name}`} disabled={value <= 1} onClick={() => onChange(value - 1)}>−</button>
    <input aria-label={`Số lượng ${name}`} type="number" min={1} max={max} step={1} value={value} onChange={event => onChange(Number(event.target.value))}/>
    <button type="button" aria-label={`Tăng số lượng ${name}`} disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
  </div>;
}

export function PosCatalog({ rows, ready, loading, query, onQuery, onAdd, onBarcodeScanned, quantities }: {
  rows: Inventory[]; ready: boolean; loading: boolean; query: string;
  onQuery: (value: string) => void; onAdd: (stock: Inventory) => void;
  onBarcodeScanned?: (code: string, resolvedSkuId?: string | null) => boolean;
  quantities: Record<string, number>;
}) {
  const [category, setCategory] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState<'esp32' | 'webcam'>('esp32');
  const [scanStatus, setScanStatus] = useState('Đưa mã Barcode (EAN-13, Code-128) hoặc mã QR vào khung hình camera để tự động tính tiền.');
  const [lastScanned, setLastScanned] = useState<{ code: string; format: string; at: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastCodeRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const latestEspBytesRef = useRef<{ bytes: Uint8Array; at: number } | null>(null);

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

  const handleDetectedCode = (code: string, format = 'BARCODE', resolvedSkuId?: string | null) => {
    const now = Date.now();
    if (lastCodeRef.current.code === code && now - lastCodeRef.current.at < 1800) return;
    lastCodeRef.current = { code, at: now };
    setLastScanned({ code, format, at: now });
    if (onBarcodeScanned) {
      const matched = onBarcodeScanned(code, resolvedSkuId);
      setScanStatus(matched
        ? `✅ Đã quét [${format}] ${code} — Đã cộng sản phẩm vào giỏ hàng!`
        : `⚠️ Đã đọc mã [${format}] ${code} nhưng chưa khớp sản phẩm còn tồn trong kho này.`);
      return;
    }
    const clean = code.trim().toLowerCase();
    const hit = rows.find(r =>
      (resolvedSkuId && r.skuId === resolvedSkuId) ||
      r.sku.barcode?.toLowerCase() === clean ||
      r.sku.code.toLowerCase() === clean ||
      r.sku.product.code.toLowerCase() === clean
    );
    if (hit && hit.available > 0) {
      onAdd(hit);
      setScanStatus(`✅ Đã quét [${format}] ${code} — Đã thêm "${hit.sku.product.name}" vào giỏ!`);
    } else {
      onQuery(code);
      setScanStatus(`🔎 Đã đọc mã ${code} — Đang lọc danh sách sản phẩm.`);
    }
  };

  useEffect(() => {
    if (!scannerOpen) return;
    let active = true;
    let stream: MediaStream | null = null;

    if (cameraMode === 'webcam' && typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } } })
        .then(mediaStream => {
          if (!active) { mediaStream.getTracks().forEach(t => t.stop()); return; }
          stream = mediaStream;
          if (videoRef.current) {
            videoRef.current.srcObject = mediaStream;
            void videoRef.current.play().catch(() => {});
          }
        })
        .catch(() => {
          if (active) setScanStatus('Không mở được Webcam trình duyệt. Bạn có thể chuyển sang tab ESP32-CAM hoặc chọn mã bên dưới.');
        });
    }

    const timer = window.setInterval(async () => {
      if (!active) return;
      try {
        if (cameraMode === 'esp32') {
          const recentEspFrame = latestEspBytesRef.current;
          const payload = recentEspFrame && Date.now() - recentEspFrame.at < 3000
            ? { source: 'image' as const, imageDataUrl: uint8ToBase64DataUrl(recentEspFrame.bytes) }
            : { source: 'esp32' as const };
          const res = await api<PosScanResult>('iot/camera/pos-scan', 'POST', payload, 4000);
          if (active && res.decoded && (res.resolvedBarcode || res.code)) {
            handleDetectedCode(res.resolvedBarcode ?? res.code!, res.format ?? 'ESP32-CAM', res.resolvedSkuId);
          }
        } else if (cameraMode === 'webcam' && videoRef.current && videoRef.current.readyState >= 2) {
          const video = videoRef.current;
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 480;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageDataUrl = canvas.toDataURL('image/jpeg', 0.8);
            const res = await api<PosScanResult>('iot/camera/pos-scan', 'POST', { source: 'image', imageDataUrl }, 4000);
            if (active && res.decoded && (res.resolvedBarcode || res.code)) {
              handleDetectedCode(res.resolvedBarcode ?? res.code!, res.format ?? 'WEBCAM', res.resolvedSkuId);
            }
          }
        }
      } catch {
        // Ignore transient frame poll errors
      }
    }, 900);

    return () => {
      active = false;
      window.clearInterval(timer);
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, [scannerOpen, cameraMode, rows]);

  const categories = [...new Map(rows.flatMap(row => row.sku.product.category ? [[row.sku.product.category.id, row.sku.product.category] as const] : [])).values()];
  const selectedCategory = categories.some(item => item.id === category) ? category : '';
  const shown = selectedCategory ? rows.filter(row => row.sku.product.category?.id === selectedCategory) : rows;

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    const clean = query.trim();
    if (!clean) return;
    event.preventDefault();
    if (onBarcodeScanned && onBarcodeScanned(clean)) {
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
      onQuery('');
    }
  };

  return <div className="pos-catalog">
    <header className="pos-catalog-heading">
      <h2>Hàng đang bán</h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          type="button"
          disabled={!ready}
          onClick={() => setScannerOpen(true)}
          className="ui-action-button action-approve"
          style={{ padding: '6px 12px', fontSize: '12.5px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          📷 Quét Camera (Barcode / QR)
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
    {scannerOpen && (
      <div className="ui-modal" onMouseDown={e => { if (e.target === e.currentTarget) setScannerOpen(false); }}>
        <section className="ui-modal-card" style={{ maxWidth: 600, width: '95%' }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <h2>📷 Quét Camera Barcode & QR tính tiền POS</h2>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#475569' }}>
                Hỗ trợ giải mã song song cả <b>Barcode 1D (EAN-13, EAN-8, Code-128, UPC)</b> và <b>QR Code 2D</b> qua thư viện ZXing MultiFormatReader.
              </p>
            </div>
            <button type="button" onClick={() => setScannerOpen(false)} aria-label="Đóng" style={{ fontSize: 22, background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
          </header>
          <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
            <button
              type="button"
              className={`ui-action-button ${cameraMode === 'esp32' ? 'action-approve' : 'action-more'}`}
              onClick={() => setCameraMode('esp32')}
            >
              📡 Camera IoT (ESP32-CAM)
            </button>
            <button
              type="button"
              className={`ui-action-button ${cameraMode === 'webcam' ? 'action-approve' : 'action-more'}`}
              onClick={() => setCameraMode('webcam')}
            >
              💻 Webcam máy tính / Điện thoại
            </button>
          </div>
          {cameraMode === 'esp32' ? (
            <div className="live-inbound" style={{ background: 'transparent', padding: 0, minHeight: 'auto' }}>
              <CameraPreview onFrameBytes={bytes => { latestEspBytesRef.current = { bytes, at: Date.now() }; }} />
            </div>
          ) : (
            <div style={{ position: 'relative', background: '#0f172a', borderRadius: 12, overflow: 'hidden', minHeight: 250, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #14b8a6' }}>
              <video ref={videoRef} muted playsInline style={{ width: '100%', maxHeight: 300, objectFit: 'contain' }} />
              <div style={{ position: 'absolute', inset: '22% 14%', border: '2px dashed rgba(45, 212, 191, 0.9)', borderRadius: 10, pointerEvents: 'none', boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.28)' }} />
            </div>
          )}
          <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', fontSize: 13, fontWeight: 600 }}>
            {scanStatus}
            {lastScanned && <div style={{ fontSize: 12, color: '#0f766e', marginTop: 4 }}>Mã vừa nhận: <b>{lastScanned.code}</b> ({lastScanned.format})</div>}
          </div>
          {rows.filter(r => r.available > 0 && r.sku.barcode).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <small style={{ display: 'block', marginBottom: 6, fontWeight: 700, color: '#334155' }}>
                ⚡ Quét thử nhanh Barcode sản phẩm trong kho (dùng khi demo nhanh):
              </small>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 110, overflowY: 'auto' }}>
                {rows.filter(r => r.available > 0 && r.sku.barcode).slice(0, 6).map(r => (
                  <button
                    key={r.id}
                    type="button"
                    className="ui-action-button action-view"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={() => handleDetectedCode(r.sku.barcode!, 'EAN_13', r.skuId)}
                  >
                    ║▌║ {r.sku.barcode} · {r.sku.product.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <footer style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="ui-action-button action-more" onClick={() => setScannerOpen(false)}>Đóng khung quét</button>
          </footer>
        </section>
      </div>
    )}
    {ready && <div className="pos-categories" aria-label="Nhóm sản phẩm"><button type="button" className="category-filter" style={categoryTheme().style} aria-pressed={!selectedCategory} onClick={() => setCategory('')}><Icon name="grid" size={16}/>Tất cả <span>{rows.length}</span></button>{categories.map(item => <button type="button" className="category-filter" style={categoryTheme(item).style} aria-pressed={item.id === selectedCategory} key={item.id} onClick={() => setCategory(item.id)}><Icon name={categoryTheme(item).icon} size={16}/>{item.name}</button>)}</div>}
    {!ready ? <div className="pos-empty"><Icon name="store" size={40}/><h3>Bắt đầu phiên bán hàng</h3><p>Chọn ca làm việc và kho ở phía trên.<br/>Sản phẩm có trong kho sẽ xuất hiện tại đây.</p><Link href="/ca-lam-viec">Quản lý ca làm việc →</Link></div>
      : loading ? <div className="pos-product-grid" role="status" aria-label="Đang tải sản phẩm">{Array.from({ length: 8 }, (_, index) => <div className="pos-product-skeleton" key={index}/>)}</div>
      : !shown.length ? <div className="pos-empty"><Icon name="search" size={36}/><h3>{query ? 'Không tìm thấy sản phẩm' : 'Kho chưa có sản phẩm'}</h3><p>{query ? 'Thử tên khác hoặc kiểm tra lại mã vạch.' : 'Kiểm tra kho đã chọn hoặc nhập hàng trước khi bán.'}</p>{query && <button type="button" onClick={() => onQuery('')}>Xóa tìm kiếm</button>}</div>
      : <><div className="pos-product-grid">{shown.map(stock => {
        const quantity = quantities[stock.skuId] ?? 0;
        const badgeCategory = stock.sku.product.category;
        return <button type="button" className="pos-product" style={badgeCategory ? categoryTheme(badgeCategory).style : undefined} key={stock.id} disabled={stock.available <= quantity} onClick={() => onAdd(stock)} aria-label={`Thêm ${stock.sku.product.name}`}>
          <div className="pos-product-image"><ProductImage src={stock.sku.product.imageUrl} name={stock.sku.product.name} size="md"/>{quantity > 0 && <span key={quantity} className="pos-added">{quantity} trong giỏ</span>}</div>
          {badgeCategory && <CategoryBadge category={badgeCategory}/>}
          <span className="pos-product-name">{stock.sku.product.name}</span><small>{stock.sku.product.unit} · {stock.available > 0 ? `Còn ${stock.available}` : 'Hết hàng'}</small>
          <div className="pos-product-bottom"><strong>{new Intl.NumberFormat('vi-VN').format(stock.sku.sellingPrice)}<small>đ</small></strong><span aria-hidden="true">+</span></div>
        </button>;
      })}</div><p className="pos-catalog-foot">Đang hiển thị {shown.length} sản phẩm · Bấm vào sản phẩm hoặc quét Barcode/QR để thêm vào giỏ</p></>}
  </div>;
}
