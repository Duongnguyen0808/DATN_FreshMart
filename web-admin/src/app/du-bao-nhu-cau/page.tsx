'use client';
import { ForecastEvidenceDialog, ForecastShortageBanner, type ForecastAlert } from '../../components/forecast-shortage-alert';
import { MetricCard, MetricGrid } from '../../components/ui/metric-card';
import { TableState } from '../../components/ui/table-state';

import '../forecast-console.css';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Protected, useAuth } from '../../components/auth-provider';
import { ProductIdentity } from '../../components/ui/product-image';
import { StatusBadge } from '../../components/ui/status-badge';
import { useToast } from '../../components/ui/toast-provider';
import { errorMessage } from '../../lib/auth-api';
import { getDemandForecast, getShortageAlerts, runDemandForecast, type DemandForecast, type ShortageAlertReport } from '../../lib/forecasts-api';
import { decideRecommendation, generateRecommendations, getRecommendations, type InventoryRecommendation } from '../../lib/recommendations-api';
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
  const [recommendations, setRecommendations] = useState<InventoryRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [decidingId, setDecidingId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('status') === 'shortage') setScope('SHORTAGE');
    const requestedHorizon = Number(params.get('horizon'));
    if ([7, 14, 30].includes(requestedHorizon)) setHorizon(requestedHorizon);
    const requestedStore = params.get('storeId');
    if (requestedStore) setStoreId(requestedStore);
  }, []);

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
        const [stock, nextRecs] = await Promise.all([
          getShortageAlerts(storeId, horizon),
          getRecommendations(storeId, horizon).catch(() => null),
        ]);
        if (active) {
          setForecast(result);
          setAnalysis(stock);
          setRecommendations(Array.isArray(nextRecs?.items) ? nextRecs.items : []);
          setError('');
        }
      } catch (reason) { if (active) setError(errorMessage(reason)); }
      finally { if (active) { setLoading(false); setRunning(false); } }
    };
    setLoading(true); setError(''); setForecast(null); setAnalysis(null); setRecommendations([]);
    void refresh(true);
    const timer = window.setInterval(() => { void refresh(false); }, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [storeId, horizon]);

  const runNow = async () => {
    if (!storeId || running) return;
    setRunning(true); setError('');
    try {
      const result = await runDemandForecast(storeId, horizon);
      const [stock, nextRecs] = await Promise.all([
        getShortageAlerts(storeId, horizon),
        getRecommendations(storeId, horizon).catch(() => null),
      ]);
      setForecast(result); setAnalysis(stock);
      setRecommendations(Array.isArray(nextRecs?.items) ? nextRecs.items : []);
      showToast(`Đã cập nhật dự báo ${horizon} ngày cho ${result.items.length} sản phẩm.`);
    } catch (reason) { const message = errorMessage(reason); setError(message); showToast(message, 'error'); }
    finally { setRunning(false); }
  };

  const handleGenerateRecommendations = async () => {
    if (!storeId || generating) return;
    setGenerating(true); setError('');
    try {
      const result = await generateRecommendations(storeId, horizon);
      const list = Array.isArray(result?.items) ? result.items : [];
      setRecommendations(list);
      showToast(list.length ? `Đã lập ${list.length} đề xuất điều chuyển / mua bổ sung.` : 'Chưa có mặt hàng thiếu cần tạo đề xuất.');
    } catch (reason) { const message = errorMessage(reason); setError(message); showToast(message, 'error'); }
    finally { setGenerating(false); }
  };

  const handleDecision = async (item: InventoryRecommendation, action: 'APPLY' | 'DISMISS') => {
    if (decidingId) return;
    setDecidingId(item.id); setError('');
    try {
      await decideRecommendation(
        item.id,
        action,
        action === 'APPLY' ? 'Phê duyệt trực tiếp từ bảng điều khiển dự báo AI' : 'Từ chối đề xuất từ bảng điều khiển dự báo AI',
        action === 'APPLY' ? item.suggestedQuantity : undefined,
      );
      const [stock, nextRecs] = await Promise.all([
        getShortageAlerts(storeId, horizon),
        getRecommendations(storeId, horizon).catch(() => null),
      ]);
      setAnalysis(stock);
      setRecommendations(Array.isArray(nextRecs?.items) ? nextRecs.items : []);
      showToast(action === 'APPLY' ? 'Đã phê duyệt và tự động khởi tạo phiếu nghiệp vụ.' : 'Đã từ chối đề xuất.');
    } catch (reason) { const message = errorMessage(reason); setError(message); showToast(message, 'error'); }
    finally { setDecidingId(''); }
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
  const demoRow = shortages[0] ?? allRows[0];
  const demoInbound = demoRow ? demoRow.inTransfer + demoRow.incomingPurchase : 0;

  return <main className="suite-page simple-forecast-page">
    <header className="suite-heading"><div><div className="breadcrumb">Dự báo hàng</div><h1>Dự báo nhu cầu sản phẩm</h1><p>Dựa trên lịch sử bán hàng của chi nhánh để ước tính nhu cầu và nhận biết mặt hàng cần bổ sung.</p></div><div><Link className="outline-button" href="/du-bao-nhu-cau/khao-sat">Khảo sát mô hình AI</Link><Link className="outline-button" href="/dieu-chuyen">Phiếu điều chuyển</Link><Link className="outline-button" href="/don-mua-hang">Đơn mua hàng</Link></div></header>
    <section className="panel simple-forecast-controls"><label>Chi nhánh<select value={storeId} onChange={event => setStoreId(event.target.value)}><option value="">Chọn chi nhánh</option>{stores.map(store => <option key={store.id} value={store.id}>{store.code} · {store.name}</option>)}</select></label><label>Dự báo trong<select value={horizon} onChange={event => setHorizon(Number(event.target.value))}><option value={7}>7 ngày</option><option value={14}>14 ngày</option><option value={30}>30 ngày</option></select></label><button className="primary-button" type="button" disabled={!storeId || loading || running} onClick={() => void runNow()}>{running ? 'Đang dự đoán…' : 'Cập nhật dự đoán'}</button></section>
    {error && <div className="ui-error" role="alert">{error}</div>}
    {loading && <p role="status">Đang tải dữ liệu dự báo…</p>}
    {!loading && forecast?.run && <>
      <ForecastShortageBanner items={shortages.map(row => ({ ...row, storeId, storeName: forecast.store.name, horizonDays: forecast.run!.horizonDays })) as ForecastAlert[]} onFilter={() => setScope(current => current === 'SHORTAGE' ? 'ALL' : 'SHORTAGE')} filtered={scope === 'SHORTAGE'}/>
      <MetricGrid className="simple-forecast-summary" label="Kết quả dự báo"><MetricCard tone="blue" label="Sản phẩm được dự đoán" value={format(forecast.items.length)} caption={`${forecast.store.name} · ${horizon} ngày tới`}/><MetricCard tone="violet" label="Tổng nhu cầu dự báo" value={format(totalDemand)} caption="Tổng số lượng dự kiến bán trong kỳ"/><MetricCard tone={shortages.length ? 'amber' : 'green'} label="Cần bổ sung" value={format(shortages.length)} caption={`Thiếu dự kiến ${format(totalShort)} đơn vị`}/><MetricCard tone="teal" label="Lịch sử đã phân tích" value={`${format(forecast.run.historyDays)} ngày`} caption={`Cập nhật ${new Date(forecast.run.generatedAt).toLocaleString('vi-VN')}`}/></MetricGrid>
      <details className="forecast-method-toggle"><summary>Cách đọc dự báo và cơ sở tính toán</summary><section className="forecast-explainer"><header><div><span>CÁCH ĐỌC KẾT QUẢ</span><h2>Dự báo → đối chiếu tồn → gợi ý cần bù</h2><p>Con số là gợi ý vận hành có căn cứ, không tự tạo đơn mua và không tự thay đổi tồn kho.</p></div><details><summary>Cơ sở phương pháp</summary><p>Dự báo FreshMart dùng lịch sử bán theo SKU/chi nhánh để so sánh mô hình trên các đoạn thời gian đã qua. M5 chỉ dùng để kiểm tra quy trình nghiên cứu, không lấy số bán M5 để suy ra số lượng hàng FreshMart.</p><p>Tồn an toàn dùng sai số kiểm thử cuốn chiếu P95 khi đủ ít nhất 8 kỳ không chồng lấn; nếu chưa đủ, hệ thống ghi rõ và tạm dùng mức kho cấu hình.</p></details></header><ol className="forecast-explainer-steps"><li><b>1</b><span><strong>Lịch sử bán thật</strong><small>{forecast.run.historyDays} ngày của chi nhánh đang chọn; số bán trừ hàng khách trả.</small></span></li><li><b>2</b><span><strong>So mô hình theo thời gian</strong><small>Chọn mô hình có sai số thấp hơn trên các ngày chưa dùng để khớp mô hình.</small></span></li><li><b>3</b><span><strong>Tính phần dự phòng</strong><small>P95 từ backtest nếu đủ mẫu; nếu chưa đủ thì dùng mức cấu hình và báo rõ.</small></span></li><li><b>4</b><span><strong>Đưa ra hành động</strong><small>Nhu cầu + dự phòng − tồn khả dụng − hàng đang về = lượng còn thiếu.</small></span></li></ol>{demoRow && <div className="forecast-live-example"><strong>Ví dụ từ dữ liệu đang xem · {demoRow.productName}</strong><div><span>Nhu cầu {format(demoRow.predictedQuantity)} {demoRow.unit}</span><i>+</i><span>Dự phòng {format(demoRow.safetyStock)} {demoRow.unit}</span><i>−</i><span>Tồn {format(demoRow.available)} {demoRow.unit}</span><i>−</i><span>Đang về {format(demoInbound)} {demoRow.unit}</span><i>=</i><b>{demoRow.shortageQuantity > 0 ? `Cần bù ${format(demoRow.shortageQuantity)} ${demoRow.unit}` : 'Đủ hàng theo kỳ dự báo'}</b></div><small>{demoRow.safetyStockEvidence?.source === 'BACKTEST_P95' ? `Dự phòng từ backtest: ${demoRow.safetyStockEvidence.sampleCount} kỳ không chồng lấn · mục tiêu 95%, không phải cam kết.` : `Dự phòng tạm thời theo cấu hình kho: có ${demoRow.safetyStockEvidence?.sampleCount ?? 0}/8 kỳ kiểm thử hợp lệ.`}</small></div>}</section>
</details>      <section className="panel simple-forecast-table"><div className="panel-heading"><div><h2>Chi tiết dự báo theo sản phẩm</h2><p>Hiển thị {format(visibleRows.length)} / {format(allRows.length)} mã sản phẩm · sản phẩm cần bổ sung được xếp lên đầu.</p></div></div><div className="simple-forecast-filters"><label>Tìm sản phẩm<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Tên hoặc mã sản phẩm"/></label><label>Hiển thị<select value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="ALL">Tất cả sản phẩm</option><option value="SHORTAGE">Cần bổ sung ({shortages.length})</option><option value="COVERED">Đủ hàng ({allRows.length - shortages.length})</option></select></label><span>{forecast.run.model} · dự báo {horizon} ngày</span></div><div className="table-scroll"><table><thead><tr><th>Sản phẩm / Mã sản phẩm</th><th>Bán lịch sử</th><th>Dự báo {horizon} ngày</th><th>Tồn khả dụng</th><th>Đang về</th><th>Tồn an toàn</th><th>Số ngày đủ hàng</th><th>Cần bổ sung</th><th>Chất lượng</th><th>Lý do / căn cứ</th></tr></thead><tbody>{visibleRows.length ? visibleRows.map(row => { const incoming = row.inTransfer + row.incomingPurchase; const averageDaily = row.predictedQuantity / Math.max(1, horizon); const coverDays = averageDaily > 0 ? Math.max(0, Math.floor((row.available + incoming - row.safetyStock) / averageDaily)) : null; const reason = row.shortageQuantity > 0 ? `Nhu cầu ${format(row.predictedQuantity)} + an toàn ${format(row.safetyStock)} − tồn ${format(row.available)} − đang chuyển ${format(row.inTransfer)} − đơn mua hàng sắp về ${format(row.incomingPurchase)} = thiếu ${format(row.shortageQuantity)} ${row.unit}.` : `Tồn và hàng dự kiến về đáp ứng nhu cầu ${format(row.predictedQuantity)} ${row.unit} cùng mức an toàn ${format(row.safetyStock)} ${row.unit}.`; return <tr key={row.skuId} className={row.shortageQuantity > 0 ? 'simple-forecast-short-row' : undefined}><td><ProductIdentity name={row.productName} code={row.productCode} imageUrl={row.imageUrl}/></td><td>{format(row.observedQuantity)} {row.unit}</td><td><strong>{format(row.predictedQuantity)} {row.unit}</strong></td><td>{format(row.available)} {row.unit}</td><td>{format(incoming)} {row.unit}<small>Chuyển {format(row.inTransfer)} · Đơn mua hàng {format(row.incomingPurchase)}</small></td><td>{format(row.safetyStock)} {row.unit}<small>{row.safetyStockEvidence?.source === "BACKTEST_P95" ? "Từ kiểm thử cuốn chiếu · P95" : "Tạm dùng mức tồn an toàn kho cấu hình"}</small><ForecastEvidenceDialog title="Cơ sở mức dự phòng" product={row.productName}><small>{row.safetyStockEvidence?.basis ?? "Chưa có bằng chứng mức tồn an toàn trong lần dự báo này; hãy chạy dự báo mới."}</small></ForecastEvidenceDialog></td><td>{coverDays === null ? '—' : `${format(coverDays)} ngày`}</td><td>{row.shortageQuantity > 0 ? <StatusBadge tone={row.severity === 'HIGH' ? 'red' : row.severity === 'MEDIUM' ? 'amber' : 'blue'}>{format(row.shortageQuantity)} {row.unit}</StatusBadge> : <StatusBadge tone="green">Đủ hàng</StatusBadge>}</td><td><StatusBadge tone={row.dataQuality === 'SUFFICIENT' ? 'green' : 'amber'}>{row.dataQuality === 'SUFFICIENT' ? 'Đủ dữ liệu' : row.dataQuality === 'SPARSE' ? 'Dữ liệu thưa' : 'Chưa có bán'}</StatusBadge></td><td className="simple-forecast-reason"><ForecastEvidenceDialog title="Xem căn cứ" product={row.productName}>{reason}{row.timing && <><small>{row.timing.leadTimeDays === null ? 'Chưa cấu hình thời gian giao hàng.' : `Giao hàng dự kiến: ${row.timing.leadTimeDays} ngày. ${!row.timing.leadTimeCovered ? 'Cần chọn kỳ dự báo dài hơn để đánh giá đủ thời gian cung ứng.' : row.timing.urgent ? 'Có nguy cơ hết hàng trước khi hàng mới về; cân nhắc điều chuyển khẩn.' : row.timing.orderNow ? 'Nên đặt hàng ngay theo thời gian cung ứng.' : 'Chưa chạm ngưỡng đặt hàng theo thời gian cung ứng.'}`}</small>{row.shortageQuantity > 0 && row.purchaseUnit && <small>Nếu mua theo quy cách: {row.timing.suggestedPacks} {row.purchaseUnit} = {row.timing.roundedPurchaseQuantity} {row.unit}. Quản lý xem xét lượng làm tròn.</small>}<small>{row.timing.basis}</small></>}</ForecastEvidenceDialog></td></tr>; }) : <tr><td colSpan={10}><TableState message="Không có sản phẩm phù hợp bộ lọc."/></td></tr>}</tbody></table></div></section>
      <section className="panel simple-forecast-recommendations">
        <div className="panel-heading">
          <div>
            <h2>Đề xuất xử lý thiếu hàng (Ưu tiên điều chuyển nội bộ → Mua bổ sung)</h2>
            <p>Hệ thống tự động đối chiếu tồn dư vượt mức an toàn + nhu cầu dự báo tại các chi nhánh khác để đề xuất điều chuyển trước, phần còn thiếu mới đề xuất mua hàng.</p>
          </div>
          <div className="simple-forecast-rec-actions">
            <button className="primary-button" type="button" disabled={generating || running || !shortages.length} onClick={() => void handleGenerateRecommendations()}>
              {generating ? 'Đang lập phương án…' : recommendations.length ? 'Cập nhật đề xuất AI' : `Lập đề xuất xử lý (${shortages.length} mã thiếu)`}
            </button>
          </div>
        </div>
        {recommendations.length > 0 && <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Sản phẩm</th>
                <th>Phương án AI</th>
                <th>Nguồn cung / Kho nhận</th>
                <th>Số lượng đề xuất</th>
                <th>Trạng thái</th>
                <th>Phiếu nghiệp vụ / Quyết định</th>
              </tr>
            </thead>
            <tbody>
              {recommendations.map(item => (
                <tr key={item.id}>
                  <td><ProductIdentity name={item.productName} code={item.productCode} imageUrl={item.imageUrl}/></td>
                  <td>
                    <StatusBadge tone={item.type === 'TRANSFER' ? 'blue' : 'amber'}>
                      {item.type === 'TRANSFER' ? '1. Điều chuyển nội bộ' : '2. Mua bổ sung NCC'}
                    </StatusBadge>
                  </td>
                  <td>
                    {item.type === 'TRANSFER'
                      ? <><strong>{item.sourceWarehouse?.store.name}</strong><small>{item.sourceWarehouse?.name} → {item.destinationWarehouse?.name}</small></>
                      : <><strong>{item.targetStore.name}</strong><small>Mua từ Nhà cung cấp (hết tồn dư nội bộ)</small></>}
                  </td>
                  <td><strong>{format(item.finalQuantity ?? item.suggestedQuantity)} {item.unit}</strong></td>
                  <td>
                    <StatusBadge tone={item.status === 'APPLIED' ? 'green' : item.status === 'PENDING' ? 'amber' : 'neutral'}>
                      {item.status === 'PENDING' ? 'Chờ phê duyệt' : item.status === 'APPLIED' ? 'Đã tạo phiếu' : item.status === 'SUPERSEDED' ? 'Hết hiệu lực' : 'Đã từ chối'}
                    </StatusBadge>
                  </td>
                  <td>
                    {item.transfer ? (
                      <Link className="outline-button" href={`/dieu-chuyen/${item.transfer.id}`}>Xem phiếu {item.transfer.code} →</Link>
                    ) : item.purchaseRequest ? (
                      <Link className="outline-button" href={`/de-nghi-mua/${item.purchaseRequest.id}`}>Xem đề nghị {item.purchaseRequest.code} →</Link>
                    ) : item.status === 'PENDING' ? (
                      <div className="simple-forecast-rec-buttons">
                        <button className="primary-button" type="button" disabled={!!decidingId} onClick={() => void handleDecision(item, 'APPLY')}>
                          {decidingId === item.id ? 'Đang xử lý…' : item.type === 'TRANSFER' ? 'Duyệt tạo phiếu chuyển' : 'Duyệt tạo đề nghị mua'}
                        </button>
                        <button className="outline-button" type="button" disabled={!!decidingId} onClick={() => void handleDecision(item, 'DISMISS')}>
                          Từ chối
                        </button>
                      </div>
                    ) : (
                      <small>{item.decisionNote ?? '—'}</small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      </section>
    </>}
    {!loading && !forecast?.run && !error && <section className="panel empty-state"><h2>Chưa có dữ liệu dự báo</h2><p>Chọn chi nhánh để tạo dự báo nhu cầu từ dữ liệu bán hàng.</p></section>}
  </main>;
}

export default function ForecastPage() { return <Protected permission="reports.read"><SimpleForecastPage /></Protected>; }
