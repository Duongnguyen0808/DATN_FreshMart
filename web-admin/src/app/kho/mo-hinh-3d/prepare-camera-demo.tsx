'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../../lib/auth-api';
import type { ForecastInventoryAdvice } from '../../../lib/forecasts-api';
import type { IotEvent } from '../../../lib/iot-api';
import type { PurchaseOrder } from '../../../lib/purchase-orders-api';
import type { Warehouse } from '../../../lib/organization-api';
import { useAuth } from '../../../components/auth-provider';
import { ProductImage } from '../../../components/ui/product-image';

export const ESP_DEVICE_ID = 'FRESHMART-CAMERA-IN-01';
export const isEspEvent = (event: IotEvent) => event.source === 'DEVICE' && event.eventType === 'CAMERA_CODE_DETECTED' && event.deviceId === ESP_DEVICE_ID;

export function EspReceivingGuide() {
  return <section className="esp-guide" aria-label="Quy trình nhận hàng IoT">
    <article><b>01 · Chuẩn bị kiện</b><p>Chọn sản phẩm từ đơn mua hàng, nhập số lượng và hạn sử dụng. In phiếu QR, dán lên kiện.</p></article>
    <article><b>02 · ESP32-CAM đọc mã</b><p>Mở mô hình 3D, chọn kiện để chạy demo. Tại bước quét, đưa tem trước thiết bị; web tự hiện thông tin kiện.</p></article>
    <article><b>03 · Đối chiếu & nhập kho</b><p>Nhân viên xác nhận hàng thực nhận. Hệ thống lập phiếu, cộng tồn và chạy tiếp mô hình. Quét lặp không cộng lần hai.</p></article>
  </section>;
}

export function EspStation({ connected, latest, waiting = false }: { connected: boolean; latest?: IotEvent; waiting?: boolean }) {
  return <section className={`esp-station ${waiting ? 'is-waiting' : ''}`} aria-label="Trạm nhận hàng ESP32-CAM">
    <div className="esp-station-symbol" aria-hidden="true">▣</div><div className="esp-station-copy"><span>TRẠM NHẬN HÀNG · IOT</span><h2>{waiting ? 'Đưa tem QR trước ESP32-CAM' : 'ESP32-CAM · Cổng nhận hàng'}</h2><p>{waiting ? 'Giữ tem rõ nét, đủ ánh sáng. Thông tin kiện sẽ hiện khi backend nhận đúng mã.' : 'Thiết bị đọc mã kiện và gửi qua Wi-Fi. Web hiển thị kết quả để nhân viên đối chiếu.'}</p></div>
    <div className="esp-station-status"><strong>{connected ? 'Web đang nhận realtime' : 'Web chưa kết nối realtime'}</strong><small>{latest ? `Lượt quét thiết bị: ${new Date(latest.receivedAt).toLocaleString('vi-VN')}` : 'Chưa ghi nhận lượt quét từ thiết bị'}</small><small>Trạng thái nguồn thiết bị: chưa có heartbeat</small></div>
  </section>;
}

type Advice = ForecastInventoryAdvice & { unitCost: number; pendingQuantity: number; suggestedQuantity: number };
type Options = { forecastRunId: string | null; horizonDays: number; storeName: string; suppliers: { id: string; code: string; name: string }[]; items: Advice[] };
type Line = { selected: boolean; quantity: string; unitCost: string };
const money = (value: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);

