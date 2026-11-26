'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/auth-api';
import { getStores } from '../lib/organization-api';
import type { ForecastInventoryAdvice, ShortageAlertReport } from '../lib/forecasts-api';
import { useAuth } from './auth-provider';
import { useStockReceiptRefresh } from '../lib/use-stock-receipt-refresh';
import { ProductImage } from './ui/product-image';
import './forecast-shortage-alert.css';

export function ForecastEvidenceDialog({ title, product, children }: { title: string; product: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="forecast-evidence-trigger" onClick={() => setOpen(true)}>{title}</button>
    {open && createPortal(<dialog ref={node => { dialog.current = node; if (node && !node.open) node.showModal(); }} className="forecast-evidence-dialog" onCancel={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <header><div><h2>{title}</h2><p>{product}</p></div><button type="button" aria-label="Đóng căn cứ dự báo" onClick={() => setOpen(false)}>×</button></header>
      <div className="forecast-evidence-content">{children}</div>
      <footer><button type="button" onClick={() => setOpen(false)}>Đóng</button></footer>
    </dialog>, document.body)}
  </>;
}

export type ForecastAlert = ForecastInventoryAdvice & { storeId: string; storeName: string; horizonDays: number };
const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
const number = (value: number) => new Intl.NumberFormat('vi-VN').format(value);

const forecastCache = new Map<string, { at: number; reports: ShortageAlertReport[] }>();

/** Uses the same backend shortage calculation as the forecast analysis; never trains on page load. */
export function useForecastShortages(storeId = '') {
  const { user } = useAuth();
  const [reports, setReports] = useState<ShortageAlertReport[]>(() => {
    if (!user) return [];
    const cached = forecastCache.get(`${user.id}:${storeId}:0`);
    return cached && Date.now() - cached.at < 60_000 ? cached.reports : [];
  });
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [version, setVersion] = useState(0);
  useStockReceiptRefresh(() => {
    forecastCache.clear();
    setVersion(value => value + 1);
  });
  useEffect(() => {
    const update = () => {
      forecastCache.clear();
      setVersion(value => value + 1);
    };
    window.addEventListener('freshmart-forecast-updated', update);
    return () => window.removeEventListener('freshmart-forecast-updated', update);
  }, []);
  useEffect(() => {
    if (!user) return;
    let active = true;
    const cacheKey = `${user.id}:${storeId}:${version}`;
    const cached = forecastCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 60_000) {
      setReports(cached.reports);
      setLoading(false);
      return;
    }
    setLoading(true); setUnavailable(false);
    const load = async () => {
      try {
        const stores = storeId ? [{ id: storeId }] : user.globalAccess ? (await getStores()).filter(row => row.active) : user.stores.filter(row => row.active);
        const results = await Promise.allSettled(stores.map(async store => {
          const get = (days: number) => api<ShortageAlertReport>(`inventory/forecast-alerts?storeId=${encodeURIComponent(store.id)}&horizonDays=${days}`);
          const weekly = await get(7);
          return weekly.run ? weekly : get(14);
        }));
        if (!active) return;
        const loaded = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
        setReports(loaded);
        forecastCache.set(cacheKey, { at: Date.now(), reports: loaded });
        setUnavailable(results.some(result => result.status === 'rejected'));
      } catch { if (active) setUnavailable(true); }
      finally { if (active) setLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [user, storeId, version]);
  const items = useMemo(() => reports.flatMap(report => report.items.filter(row => row.shortageQuantity > 0).map(row => ({ ...row, storeId: report.store.id, storeName: report.store.name, horizonDays: report.run?.horizonDays ?? 7 }))).sort((a, b) => rank[a.severity!] - rank[b.severity!] || b.shortageQuantity - a.shortageQuantity), [reports]);
  return { items, loading, unavailable, missingForecast: reports.some(report => !report.run), refresh: () => setVersion(value => value + 1) };
}

export function ForecastAlertBadge({ item }: { item: ForecastAlert }) {
  const tone = item.severity === 'HIGH' ? 'critical' : item.severity === 'MEDIUM' ? 'warning' : 'watch';
  return (
    <details
      className={`forecast-alert-detail ${tone}`}
      style={{ display: 'block', width: 'fit-content', margin: '5px auto 0' }}
      onClick={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
    >
      <summary
        style={{
          whiteSpace: 'nowrap',
          background: '#ffffff',
          border: '1px solid #cbd5e1',
          color: '#0f766e',
          padding: '2px 8px',
          borderRadius: 6,
          fontWeight: 600,
        }}
      >
        {tone === 'critical' ? 'Cần xử lý gấp' : 'Cần bổ sung'} · {number(item.shortageQuantity)} {item.unit}
      </summary>
      <div style={{ textAlign: 'left' }}>
        <strong>{item.storeName} · {item.horizonDays} ngày</strong>
        <span>Khả dụng: {number(item.available)} {item.unit}</span>
        <span>Dự báo: {number(item.predictedQuantity)} {item.unit}</span>
        <span>Đang về: {number(item.inTransfer + item.incomingPurchase)} {item.unit}</span>
        <span>Dự phòng: {number(item.safetyStock)} {item.unit}</span>
        {item.dataQuality === 'NO_SALES' && <span>Chưa có bán: gợi ý dựa trên mức dự phòng.</span>}
        <Link href={`/du-bao-nhu-cau?status=shortage&storeId=${encodeURIComponent(item.storeId)}&horizon=${item.horizonDays}`}>
          Xem dự báo →
        </Link>
      </div>
    </details>
  );
}

export function ForecastShortageBanner({ items, loading, unavailable, missingForecast, onFilter, filtered, showProducts = false, scopeNote }: { items: ForecastAlert[]; loading?: boolean; unavailable?: boolean; missingForecast?: boolean; onFilter?: () => void; filtered?: boolean; showProducts?: boolean; scopeNote?: string }) {
  if (loading || !items.length) return null;
  const critical = items.filter(item => item.severity === 'HIGH').length;
  const outOfStock = items.filter(item => item.available <= 0).length;
  const lowStock = items.length - outOfStock;
  const periods = [...new Set(items.map(item => item.horizonDays))].sort((a,b) => a-b);
  const period = periods.length === 1 ? `${periods[0]} ngày` : periods.map(day => `${day} ngày`).join(' hoặc ');
  const detail = items.length === 1 || items.every(item => item.storeId === items[0]?.storeId) ? `&storeId=${encodeURIComponent(items[0]!.storeId)}&horizon=${items[0]!.horizonDays}` : '';
  const totalShortageQty = items.reduce((sum, item) => sum + item.shortageQuantity, 0);
  const branchCount = new Set(items.map(item => item.storeId)).size;
  return (
    <section
      className={`forecast-shortage-banner ${critical ? 'critical' : ''}`}
      aria-label="Kế hoạch bổ sung tồn kho theo dự báo nhu cầu"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        padding: 0,
        margin: '12px 0',
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderLeft: '3px solid #0f766e',
        borderRadius: 10,
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
        overflow: 'hidden',
      }}
    >
      {/* Top Bar: Pure white background, logo teal accent only (#0f766e), zero colored badge backgrounds */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          padding: '14px 20px',
          background: '#ffffff',
          borderBottom: showProducts ? '1px solid #f1f5f9' : 'none',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 240, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '2px 9px',
                borderRadius: 6,
                background: '#ffffff',
                border: '1px solid #0f766e',
                color: '#0f766e',
                fontSize: 11.5,
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#0f766e' }} />
              Dự báo {period}
            </span>
            <strong style={{ fontSize: 14.5, fontWeight: 700, color: '#0f172a', lineHeight: 1.3 }}>
              Kế hoạch bổ sung tồn kho ({items.length} mặt hàng cần nhập)
            </strong>
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: '#64748b', lineHeight: 1.4 }}>
            {branchCount > 1 ? `Tổng hợp ${branchCount} chi nhánh · ` : `${items[0]?.storeName} · `}
            Đối chiếu tồn khả dụng, hàng đang về và định mức dự phòng{scopeNote ? ` · ${scopeNote}` : ''}.
            {(unavailable || missingForecast) ? ' Một số chi nhánh chưa đồng bộ dữ liệu.' : ''}
          </p>
        </div>

        {/* Clean White Outlined Stat Pills (no colored fills, only logo teal & slate text) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {outOfStock > 0 && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 32,
                padding: '0 11px',
                borderRadius: 6,
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                color: '#475569',
                fontSize: 12,
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              <span>Hết tồn</span>
              <b style={{ color: '#0f766e', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{outOfStock}</b>
            </span>
          )}
          {lowStock > 0 && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 32,
                padding: '0 11px',
                borderRadius: 6,
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                color: '#475569',
                fontSize: 12,
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              <span>Sắp thiếu</span>
              <b style={{ color: '#0f766e', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{lowStock}</b>
            </span>
          )}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 32,
              padding: '0 11px',
              borderRadius: 6,
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              color: '#475569',
              fontSize: 12,
              fontWeight: 500,
              whiteSpace: 'nowrap',
            }}
          >
            <span>Tổng cần bù</span>
            <b style={{ color: '#0f766e', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>+{number(totalShortageQty)}</b>
          </span>

          <div className="forecast-shortage-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 2 }}>
            {onFilter && (
              <button
                type="button"
                onClick={onFilter}
                style={{
                  height: 34,
                  padding: '0 12px',
                  borderRadius: 7,
                  border: filtered ? '1px solid #0f766e' : '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: filtered ? '#0f766e' : '#334155',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {filtered ? 'Xem tất cả' : 'Lọc hàng thiếu'}
              </button>
            )}
            <Link
              href={`/du-bao-nhu-cau?status=shortage${detail}`}
              style={{
                height: 34,
                padding: '0 13px',
                borderRadius: 7,
                background: '#0f766e',
                border: '1px solid #0f766e',
                color: '#ffffff',
                fontSize: 12.5,
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                textDecoration: 'none',
                boxShadow: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Xem dự báo →
            </Link>
          </div>
        </div>
      </div>

      {/* Product Replenishment Cards: Pure white cards with neutral borders and logo teal accent */}
      {showProducts && (
        <div
          className="forecast-shortage-top"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 12,
            width: '100%',
            padding: '14px 20px',
            background: '#ffffff',
          }}
        >
          {items.slice(0, 3).map(item => {
            const isZero = item.available <= 0;
            return (
              <div
                className="forecast-shortage-product"
                key={`${item.storeId}-${item.skuId}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 11,
                  padding: '10px 13px',
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  boxShadow: 'none',
                }}
              >
                <ProductImage src={item.imageUrl} name={item.productName} size="md" />
                <div className="forecast-shortage-product-copy" style={{ minWidth: 0, flex: 1, display: 'grid', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <strong style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.productName}
                    </strong>
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '1px 7px',
                        borderRadius: 4,
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        color: '#475569',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {isZero ? 'Hết tồn' : 'Sắp thiếu'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: 12, color: '#64748b' }}>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.storeName} · Tồn: <b style={{ color: '#0f172a', fontWeight: 600, background: 'transparent', border: 0, padding: 0, margin: 0 }}>{number(item.available)} {item.unit}</b>
                    </span>
                    <span
                      style={{
                        flexShrink: 0,
                        color: '#0f766e',
                        fontWeight: 700,
                        fontSize: 12,
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Cần bù +{number(item.shortageQuantity)} {item.unit}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
