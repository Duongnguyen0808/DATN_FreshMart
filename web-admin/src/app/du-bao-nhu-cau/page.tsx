'use client';

import '../forecast-console.css';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Protected, useAuth } from '../../components/auth-provider';
import { ProductIdentity } from '../../components/ui/product-image';
import { StatusBadge } from '../../components/ui/status-badge';
import { useToast } from '../../components/ui/toast-provider';
import { errorMessage } from '../../lib/auth-api';
import { getDemandForecast, getShortageAlerts, runDemandForecast, type DemandForecast, type ShortageAlertReport } from '../../lib/forecasts-api';
import { getStores } from '../../lib/organization-api';

type StoreOption = { id: string; code: string; name: string };
const format = (value: number) => new Intl.NumberFormat('vi-VN').format(value);
const todayInVietnam = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

function SimpleForecastPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storeId, setStoreId] = useState('');
  const [horizon, setHorizon] = useState(14);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'ALL' | 'SHORTAGE' | 'COVERED'>('ALL');
  const [forecast, setForecast] = useState<DemandForecast | null>(null);
  const [analysis, setAnalysis] = useState<ShortageAlertReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    const assigned = user.stores.filter(row => row.active).map(({ id, code, name }) => ({ id, code, name }));
    if (!user.globalAccess) { setStores(assigned); setStoreId(current => current || assigned[0]?.id || ''); return; }
    getStores().then(rows => { const active = rows.filter(row => row.active).map(({ id, code, name }) => ({ id, code, name })); setStores(active); setStoreId(current => current || active[0]?.id || ''); })
      .catch(reason => setError(errorMessage(reason)));
  }, [user]);

  useEffect(() => {
    if (!storeId) { setForecast(null); setAnalysis(null); return; }
    let active = true;
    const refresh = async (ensureToday: boolean) => {
      try {
        let result = await getDemandForecast(storeId, horizon);
        const generatedDay = result.run && new Date(result.run.generatedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
        if (ensureToday && (!result.run || generatedDay !== todayInVietnam())) {
          if (active) setRunning(true);
          result = await runDemandForecast(storeId, horizon);
        }
        const stock = await getShortageAlerts(storeId, horizon);
        if (active) { setForecast(result); setAnalysis(stock); setError(''); }
      } catch (reason) { if (active) setError(errorMessage(reason)); }
      finally { if (active) { setLoading(false); setRunning(false); } }
    };
    setLoading(true); setError(''); setForecast(null); setAnalysis(null);
    void refresh(true);
    const timer = window.setInterval(() => { void refresh(false); }, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [storeId, horizon]);

  const runNow = async () => {
    if (!storeId || running) return;
    setRunning(true); setError('');
    try {
      const result = await runDemandForecast(storeId, horizon);
      const stock = await getShortageAlerts(storeId, horizon);
      setForecast(result); setAnalysis(stock);
      showToast(`Đã cập nhật dự báo ${horizon} ngày cho ${result.items.length} sản phẩm.`);
    } catch (reason) { const message = errorMessage(reason); setError(message); showToast(message, 'error'); }
    finally { setRunning(false); }
  };

  const allRows = useMemo(() => [...(analysis?.analysisItems ?? [])].sort((a, b) => {
    const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
    const priorityA = a.severity ? rank[a.severity] : 3;
    const priorityB = b.severity ? rank[b.severity] : 3;
    return priorityA - priorityB || b.shortageQuantity - a.shortageQuantity || b.predictedQuantity - a.predictedQuantity;
  }), [analysis]);
  const shortages = allRows.filter(row => row.shortageQuantity > 0);
  const visibleRows = allRows.filter(row => (scope === 'ALL' || (scope === 'SHORTAGE' ? row.shortageQuantity > 0 : row.shortageQuantity === 0)) && `${row.productName} ${row.productCode} ${row.skuCode}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const totalShort = shortages.reduce((sum, row) => sum + row.shortageQuantity, 0);
  const totalDemand = allRows.reduce((sum, row) => sum + row.predictedQuantity, 0);

  return <main className="suite-page simple-forecast-page">
    <header className="suite-heading"><div><div className="breadcrumb">Dự báo hàng</div><h1>Dự báo nhu cầu sản phẩm</h1><p>Dựa trên lịch sử bán hàng của chi nhánh để ước tính nhu cầu và nhận biết mặt hàng cần bổ sung.</p></div><Link className="outline-button" href="/hoa-don/tao">Đến bán hàng</Link></header>
    <section className="panel simple-forecast-controls"><label>Chi nhánh<select value={storeId} onChange={event => setStoreId(event.target.value)}><option value="">Chọn chi nhánh</option>{stores.map(store => <option key={store.id} value={store.id}>{store.code} · {store.name}</option>)}</select></label><label>Dự báo trong<select value={horizon} onChange={event => setHorizon(Number(event.target.value))}><option value={7}>7 ngày</option><option value={14}>14 ngày</option><option value={30}>30 ngày</option></select></label><button className="primary-button" type="button" disabled={!storeId || loading || running} onClick={() => void runNow()}>{running ? 'Đang dự đoán…' : 'Cập nhật dự đoán'}</button></section>
    {error && <div className="ui-error" role="alert">{error}</div>}
    {loading && <p role="status">Đang tải dữ liệu dự báo…</p>}
    {!loading && forecast?.run && <>
      <section className="simple-forecast-summary"><article><span>SẢN PHẨM ĐƯỢC DỰ ĐOÁN</span><strong>{format(forecast.items.length)}</strong><small>{forecast.store.name} · {horizon} ngày tới</small></article><article><span>TỔNG NHU CẦU DỰ BÁO</span><strong>{format(totalDemand)}</strong><small>Tổng số lượng dự kiến bán trong kỳ</small></article><article className={shortages.length ? 'attention' : 'ok'}><span>CẦN BỔ SUNG</span><strong>{format(shortages.length)}</strong><small>Thiếu dự kiến {format(totalShort)} đơn vị</small></article><article><span>LỊCH SỬ ĐÃ PHÂN TÍCH</span><strong>{format(forecast.run.historyDays)} ngày</strong><small>Cập nhật {new Date(forecast.run.generatedAt).toLocaleString('vi-VN')}</small></article></section>
      <section className="panel simple-forecast-table"><div className="panel-heading"><div><h2>Chi tiết dự báo theo sản phẩm</h2><p>Hiển thị {format(visibleRows.length)} / {format(allRows.length)} mã sản phẩm · sản phẩm cần bổ sung được xếp lên đầu.</p></div><Link href="/hoa-don/tao">Mở màn hình bán hàng →</Link></div><div className="simple-forecast-filters"><label>Tìm sản phẩm<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Tên hoặc mã sản phẩm"/></label><label>Hiển thị<select value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="ALL">Tất cả sản phẩm</option><option value="SHORTAGE">Cần bổ sung ({shortages.length})</option><option value="COVERED">Đủ hàng ({allRows.length - shortages.length})</option></select></label><span>{forecast.run.model} · dự báo {horizon} ngày</span></div><div className="table-scroll"><table><thead><tr><th>Sản phẩm / Mã sản phẩm</th><th>Bán lịch sử</th><th>Dự báo {horizon} ngày</th><th>Tồn khả dụng</th><th>Đang về</th><th>Tồn an toàn</th><th>Số ngày đủ hàng</th><th>Cần bổ sung</th><th>Chất lượng</th><th>Lý do / căn cứ</th></tr></thead><tbody>{visibleRows.length ? visibleRows.map(row => { const incoming = row.inTransfer + row.incomingPurchase; const averageDaily = row.predictedQuantity / Math.max(1, horizon); const coverDays = averageDaily > 0 ? Math.max(0, Math.floor((row.available + incoming - row.safetyStock) / averageDaily)) : null; const reason = row.shortageQuantity > 0 ? `Nhu cầu ${format(row.predictedQuantity)} + an toàn ${format(row.safetyStock)} − tồn ${format(row.available)} − đang chuyển ${format(row.inTransfer)} − PO sắp về ${format(row.incomingPurchase)} = thiếu ${format(row.shortageQuantity)} ${row.unit}.` : `Tồn và hàng dự kiến về đáp ứng nhu cầu ${format(row.predictedQuantity)} ${row.unit} cùng mức an toàn ${format(row.safetyStock)} ${row.unit}.`; return <tr key={row.skuId} className={row.shortageQuantity > 0 ? 'simple-forecast-short-row' : undefined}><td><ProductIdentity name={row.productName} code={row.productCode} imageUrl={row.imageUrl}/></td><td>{format(row.observedQuantity)} {row.unit}</td><td><strong>{format(row.predictedQuantity)} {row.unit}</strong></td><td>{format(row.available)} {row.unit}</td><td>{format(incoming)} {row.unit}<small>Chuyển {format(row.inTransfer)} · PO {format(row.incomingPurchase)}</small></td><td>{format(row.safetyStock)} {row.unit}</td><td>{coverDays === null ? '—' : `${format(coverDays)} ngày`}</td><td>{row.shortageQuantity > 0 ? <StatusBadge tone={row.severity === 'HIGH' ? 'red' : row.severity === 'MEDIUM' ? 'amber' : 'blue'}>{format(row.shortageQuantity)} {row.unit}</StatusBadge> : <StatusBadge tone="green">Đủ hàng</StatusBadge>}</td><td><StatusBadge tone={row.dataQuality === 'SUFFICIENT' ? 'green' : 'amber'}>{row.dataQuality === 'SUFFICIENT' ? 'Đủ dữ liệu' : row.dataQuality === 'SPARSE' ? 'Dữ liệu thưa' : 'Chưa có bán'}</StatusBadge></td><td className="simple-forecast-reason">{reason}</td></tr>; }) : <tr><td colSpan={10}>Không có sản phẩm phù hợp bộ lọc.</td></tr>}</tbody></table></div></section>
      <p className="simple-forecast-note">Dự báo được cập nhật tự động mỗi ngày khi mở trang; tồn và lượng hàng đang về được làm mới trong ngày. Kết quả là gợi ý để nhân viên ưu tiên kiểm tra khi bán hàng.</p>
    </>}
    {!loading && !forecast?.run && !error && <section className="panel empty-state"><h2>Chưa có dữ liệu dự báo</h2><p>Chọn chi nhánh để tạo dự báo nhu cầu từ dữ liệu bán hàng.</p></section>}
  </main>;
}

export default function ForecastPage() { return <Protected permission="reports.read"><SimpleForecastPage /></Protected>; }
