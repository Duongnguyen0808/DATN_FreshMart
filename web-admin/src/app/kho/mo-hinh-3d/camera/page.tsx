'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Protected } from '../../../../components/auth-provider';
import { api, errorMessage } from '../../../../lib/auth-api';
import { getWarehouses, type Warehouse } from '../../../../lib/organization-api';
import { ESP_DEVICE_ID } from '../prepare-camera-demo';
import '../live-inbound.css';

type Parcel = { id: string; tagId: string; deviceId: string; quantity: number; status: string; purchaseOrderCode?: string; product?: { name: string; unit: string } };
function CameraParcels() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]), [warehouseId, setWarehouseId] = useState('');
  const [parcels, setParcels] = useState<Parcel[]>([]), [selected, setSelected] = useState<Parcel | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  useEffect(() => { getWarehouses().then(rows => { const active = rows.filter(w => w.active); setWarehouses(active); setWarehouseId(active[0]?.id ?? ''); }).catch(e => setError(errorMessage(e))); }, []);
  useEffect(() => { if (!warehouseId) return; let active = true; setLoading(true); setError(''); setSelected(null); setParcels([]); api<Parcel[]>('iot/inbound-parcels/prepare-orders', 'POST', { warehouseId }).then(rows => { if (active) setParcels(rows.filter(p => p.tagId.startsWith('QR-'))); }).catch(e => { if (active) setError(errorMessage(e)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [warehouseId]);
  return <main className="live-inbound esp-workspace"><header className="li-head"><div><div className="breadcrumb">Kho · Trạm ESP32-CAM</div><h1>Kiện hàng & tem QR</h1><p>Mã kiện được tạo cùng đơn mua hàng và dùng để camera nhận diện khi nhập kho.</p></div><Link className="outline-button" href="/kho/mo-hinh-3d">Về mô hình 3D</Link></header>
    <section className="li-card" style={{ padding: 20 }}><label>Kho nhận<select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label><p>Chọn kiện trong mô hình 3D; mã QR tự xuất hiện khi đến bước quét. Hạn sử dụng được đối chiếu lúc nhận hàng.</p></section>
    {error && <p role="alert" className="live-error">{error}</p>}
    {selected && <section className="li-card camera-parcel-label" style={{ padding: 20 }}><h2>Mã kiện · {selected.purchaseOrderCode}</h2><p>{selected.product?.name} · {selected.quantity} {selected.product?.unit}</p><QRCodeSVG value={selected.tagId} size={224} marginSize={4} level="M"/><p><code>{selected.tagId}</code></p></section>}
    <section className="li-card"><div className="li-card-head"><h2>Kiện từ đơn mua hàng</h2></div><div className="table-scroll"><table className="li-table"><thead><tr><th>Sản phẩm</th><th>Số lượng</th><th>Đơn mua hàng</th><th>Trạng thái</th><th>Mã QR</th></tr></thead><tbody>{parcels.map(p => <tr key={p.id}><td>{p.product?.name}</td><td>{p.quantity} {p.product?.unit}</td><td>{p.purchaseOrderCode}</td><td>{p.status === 'READY' ? (p.deviceId === ESP_DEVICE_ID ? 'Chờ ESP32-CAM' : 'Thiết bị khác') : p.status === 'RECEIVED' ? 'Đã nhập kho' : 'Đã hủy'}</td><td><button onClick={() => setSelected(p)}>Xem mã QR</button></td></tr>)}{!parcels.length && <tr><td colSpan={5}>{loading ? 'Đang tải kiện…' : 'Chưa có kiện. Tạo đơn mua hàng cho kho này để có mã QR.'}</td></tr>}</tbody></table></div><p><Link href="/don-mua-hang">Đến đơn mua hàng</Link></p></section>
  </main>;
}
export default function Page() { return <Protected permission="purchase_orders.receive"><CameraParcels /></Protected>; }
