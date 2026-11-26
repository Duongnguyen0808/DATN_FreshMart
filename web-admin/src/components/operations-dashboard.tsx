'use client';
import { RevenueExplorer } from './analytics-visuals';
import { downloadExcel } from '../lib/excel-export';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Icon } from './ui/icon';
import { ProductImage } from './ui/product-image';
import { errorMessage } from '../lib/auth-api';
import { getStores, type Store } from '../lib/organization-api';
import { getDashboard, type Dashboard } from '../lib/dashboard-api';
import { useToast } from './ui/toast-provider';
import { useAuth } from './auth-provider';
import { ForecastShortageBanner, useForecastShortages } from './forecast-shortage-alert';

const money = (value: number) => new Intl.NumberFormat('vi-VN').format(Math.round(value));
const shortMoney = (value: number) =>
  value >= 1_000_000_000
    ? `${(value / 1_000_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tỷ`
    : value >= 1_000_000
    ? `${(value / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} triệu`
    : money(value);

const empty: Dashboard = {
  period: 30,
  from: '',
  to: '',
  summary: {
    revenue: 0,
    costOfGoods: 0,
    grossProfit: 0,
    grossMargin: 0,
    invoiceCount: 0,
    stockValue: 0,
    lowStock: 0,
    outstandingDebt: 0,
    overdueDebt: 0,
    overdueCount: 0,
    outstandingReceivables: 0,
    overdueReceivables: 0,
    overdueReceivableCount: 0,
    pendingTransfers: 0,
  },
  revenueSeries: [],
  branches: [],
  topProducts: [],
};

const QUICK_ACTIONS = [
  { label: 'Bán hàng POS', sub: 'Tạo hóa đơn tại quầy', icon: 'bag', href: '/hoa-don/tao' },
  { label: 'Đơn mua hàng', sub: 'Đặt bổ sung từ NCC', icon: 'receipt', href: '/don-mua-hang' },
  { label: 'Sản phẩm', sub: 'Quản lý danh mục & giá', icon: 'add', href: '/san-pham' },
  { label: 'Chuyển kho', sub: 'Điều phối giữa chi nhánh', icon: 'transfer', href: '/dieu-chuyen' },
  { label: 'Kiểm đếm kho', sub: 'Đối chiếu tồn thực tế', icon: 'check', href: '/kiem-kho' },
  { label: 'Kho 3D & RFID', sub: 'Quét QR & giám sát cửa', icon: 'truck', href: '/kho/mo-hinh-3d' },
] as const;

const ORBIT_INNER = [
  { label: 'Nhập kho', icon: 'bag', href: '/nhap-hang', angle: 250 },
  { label: 'Tồn kho', icon: 'layers', href: '/ton-kho', angle: 18 },
  { label: 'Hóa đơn', icon: 'receipt', href: '/hoa-don', angle: 138 },
] as const;

const ORBIT_OUTER = [
  { label: 'Lô hạn dùng', icon: 'clock', href: '/lo-han-dung', angle: 322 },
  { label: 'Nhân sự', icon: 'users', href: '/users', angle: 64 },
  { label: 'Chuyển hàng', icon: 'truck', href: '/dieu-chuyen', angle: 196 },
] as const;

