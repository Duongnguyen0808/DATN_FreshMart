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

/** Uses the same backend shortage calculation as the forecast analysis; never trains on page load. */
export function useForecastShortages(storeId = '') {
  const { user } = useAuth();
  const [reports, setReports] = useState<ShortageAlertReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [version, setVersion] = useState(0);
  useStockReceiptRefresh(() => setVersion(value => value + 1));
  useEffect(() => {
    const update = () => setVersion(value => value + 1);
    window.addEventListener('freshmart-forecast-updated', update);
    return () => window.removeEventListener('freshmart-forecast-updated', update);
  }, []);
  useEffect(() => {
    if (!user) return;
    let active = true;
    setReports([]); setLoading(true); setUnavailable(false);
    const load = async () => {
      try {
        const stores = storeId ? [{ id: storeId }] : user.globalAccess ? (await getStores()).filter(row => row.active) : user.stores.filter(row => row.active);
        const results = await Promise.allSettled(stores.map(async store => {
          const get = (days: number) => api<ShortageAlertReport>(`inventory/forecast-alerts?storeId=${encodeURIComponent(store.id)}&horizonDays=${days}`);
          const weekly = await get(7);
          return weekly.run ? weekly : get(14);
        }));
        if (!active) return;
        setReports(results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []));
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
  return <details className={`forecast-alert-detail ${tone}`} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <summary>{tone === 'critical' ? 'Cần xử lý gấp' : 'Cần bổ sung'} · {number(item.shortageQuantity)} {item.unit}</summary>
    <div><strong>{item.storeName} · {item.horizonDays} ngày</strong><span>Khả dụng: {number(item.available)} {item.unit}</span><span>Dự báo: {number(item.predictedQuantity)} {item.unit}</span><span>Đang về: {number(item.inTransfer + item.incomingPurchase)} {item.unit}</span><span>Dự phòng: {number(item.safetyStock)} {item.unit}</span>{item.dataQuality === 'NO_SALES' && <span>Chưa có bán: gợi ý dựa trên mức dự phòng.</span>}<Link href={`/du-bao-nhu-cau?status=shortage&storeId=${encodeURIComponent(item.storeId)}&horizon=${item.horizonDays}`}>Xem dự báo →</Link></div>
  </details>;
}

export function ForecastShortageBanner({ items, loading, unavailable, missingForecast, onFilter, filtered, showProducts = false, scopeNote }: { items: ForecastAlert[]; loading?: boolean; unavailable?: boolean; missingForecast?: boolean; onFilter?: () => void; filtered?: boolean; showProducts?: boolean; scopeNote?: string }) {
  if (loading || !items.length) return null;
  const critical = items.filter(item => item.severity === 'HIGH').length;
  const periods = [...new Set(items.map(item => item.horizonDays))].sort((a,b) => a-b);
  const period = periods.length === 1 ? `${periods[0]} ngày` : periods.map(day => `${day} ngày`).join(' hoặc ');
  const detail = items.length === 1 || items.every(item => item.storeId === items[0]?.storeId) ? `&storeId=${encodeURIComponent(items[0]!.storeId)}&horizon=${items[0]!.horizonDays}` : '';
  return <section className={`forecast-shortage-banner ${critical ? 'critical' : ''}`} aria-label="Cảnh báo dự báo thiếu hàng">
    <div className="forecast-shortage-icon" aria-hidden="true">!</div><div className="forecast-shortage-copy"><strong>{items.length} lượt sản phẩm cần bổ sung theo dự báo {period}</strong><p>{critical ? `${critical} lượt cần ưu tiên xử lý · ` : ''}{new Set(items.map(item => item.storeId)).size > 1 ? 'Tính theo từng chi nhánh · ' : `${items[0]?.storeName} · `}Đối chiếu tồn và mức dự phòng{scopeNote ? ` · ${scopeNote}` : ''}.</p>{(unavailable || missingForecast) && <small>Một số chi nhánh chưa có dữ liệu hoặc không tải được.</small>}</div><div className="forecast-shortage-actions">{onFilter && <button type="button" onClick={onFilter}>{filtered ? 'Xem tất cả sản phẩm' : 'Chỉ xem hàng cần bổ sung'}</button>}<Link href={`/du-bao-nhu-cau?status=shortage${detail}`}>Xem dự báo →</Link></div>
    {showProducts && <div className="forecast-shortage-top">{items.slice(0,3).map(item => <div className="forecast-shortage-product" key={`${item.storeId}-${item.skuId}`}><ProductImage src={item.imageUrl} name={item.productName} size="md"/><div className="forecast-shortage-product-copy"><strong>{item.productName}</strong><span>{item.storeName} · còn {number(item.available)} {item.unit}</span><b>Cần bù {number(item.shortageQuantity)} {item.unit}</b></div></div>)}</div>}
  </section>;
}