export function ForecastReplenishment({ warehouseId, onCreated, onBusy }: { warehouseId: string; onCreated: (order: PurchaseOrder) => Promise<void>; onBusy: (busy: boolean) => void }) {
  const [options, setOptions] = useState<Options | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [lines, setLines] = useState<Record<string, Line>>({}), [supplierId, setSupplierId] = useState('');
  const [creating, setCreating] = useState(false), [created, setCreated] = useState<PurchaseOrder | null>(null), [version, setVersion] = useState(0);
  const request = useRef<{ key: string; signature: string } | null>(null);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    api<Options>(`purchase-orders/forecast-replenishment?warehouseId=${encodeURIComponent(warehouseId)}`).then(result => {
      if (!active) return;
      setOptions(result); setLines(Object.fromEntries(result.items.map(row => [row.skuId, { selected: false, quantity: String(row.suggestedQuantity), unitCost: String(row.unitCost) }])));
    }).catch(reason => { if (active) setError(errorMessage(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [warehouseId, version]);
  const selected = (options?.items ?? []).filter(row => lines[row.skuId]?.selected);
  const valid = selected.length > 0 && selected.every(row => { const line = lines[row.skuId]!; return Number.isInteger(Number(line.quantity)) && Number(line.quantity) > 0 && Number(line.quantity) <= row.suggestedQuantity && Number(line.unitCost) > 0; });
  const total = selected.reduce((sum, row) => sum + Number(lines[row.skuId]!.quantity) * Number(lines[row.skuId]!.unitCost), 0);
  const change = (skuId: string, patch: Partial<Line>) => setLines(previous => ({ ...previous, [skuId]: { ...previous[skuId]!, ...patch } }));
  const create = async () => {
    if (!options?.forecastRunId || !supplierId || !valid || creating) return;
    const body = { warehouseId, supplierId, forecastRunId: options.forecastRunId, items: selected.map(row => ({ skuId: row.skuId, quantity: Number(lines[row.skuId]!.quantity), unitCost: Number(lines[row.skuId]!.unitCost) })) };
    const signature = JSON.stringify(body);
    if (!request.current || request.current.signature !== signature) request.current = { key: crypto.randomUUID(), signature };
    setCreating(true); onBusy(true); setError('');
    try {
      const order = await api<PurchaseOrder>('purchase-orders/forecast-replenishment', 'POST', { ...body, requestId: request.current.key });
      setCreated(order);
      window.dispatchEvent(new Event('freshmart-forecast-updated'));
      await onCreated(order);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setCreating(false); onBusy(false); }
  };
  return <section className="li-replenishment" aria-label="Nhập hàng từ cảnh báo thiếu hàng">
    <header><div><span className="li-replenishment-eyebrow">GỢI Ý BỔ SUNG HÀNG</span><h3>Bạn có muốn nhập các mặt hàng đang thiếu?</h3></div>{!creating && !created && <button type="button" onClick={() => setVersion(v => v + 1)}>Tải lại gợi ý</button>}</header>
    {loading ? <p role="status">Đang đối chiếu cảnh báo và đơn mua hàng chờ nhận…</p> : created ? <div className="li-notice" role="status"><strong>Đã tạo đơn {created.code}</strong><p>Kiện QR đã sẵn sàng trong danh sách bên dưới. Chọn kiện rồi bắt đầu xe vào kho.</p><Link href={`/don-mua-hang/${created.id}`}>Xem đơn mua hàng →</Link></div> : options && <>
      <p>{options.storeName} · Dự báo {options.horizonDays} ngày. Gợi ý đã trừ lượng trong các đơn mua hàng chờ nhận của chi nhánh.</p>
      {!options.forecastRunId ? <p>Chi nhánh chưa có dữ liệu dự báo. <Link href="/du-bao-nhu-cau">Mở dự báo hàng</Link>.</p> : !options.items.some(row => row.suggestedQuantity > 0) ? <p>Chưa cần đặt mua thêm: không có hàng thiếu hoặc nhu cầu đã được các đơn chờ nhận đáp ứng.</p> : <>
        <div className="li-replenishment-list">{options.items.map(row => {
          const line = lines[row.skuId]; if (!line) return null;
          const covered = row.suggestedQuantity <= 0;
          return <article key={row.skuId} className={line.selected ? 'selected' : ''}>
            <label className="li-replenishment-pick"><input type="checkbox" checked={line.selected} disabled={creating || covered} onChange={e => change(row.skuId, { selected: e.target.checked })}/><ProductImage src={row.imageUrl} name={row.productName} size="md"/><span className="li-replenishment-copy"><strong>{row.productName}</strong><small>Còn {row.available} {row.unit} · Đã đặt, chưa nhận {row.pendingQuantity} {row.unit}</small><b>{covered ? 'Đã có đơn chờ nhận' : `Cần đặt thêm ${row.suggestedQuantity} ${row.unit}`}</b></span></label>
            {line.selected && <div className="li-replenishment-values"><label>Số lượng ({row.unit})<input type="number" min="1" max={row.suggestedQuantity} step="1" value={line.quantity} disabled={creating} onChange={e => change(row.skuId, { quantity: e.target.value })}/></label><label>Giá nhập / {row.unit}<input type="number" min="0.01" step="0.01" value={line.unitCost} disabled={creating} onChange={e => change(row.skuId, { unitCost: e.target.value })}/></label></div>}
          </article>;
        })}</div>
        {selected.length > 0 && <div className="li-replenishment-checkout"><label>Nhà cung cấp cho các mặt hàng đã chọn<select value={supplierId} disabled={creating} onChange={e => setSupplierId(e.target.value)}><option value="">Chọn nhà cung cấp</option>{options.suppliers.map(s => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label><small>Giá gợi ý lấy từ giá vốn sản phẩm; kiểm tra lại theo báo giá nhà cung cấp. Số lượng tính theo đơn vị tồn kho.</small><div><strong>{selected.length} mặt hàng · {money(total)}</strong><button type="button" disabled={creating || !supplierId || !valid} onClick={() => void create()}>{creating ? 'Đang tạo đơn…' : 'Xác nhận tạo đơn mua hàng'}</button></div></div>}
      </>}
    </>}
    {error && <p role="alert" className="live-error">{error}</p>}
  </section>;
}

export type CameraParcel = { id: string; tagId: string; deviceId: string; quantity: number; status: string; purchaseOrderItemId?: string; purchaseOrderCode?: string; purchaseOrderStatus?: string; expiresAt: string | null; noExpiry?: boolean; product?: { name: string; unit: string } };
export function PrepareCameraDemo({ orders, parcels, warehouses, warehouseId, onWarehouseChange, onClose, onStart }: { orders: PurchaseOrder[]; parcels: CameraParcel[]; warehouses: Warehouse[]; warehouseId: string; onWarehouseChange: (id: string) => void; onClose: () => void; onStart: (parcel: CameraParcel) => void }) {
  const { user } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const [available, setAvailable] = useState(parcels), [selectedId, setSelectedId] = useState(''), [loading, setLoading] = useState(true), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { let active = true; setLoading(true); setError(''); setSelectedId(''); setAvailable([]); api<CameraParcel[]>('iot/inbound-parcels/prepare-orders', 'POST', { warehouseId }).then(rows => { if (active) setAvailable(rows); }).catch(reason => { if (active) setError(errorMessage(reason)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [warehouseId]);
  const ready = available.filter(p => p.status === 'READY' && p.deviceId === ESP_DEVICE_ID && p.tagId.startsWith('QR-') && (p.purchaseOrderStatus ? p.purchaseOrderStatus === 'OPEN' : orders.some(order => order.code === p.purchaseOrderCode)));
  const selected = ready.find(p => p.id === selectedId);
  const [starting, setStarting] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const busy = starting || creatingOrder;
  const start = async () => {
    if (!selected || starting) return;
    setStarting(true); setError('');
    try {
      await api('iot/camera-demo-session', 'POST', { parcelId: selected.id });
      onStart(selected);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setStarting(false); }
  };
  return <dialog ref={dialog} className="camera-scan-dialog esp-prepare-dialog" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2>Chuẩn bị nhập kho</h2><button disabled={busy} onClick={onClose} aria-label="Đóng">×</button></header>
    <p>Chọn chi nhánh nhận hàng, sau đó chọn kiện từ đơn mua hàng. Mã QR sẽ hiện ở bước camera quét.</p>
    <label>Chi nhánh · kho nhận<select disabled={busy} value={warehouseId} onChange={event => onWarehouseChange(event.target.value)}>{warehouses.map(w => <option key={w.id} value={w.id}>{w.store.name} · {w.name}</option>)}</select></label>
    {(user?.permissions.includes('purchase_orders.create') || user?.permissions.includes('*')) && <ForecastReplenishment key={warehouseId} warehouseId={warehouseId} onBusy={setCreatingOrder} onCreated={async order => {
      try {
        const rows = await api<(CameraParcel & { purchaseOrderId: string })[]>(`iot/inbound-parcels?warehouseId=${encodeURIComponent(warehouseId)}`);
        setAvailable(rows); setSelectedId(rows.find(row => row.purchaseOrderId === order.id && row.status === 'READY')?.id ?? '');
      } catch { setError('Đơn mua hàng đã tạo thành công. Đóng và mở lại popup để tải kiện QR mới.'); }
    }}/>}
    {error && <p role="alert" className="live-error">{error}</p>}
    <label>Kiện chờ nhận<select value={selectedId} onChange={event => setSelectedId(event.target.value)} disabled={loading || busy}><option value="">{loading ? 'Đang tải kiện…' : 'Chọn kiện chờ nhận'}</option>{ready.map(p => <option key={p.id} value={p.id}>{p.purchaseOrderCode} · {p.product?.name} · {p.quantity} {p.product?.unit}</option>)}</select></label>
    {!loading && !error && !ready.length && <p>Kho chưa có kiện chờ nhận. <a href="/don-mua-hang">Tạo hoặc kiểm tra đơn mua hàng</a>.</p>}
    <footer><button type="button" disabled={!selected || loading || busy} onClick={() => void start()}>{starting ? 'Đang chuẩn bị camera…' : 'Bắt đầu xe vào kho'}</button></footer>
  </dialog>;
}
