'use client';
import { TableState } from '../../components/ui/table-state';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, errorMessage } from '../../lib/auth-api';
import { getInventory, type Inventory } from '../../lib/inventory-api';
import {
  createFefoRiskTransfer,
  getFefoExpiryRisks,
  type FefoExpiryRiskItem,
  type FefoExpiryRiskReport,
} from '../../lib/forecasts-api';
import { Protected, useAuth } from '../../components/auth-provider';
import { MetricCard, MetricGrid } from '../../components/ui/metric-card';
import { ProductImage } from '../../components/ui/product-image';
import { StatusBadge } from '../../components/ui/status-badge';
import { useToast } from '../../components/ui/toast-provider';
import './lots.css';

type Disposal = { id: string; quantity: number; reason: string; status: string; evidence: string | null };
type Lot = {
  id: string;
  inventoryId: string;
  code: string;
  expiresAt: string | null;
  quantity: number;
  status: string;
  expired: boolean;
  daysRemaining: number | null;
  zone: string;
  purchaseOrderItemId: string | null;
  inventory: Inventory;
  disposals: Disposal[];
  movements: { id: string; quantity: number; referenceType: string; createdAt: string }[];
};
type Product = Inventory['sku']['product'] & { purchaseUnit?: string | null; purchasePackSize?: number; leadTimeDays?: number | null };
type Operation = { kind: 'classify' | 'quarantine' | 'count' | 'dispose' | 'complete'; lot?: Lot; disposal?: Disposal };

const fmtNum = (v: number) => new Intl.NumberFormat('vi-VN').format(Math.round(v));
const shortDateVn = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-');
  return d && m && y ? `${d}/${m}/${y}` : isoDate;
};

