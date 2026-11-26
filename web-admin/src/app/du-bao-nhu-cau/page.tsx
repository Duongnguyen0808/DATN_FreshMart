'use client';
import { ForecastShortageBanner, type ForecastAlert } from '../../components/forecast-shortage-alert';
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
import {
  createFefoRiskTransfer,
  executeSmartRebalance,
  getDemandForecast,
  getFefoExpiryRisks,
  getShortageAlerts,
  runDemandForecast,
  type DemandForecast,
  type FefoExpiryRiskItem,
  type FefoExpiryRiskReport,
  type ShortageAlertReport,
} from '../../lib/forecasts-api';
import { decideRecommendation, generateRecommendations, getRecommendations, type InventoryRecommendation } from '../../lib/recommendations-api';
import { getStores } from '../../lib/organization-api';

type StoreOption = { id: string; code: string; name: string };
const format = (value: number) => new Intl.NumberFormat('vi-VN').format(Math.round(value));
const todayInVietnam = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
const shortDateVn = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-');
  return d && m && y ? `${d}/${m}/${y}` : isoDate;
};

function SimpleForecastPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const can = (permission: string) => Boolean(user?.permissions.includes('*') || user?.permissions.includes(permission));

  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storeId, setStoreId] = useState('');
  const [horizon, setHorizon] = useState(14);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'ALL' | 'SHORTAGE' | 'COVERED'>('ALL');
  const [showAllFefo, setShowAllFefo] = useState(false);
  const [forecast, setForecast] = useState<DemandForecast | null>(null);
  const [analysis, setAnalysis] = useState<ShortageAlertReport | null>(null);
  const [recommendations, setRecommendations] = useState<InventoryRecommendation[]>([]);
  const [fefoReport, setFefoReport] = useState<FefoExpiryRiskReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [decidingId, setDecidingId] = useState('');
  const [rebalancingSkuId, setRebalancingSkuId] = useState('');
  const [transferringLotId, setTransferringLotId] = useState('');
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

  const reloadData = async (currentStoreId: string, currentHorizon: number) => {
    const [stock, nextRecs, fefo] = await Promise.all([
      getShortageAlerts(currentStoreId, currentHorizon),
      getRecommendations(currentStoreId, currentHorizon).catch(() => null),
      getFefoExpiryRisks(undefined, currentHorizon).catch(() => null),
    ]);
    setAnalysis(stock);
    setRecommendations(Array.isArray(nextRecs?.items) ? nextRecs.items : []);
    if (fefo) setFefoReport(fefo);
  };

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
        const [stock, nextRecs, fefo] = await Promise.all([
          getShortageAlerts(storeId, horizon),
          getRecommendations(storeId, horizon).catch(() => null),
          getFefoExpiryRisks(undefined, horizon).catch(() => null),
        ]);
        if (active) {
          setForecast(result);
          setAnalysis(stock);
          setRecommendations(Array.isArray(nextRecs?.items) ? nextRecs.items : []);
          if (fefo) setFefoReport(fefo);
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
      setForecast(result);
      await reloadData(storeId, horizon);
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

  const handleOneClickRebalance = async (skuId: string, productName: string) => {
    if (!storeId || rebalancingSkuId) return;
    setRebalancingSkuId(skuId); setError('');
    try {
      const res = await executeSmartRebalance(storeId, horizon, skuId);
      await reloadData(storeId, horizon);
      const codesText = res.createdCodes?.length ? ` (${res.createdCodes.join(', ')})` : '';
      showToast(
        res.appliedCount > 0
          ? `Đã tạo ${res.appliedCount} phiếu cho "${productName}"${codesText}.`
          : `Đã đồng bộ phương án điều phối cho "${productName}".`
      );
    } catch (reason) {
      const message = errorMessage(reason);
      setError(message);
      showToast(message, 'error');
    } finally {
      setRebalancingSkuId('');
    }
  };

  const handleFefoRiskTransfer = async (lot: FefoExpiryRiskItem) => {
    if (!lot.recommendedTransferBranch || transferringLotId) return;
    setTransferringLotId(lot.lotId); setError('');
    try {
      const created = await createFefoRiskTransfer({
        sourceWarehouseId: lot.warehouseId,
        destinationWarehouseId: lot.recommendedTransferBranch.warehouseId,
        skuId: lot.skuId,
        quantity: lot.recommendedTransferBranch.absorbableQuantity,
        lotCode: lot.lotCode,
      });
      await reloadData(storeId, horizon);
      showToast(
        created.alreadyExists
          ? `Đã có sẵn phiếu điều chuyển ${created.code} cho lô ${lot.lotCode}.`
          : `Đã tạo phiếu điều chuyển ${created.code} (${lot.recommendedTransferBranch.absorbableQuantity} ${lot.unit} → ${lot.recommendedTransferBranch.warehouseName}).`
      );
    } catch (reason) {
      const message = errorMessage(reason);
      setError(message);
      showToast(message, 'error');
    } finally {
      setTransferringLotId('');
    }
  };

  const handleDecision = async (item: InventoryRecommendation, action: 'APPLY' | 'DISMISS') => {
    if (decidingId) return;
    setDecidingId(item.id); setError('');
    try {
      await decideRecommendation(
        item.id,
        action,
        action === 'APPLY' ? 'Phê duyệt từ bảng dự báo AI' : 'Từ chối từ bảng dự báo AI',
        action === 'APPLY' ? item.suggestedQuantity : undefined,
      );
      await reloadData(storeId, horizon);
      showToast(action === 'APPLY' ? 'Đã phê duyệt và tạo phiếu nghiệp vụ.' : 'Đã từ chối đề xuất.');
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
  const visibleRows = allRows.filter(row =>
    (scope === 'ALL' || (scope === 'SHORTAGE' ? row.shortageQuantity > 0 : row.shortageQuantity === 0)) &&
    `${row.productName} ${row.productCode} ${row.skuCode}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  );
  const totalShort = shortages.reduce((sum, row) => sum + row.shortageQuantity, 0);
  const totalTransferable = analysis?.summary?.transferableQuantity ?? shortages.reduce((sum, row) => sum + (row.smartRebalancing?.totalTransferQty ?? 0), 0);
  const totalCapitalSaved = analysis?.summary?.estimatedCapitalSaved ?? shortages.reduce((sum, row) => sum + (row.smartRebalancing?.estimatedCapitalSaved ?? 0), 0);
  const demoRow = shortages[0] ?? allRows[0];
  const demoInbound = demoRow ? demoRow.inTransfer + demoRow.incomingPurchase : 0;

  const recsBySku = useMemo(() => {
    const map = new Map<string, InventoryRecommendation[]>();
    for (const r of recommendations) {
      const list = map.get(r.skuId) ?? [];
      list.push(r);
      map.set(r.skuId, list);
    }
    return map;
  }, [recommendations]);

  const fefoAtRiskRows = useMemo(
    () => (fefoReport?.items ?? []).filter(item => item.atRiskQuantity > 0),
    [fefoReport]
  );

  const visibleFefoRows = useMemo(() => {
    const base = showAllFefo
      ? (fefoReport?.items ?? []).filter(i => i.daysRemaining <= 35 || i.atRiskQuantity > 0)
      : fefoAtRiskRows;
    return base.slice(0, 12);
  }, [fefoReport, fefoAtRiskRows, showAllFefo]);

  return <main className="suite-page simple-forecast-page">
    <header className="suite-heading">
      <div>
        <div className="breadcrumb">Dự báo & Điều phối</div>
        <h1>Dự báo nhu cầu & điều phối chuỗi</h1>
        <p>Dự báo sức mua từng chi nhánh, ưu tiên điều chuyển hàng dư nội bộ trước khi đặt mua nhà cung cấp và cảnh báo lô cận hạn FEFO.</p>
      </div>
      <div className="heading-actions">
        <Link className="outline-button" href="/du-bao-nhu-cau/khao-sat">Khảo sát mô hình AI</Link>
        <Link className="outline-button" href="/lo-han-dung">Lô và hạn sử dụng</Link>
      </div>
    </header>

    <section className="panel simple-forecast-controls">
      <label>Chi nhánh
        <select value={storeId} onChange={event => setStoreId(event.target.value)}>
          <option value="">Chọn chi nhánh</option>
          {stores.map(store => <option key={store.id} value={store.id}>{store.code} · {store.name}</option>)}
        </select>
      </label>
      <label>Chu kỳ dự báo
        <select value={horizon} onChange={event => setHorizon(Number(event.target.value))}>
          <option value={7}>7 ngày tới</option>
          <option value={14}>14 ngày tới</option>
          <option value={30}>30 ngày tới</option>
        </select>
      </label>
      <button className="primary-button" type="button" disabled={!storeId || loading || running} onClick={() => void runNow()}>
        {running ? 'Đang dự đoán…' : 'Cập nhật dự đoán'}
      </button>
    </section>

    {error && <div className="ui-error" role="alert">{error}</div>}
    {loading && <p role="status">Đang tải dữ liệu dự báo…</p>}

    {!loading && forecast?.run && <>
      <ForecastShortageBanner
        items={shortages.map(row => ({ ...row, storeId, storeName: forecast.store.name, horizonDays: forecast.run!.horizonDays })) as ForecastAlert[]}
        onFilter={() => setScope(current => current === 'SHORTAGE' ? 'ALL' : 'SHORTAGE')}
        filtered={scope === 'SHORTAGE'}
      />

      <MetricGrid className="simple-forecast-summary" label="Tổng quan dự báo">
        <MetricCard tone="blue" label="Sản phẩm dự báo" value={format(forecast.items.length)} caption={`${forecast.store.name} · ${horizon} ngày`}/>
        <MetricCard tone={shortages.length ? 'amber' : 'green'} label="Cần bổ sung" value={`${format(shortages.length)} mã`} caption={shortages.length ? `Thiếu ${format(totalShort)} đv · Chuyển nội bộ ${format(totalTransferable)} đv` : 'Các mặt hàng đều đủ tồn'}/>
        <MetricCard tone="violet" label="Tiết kiệm vốn nhập" value={`${format(totalCapitalSaved)} đ`} caption="Điều chuyển hàng dư thay vì mua NCC"/>
        <MetricCard tone={fefoAtRiskRows.length ? 'red' : 'teal'} label="Lô cận hạn có nguy cơ" value={`${format(fefoAtRiskRows.length)} lô`} caption={fefoReport?.summary ? `Dự kiến tồn đọng ${format(fefoReport.summary.totalAtRiskUnits)} đv` : 'Đang phân tích FEFO'}/>
      </MetricGrid>

      <details className="forecast-method-toggle">
        <summary>Công thức tính thiếu hàng và cơ sở cân đối chuỗi</summary>
        <section className="forecast-explainer">
          <header>
            <div>
              <span>CƠ SỞ TÍNH TOÁN</span>
              <h2>Dự báo → Đối chiếu tồn → Điều chuyển kho dư → Mua NCC</h2>
              <p>Thiếu hụt = Dự báo + Tồn an toàn − Tồn khả dụng − Hàng đang về. Hệ thống kiểm tra tồn dư vượt ngưỡng dự báo của các kho khác trước khi đề xuất mua mới.</p>
            </div>
            <details>
              <summary>Chi tiết dữ liệu mô hình</summary>
              <p>Mô hình dự báo dùng lịch sử bán thực tế của từng chi nhánh; tồn an toàn tính từ sai số kiểm thử cuốn chiếu P95 hoặc mức cấu hình kho khi chưa đủ mẫu.</p>
            </details>
          </header>
          <ol className="forecast-explainer-steps">
            <li><b>1</b><span><strong>Lịch sử bán thật</strong><small>{forecast.run.historyDays} ngày bán ròng của chi nhánh đang chọn.</small></span></li>
            <li><b>2</b><span><strong>Chọn mô hình</strong><small>Tự chọn mô hình có sai số thấp nhất theo chu kỳ {horizon} ngày.</small></span></li>
            <li><b>3</b><span><strong>Tồn an toàn</strong><small>P95 từ backtest hoặc cấu hình dự phòng của kho.</small></span></li>
            <li><b>4</b><span><strong>Cân đối chuỗi</strong><small>Điều chuyển kho dư trước, chỉ mua NCC phần thiếu còn lại.</small></span></li>
          </ol>
          {demoRow && (
            <div className="forecast-live-example">
              <strong>Ví dụ: {demoRow.productName}</strong>
              <div>
                <span>Dự báo {format(demoRow.predictedQuantity)} {demoRow.unit}</span><i>+</i>
                <span>Dự phòng {format(demoRow.safetyStock)} {demoRow.unit}</span><i>−</i>
                <span>Tồn {format(demoRow.available)} {demoRow.unit}</span><i>−</i>
                <span>Đang về {format(demoInbound)} {demoRow.unit}</span><i>=</i>
                <b>{demoRow.shortageQuantity > 0 ? `Cần bù ${format(demoRow.shortageQuantity)} ${demoRow.unit}` : 'Đủ hàng'}</b>
              </div>
            </div>
          )}
        </section>
      </details>

      {/* BẢNG 1: SMART BRANCH REBALANCING */}
      <section className="panel simple-forecast-table">
        <div className="panel-heading">
          <div>
            <h2>Đề xuất điều chuyển & bổ sung hàng giữa các kho</h2>
            <p>Ưu tiên điều chuyển hàng dư từ chi nhánh khác (đã giữ lại tồn an toàn và dự báo bán của kho nguồn) trước khi đặt mua nhà cung cấp. Chưa có dữ liệu thời gian và chi phí tuyến đường để tối ưu vận chuyển.</p>
          </div>
        </div>
        <div className="simple-forecast-filters">
          <label>Tìm sản phẩm
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Tên hoặc mã sản phẩm"/>
          </label>
          <label>Trạng thái
            <select value={scope} onChange={event => setScope(event.target.value as typeof scope)}>
              <option value="ALL">Tất cả ({allRows.length})</option>
              <option value="SHORTAGE">Cần bổ sung ({shortages.length})</option>
              <option value="COVERED">Đủ hàng ({allRows.length - shortages.length})</option>
            </select>
          </label>
          <span>{forecast.run.model} · {horizon} ngày</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Sản phẩm</th>
                <th>Dự báo / Dự phòng</th>
                <th>Tồn / Đang về</th>
                <th>Cân đối thiếu</th>
                <th>Phương án chuỗi (AI)</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length ? visibleRows.map(row => {
                const incoming = row.inTransfer + row.incomingPurchase;
                const reb = row.smartRebalancing;
                const skuRecs = recsBySku.get(row.skuId) ?? [];
                const activeTransfers = skuRecs.filter(r => r.transfer && r.transfer.status !== 'CANCELLED');
                const activePurchases = skuRecs.filter(r => r.purchaseRequest && r.purchaseRequest.status !== 'CANCELLED');
                const hasCreatedDocs = activeTransfers.length > 0 || activePurchases.length > 0;
                const needsTransfer = (reb?.totalTransferQty ?? 0) > 0;
                const needsPurchase = (reb?.remainingPurchaseQty ?? 0) > 0 || (!reb && row.shortageQuantity > 0);
                const hasPermission =
                  (!needsTransfer || can('transfers.create')) &&
                  (!needsPurchase || can('purchase_requests.create'));

                return (
                  <tr key={row.skuId} className={row.shortageQuantity > 0 ? 'simple-forecast-short-row' : undefined}>
                    <td><ProductIdentity name={row.productName} code={row.productCode} imageUrl={row.imageUrl}/></td>
                    <td>
                      <strong>{format(row.predictedQuantity)} {row.unit}</strong>
                      <small>Dự phòng: {format(row.safetyStock)} {row.unit}</small>
                    </td>
                    <td>
                      <strong>{format(row.available)} {row.unit}</strong>
                      <small>Đang về: {format(incoming)} {row.unit}</small>
                    </td>
                    <td>
                      {row.shortageQuantity > 0 ? (
                        <StatusBadge tone={row.severity === 'HIGH' ? 'red' : row.severity === 'MEDIUM' ? 'amber' : 'blue'}>
                          Thiếu {format(row.shortageQuantity)} {row.unit}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="green">Đủ hàng</StatusBadge>
                      )}
                    </td>
                    <td>
                      {row.shortageQuantity > 0 && reb ? (
                        <div className="ai-plan-list">
                          {reb.transfers.map(t => (
                            <span key={t.sourceWarehouseId}>
                              Điều chuyển <strong>{format(t.suggestedTransferQty)} {row.unit}</strong> từ {t.sourceWarehouseName}
                            </span>
                          ))}
                          {reb.remainingPurchaseQty > 0 && (
                            <span>
                              Mua NCC: <strong>{format(reb.remainingPurchaseQty)} {row.unit}</strong>
                              {reb.totalTransferQty === 0 && ' (kho khác hết dư)'}
                            </span>
                          )}
                          {reb.estimatedCapitalSaved > 0 && (
                            <span className="ai-plan-saved">Tiết kiệm {format(reb.estimatedCapitalSaved)} đ vốn</span>
                          )}
                        </div>
                      ) : (
                        <span className="ai-plan-list"><span className="ai-plan-muted">Đủ nguồn cung</span></span>
                      )}
                    </td>
                    <td>
                      {row.shortageQuantity > 0 ? (
                        <div className="ai-actions-col">
                          {activeTransfers.map(r => r.transfer && (
                            <Link key={r.id} className="outline-button" href={`/dieu-chuyen/${r.transfer.id}`}>
                              Phiếu {r.transfer.code} →
                            </Link>
                          ))}
                          {activePurchases.map(r => r.purchaseRequest && (
                            <Link key={r.id} className="outline-button" href={`/de-nghi-mua/${r.purchaseRequest.id}`}>
                              Đề nghị {r.purchaseRequest.code} →
                            </Link>
                          ))}
                          {!hasCreatedDocs && (
                            hasPermission ? (
                              <button
                                type="button"
                                className="primary-button"
                                disabled={rebalancingSkuId === row.skuId}
                                onClick={() => void handleOneClickRebalance(row.skuId, row.productName)}
                              >
                                {rebalancingSkuId === row.skuId
                                  ? 'Đang tạo…'
                                  : needsTransfer && needsPurchase
                                    ? 'Tạo chuyển + mua'
                                    : needsTransfer
                                      ? 'Tạo điều chuyển'
                                      : 'Tạo đề nghị mua'}
                              </button>
                            ) : (
                              <small>Chưa có quyền lập phiếu</small>
                            )
                          )}
                        </div>
                      ) : (
                        <span className="ai-plan-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              }) : <tr><td colSpan={6}><TableState message="Không có sản phẩm phù hợp bộ lọc."/></td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* BẢNG 2: FEFO EXPIRY RISK × AI FORECAST */}
      <section className="panel simple-forecast-recommendations">
        <div className="panel-heading">
          <div>
            <h2>Lô cận hạn có nguy cơ dư trước hạn (toàn chuỗi)</h2>
            <p>Đối chiếu tồn theo lô FEFO với tốc độ tiêu thụ dự báo AI để gợi ý xả hàng hoặc điều chuyển sang chi nhánh bán nhanh hơn.</p>
          </div>
          <div className="simple-forecast-rec-actions">
            {fefoReport && fefoReport.items.length > fefoAtRiskRows.length && (
              <button
                type="button"
                className="outline-button"
                onClick={() => setShowAllFefo(v => !v)}
              >
                {showAllFefo ? `Chỉ lô nguy cơ (${fefoAtRiskRows.length})` : `Xem thêm lô an toàn`}
              </button>
            )}
            <Link className="outline-button" href="/lo-han-dung">Quản lý lô và hạn sử dụng →</Link>
          </div>
        </div>
        {visibleFefoRows.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Sản phẩm / Kho</th>
                  <th>Mã lô / Hạn dùng</th>
                  <th>Tồn / Dự báo bán</th>
                  <th>Nguy cơ dư</th>
                  <th>Đề xuất AI</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {visibleFefoRows.map(lot => (
                  <tr key={lot.lotId} className={lot.atRiskQuantity > 0 ? 'simple-forecast-short-row' : undefined}>
                    <td>
                      <ProductIdentity name={lot.productName} code={lot.productCode} imageUrl={lot.imageUrl}/>
                      <small>{lot.warehouseName}</small>
                    </td>
                    <td>
                      <span className="lot-code" title={lot.lotCode}>{lot.lotCode}</span>
                      <small style={{ color: lot.daysRemaining <= 14 ? '#b91c1c' : undefined }}>
                        {lot.daysRemaining < 0 ? `Quá hạn ${Math.abs(lot.daysRemaining)} ngày` : `Còn ${lot.daysRemaining} ngày`} ({shortDateVn(lot.expiresAt)})
                      </small>
                    </td>
                    <td>
                      <strong>{format(lot.lotQuantity)} {lot.unit}</strong>
                      <small>Kịp bán: {format(lot.projectedSoldBeforeExpiry)} ({lot.dailyForecastRate}/ngày)</small>
                    </td>
                    <td>
                      {lot.daysRemaining < 0 ? (
                        <StatusBadge tone="red">Hết hạn ({format(lot.lotQuantity)} {lot.unit})</StatusBadge>
                      ) : lot.atRiskQuantity > 0 ? (
                        <>
                          <StatusBadge tone={lot.riskLevel === 'CRITICAL' ? 'red' : 'amber'}>
                            Dư {format(lot.atRiskQuantity)} {lot.unit}
                          </StatusBadge>
                          <small style={{ color: '#b91c1c' }}>Vốn: {format(lot.atRiskValue)} đ</small>
                        </>
                      ) : (
                        <StatusBadge tone="green">An toàn</StatusBadge>
                      )}
                    </td>
                    <td>
                      {lot.daysRemaining < 0 ? (
                        <div className="ai-plan-list"><span>Chặn xuất bán · Lập phiếu hủy</span></div>
                      ) : lot.atRiskQuantity > 0 ? (
                        <div className="ai-plan-list">
                          <span>Giảm {lot.suggestedDiscountPercent}% xả hàng (thu ~{format(lot.recoverableValue)} đ)</span>
                          {lot.daysRemaining <= 10 && lot.lotQuantity >= 2 && (
                            <span style={{ color: '#be123c', fontWeight: 600 }}>🎁 Đủ điều kiện xả nhanh Mua 1 Tặng 1 tại POS</span>
                          )}
                          {lot.recommendedTransferBranch && (
                            <span className="ai-plan-saved">
                              Chuyển {lot.recommendedTransferBranch.absorbableQuantity} {lot.unit} → {lot.recommendedTransferBranch.warehouseName} ({lot.recommendedTransferBranch.dailyDemandRate}/ngày)
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="ai-plan-list"><span className="ai-plan-muted">Kịp bán hết trước hạn</span></div>
                      )}
                    </td>
                    <td>
                      <div className="ai-actions-col">
                        {lot.pendingTransfer ? (
                          <Link className="outline-button" href={`/dieu-chuyen/${lot.pendingTransfer.id}`}>
                            Phiếu {lot.pendingTransfer.code} →
                          </Link>
                        ) : lot.atRiskQuantity > 0 && lot.recommendedTransferBranch && can('transfers.create') ? (
                          <button
                            type="button"
                            className="primary-button"
                            disabled={transferringLotId === lot.lotId}
                            onClick={() => void handleFefoRiskTransfer(lot)}
                          >
                            {transferringLotId === lot.lotId
                              ? 'Đang tạo…'
                              : `Chuyển → ${lot.recommendedTransferBranch.warehouseName}`}
                          </button>
                        ) : null}
                        {lot.atRiskQuantity > 0 && lot.daysRemaining >= 0 && lot.daysRemaining <= 21 && lot.lotQuantity >= 1 && (
                          <Link
                            className="outline-button"
                            href={`/hoa-don/tao?fefoPromo=${encodeURIComponent(`FEFO-${lot.lotCode.toUpperCase()}`)}&skuId=${encodeURIComponent(lot.skuId)}&warehouseId=${encodeURIComponent(lot.warehouseId)}`}
                          >
                            🏷️ Bán POS -{lot.suggestedDiscountPercent}% →
                          </Link>
                        )}
                        {lot.atRiskQuantity > 0 && lot.daysRemaining >= 0 && lot.daysRemaining <= 10 && lot.lotQuantity >= 2 && (
                          <Link
                            className="outline-button"
                            href={`/hoa-don/tao?fefoPromo=${encodeURIComponent(`BOGO-${lot.lotCode.toUpperCase()}`)}&skuId=${encodeURIComponent(lot.skuId)}&warehouseId=${encodeURIComponent(lot.warehouseId)}`}
                          >
                            🎁 Bán 1 Tặng 1 →
                          </Link>
                        )}
                        {lot.atRiskQuantity <= 0 && !lot.pendingTransfer && (
                          <span className="ai-plan-muted">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <TableState message="Không có lô cận hạn nào có nguy cơ tồn đọng trước hạn."/>
        )}
      </section>

      {/* BẢNG 3: DANH SÁCH PHIẾU ĐỀ XUẤT ĐÃ KHỞI TẠO */}
      <section className="panel simple-forecast-recommendations">
        <div className="panel-heading">
          <div>
            <h2>Phiếu điều chuyển & đề nghị mua đã khởi tạo</h2>
            <p>Theo dõi và phê duyệt các đề xuất điều phối hàng cho chi nhánh {forecast.store.name}.</p>
          </div>
          <div className="simple-forecast-rec-actions">
            <button className="outline-button" type="button" disabled={generating || running || !shortages.length} onClick={() => void handleGenerateRecommendations()}>
              {generating ? 'Đang lập phương án…' : recommendations.length ? 'Cập nhật danh sách đề xuất' : `Lập đề xuất cho ${shortages.length} mã`}
            </button>
          </div>
        </div>
        {recommendations.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Sản phẩm</th>
                  <th>Loại đề xuất</th>
                  <th>Nguồn cung / Kho nhận</th>
                  <th>Số lượng</th>
                  <th>Trạng thái</th>
                  <th>Phiếu / Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {recommendations.map(item => (
                  <tr key={item.id}>
                    <td><ProductIdentity name={item.productName} code={item.productCode} imageUrl={item.imageUrl}/></td>
                    <td>
                      <StatusBadge tone={item.type === 'TRANSFER' ? 'blue' : 'amber'}>
                        {item.type === 'TRANSFER' ? 'Điều chuyển nội bộ' : 'Mua bổ sung NCC'}
                      </StatusBadge>
                    </td>
                    <td>
                      {item.type === 'TRANSFER'
                        ? <><strong>{item.sourceWarehouse?.store.name}</strong><small>{item.sourceWarehouse?.name} → {item.destinationWarehouse?.name}</small></>
                        : <><strong>{item.targetStore.name}</strong><small>Nhà cung cấp</small></>}
                    </td>
                    <td><strong>{format(item.finalQuantity ?? item.suggestedQuantity)} {item.unit}</strong><small title={item.selectionBasis}>{item.type === 'TRANSFER' ? 'Kho dư khả dụng lớn nhất' : 'Phần thiếu sau hàng đang về'}</small></td>
                    <td>
                      <StatusBadge tone={item.status === 'APPLIED' ? 'green' : item.status === 'PENDING' ? 'amber' : 'neutral'}>
                        {item.status === 'PENDING' ? 'Chờ phê duyệt' : item.status === 'APPLIED' ? 'Đã tạo phiếu' : item.status === 'SUPERSEDED' ? 'Hết hiệu lực' : 'Đã từ chối'}
                      </StatusBadge>
                    </td>
                    <td>
                      {item.transfer ? (
                        <Link className="outline-button" href={`/dieu-chuyen/${item.transfer.id}`}>Phiếu {item.transfer.code} →</Link>
                      ) : item.purchaseRequest ? (
                        <Link className="outline-button" href={`/de-nghi-mua/${item.purchaseRequest.id}`}>Đề nghị {item.purchaseRequest.code} →</Link>
                      ) : item.status === 'PENDING' ? (
                        <div className="simple-forecast-rec-buttons">
                          <button className="primary-button" type="button" disabled={!!decidingId} onClick={() => void handleDecision(item, 'APPLY')}>
                            {decidingId === item.id ? 'Đang xử lý…' : item.type === 'TRANSFER' ? 'Duyệt điều chuyển' : 'Duyệt đề nghị mua'}
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
          </div>
        ) : (
          <TableState message="Chưa có phiếu đề xuất nào được khởi tạo trong kỳ dự báo này. Dùng nút Tạo ở bảng trên hoặc bấm Lập đề xuất."/>
        )}
      </section>
    </>}

    {!loading && !forecast?.run && !error && (
      <section className="panel empty-state">
        <h2>Chưa có dữ liệu dự báo</h2>
        <p>Chọn chi nhánh để tạo dự báo nhu cầu từ dữ liệu bán hàng.</p>
      </section>
    )}
  </main>;
}

export default function ForecastPage() { return <Protected permission="reports.read"><SimpleForecastPage /></Protected>; }