function buildSparklinePath(values: number[], width = 260, height = 64): { line: string; area: string } {
  const pts = values.length >= 2 ? values : [12, 18, 15, 24, 22, 31, 28, 36];
  const max = Math.max(1, ...pts);
  const min = Math.min(0, ...pts);
  const span = Math.max(1, max - min);
  const coords = pts.map((v, idx) => {
    const x = (idx / (pts.length - 1)) * width;
    const y = height - 6 - ((v - min) / span) * (height - 14);
    return [Number(x.toFixed(1)), Number(y.toFixed(1))] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  return { line, area };
}

export default function OperationsDashboard() {
  const { showToast } = useToast();
  const { user } = useAuth();
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [data, setData] = useState(empty);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState('');
  const [period, setPeriod] = useState<7 | 30 | 90>(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const forecastAlerts = useForecastShortages(storeId);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getDashboard(period, storeId || undefined));
      setLoadedAt(new Date());
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    getStores().then(rows => setStores(rows.filter(row => row.active))).catch(reason => setError(errorMessage(reason)));
  }, []);

  useEffect(() => { load(); }, [period, storeId]);

  const greetingText = useMemo(() => {
    const hr = new Date().getHours();
    if (hr < 12) return 'Chào buổi sáng';
    if (hr < 18) return 'Chào buổi chiều';
    return 'Chào buổi tối';
  }, []);

  const exportExcel = () => {
    const rows = [
      ['THỐNG KÊ DASHBOARD FRESHMART'],
      ['Từ ngày', data.from.slice(0, 10)],
      ['Đến ngày', data.to.slice(0, 10)],
      ['Doanh thu', String(data.summary.revenue)],
      ['Giá vốn ước tính', String(data.summary.costOfGoods)],
      ['Lợi nhuận gộp ước tính', String(data.summary.grossProfit)],
      ['Biên lợi nhuận gộp (%)', String(data.summary.grossMargin)],
      ['Số hóa đơn', String(data.summary.invoiceCount)],
      ['Giá trị tồn kho', String(data.summary.stockValue)],
      ['Công nợ phải trả', String(data.summary.outstandingDebt)],
      ['Phải trả quá hạn', String(data.summary.overdueDebt)],
      ['Công nợ phải thu', String(data.summary.outstandingReceivables)],
      ['Phải thu quá hạn', String(data.summary.overdueReceivables)],
      [],
      ['Chi nhánh', 'Doanh thu', 'Số hóa đơn'],
      ...data.branches.map(row => [row.name, String(row.revenue), String(row.invoiceCount)]),
    ];
    const csv = '\uFEFF' + rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n');
    void downloadExcel(csv, `dashboard-${new Date().toISOString().slice(0, 10)}.xls`);
    showToast('Đã xuất thống kê Dashboard dạng Excel.');
  };

  const spark = useMemo(
    () => buildSparklinePath(data.revenueSeries.slice(-14).map(r => r.revenue)),
    [data.revenueSeries]
  );

  // Stock health metrics (total catalog ~44 active SKUs across branches)
  const totalCatalog = Math.max(44, data.summary.lowStock + (forecastAlerts.items?.length ?? 0) + 28);
  const urgentShortageCount = forecastAlerts.items?.length ?? 0;
  const lowStockCount = data.summary.lowStock;
  const healthyStockCount = Math.max(0, totalCatalog - lowStockCount - urgentShortageCount);
  const pctHealthy = Math.round((healthyStockCount / totalCatalog) * 100);
  const pctLow = Math.round((lowStockCount / totalCatalog) * 100);
  const pctUrgent = Math.max(0, 100 - pctHealthy - pctLow);

  const dockDoors = [
    { code: 'G1', label: 'Trạm QR', state: 'is-load' as const },
    { code: 'G2', label: 'Nhập PO', state: 'is-load' as const },
    { code: 'G3', label: 'Xuất POS', state: 'is-unload' as const },
    { code: 'G4', label: 'Cổng RFID', state: 'is-load' as const },
    { code: 'G5', label: 'Dự phòng', state: 'is-free' as const },
    { code: 'G6', label: 'Điều chuyển', state: 'is-unload' as const },
    { code: 'G7', label: 'Kiểm lô', state: 'is-load' as const },
    { code: 'G8', label: 'Xuất chi nhánh', state: 'is-unload' as const },
  ];

  // Order & warehouse pipeline stages
  const stageForecast = Math.max(1, urgentShortageCount);
  const stageTransfer = Math.max(1, data.summary.pendingTransfers);
  const stageLowStock = Math.max(1, data.summary.lowStock);
  const stageDebt = Math.max(1, data.summary.overdueCount);
  const stageCompleted = Math.max(1, data.summary.invoiceCount);
  const stageTotal = stageForecast + stageTransfer + stageLowStock + stageDebt + stageCompleted;

  const pipelineSteps = [
    { name: 'Cần nhập AI', count: urgentShortageCount, sub: 'dự báo 14 ngày', icon: 'sparkles', hot: urgentShortageCount > 0, weight: stageForecast, color: '#99f6e4' },
    { name: 'Chờ điều chuyển', count: data.summary.pendingTransfers, sub: 'phiếu nội bộ', icon: 'transfer', hot: false, weight: stageTransfer, color: '#5eead4' },
    { name: 'Cảnh báo tồn', count: data.summary.lowStock, sub: 'dưới mức an toàn', icon: 'box', hot: data.summary.lowStock > 0, weight: stageLowStock, color: '#2dd4bf' },
    { name: 'Công nợ đến hạn', count: data.summary.overdueCount, sub: 'cần đối soát', icon: 'wallet', hot: false, weight: stageDebt, color: '#14b8a6' },
    { name: 'Đơn hoàn tất', count: data.summary.invoiceCount, sub: `trong ${period} ngày`, icon: 'check', hot: false, weight: stageCompleted, color: '#0d7a73' },
  ];

  const topOne = data.topProducts[0] ?? null;
  const runnerUps = data.topProducts.slice(1, 5);
  const maxTopQty = Math.max(1, topOne?.quantity ?? 1);
  const totalBranchRev = Math.max(1, data.branches.reduce((s, b) => s + b.revenue, 0));

  return (
    <div className="c2 wm-dashboard">
      {/* ============ Page Header (.c2-head) ============ */}
      <header className="c2-head">
        <div className="c2-head-copy">
          <nav aria-label="Breadcrumb" className="c2-crumb">
            <span>Trang chủ</span>
            <Icon name="chevron" size={12} />
            <span aria-current="page">Kho vận &amp; Bán lẻ</span>
          </nav>
          <h1 className="c2-title">Trung tâm Kho &amp; Bán lẻ</h1>
          <p className="c2-sub">Toàn bộ luồng hàng hóa, cổng kho thông minh và doanh thu chi nhánh theo thời gian thực.</p>
        </div>

        <div className="c2-head-actions">
          <span className="c2-live">
            <i />
            {loading
              ? 'Đang đồng bộ…'
              : loadedAt
              ? `Trực tuyến · ${new Intl.DateTimeFormat('vi-VN', { timeStyle: 'short' }).format(loadedAt)}`
              : 'Trực tuyến 24/7'}
          </span>

          <label className="wm-select-pill">
            <Icon name="store" size={15} />
            <select value={storeId} onChange={event => setStoreId(event.target.value)} aria-label="Chọn chi nhánh">
              <option value="">Tất cả chi nhánh</option>
              {stores.map(store => <option key={store.id} value={store.id}>{store.code} · {store.name}</option>)}
            </select>
          </label>

          <button type="button" className="wm-btn wm-btn-ghost" onClick={exportExcel} disabled={loading}>
            <Icon name="download" size={15} />
            Xuất thống kê
          </button>

          <Link href="/hoa-don/tao" className="wm-btn wm-btn-primary">
            <Icon name="add" size={15} />
            Tạo đơn bán
          </Link>
        </div>
      </header>

      {error && <div className="ui-error">{error} <button onClick={load}>Thử lại</button></div>}

      {/* ============ Hero Row: Animated Warehouse Banner (8 cols) + 2 Live Widgets (4 cols) ============ */}
      <div className="hw-row">
        <div className="hw-banner" role="region" aria-label="Tổng quan kho thông minh FreshMart">
          <svg className="hw-scene" viewBox="0 0 1200 300" preserveAspectRatio="xMaxYMax slice" aria-hidden="true" focusable="false">
            <defs>
              <radialGradient id="fmSun" cx=".5" cy=".5" r=".5">
                <stop offset="0" stopColor="#ffffff" stopOpacity=".95" />
                <stop offset=".5" stopColor="#99f6e4" stopOpacity=".5" />
                <stop offset="1" stopColor="#5eead4" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="fmRoof" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#2dd4bf" />
                <stop offset=".55" stopColor="#0d9488" />
                <stop offset="1" stopColor="#0d7a73" />
              </linearGradient>
              <g id="fmTruck">
                <rect x="0" y="0" width="92" height="38" rx="5" fill="#ffffff" stroke="#0d7a73" strokeWidth="1.6" />
                <path d="M10 19h72" stroke="#14b8a6" strokeOpacity=".45" />
                <rect x="95" y="9" width="38" height="29" rx="7" fill="#0d7a73" />
                <rect x="116" y="13" width="13" height="10" rx="3" fill="#e6fffa" />
                <circle cx="20" cy="41" r="7" fill="#0f2926" />
                <circle cx="66" cy="41" r="7" fill="#0f2926" />
                <circle cx="116" cy="41" r="7" fill="#0f2926" />
                <circle cx="20" cy="41" r="2.8" fill="#5eead4" />
                <circle cx="66" cy="41" r="2.8" fill="#5eead4" />
                <circle cx="116" cy="41" r="2.8" fill="#5eead4" />
                <ellipse cx="140" cy="28" rx="13" ry="7" fill="#ccfbf1" opacity=".65" />
              </g>
            </defs>
            <g className="hw-sun">
              <circle cx="930" cy="96" r="130" fill="url(#fmSun)" />
              <circle cx="930" cy="96" r="42" fill="#e6fffa" />
              <g className="hw-rays" stroke="#2dd4bf" strokeWidth="3" strokeLinecap="round" opacity=".65">
                <path d="M992 96L1014 96" /><path d="M985.9 122.9L1005.7 132.4" /><path d="M968.7 144.5L982.4 161.7" />
                <path d="M943.8 156.4L948.7 177.9" /><path d="M916.2 156.4L911.3 177.9" /><path d="M891.3 144.5L877.6 161.7" />
                <path d="M874.1 122.9L854.3 132.4" /><path d="M868 96L846 96" /><path d="M874.1 69.1L854.3 59.6" />
                <path d="M891.3 47.5L877.6 30.3" /><path d="M916.2 35.6L911.3 14.1" /><path d="M943.8 35.6L948.7 14.1" />
                <path d="M968.7 47.5L982.4 30.3" /><path d="M985.9 69.1L1005.7 59.6" />
              </g>
            </g>
            <g className="hw-cloud" style={{ ['--d' as string]: '60s', ['--t' as string]: '0s' }} transform="translate(0 40) scale(1)">
              <rect x="0" y="22" width="150" height="30" rx="15" fill="#fff" opacity=".8" />
              <rect x="26" y="4" width="80" height="34" rx="17" fill="#fff" opacity=".8" />
            </g>
            <g className="hw-cloud" style={{ ['--d' as string]: '82s', ['--t' as string]: '-30s' }} transform="translate(0 86) scale(0.7)">
              <rect x="0" y="22" width="150" height="30" rx="15" fill="#fff" opacity=".75" />
              <rect x="26" y="4" width="80" height="34" rx="17" fill="#fff" opacity=".75" />
            </g>
            {/* Background skyline silhouettes */}
            <rect x="330" y="204" width="60" height="46" rx="4" fill="#99e6da" opacity=".55" />
            <rect x="396" y="180" width="78" height="70" rx="4" fill="#99e6da" opacity=".55" />
            <rect x="480" y="198" width="54" height="52" rx="4" fill="#99e6da" opacity=".55" />
            <rect x="1010" y="190" width="64" height="60" rx="4" fill="#99e6da" opacity=".55" />
            <rect x="1080" y="206" width="90" height="44" rx="4" fill="#99e6da" opacity=".55" />
            {/* Main Warehouse Building */}
            <rect x="540" y="146" width="340" height="104" rx="6" fill="#f7fffe" stroke="#0d9488" strokeOpacity=".65" strokeWidth="2" />
            <path d="M522 156Q710 98 898 156L880 168H540Z" fill="url(#fmRoof)" />
            <path d="M560 142Q710 108 860 142" fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth="2.5" strokeLinecap="round" />
            <rect x="654" y="171" width="112" height="19" rx="9.5" fill="#093834" />
            <text x="710" y="184" textAnchor="middle" fontSize="10.5" fontWeight="800" letterSpacing="1.4" fill="#5eead4">FM-KHO 3D</text>
            {/* 4 Animated Dock Shutters */}
            {[
              { x: 566, delay: '0s' },
              { x: 640, delay: '-1.4s' },
              { x: 714, delay: '-2.8s' },
              { x: 788, delay: '-4.2s' },
            ].map(bay => (
              <g key={bay.x}>
                <rect x={bay.x} y="196" width="56" height="54" rx="5" fill="#0b2e2b" />
                <rect x={bay.x + 6} y="228" width="16" height="18" rx="2" fill="#2dd4bf" />
                <rect x={bay.x + 26} y="234" width="20" height="12" rx="2" fill="#99f6e4" />
                <rect className="hw-shutter" style={{ ['--t' as string]: bay.delay }} x={bay.x} y="196" width="56" height="54" rx="5" fill="#d8f5ef" stroke="#8fd3c7" />
              </g>
            ))}
            {/* Secondary Annex */}
            <rect x="920" y="176" width="230" height="74" rx="6" fill="#f7fffe" stroke="#0d9488" strokeOpacity=".55" strokeWidth="2" />
            <path d="M906 184Q1035 146 1164 184L1150 194H920Z" fill="url(#fmRoof)" />
            <rect x="940" y="206" width="50" height="44" rx="4" fill="#0f3834" />
            <rect x="1010" y="206" width="50" height="44" rx="4" fill="#0f3834" />
            <rect x="1080" y="206" width="50" height="44" rx="4" fill="#0f3834" />
            {/* Highway + Animated Trucks */}
            <rect x="0" y="250" width="1200" height="50" fill="#0d2f2c" />
            <rect x="0" y="250" width="1200" height="4" fill="#14b8a6" opacity=".8" />
            <path className="hw-dash" d="M0 278H1200" stroke="#ccfbf1" strokeWidth="3" strokeDasharray="26 22" opacity=".75" />
            <g className="hw-tr1"><use href="#fmTruck" transform="translate(-170 226) scale(.9)" /></g>
            <g className="hw-tr2"><g transform="translate(1380 258)"><use href="#fmTruck" transform="scale(-.78 .78)" /></g></g>
          </svg>

          <div className="hw-banner-copy">
            <span className="hw-kicker">FRESHMART WAREHOUSE &amp; POS</span>
            <h2 className="hw-h">{greetingText}, {user?.name ?? 'Quản trị viên'}</h2>
            <p className="hw-lead">
              Hệ thống ghi nhận <b>{money(data.summary.invoiceCount)}</b> hóa đơn hoàn tất,{' '}
              <b>{money(data.summary.pendingTransfers)}</b> phiếu điều chuyển tại kho và{' '}
              <b>{money(data.summary.lowStock)}</b> mặt hàng chạm ngưỡng tồn an toàn.
            </p>
            <div className="hw-actions">
              <Link href="/hoa-don" className="wm-btn wm-btn-primary">
                <Icon name="bag" size={16} />
                Mở đơn bán hàng
              </Link>
              <Link href="/kho/mo-hinh-3d" className="wm-btn wm-btn-ghost">
                <Icon name="scan" size={16} />
                Mô hình kho 3D
              </Link>
              <Link href="/lo-han-dung" className="wm-btn wm-btn-ghost">
                <Icon name="clock" size={16} />
                Kiểm tra lô cận hạn
              </Link>
            </div>
          </div>
        </div>

        <div className="hw-widgets">
          {/* Widget 1: Revenue Sparkline */}
          <section className="c2-card hw-w" aria-labelledby="hw-rev">
            <header className="hw-w-head">
              <span className="c2-ico"><Icon name="wallet" size={18} /></span>
              <div className="hw-w-title-wrap">
                <h2 id="hw-rev" className="hw-w-title">Doanh thu {period} ngày</h2>
                <p className="hw-w-sub">Tổng hợp hóa đơn đã thanh toán</p>
              </div>
              <Link href="/bao-cao-doanh-thu" className="hw-w-go" aria-label="Xem thống kê doanh thu">
                <Icon name="arrowUpRight" size={15} />
              </Link>
            </header>
            <div className="hw-rev">
              <p className="hw-big">{loading ? '…' : `${shortMoney(data.summary.revenue)} đ`}</p>
              <em className="hw-d is-up">Biên {data.summary.grossMargin.toFixed(1)}%</em>
              <small>Lãi gộp {shortMoney(data.summary.grossProfit)} đ</small>
            </div>
            <svg className="hw-spark" viewBox="0 0 260 64" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id="fmSparkFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.34" />
                  <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <path d={spark.area} fill="url(#fmSparkFill)" />
              <path d={spark.line} fill="none" stroke="#0d7a73" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="hw-axis">
              <span>{data.from ? data.from.slice(5, 10) : 'Đầu kỳ'}</span>
              <span>{money(data.summary.invoiceCount)} đơn</span>
              <span>Hôm nay</span>
            </p>
          </section>

          {/* Widget 2: Dock Doors & IoT Gates */}
          <section className="c2-card hw-w" aria-labelledby="hw-dock">
            <header className="hw-w-head">
              <span className="c2-ico"><Icon name="truck" size={18} /></span>
              <div className="hw-w-title-wrap">
                <h2 id="hw-dock" className="hw-w-title">Cổng kho &amp; Trạm IoT</h2>
                <p className="hw-w-sub">7/8 trạm đang hoạt động · Kho 3D</p>
              </div>
              <Link href="/kho/mo-hinh-3d" className="hw-w-go" aria-label="Mở mô hình kho 3D">
                <Icon name="arrowUpRight" size={15} />
              </Link>
            </header>
            <ul className="hw-doors">
              {dockDoors.map(door => (
                <li key={door.code} className={`hw-door ${door.state}`} title={`${door.code} · ${door.label}`}>
                  <Icon name={door.state === 'is-free' ? 'add' : 'truck'} size={15} />
                  <b>{door.code}</b>
                </li>
              ))}
            </ul>
            <p className="hw-legend">
              <span className="is-load"><i />Nhập &amp; Quét 4</span>
              <span className="is-unload"><i />Xuất hàng 3</span>
              <span className="is-free"><i />Trống 1</span>
            </p>
          </section>
        </div>
      </div>

      <ForecastShortageBanner {...forecastAlerts} showProducts />

      {/* ============ Second Row: Network Hub + Stock Health Donut + Quick Actions ============ */}
      <div className="c2-toprow">
        {/* Orbital Network Hub */}
        <section className="c2-card c2-orb-card" aria-labelledby="c2-net">
          <header className="c2-card-head">
            <span className="c2-ico"><Icon name="globe" size={19} /></span>
            <div className="c2-card-head-copy">
              <h2 id="c2-net" className="c2-card-title">Mạng lưới liên kết</h2>
              <p className="c2-card-sub">Các phân hệ kết nối trực tiếp về trung tâm kho</p>
            </div>
          </header>
          <div className="c2-orb-body">
            <div className="c2-orb">
              <i className="c2-orb-glow" aria-hidden="true" />
              <i className="c2-orb-ring r1" aria-hidden="true" />
              <i className="c2-orb-ring r2" aria-hidden="true" />
              <div className="c2-orb-spin is-inner">
                {ORBIT_INNER.map(node => (
                  <Link key={node.href} href={node.href} className="c2-orb-item" style={{ ['--a' as string]: `${node.angle}deg`, ['--r' as string]: '82px' }}>
                    <span className="c2-orb-tile">
                      <Icon name={node.icon} size={15} />
                      <em>{node.label}</em>
                    </span>
                  </Link>
                ))}
              </div>
              <div className="c2-orb-spin is-outer">
                {ORBIT_OUTER.map(node => (
                  <Link key={node.href} href={node.href} className="c2-orb-item" style={{ ['--a' as string]: `${node.angle}deg`, ['--r' as string]: '128px' }}>
                    <span className="c2-orb-tile">
                      <Icon name={node.icon} size={15} />
                      <em>{node.label}</em>
                    </span>
                  </Link>
                ))}
              </div>
              <Link href="/kho/mo-hinh-3d" className="c2-orb-core" aria-label="Trung tâm kho thông minh">
                <Icon name="store" size={24} />
              </Link>
              <p className="c2-orb-cap">
                <b>{stores.length || 3} chi nhánh</b>
                <small>1 mạng lưới Cloud</small>
              </p>
            </div>
          </div>
        </section>

        {/* Stock Health Donut */}
        <section className="c2-card c2-health-card" aria-labelledby="c2-health">
          <header className="c2-card-head">
            <span className="c2-ico"><Icon name="pulse" size={19} /></span>
            <div className="c2-card-head-copy">
              <h2 id="c2-health" className="c2-card-title">Sức khỏe tồn kho</h2>
              <p className="c2-card-sub">Theo dõi an toàn tồn &amp; công nợ toàn chuỗi</p>
            </div>
            <Link href="/ton-kho" className="c2-link">Chi tiết</Link>
          </header>

          <div className="c2-health">
            <div className="c2-donut">
              <svg viewBox="0 0 42 42" aria-hidden="true">
                <circle cx="21" cy="21" r="15.915" fill="none" stroke="#e2f2ee" strokeWidth="5.2" />
                <circle
                  cx="21"
                  cy="21"
                  r="15.915"
                  fill="none"
                  stroke="#0d9488"
                  strokeWidth="5.2"
                  strokeDasharray={`${pctHealthy} ${100 - pctHealthy}`}
                  strokeDashoffset="25"
                />
                {pctLow > 0 && (
                  <circle
                    cx="21"
                    cy="21"
                    r="15.915"
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="5.2"
                    strokeDasharray={`${pctLow} ${100 - pctLow}`}
                    strokeDashoffset={String(25 - pctHealthy)}
                  />
                )}
                {pctUrgent > 0 && (
                  <circle
                    cx="21"
                    cy="21"
                    r="15.915"
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth="5.2"
                    strokeDasharray={`${pctUrgent} ${100 - pctUrgent}`}
                    strokeDashoffset={String(25 - pctHealthy - pctLow)}
                  />
                )}
              </svg>
              <div className="c2-donut-center">
                <b>{totalCatalog}</b>
                <small>mặt hàng</small>
              </div>
            </div>

            <ul className="c2-health-list">
              <li><i style={{ ['--col' as string]: '#0d9488' }} /><span>Đủ hàng an toàn</span><b>{healthyStockCount}</b><em>{pctHealthy}%</em></li>
              <li><i style={{ ['--col' as string]: '#f59e0b' }} /><span>Dưới mức an toàn</span><b>{lowStockCount}</b><em>{pctLow}%</em></li>
              <li><i style={{ ['--col' as string]: '#ef4444' }} /><span>Dự báo thiếu (AI)</span><b>{urgentShortageCount}</b><em>{pctUrgent}%</em></li>
            </ul>
          </div>

          <div className="c2-hkpis">
            <div><small>Giá trị tồn kho</small><b>{shortMoney(data.summary.stockValue)} đ</b></div>
            <div><small>Phải trả NCC</small><b>{shortMoney(data.summary.outstandingDebt)} đ</b></div>
            <div><small>Phải thu KH</small><b>{shortMoney(data.summary.outstandingReceivables)} đ</b></div>
          </div>
        </section>

        {/* Quick Actions */}
        <section className="c2-card c2-qa-card" aria-labelledby="c2-qa">
          <header className="c2-card-head">
            <span className="c2-ico"><Icon name="lightning" size={19} /></span>
            <div className="c2-card-head-copy">
              <h2 id="c2-qa" className="c2-card-title">Thao tác nhanh</h2>
              <p className="c2-card-sub">Truy cập ngay các nghiệp vụ thường dùng</p>
            </div>
          </header>
          <div className="c2-qa-grid">
            {QUICK_ACTIONS.map(action => (
              <Link key={action.href} href={action.href} className="c2-qa">
                <span className="c2-qa-ico"><Icon name={action.icon} size={17} /></span>
                <span className="c2-qa-copy">
                  <b>{action.label}</b>
                  <small>{action.sub}</small>
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      {/* ============ Third Row: Revenue · Last N Days + Warehouses / Branches Table ============ */}
      <div className="c2-grid">
        <section className="c2-card" aria-labelledby="c2-sales">
          <div className="c2-sales-top">
            <div>
              <h2 id="c2-sales" className="c2-card-title">Biểu đồ doanh thu · {period} ngày qua</h2>
              <p className="c2-card-sub">{data.from.slice(0, 10)} → {data.to.slice(0, 10)} · Chạm từng cột để xem chi tiết ngày</p>
            </div>
            <div className="chart-tabs">
              {([7, 30, 90] as const).map(value => (
                <button key={value} type="button" className={period === value ? 'selected' : ''} onClick={() => setPeriod(value)}>
                  {value} ngày
                </button>
              ))}
            </div>
          </div>

          <RevenueExplorer rows={data.revenueSeries} />

          <div className="c2-tiles">
            <div className="c2-tile">
              <p>Hóa đơn hoàn tất</p>
              <b>{money(data.summary.invoiceCount)}</b>
              <em className="is-up">100% thanh toán</em>
            </div>
            <div className="c2-tile is-mint">
              <p>Lợi nhuận gộp</p>
              <b>{shortMoney(data.summary.grossProfit)} đ</b>
              <em className="is-up">Biên {data.summary.grossMargin.toFixed(1)}%</em>
            </div>
            <div className="c2-tile is-soft">
              <p>Trung bình / đơn</p>
              <b>{data.summary.invoiceCount ? `${shortMoney(data.summary.revenue / data.summary.invoiceCount)} đ` : '—'}</b>
              <em className="is-up">Giá trị giỏ hàng</em>
            </div>
          </div>
        </section>

        <section className="c2-card" aria-labelledby="c2-wh">
          <header className="c2-card-head">
            <span className="c2-ico"><Icon name="store" size={19} /></span>
            <div className="c2-card-head-copy">
              <h2 id="c2-wh" className="c2-card-title">Chi nhánh &amp; Kho vận hành</h2>
              <p className="c2-card-sub">Sản lượng đơn và doanh thu theo điểm bán</p>
            </div>
            <Link href="/so-sanh-chi-nhanh" className="c2-link">So sánh</Link>
          </header>

          <div className="table-scroll">
            <table className="c2-table">
              <thead>
                <tr>
                  <th>Chi nhánh / Kho</th>
                  <th>Hóa đơn</th>
                  <th>Tỷ trọng</th>
                  <th>Doanh thu</th>
                </tr>
              </thead>
              <tbody>
                {!data.branches.length ? (
                  <tr><td colSpan={4}>Chưa có phát sinh doanh thu chi nhánh trong kỳ.</td></tr>
                ) : (
                  data.branches.map(b => {
                    const share = ((b.revenue / totalBranchRev) * 100).toFixed(1);
                    return (
                      <tr key={b.id} onClick={() => setStoreId(b.id)} style={{ cursor: 'pointer' }}>
                        <td>
                          <span className="c2-row-name">
                            <span className="c2-row-ico"><Icon name="store" size={16} /></span>
                            <span>
                              <b>{b.name}</b>
                              <small>Nhấn để lọc theo chi nhánh</small>
                            </span>
                          </span>
                        </td>
                        <td><b>{money(b.invoiceCount)}</b> đơn</td>
                        <td className="is-good"><b>{share}%</b></td>
                        <td><b>{money(b.revenue)} đ</b></td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <Link href="/kho" className="c2-add">
            <Icon name="add" size={14} />
            Quản lý danh sách kho &amp; chi nhánh
          </Link>
        </section>
      </div>

      {/* ============ Bottom Row: Order & Warehouse Pipeline (8 cols) + Top Sellers (4 cols) ============ */}
      <div className="c2-row">
        <section className="c2-card c2-pipe-card" aria-labelledby="c2-pipe">
          <header className="c2-card-head">
            <span className="c2-ico"><Icon name="transfer" size={19} /></span>
            <div className="c2-card-head-copy">
              <h2 id="c2-pipe" className="c2-card-title">Luồng vận hành Kho &amp; Đơn hàng</h2>
              <p className="c2-card-sub">Từ dự báo AI, điều chuyển nội bộ đến xuất bán hoàn tất tại quầy</p>
            </div>
            <Link href="/hoa-don" className="c2-link">Tất cả hóa đơn</Link>
          </header>

          <div className="c2-flow">
            <ol className="c2-flow-steps">
              {pipelineSteps.map(step => (
                <li key={step.name} className={step.hot ? 'is-hot' : ''}>
                  <span className="c2-fl-node"><Icon name={step.icon} size={20} /></span>
                  <b>{money(step.count)}</b>
                  <span className="c2-fl-name">{step.name}</span>
                  <small>{step.sub}</small>
                </li>
              ))}
            </ol>
          </div>

          <div className="c2-flow-mix" role="img" aria-label="Tỷ trọng các khâu vận hành">
            {pipelineSteps.map(step => (
              <i key={step.name} style={{ flex: `${step.weight} 1 0`, background: step.color }} title={`${step.name}: ${step.count}`} />
            ))}
          </div>

          <ul className="c2-flow-legend">
            {pipelineSteps.map(step => (
              <li key={step.name}>
                <i style={{ background: step.color }} />
                <span>{step.name}</span>
                <b>{((step.weight / stageTotal) * 100).toFixed(0)}%</b>
              </li>
            ))}
          </ul>

          <div className="c2-flow-foot">
            <div>
              <small>Hóa đơn trong kỳ</small>
              <b>{money(data.summary.invoiceCount)} đơn</b>
            </div>
            <div>
              <small>Công nợ quá hạn</small>
              <b>{shortMoney(data.summary.overdueDebt)} đ</b>
            </div>
            <div className="is-warn">
              <span className="c2-warn-ico"><Icon name="bulb" size={17} /></span>
              <span>
                <small>Đề xuất bổ sung hàng AI</small>
                <b>{urgentShortageCount > 0 ? `${urgentShortageCount} mặt hàng dự báo thiếu trong 14 ngày` : 'Tồn kho đáp ứng tốt nhu cầu 14 ngày'}</b>
              </span>
              <Link href="/du-bao-nhu-cau">Xem dự báo</Link>
            </div>
          </div>
        </section>

        <section className="c2-card c2-top-card" aria-labelledby="c2-top">
          <header className="c2-card-head">
            <span className="c2-ico"><Icon name="trophy" size={19} /></span>
            <div className="c2-card-head-copy">
              <h2 id="c2-top" className="c2-card-title">Top bán chạy nhất</h2>
              <p className="c2-card-sub">Xếp hạng sản lượng trong {period} ngày qua</p>
            </div>
            <Link href="/san-pham" className="c2-link">Sản phẩm</Link>
          </header>

          {topOne ? (
            <>
              <Link href="/san-pham" className="c2-best-hero">
                <span className="c2-best-medal">#1 Dẫn đầu</span>
                <div className="c2-best-img">
                  <ProductImage src={topOne.imageUrl} name={topOne.productName} />
                </div>
                <span className="c2-best-copy">
                  <b>{topOne.productName}</b>
                  <small>{topOne.productCode} · {topOne.unit}</small>
                  <span className="c2-best-stats">
                    <em><b>{money(topOne.quantity)}</b> đã bán</em>
                    <em>{shortMoney(topOne.revenue)} đ</em>
                  </span>
                </span>
              </Link>

              <ol className="c2-best-list">
                {runnerUps.map((prod, idx) => {
                  const pct = Math.max(12, Math.round((prod.quantity / maxTopQty) * 100));
                  return (
                    <li key={prod.productCode}>
                      <span className="c2-best-rank">{idx + 2}</span>
                      <div className="c2-best-thumb">
                        <ProductImage src={prod.imageUrl} name={prod.productName} />
                      </div>
                      <span className="c2-best-mid">
                        <b>{prod.productName}</b>
                        <i className="c2-best-bar"><i style={{ width: `${pct}%` }} /></i>
                      </span>
                      <span className="c2-best-n">
                        <b>{money(prod.quantity)} {prod.unit}</b>
                        <small>{shortMoney(prod.revenue)} đ</small>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </>
          ) : (
            <p className="analytics-empty">Chưa có sản phẩm bán trong kỳ đã chọn.</p>
          )}
        </section>
      </div>
    </div>
  );
}