function Lots() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const can = (permission: string) => user?.permissions.includes(permission) || user?.permissions.includes('*');

  const [lots, setLots] = useState<Lot[]>([]);
  const [stocks, setStocks] = useState<Inventory[]>([]);
  const [fefoAiReport, setFefoAiReport] = useState<FefoExpiryRiskReport | null>(null);
  const [showAllAiLots, setShowAllAiLots] = useState(false);
  const [transferringLotId, setTransferringLotId] = useState('');

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [operation, setOperation] = useState<Operation | null>(null);
  const [selected, setSelected] = useState('');
  const [procurement, setProcurement] = useState<Product | null>(null);

  const load = async () => {
    const [rows, first, fefoAi] = await Promise.all([
      api<Lot[]>('inventory-lots'),
      getInventory({ pageSize: 100 }),
      getFefoExpiryRisks(undefined, 14).catch(() => null),
    ]);
    const pages = await Promise.all(
      Array.from({ length: Math.max(0, first.pagination.totalPages - 1) }, (_, n) => getInventory({ pageSize: 100, page: n + 2 }))
    );
    setLots(rows);
    setStocks([...first.items, ...pages.flatMap(page => page.items)]);
    if (fefoAi) setFefoAiReport(fefoAi);
  };

  useEffect(() => {
    load().catch(e => setError(errorMessage(e)));
  }, []);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      await load();
      setOperation(null);
      setProcurement(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const handleFefoAiTransfer = async (item: FefoExpiryRiskItem) => {
    if (!item.recommendedTransferBranch || transferringLotId) return;
    setTransferringLotId(item.lotId);
    setError('');
    try {
      const created = await createFefoRiskTransfer({
        sourceWarehouseId: item.warehouseId,
        destinationWarehouseId: item.recommendedTransferBranch.warehouseId,
        skuId: item.skuId,
        quantity: item.recommendedTransferBranch.absorbableQuantity,
        lotCode: item.lotCode,
      });
      await load();
      showToast(
        created.alreadyExists
          ? `Đã có sẵn phiếu điều chuyển ${created.code} cho lô ${item.lotCode}.`
          : `Đã tạo phiếu điều chuyển ${created.code} (${item.recommendedTransferBranch.absorbableQuantity} ${item.unit} → ${item.recommendedTransferBranch.warehouseName}).`
      );
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setTransferringLotId('');
    }
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!operation) return;
    const quantity = Number(form.get('quantity'));
    const reason = String(form.get('reason') ?? '');
    void run(() => {
      if (operation.kind === 'classify') {
        return api(`inventory/${selected}/lots/classify`, 'POST', {
          quantity,
          reason,
          code: form.get('code'),
          expiresAt: form.get('expiresAt') || null,
        });
      }
      if (operation.kind === 'complete') {
        return api(`lot-disposals/${operation.disposal!.id}/complete`, 'POST', {
          evidence: form.get('evidence'),
        });
      }
      return api(
        `inventory-lots/${operation.lot!.id}/${operation.kind === 'dispose' ? 'disposals' : operation.kind}`,
        'POST',
        operation.kind === 'quarantine' ? { reason } : { quantity, reason }
      );
    });
  };

  const visible = lots.filter(lot => {
    const term = `${lot.code} ${lot.inventory.sku.product.name} ${lot.inventory.warehouse.name}`.toLowerCase();
    const matchesSearch = term.includes(search.toLowerCase());
    const matchesFilter =
      filter === 'ALL' ||
      (filter === 'EXPIRED' && lot.expired) ||
      (filter === 'SOON' && lot.daysRemaining !== null && lot.daysRemaining >= 0 && lot.daysRemaining <= 30) ||
      (filter === 'HOLD' && (lot.status !== 'AVAILABLE' || lot.expired));
    return matchesSearch && matchesFilter;
  });

  const expiredCount = lots.filter(lot => lot.expired).length;
  const soonCount = lots.filter(lot => !lot.expired && lot.daysRemaining !== null && lot.daysRemaining >= 0 && lot.daysRemaining <= 30).length;
  const aiRiskCount = fefoAiReport?.summary?.atRiskLotsCount ?? 0;

  const visibleAiRows = useMemo(() => {
    const all = fefoAiReport?.items ?? [];
    if (showAllAiLots) return all.filter(i => i.daysRemaining <= 35 || i.atRiskQuantity > 0);
    return all.filter(i => i.atRiskQuantity > 0);
  }, [fefoAiReport, showAllAiLots]);

  const labels: Record<string, string> = { READY: 'Chờ xử lý thực tế', COMPLETED: 'Đã xử lý', REJECTED: 'Từ chối' };

  return (
    <main className="suite-page lots-screen">
      <header className="suite-heading">
        <div>
          <div className="breadcrumb">Hàng hóa và Kho · Lô và hạn sử dụng</div>
          <h1>Quản lý Lô và Hạn sử dụng</h1>
          <p>Quản lý hạn sử dụng theo từng lô (hết hạn trước xuất trước) và đối chiếu sức mua AI để phát hiện sớm lô cận hạn có nguy cơ tồn đọng.</p>
        </div>
        <div className="heading-actions">
          <Link className="outline-button" href="/du-bao-nhu-cau">Dự báo nhu cầu AI →</Link>
          <Link className="outline-button" href="/ton-kho">Tồn kho →</Link>
        </div>
      </header>

      {error && <div className="ui-error" role="alert">{error}</div>}

      <MetricGrid label="Tổng quan lô hàng">
        <MetricCard tone="blue" label="Tổng số lô" value={fmtNum(lots.length)} caption="Đang quản lý trong kho" />
        <MetricCard tone={soonCount ? 'amber' : 'teal'} label="Sắp hết hạn (≤ 30 ngày)" value={fmtNum(soonCount)} caption="Ưu tiên xuất lô hạn gần trước" />
        <MetricCard
          tone={aiRiskCount ? 'red' : 'green'}
          label="Nguy cơ tồn dư cận hạn"
          value={`${fmtNum(aiRiskCount)} lô`}
          caption={aiRiskCount ? `${fmtNum(fefoAiReport?.summary?.totalAtRiskUnits ?? 0)} đv · Vốn ${fmtNum(fefoAiReport?.summary?.totalAtRiskValue ?? 0)} đ` : 'Tốc độ bán kịp trước hạn'}
        />
        <MetricCard tone={expiredCount ? 'red' : 'teal'} label="Đã hết hạn" value={fmtNum(expiredCount)} caption="Chặn xuất bán tự động" />
      </MetricGrid>

      {fefoAiReport && fefoAiReport.items.length > 0 && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Phân bổ lô cận hạn và Dự báo nhu cầu (14 ngày)</h2>
              <p className="panel-meta">
                Đối chiếu sức mua dự kiến (14 ngày) theo thứ tự hạn dùng tăng dần để phát hiện sớm lô có nguy cơ tồn đọng.
              </p>
            </div>
            <div className="lots-actions">
              <button type="button" className="outline-button" onClick={() => setShowAllAiLots(v => !v)}>
                {showAllAiLots ? `Chỉ xem lô nguy cơ (${aiRiskCount})` : `Xem tất cả lô (${fefoAiReport.items.filter(i => i.daysRemaining <= 35 || i.atRiskQuantity > 0).length})`}
              </button>
            </div>
          </div>
          {visibleAiRows.length > 0 ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Sản phẩm / Kho</th>
                    <th>Mã lô / Hạn dùng</th>
                    <th>Tồn lô / Phân bổ hạn dùng</th>
                    <th>Đánh giá nguy cơ dư (14 ngày)</th>
                    <th>Đề xuất xử lý</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleAiRows.map(item => {
                    const unsoldRatio = item.unsoldRatio ?? (item.lotQuantity > 0 ? item.atRiskQuantity / item.lotQuantity : 0);
                    const recommendBogo =
                      item.conditionalComboSuggestion ??
                      (item.daysRemaining >= 0 &&
                        !item.beyondHorizon &&
                        item.atRiskQuantity > 0 &&
                        (item.daysRemaining <= 10 || unsoldRatio >= 0.45));
                    return (
                    <tr key={item.lotId}>
                      <td>
                        <div className="product-identity">
                          <ProductImage src={item.imageUrl} name={item.productName} size="sm" />
                          <div>
                            <strong>{item.productName}</strong>
                            <small>{item.warehouseName}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="lot-code" title={item.lotCode}>{item.lotCode}</span>
                        <small className={item.daysRemaining <= 14 ? 'lots-danger' : undefined}>
                          {item.daysRemaining < 0
                            ? `Quá hạn ${Math.abs(item.daysRemaining)} ngày`
                            : item.daysRemaining === 0
                              ? 'Hết hạn cuối ngày hôm nay'
                              : `Còn ${item.daysRemaining} ngày`}{' '}
                          ({shortDateVn(item.expiresAt)})
                        </small>
                      </td>
                      <td>
                        <strong>{fmtNum(item.lotQuantity)} {item.unit}</strong>
                        {item.allocationStatus === 'NO_FORECAST_RUN' || item.allocationStatus === 'NO_SALES_HISTORY' ? (
                          <small className="lots-plan-muted">Chưa có dự báo hợp lệ</small>
                        ) : (
                          <small>
                            Dự kiến bán: {fmtNum(item.projectedSoldBeforeExpiry)} {item.unit} ({item.dailyForecastRate}/ngày)
                            {(item.priorConsumedDemand ?? 0) > 0 ? ` · Đã trừ ${item.priorConsumedDemand} đv cho lô hạn sớm hơn` : ''}
                          </small>
                        )}
                      </td>
                      <td>
                        {item.daysRemaining < 0 || item.allocationStatus === 'EXPIRED_OR_QUARANTINED' ? (
                          <StatusBadge tone="red">Hết hạn / Khóa ({fmtNum(item.lotQuantity)} {item.unit})</StatusBadge>
                        ) : item.allocationStatus === 'NO_FORECAST_RUN' || item.allocationStatus === 'NO_SALES_HISTORY' ? (
                          <StatusBadge tone="neutral">Chưa đủ dữ liệu dự báo</StatusBadge>
                        ) : item.beyondHorizon || item.allocationStatus === 'BEYOND_FORECAST_HORIZON' ? (
                          <>
                            <StatusBadge tone="neutral">Ngoài tầm nhìn {item.horizonDays} ngày</StatusBadge>
                            <small style={{ display: 'block', marginTop: 3, color: '#64748b' }}>
                              Không ngoại suy ngoài {item.horizonDays} ngày
                            </small>
                          </>
                        ) : item.atRiskQuantity > 0 ? (
                          <>
                            <StatusBadge tone={item.riskLevel === 'CRITICAL' ? 'red' : 'amber'}>
                              Nguy cơ dư {fmtNum(item.atRiskQuantity)} {item.unit} ({Math.round(unsoldRatio * 100)}%)
                            </StatusBadge>
                            <small className="lots-danger" style={{ display: 'block', marginTop: 3 }}>
                              Giá vốn lượng dư: {fmtNum(item.atRiskValue)} đ
                            </small>
                          </>
                        ) : (
                          <StatusBadge tone="green">An toàn trong hạn</StatusBadge>
                        )}
                      </td>
                      <td>
                        {item.daysRemaining < 0 || item.allocationStatus === 'EXPIRED_OR_QUARANTINED' ? (
                          <div className="lots-plan-list"><span>[Quy tắc kho]: Đã chặn xuất bán tại POS · Cách ly và Lập phiếu tiêu hủy</span></div>
                        ) : item.allocationStatus === 'NO_FORECAST_RUN' || item.allocationStatus === 'NO_SALES_HISTORY' ? (
                          <div className="lots-plan-list"><span className="lots-plan-muted">Chưa chạy dự báo AI hoặc chưa có lịch sử bán (không tự tạo dự báo giả)</span></div>
                        ) : item.beyondHorizon || item.allocationStatus === 'BEYOND_FORECAST_HORIZON' ? (
                          <div className="lots-plan-list">
                            <span className="lots-plan-muted">
                              Còn {item.daysRemaining} ngày (&gt; tầm nhìn dự báo {item.horizonDays} ngày). Dự kiến tiêu thụ {item.projectedSoldBeforeExpiry}/{item.lotQuantity} {item.unit} trong {item.horizonDays} ngày đầu; tiếp tục theo dõi định kỳ.
                            </span>
                          </div>
                        ) : item.atRiskQuantity > 0 ? (
                          <div className="lots-plan-list">
                            <span>
                              <b>[Gợi ý quy tắc]:</b> Tham khảo giảm {item.suggestedDiscountPercent}% (giá sau giảm {fmtNum(item.discountedPrice)} đ/{item.unit}, thu hồi tối đa ~{fmtNum(item.recoverableValue)} đ nếu bán hết lượng dư)
                            </span>
                            {recommendBogo && (
                              <span className="lots-plan-sub" style={{ color: '#be123c', fontWeight: 600 }}>
                                <b>[Gợi ý có điều kiện]:</b> Cân nhắc chương trình Mua kèm / Mua 1 tặng 1 nếu biên lợi nhuận cho phép (tham số cấu hình: ≤10 ngày hoặc dư ≥45%)
                              </span>
                            )}
                            {item.recommendedTransferBranch && (
                              <span className="lots-plan-sub">
                                <b>[Cân bằng điều chuyển]:</b> Chuyển {item.recommendedTransferBranch.absorbableQuantity} {item.unit} → {item.recommendedTransferBranch.warehouseName} (cầu dự báo {item.recommendedTransferBranch.dailyDemandRate}/ngày, đã trừ 2 ngày vận chuyển và tồn cận hạn tại kho nhận)
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="lots-plan-list"><span className="lots-plan-muted">[Dự báo nhu cầu]: Sức mua dự báo đủ hấp thụ hết trước hạn</span></div>
                        )}
                      </td>
                      <td>
                        {(() => {
                          const matchedLot = lots.find(l => l.id === item.lotId);
                          const isExpiredRow = item.daysRemaining < 0 || item.allocationStatus === 'EXPIRED_OR_QUARANTINED';
                          return (
                            <div className="lots-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {isExpiredRow ? (
                                matchedLot && matchedLot.quantity > 0 && can('stocktakes.create') ? (
                                  <>
                                    <button type="button" className="ui-action-button action-edit" disabled={busy} onClick={() => setOperation({ kind: 'quarantine', lot: matchedLot })}>Cách ly</button>
                                    <button type="button" className="ui-action-button action-danger" disabled={busy} onClick={() => setOperation({ kind: 'dispose', lot: matchedLot })}>Tiêu hủy</button>
                                  </>
                                ) : (
                                  <span className="lots-plan-muted">Đã khóa tại POS</span>
                                )
                              ) : (
                                <>
                                  {item.pendingTransfer ? (
                                    <Link className="ui-action-button action-view" href={`/dieu-chuyen/${item.pendingTransfer.id}`}>
                                      Phiếu {item.pendingTransfer.code} →
                                    </Link>
                                  ) : item.atRiskQuantity > 0 && item.recommendedTransferBranch && can('transfers.create') ? (
                                    <button
                                      type="button"
                                      className="ui-action-button action-approve"
                                      disabled={transferringLotId === item.lotId}
                                      onClick={() => void handleFefoAiTransfer(item)}
                                    >
                                      {transferringLotId === item.lotId
                                        ? 'Đang tạo…'
                                        : `Chuyển → ${item.recommendedTransferBranch.warehouseName}`}
                                    </button>
                                  ) : null}
                                  {item.atRiskQuantity > 0 && item.daysRemaining >= 0 && item.daysRemaining <= 21 && item.lotQuantity >= 1 && (
                                    <Link
                                      className="ui-action-button action-edit"
                                      href={`/hoa-don/tao?fefoPromo=${encodeURIComponent(`FEFO-${item.lotCode.toUpperCase()}`)}&skuId=${encodeURIComponent(item.skuId)}&warehouseId=${encodeURIComponent(item.warehouseId)}`}
                                    >
                                      Bán xả -{item.suggestedDiscountPercent}% →
                                    </Link>
                                  )}
                                  {item.atRiskQuantity > 0 && item.daysRemaining >= 0 && item.daysRemaining <= 10 && item.lotQuantity >= 2 && (
                                    <Link
                                      className="ui-action-button action-view"
                                      href={`/hoa-don/tao?fefoPromo=${encodeURIComponent(`BOGO-${item.lotCode.toUpperCase()}`)}&skuId=${encodeURIComponent(item.skuId)}&warehouseId=${encodeURIComponent(item.warehouseId)}`}
                                    >
                                      Mua 1 Tặng 1 →
                                    </Link>
                                  )}
                                  {item.atRiskQuantity <= 0 && !item.pendingTransfer && (
                                    <span className="lots-plan-muted">—</span>
                                  )}
                                </>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
          ) : (
            <TableState message="Không có lô cận hạn nào có nguy cơ dư thừa trong tầm nhìn dự báo 14 ngày." />
          )}
        </section>
      )}

      <section className="panel lots-toolbar">
        <label>Tìm theo mã lô, sản phẩm hoặc kho
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Ví dụ: LOT-CP, sữa, Kho Ba Đình" />
        </label>
        <label>Lọc trạng thái
          <select value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="ALL">Tất cả lô</option>
            <option value="EXPIRED">Đã hết hạn</option>
            <option value="SOON">Sắp hết hạn · 30 ngày</option>
            <option value="HOLD">Cách ly / chờ xác minh</option>
          </select>
        </label>
        <button className="outline-button" disabled={busy} onClick={() => void run(load)}>Làm mới</button>
        {can('stocktakes.approve') && (
          <button className="primary-button" onClick={() => setOperation({ kind: 'classify' })}>Phân loại tồn cũ</button>
        )}
      </section>

      <details className="panel lots-settings">
        <summary>Quy cách nhập & thời gian cung ứng</summary>
        <p>Mọi số tồn và số bán giữ theo đơn vị sản phẩm. Ví dụ 1 thùng nhập = 24 hộp bán. Thời gian cung ứng là số ngày kế hoạch, cần đối chiếu nhà cung cấp.</p>
        <select
          aria-label="Chọn sản phẩm cấu hình nhập"
          defaultValue=""
          onChange={e => {
            const item = stocks.find(row => row.id === e.target.value);
            setProcurement((item?.sku.product as Product) ?? null);
          }}
        >
          <option value="">Chọn sản phẩm để xem/cấu hình</option>
          {stocks
            .filter((row, index, list) => list.findIndex(other => other.sku.product.id === row.sku.product.id) === index)
            .map(row => (
              <option key={row.id} value={row.id}>
                {row.sku.product.name} · đơn vị tồn/bán: {row.sku.product.unit}
              </option>
            ))}
        </select>
        {procurement && (
          <form
            className="lots-toolbar"
            key={procurement.id}
            onSubmit={e => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              void run(() =>
                api(`products/${procurement.id}/procurement`, 'PATCH', {
                  purchaseUnit: data.get('purchaseUnit'),
                  purchasePackSize: Number(data.get('pack')),
                  leadTimeDays: data.get('lead') === '' ? null : Number(data.get('lead')),
                })
              );
            }}
          >
            <label>Đơn vị nhập
              <input name="purchaseUnit" required defaultValue={procurement.purchaseUnit ?? procurement.unit} />
            </label>
            <label>Số {procurement.unit} / đơn vị nhập
              <input name="pack" type="number" required min="1" max="100000" defaultValue={procurement.purchasePackSize ?? 1} />
            </label>
            <label>Giao hàng dự kiến (ngày)
              <input name="lead" type="number" min="0" max="365" defaultValue={procurement.leadTimeDays ?? ''} placeholder="Chưa biết" />
            </label>
            {can('products.manage') && <button className="primary-button" disabled={busy}>Lưu cấu hình</button>}
          </form>
        )}
      </details>

      <section className="panel lots-table-panel">
        <div className="lots-table-heading">
          <div>
            <h2>Danh sách lô tồn kho vật lý</h2>
            <p>{visible.length} / {lots.length} lô · ưu tiên xem các lô cần xử lý trước</p>
          </div>
          <span className="lots-fefo"><b>Quy tắc</b> Hết hạn trước · xuất trước</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Sản phẩm / kho</th>
                <th>Mã lô / hạn sử dụng</th>
                <th>Số lượng</th>
                <th>Vị trí / trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(lot => (
                <tr key={lot.id}>
                  <td>
                    <div className="product-identity">
                      <ProductImage src={lot.inventory.sku.product.imageUrl} name={lot.inventory.sku.product.name} size="sm" />
                      <div>
                        <strong>{lot.inventory.sku.product.name}</strong>
                        <small>{lot.inventory.warehouse.name}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="lot-code" title={lot.code}>{lot.code}</span>
                    <small>
                      {lot.expiresAt
                        ? `Hạn sử dụng: ${new Date(lot.expiresAt).toLocaleDateString('vi-VN', { timeZone: 'UTC' })}`
                        : lot.status === 'LEGACY'
                        ? 'Chưa xác minh hạn sử dụng'
                        : 'Không khai báo hạn sử dụng'}
                    </small>
                  </td>
                  <td><strong>{lot.quantity}</strong> {lot.inventory.sku.product.unit}</td>
                  <td>
                    <strong className={lot.expired ? 'lots-danger' : ''}>
                      {lot.expired
                        ? 'Đã hết hạn · chặn xuất bán'
                        : lot.daysRemaining !== null && lot.daysRemaining <= 30
                        ? `Còn ${lot.daysRemaining} ngày`
                        : lot.status === 'LEGACY'
                        ? 'Tồn cũ chưa xác minh'
                        : lot.status === 'QUARANTINE'
                        ? 'Cách ly'
                        : 'Còn sử dụng'}
                    </strong>
                    <small>{lot.zone}</small>
                  </td>
                  <td>
                    <div className="lots-actions">
                      {lot.quantity > 0 && can('stocktakes.create') && (
                        <>
                          <button type="button" className="ui-action-button action-edit" disabled={busy} onClick={() => setOperation({ kind: 'quarantine', lot })}>Cách ly</button>
                          <button type="button" className="ui-action-button action-danger" disabled={busy} onClick={() => setOperation({ kind: 'dispose', lot })}>Lập phiếu tiêu hủy</button>
                        </>
                      )}
                      {can('stocktakes.approve') && (
                        <button type="button" className="ui-action-button action-view" disabled={busy} onClick={() => setOperation({ kind: 'count', lot })}>Kiểm đếm lô</button>
                      )}
                    </div>
                    <details>
                      <summary>Lịch sử lô</summary>
                      {lot.movements.map(row => (
                        <p key={row.id}>
                          {new Date(row.createdAt).toLocaleString('vi-VN')} · {row.referenceType} · {row.quantity > 0 ? '+' : ''}{row.quantity}
                        </p>
                      ))}
                    </details>
                  </td>
                </tr>
              ))}
              {!visible.length && (
                <tr>
                  <td colSpan={5}><TableState message="Chưa có lô phù hợp. Ghi mã lô và hạn sử dụng khi nhận hàng hoặc phân loại tồn cũ." /></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Phiếu xử lý hàng cách ly</h2>
            <p className="panel-meta">Chỉ xác nhận hoàn tất sau khi xử lý hàng thực tế và ghi số biên bản hoặc đường dẫn bằng chứng.</p>
          </div>
        </div>
        {lots.flatMap(lot =>
          lot.disposals.map(row => (
            <article className="lots-disposal" key={row.id}>
              <div>
                <strong>{lot.code} · {row.quantity} {lot.inventory.sku.product.unit}</strong>
                <p>{row.reason}</p>
                <small>{labels[row.status]} · {row.id}{row.evidence && ` · ${row.evidence}`}</small>
              </div>
              {can('stocktakes.approve') && row.status === 'READY' && (
                <button className="primary-button" disabled={busy} onClick={() => setOperation({ kind: 'complete', lot, disposal: row })}>
                  Xác nhận đã xử lý
                </button>
              )}
            </article>
          ))
        )}
      </section>

      <p className="lots-footnote">Trả nhà cung cấp phải theo đơn mua hàng gốc, đúng lô và được nhà cung cấp chấp thuận; phiếu tiêu hủy không tự tạo hoàn tiền.</p>

      {operation && (
        <div className="ui-modal">
          <form className="ui-modal-card" onSubmit={submit}>
            <header>
              <h2>
                {
                  ({
                    classify: 'Phân loại tồn cũ',
                    quarantine: 'Đưa hàng vào khu cách ly',
                    count: 'Kiểm đếm thực tế từng lô',
                    dispose: 'Lập phiếu tiêu hủy',
                    complete: 'Xác nhận đã xử lý thực tế',
                  })[operation.kind]
                }
              </h2>
              <button type="button" aria-label="Đóng" disabled={busy} onClick={() => setOperation(null)}>×</button>
            </header>
            {error && <p role="alert" className="ui-error">{error}</p>}
            {operation.kind === 'classify' && (
              <>
                <label>Sản phẩm / kho
                  <select required value={selected} onChange={e => setSelected(e.target.value)}>
                    <option value="">Chọn tồn kho</option>
                    {stocks.map(row => (
                      <option key={row.id} value={row.id}>
                        {row.sku.product.name} · {row.warehouse.name} · {row.onHand} {row.sku.product.unit}
                      </option>
                    ))}
                  </select>
                </label>
                <label>Mã lô
                  <input name="code" required maxLength={100} placeholder="Mã trên bao bì / chứng từ NCC" />
                </label>
                <label>Hạn sử dụng
                  <input name="expiresAt" type="date" />
                  <small>Bỏ trống nếu sản phẩm không quản lý hạn sử dụng. Tồn chưa phân loại bị chặn bán.</small>
                </label>
              </>
            )}
            {!['quarantine', 'complete'].includes(operation.kind) && (
              <label>
                {operation.kind === 'count' ? 'Số lượng thực đếm' : 'Số lượng'}
                <input type="number" name="quantity" min={operation.kind === 'count' ? 0 : 1} step="1" required defaultValue={operation.lot?.quantity} />
              </label>
            )}
            {operation.kind === 'complete' ? (
              <label>Số biên bản / đường dẫn bằng chứng
                <textarea name="evidence" required minLength={3} maxLength={2000} />
              </label>
            ) : (
              <label>Lý do / căn cứ xác minh
                <textarea name="reason" required minLength={3} maxLength={500} />
              </label>
            )}
            <footer>
              <button type="button" className="outline-button" disabled={busy} onClick={() => setOperation(null)}>Đóng</button>
              <button className="primary-button" disabled={busy}>{busy ? 'Đang xử lý…' : 'Xác nhận'}</button>
            </footer>
          </form>
        </div>
      )}
    </main>
  );
}

export default function Page() {
  return (
    <Protected permission="inventory.read">
      <Lots />
    </Protected>
  );
}
