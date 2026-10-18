'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth-provider';
import { useToast } from '../ui/toast-provider';
import { errorMessage } from '../../lib/auth-api';
import { getDemandForecast, getShortageAlerts, runDemandForecast, type DemandForecast, type ForecastInventoryAdvice } from '../../lib/forecasts-api';
import { generateRecommendations, getRecommendations, type InventoryRecommendation, type RecommendationList } from '../../lib/recommendations-api';
import { getInventory, type InventoryList } from '../../lib/inventory-api';
import { getStores } from '../../lib/organization-api';
import type { Product, Sku } from '../../lib/products-api';
import { StatusBadge } from '../ui/status-badge';

type StoreOption = { id: string; code: string; name: string };
const count = (value: number) => new Intl.NumberFormat('vi-VN').format(value);
const can = (permissions: string[] | undefined, permission: string) => !!permissions && (permissions.includes('*') || permissions.includes(permission));

export function ProductAiAdvice({ product, sku }: { product: Product; sku: Sku }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const canReadForecast = can(user?.permissions, 'reports.read');
  const canReadInventory = can(user?.permissions, 'inventory.read');
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storeId, setStoreId] = useState('');
  const [horizonDays, setHorizonDays] = useState(14);
  const [forecast, setForecast] = useState<DemandForecast | null>(null);
  const [analysis, setAnalysis] = useState<ForecastInventoryAdvice | null>(null);
  const [recommendations, setRecommendations] = useState<InventoryRecommendation[]>([]);
  const [inventory, setInventory] = useState<InventoryList | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user || !canReadForecast) return;
    if (!user.globalAccess) {
      const assigned = user.stores.filter(store => store.active).map(({ id, code, name }) => ({ id, code, name }));
      setStores(assigned);
      setStoreId(current => assigned.some(store => store.id === current) ? current : assigned[0]?.id ?? '');
      return;
    }
    getStores().then(rows => {
      const active = rows.filter(row => row.active).map(({ id, code, name }) => ({ id, code, name }));
      setStores(active);
      setStoreId(current => active.some(store => store.id === current) ? current : active[0]?.id ?? '');
    }).catch(reason => setError(errorMessage(reason)));
  }, [user, canReadForecast]);

  const load = async (targetStoreId = storeId) => {
    if (!targetStoreId || !canReadForecast) return;
    setLoading(true);
    setError('');
    try {
      const [nextForecast, shortage, nextRecommendations, stocks] = await Promise.all([
        getDemandForecast(targetStoreId, horizonDays),
        getShortageAlerts(targetStoreId, horizonDays),
        getRecommendations(targetStoreId, horizonDays),
        canReadInventory ? getInventory({ q: sku.code, status: 'all', page: 1, pageSize: 100 }) : Promise.resolve(null),
      ]);
      setForecast(nextForecast);
      setAnalysis(shortage.analysisItems.find(item => item.skuId === sku.id) ?? null);
      setRecommendations(nextRecommendations.items.filter(item => item.skuId === sku.id));
      setInventory(stocks);
    } catch (reason) {
      setError(errorMessage(reason));
      setForecast(null);
      setAnalysis(null);
      setRecommendations([]);
      setInventory(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!storeId) return;
    let active = true;
    setLoading(true);
    setError('');
    Promise.all([
      getDemandForecast(storeId, horizonDays),
      getShortageAlerts(storeId, horizonDays),
      getRecommendations(storeId, horizonDays),
      canReadInventory ? getInventory({ q: sku.code, status: 'all', page: 1, pageSize: 100 }) : Promise.resolve(null),
    ]).then(([nextForecast, shortage, nextRecommendations, stocks]) => {
      if (!active) return;
      setForecast(nextForecast);
      setAnalysis(shortage.analysisItems.find(item => item.skuId === sku.id) ?? null);
      setRecommendations(nextRecommendations.items.filter(item => item.skuId === sku.id));
      setInventory(stocks);
    }).catch(reason => { if (active) { setError(errorMessage(reason)); setForecast(null); setAnalysis(null); setRecommendations([]); setInventory(null); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [storeId, horizonDays, sku.id, sku.code, canReadInventory]);

  const selectedStore = stores.find(store => store.id === storeId);
  const forecastItem = forecast?.items.find(item => item.skuId === sku.id);
  const inventoryRows = useMemo(() => (inventory?.items ?? []).filter(row => row.skuId === sku.id), [inventory, sku.id]);
  const status = analysis?.severity ?? (analysis?.surplusQuantity ? 'SURPLUS' : forecastItem ? 'ENOUGH' : null);

  if (!canReadForecast) return null;

  const refreshForecast = async () => {
    if (!storeId) return;
    setRunning(true);
    setError('');
    try {
      await runDemandForecast(storeId, horizonDays);
      await load();
      showToast(`Đã dự báo ${horizonDays} ngày từ doanh số thật tại ${selectedStore?.name ?? 'chi nhánh'}.`);
    } catch (reason) {
      const message = errorMessage(reason);
      setError(message);
      showToast(message, 'error');
    } finally { setRunning(false); }
  };

  const createSuggestions = async () => {
    if (!storeId) return;
    setGenerating(true);
    setError('');
    try {
      const result: RecommendationList = await generateRecommendations(storeId, horizonDays);
      setRecommendations(result.items.filter(item => item.skuId === sku.id));
      showToast(result.items.length ? `Đã lưu ${result.items.length} đề xuất của chi nhánh để quản lý xem xét.` : 'Không có phần thiếu cần điều chuyển hoặc mua thêm.');
    } catch (reason) {
      const message = errorMessage(reason);
      setError(message);
      showToast(message, 'error');
    } finally { setGenerating(false); }
  };

  return <section className="detail-table panel product-ai-advice" aria-labelledby="product-ai-advice-title">
    <header>
      <div><h2 id="product-ai-advice-title">Dự báo và cảnh báo AI</h2><p>Dùng model đã train trên M5 để dự báo từ doanh số hóa đơn thật và tồn kho PostgreSQL của chi nhánh.</p></div>
      <div className="page-actions">
        <label>Chi nhánh<select value={storeId} onChange={event => setStoreId(event.target.value)} disabled={!stores.length || loading || running}>
          {stores.length ? stores.map(store => <option key={store.id} value={store.id}>{store.code} · {store.name}</option>) : <option value="">Đang tải chi nhánh…</option>}
        </select></label>
        <label>Kỳ dự báo<select value={horizonDays} onChange={event => setHorizonDays(Number(event.target.value))} disabled={loading || running}><option value={7}>7 ngày</option><option value={14}>14 ngày</option><option value={30}>30 ngày</option></select></label>
        <button className="outline-button" onClick={refreshForecast} disabled={!storeId || loading || running || !sku.active}>{running ? 'Đang chạy AI…' : forecast?.run ? 'Cập nhật dự báo' : 'Dự báo từ dữ liệu thật'}</button>
      </div>
    </header>
    {error && <div className="ui-error" role="alert">{error}</div>}
    {loading && <p role="status">Đang tải tồn kho và dự báo cho sản phẩm…</p>}
    {!loading && !stores.length && <p className="form-note">Tài khoản chưa được gán vào chi nhánh đang hoạt động.</p>}
    {!loading && storeId && forecast && !forecast.run && <p className="form-note">Chưa có lần dự báo cho chi nhánh/kỳ này. Chọn “Dự báo từ dữ liệu thật” để đọc 56 ngày doanh số trong hệ thống, chạy model và lưu kết quả.</p>}
    {!loading && forecast?.run && <>
      <div className="product-ai-summary">
        <div><span>Model</span><strong>{forecast.run.model}</strong></div>
        <div><span>Nhu cầu dự báo</span><strong>{forecastItem ? `${count(forecastItem.predictedQuantity)} ${product.unit}` : 'Sản phẩm này chưa nằm trong lần dự báo'}</strong></div>
        <div><span>Tồn khả dụng</span><strong>{count(analysis?.available ?? forecastItem?.availableAtRun ?? 0)} {product.unit}</strong></div>
        <div><span>Tồn an toàn</span><strong>{count(analysis?.safetyStock ?? forecastItem?.safetyStockAtRun ?? 0)} {product.unit}</strong></div>
        <div><span>Đang về</span><strong>{count((analysis?.inTransfer ?? 0) + (analysis?.incomingPurchase ?? 0))} {product.unit}</strong></div>
        <div><span>Khoảng dự báo</span><strong>{forecast.run.forecastFrom.slice(0, 10)} → {forecast.run.forecastTo.slice(0, 10)}</strong></div>
      </div>
      <div className="product-ai-alert" role="status">
        {status === 'HIGH' || status === 'MEDIUM' || status === 'LOW' ? <>
          <StatusBadge tone={status === 'HIGH' ? 'red' : status === 'MEDIUM' ? 'amber' : 'blue'}>Nguy cơ thiếu · {status === 'HIGH' ? 'Cao' : status === 'MEDIUM' ? 'Trung bình' : 'Thấp'}</StatusBadge>
          <strong>Cần bù khoảng {count(analysis?.shortageQuantity ?? 0)} {product.unit}</strong>
          <span>Đã tính tồn an toàn, hàng đang chuyển và PO dự kiến nhận trong kỳ.</span>
        </> : status === 'SURPLUS' ? <>
          <StatusBadge tone="green">Đang dư so với nhu cầu</StatusBadge>
          <strong>Dư khoảng {count(analysis?.surplusQuantity ?? 0)} {product.unit} sau khi giữ tồn an toàn.</strong>
          <span>Chỉ là lượng dư ước tính tại chi nhánh này; đề xuất chuyển còn đối chiếu dự báo nguồn và các phiếu đang chờ.</span>
        </> : forecastItem ? <>
          <StatusBadge tone="green">Đủ đáp ứng kỳ dự báo</StatusBadge>
          <strong>Chưa cần điều chuyển hoặc mua thêm cho chi nhánh này.</strong>
          <span>Dữ liệu bán: {count(forecastItem.observedQuantity)} {product.unit} trong 56 ngày · {forecastItem.dataQuality === 'SUFFICIENT' ? 'đủ dữ liệu' : forecastItem.dataQuality === 'SPARSE' ? 'dữ liệu bán thưa' : 'chưa có bán hàng'}.</span>
        </> : <><StatusBadge tone="amber">Chưa có kết quả cho sản phẩm</StatusBadge><span>Hãy kiểm tra sản phẩm đang kinh doanh và cập nhật dự báo.</span></>}
      </div>
      {analysis && analysis.severity && recommendations.length === 0 && <div className="product-ai-actions"><button className="primary-button" onClick={createSuggestions} disabled={generating}>{generating ? 'Đang đối chiếu tồn các chi nhánh…' : 'Tạo đề xuất chuyển / mua hàng'}</button><span>Tạo đề xuất chờ quản lý duyệt; không tự tạo phiếu hoặc sửa tồn.</span></div>}
    </>}
    {recommendations.length > 0 && <div className="table-scroll"><div className="panel-heading"><h3>Đề xuất đang lưu cho sản phẩm này</h3><Link href="/de-xuat">Mở trang duyệt đề xuất</Link></div><table><thead><tr><th>Loại</th><th>Chi nhánh / kho</th><th className="numeric">Số lượng</th><th>Trạng thái</th><th>Phiếu</th></tr></thead><tbody>{recommendations.map(item => <tr key={item.id}>
      <td><StatusBadge tone={item.type === 'TRANSFER' ? 'blue' : 'amber'}>{item.type === 'TRANSFER' ? 'Điều chuyển' : 'Mua bổ sung'}</StatusBadge></td>
      <td>{item.type === 'TRANSFER' ? <>{item.sourceWarehouse?.store.name}<small>{item.sourceWarehouse?.name} → {item.destinationWarehouse?.name}</small></> : <>{item.targetStore.name}<small>Chưa đủ nguồn hàng nội bộ</small></>}</td>
      <td className="numeric"><strong>{count(item.finalQuantity ?? item.suggestedQuantity)} {product.unit}</strong></td>
      <td>{item.status === 'PENDING' ? 'Chờ quản lý duyệt' : item.status === 'APPROVED' ? 'Đã chấp thuận' : item.status === 'SUPERSEDED' ? 'Hết hiệu lực' : 'Đã từ chối'}</td>
      <td>{item.transfer ? <Link href={`/dieu-chuyen/${item.transfer.id}`}>{item.transfer.code}</Link> : item.purchaseRequest ? <Link href={`/de-nghi-mua/${item.purchaseRequest.id}`}>{item.purchaseRequest.code}</Link> : 'Chưa tạo (chờ duyệt)'}</td>
    </tr>)}</tbody></table></div>}
    {canReadInventory && inventoryRows.length > 0 && <div className="table-scroll product-ai-stock"><div className="panel-heading"><h3>Tồn sản phẩm tại các chi nhánh trong phạm vi tài khoản</h3><span className="panel-meta">Số “vượt tồn an toàn” chưa trừ nhu cầu dự báo nguồn</span></div><table><thead><tr><th>Chi nhánh / kho</th><th className="numeric">Tồn</th><th className="numeric">Khả dụng</th><th className="numeric">Đang về</th><th className="numeric">An toàn</th><th className="numeric">Trên mức an toàn</th></tr></thead><tbody>{inventoryRows.map(row => <tr key={row.id}>
      <td>{row.warehouse.store.name}<small>{row.warehouse.name}</small></td><td className="numeric">{count(row.onHand)}</td><td className="numeric">{count(row.available)}</td><td className="numeric">{count(row.incoming)}</td><td className="numeric">{count(row.safetyStock)}</td><td className="numeric">{count(Math.max(0, row.available - row.safetyStock))}</td>
    </tr>)}</tbody></table></div>}
    {forecast?.run && <p className="form-note">Dự báo được lưu lúc {new Date(forecast.run.generatedAt).toLocaleString('vi-VN')}. Doanh số huấn luyện M5 chỉ cung cấp mô hình; số lượng hiển thị được dự đoán từ dữ liệu bán hàng và tồn kho thật của chi nhánh, không lấy tồn M5 làm tồn vận hành.</p>}
  </section>;
}
