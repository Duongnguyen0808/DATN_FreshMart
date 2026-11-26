'use client';
import { AnalyticsHero, DistributionPanel, RevenueExplorer } from './analytics-visuals';
import { downloadExcel } from '../lib/excel-export';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from './ui/icon';
import { MetricCard } from './ui/metric-card';
import { PanelCard } from './ui/page-kit';
import { ProductImage } from './ui/product-image';
import { errorMessage } from '../lib/auth-api';
import { getStores, type Store } from '../lib/organization-api';
import { getDashboard, type Dashboard } from '../lib/dashboard-api';
import { useToast } from './ui/toast-provider';
import { useAuth } from './auth-provider';
import { ForecastShortageBanner, useForecastShortages } from './forecast-shortage-alert';

function DashboardWorkQueue({ summary }: { summary: Dashboard['summary'] }) {
  const tasks = [
    { label: 'Hàng cần bổ sung', detail: 'Kiểm tra mức tồn và đặt thêm hàng', count: summary.lowStock, icon: 'box', href: '/ton-kho' },
    { label: 'Phiếu chuyển sẵn sàng', detail: 'Chuẩn bị hàng để xuất kho', count: summary.pendingTransfers, icon: 'transfer', href: '/dieu-chuyen' },
    { label: 'Khoản phải trả quá hạn', detail: 'Đối chiếu nhà cung cấp', count: summary.overdueCount, icon: 'wallet', href: '/cong-no' },
  ];
  const total = tasks.reduce((sum, task) => sum + task.count, 0);
  return (
    <aside className="commerce-work-queue">
      <header>
        <h2>Cần bạn xử lý</h2>
        <span className="commerce-task-total">{total}</span>
      </header>
      <p className="commerce-work-description">Những việc cần theo dõi trong cửa hàng.</p>
      <div>
        {tasks.map(task => (
          <Link
            className={`commerce-task${task.count > 0 ? ' has-work' : ''}${task.count > 0 && task.label.includes('quá hạn') ? ' is-overdue' : ''}`}
            key={task.href}
            href={task.href}
          >
            <span className="commerce-task-icon"><Icon name={task.icon} size={18} /></span>
            <span className="commerce-task-copy">
              <strong>{task.label}</strong>
              <small>{task.detail}</small>
            </span>
            <b>{task.count}</b>
            <Icon name="chevron" size={14} />
          </Link>
        ))}
      </div>
      <footer>
        <Icon name="check" size={16} />
        <span>{total ? 'Chọn một mục để xem và xử lý chi tiết.' : 'Chưa có việc cần xử lý trong phạm vi này.'}</span>
      </footer>
      <div className="commerce-shortcuts">
        <h3>Thao tác nhanh</h3>
        <Link href="/nhap-hang"><Icon name="bag" size={17} />Nhập hàng<Icon name="chevron" size={14} /></Link>
        <Link href="/kho/mo-hinh-3d"><Icon name="store" size={17} />Theo dõi kho 3D<Icon name="chevron" size={14} /></Link>
      </div>
    </aside>
  );
}

const money = (value: number) => new Intl.NumberFormat('vi-VN').format(Math.round(value));
const shortMoney = (value: number) =>
  value >= 1_000_000_000
    ? `${(value / 1_000_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tỷ`
    : value >= 1_000_000
    ? `${(value / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} triệu`
    : money(value);

function DashboardNumber({ value, format = money }: { value: number; format?: (value: number) => string }) {
  return <>{format(Number.isFinite(value) ? value : 0)}</>;
}

const quickTiles = [
  { title: 'Bán hàng POS', sub: 'Tạo hóa đơn nhanh', icon: 'receipt', href: '/hoa-don/tao', featured: true },
  { title: 'Quét QR & Kho 3D', sub: 'Mô hình số & RFID', icon: 'scan', href: '/kho/mo-hinh-3d', featured: false },
  { title: 'Sản phẩm', sub: 'Danh mục & giá bán', icon: 'box', href: '/san-pham', featured: false },
  { title: 'Tồn kho', sub: 'Theo dõi đa chi nhánh', icon: 'store', href: '/ton-kho', featured: false },
  { title: 'Lô & Hạn dùng', sub: 'Kiểm soát cận hạn', icon: 'clock', href: '/lo-han-dung', featured: false },
  { title: 'Nhập hàng', sub: 'Đơn mua & nhà cung cấp', icon: 'truck', href: '/nhap-hang', featured: false },
  { title: 'Dự báo hàng AI', sub: 'Đề xuất nhập bổ sung', icon: 'sparkles', href: '/du-bao-nhu-cau', featured: false },
  { title: 'Thống kê', sub: 'Doanh thu & lợi nhuận', icon: 'chart', href: '/bao-cao-doanh-thu', featured: false },
] as const;

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

  return (
    <div className="dashboard commerce-dashboard analytics-dashboard offio-dashboard">
      {/* Top Brand Callout Strip (OFFIO style) */}
      <section className="offio-promo-banner" aria-label="Giới thiệu hệ thống FreshMart">
        <div className="offio-promo-copy">
          <span className="offio-promo-badge"><Icon name="sparkles" size={17} /></span>
          <p>
            <strong>FreshMart — Siêu ứng dụng quản trị bán lẻ &amp; kho thông minh.</strong>{' '}
            Bán hàng POS, mô hình kho 3D, cổng từ RFID, kiểm soát lô hạn dùng và dự báo AI đồng bộ thời gian thực trên Web và Mobile.
          </p>
        </div>
        <Link href="/hoa-don/tao" className="offio-promo-cta">Mở quầy bán hàng</Link>
      </section>

      {/* Hero Centerpiece + 4x2 Quick Module Tiles (OFFIO style) */}
      <section className="offio-hero-showcase" aria-label="Trung tâm vận hành và lối tắt phân hệ">
        <div className="offio-hero-card">
          <div className="offio-hero-content">
            <h1>Trung tâm Vận hành</h1>
            <p className="offio-hero-subtitle">Điều phối bán lẻ, tồn kho đa chi nhánh và dự báo nhu cầu toàn diện</p>
            <ul className="offio-hero-checks">
              <li><Icon name="check" size={15} /> Bán hàng POS &amp; QR</li>
              <li><Icon name="check" size={15} /> Kho 3D &amp; An ninh RFID</li>
              <li><Icon name="check" size={15} /> Kiểm soát lô cận hạn</li>
              <li><Icon name="check" size={15} /> Dự báo nhập hàng AI</li>
            </ul>
            <div className="offio-hero-actions">
              <Link href="/kho/mo-hinh-3d" className="offio-hero-btn">
                Khám phá kho 3D <Icon name="chevron" size={14} />
              </Link>
            </div>
          </div>
          <div className="offio-hero-visual" aria-hidden="true">
            <div className="offio-doc-sheet">
              <span className="offio-doc-tag">POS · 3D</span>
              <div className="offio-doc-lines">
                <span />
                <span />
                <span />
                <span />
              </div>
              <div className="offio-doc-mini-icons">
                <Icon name="scan" size={14} />
                <Icon name="transfer" size={14} />
                <Icon name="chart" size={14} />
                <Icon name="shield" size={14} />
              </div>
            </div>
          </div>
        </div>

        <div className="offio-quick-grid">
          {quickTiles.map(tile => (
            <Link key={tile.href} href={tile.href} className={`offio-quick-tile${tile.featured ? ' is-featured' : ''}`}>
              <span className="offio-tile-icon"><Icon name={tile.icon} size={22} /></span>
              <strong>{tile.title}</strong>
              <small>{tile.sub}</small>
            </Link>
          ))}
        </div>
      </section>

      {/* Secondary Operational Filter & Status Strip (OFFIO ID-Studio banner style) */}
      <section className="offio-feature-strip" aria-label="Phạm vi chi nhánh và trích xuất dữ liệu">
        <div className="offio-strip-left">
          <span className="offio-strip-icon"><Icon name="store" size={20} /></span>
          <div className="offio-strip-copy">
            <div className="offio-strip-title-row">
              <strong>{user?.name ? `Xin chào, ${user.name} — Tổng quan ${period} ngày` : `Tổng quan vận hành ${period} ngày`}</strong>
              <span className="offio-new-pill">Trực tuyến</span>
            </div>
            <p>
              {loading
                ? 'Đang đồng bộ số liệu doanh thu, tồn kho và công nợ…'
                : loadedAt
                ? `Cập nhật lúc ${new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(loadedAt)} · Theo dõi doanh thu, hóa đơn hoàn tất và cảnh báo tồn kho theo chi nhánh.`
                : 'Theo dõi doanh thu, đơn hàng và tồn kho theo phạm vi được cấp.'}
            </p>
          </div>
        </div>
        <div className="offio-strip-actions">
          <label className="date-select offio-branch-filter">
            <Icon name="store" size={15} />
            <select value={storeId} onChange={event => setStoreId(event.target.value)}>
              <option value="">Tất cả chi nhánh</option>
              {stores.map(store => <option key={store.id} value={store.id}>{store.code} · {store.name}</option>)}
            </select>
          </label>
          <button className="offio-strip-cta" onClick={exportExcel} disabled={loading}>
            Xuất thống kê <Icon name="chevron" size={14} />
          </button>
        </div>
      </section>

      {error && <div className="ui-error">{error} <button onClick={load}>Thử lại</button></div>}

      <ForecastShortageBanner {...forecastAlerts} showProducts />
      <AnalyticsHero revenue={data.summary.revenue} profit={data.summary.grossProfit} margin={data.summary.grossMargin} invoices={data.summary.invoiceCount} period={period} loading={loading} />

      <div className="dashboard-middle">
        <PanelCard
          className="revenue-panel"
          title="Doanh thu theo ngày"
          meta={`${data.from.slice(0, 10)} → ${data.to.slice(0, 10)}`}
          actions={
            <div className="chart-tabs">
              {([7, 30, 90] as const).map(value => (
                <button key={value} className={period === value ? 'selected' : ''} onClick={() => setPeriod(value)}>
                  {value} ngày
                </button>
              ))}
            </div>
          }
        >
          <RevenueExplorer rows={data.revenueSeries} />
        </PanelCard>
        <DashboardWorkQueue summary={data.summary} />
      </div>

      <section className="commerce-balances" aria-label="Inventory and balances">
        <MetricCard
          tone="indigo"
          label="GIÁ TRỊ TỒN KHO"
          icon={<Icon name="store" size={17} />}
          value={<><DashboardNumber value={data.summary.stockValue} format={shortMoney} /> <small>đ</small></>}
          caption={`${data.summary.lowStock} sản phẩm chạm hoặc dưới mức an toàn`}
        />
        <MetricCard
          tone="orange"
          label="CÔNG NỢ PHẢI TRẢ"
          icon={<Icon name="warning" size={17} />}
          value={<><DashboardNumber value={data.summary.outstandingDebt} format={shortMoney} /> <small>đ</small></>}
          caption={`${data.summary.overdueCount} khoản quá hạn · ${shortMoney(data.summary.overdueDebt)} đ`}
        />
        <MetricCard
          tone="cyan"
          label="CÔNG NỢ PHẢI THU"
          icon={<Icon name="wallet" size={17} />}
          value={<><DashboardNumber value={data.summary.outstandingReceivables} format={shortMoney} /> <small>đ</small></>}
          caption={`${data.summary.overdueReceivableCount} khoản quá hạn · ${shortMoney(data.summary.overdueReceivables)} đ`}
        />
      </section>

      <div className="dashboard-visuals">
        <DistributionPanel
          title="Doanh thu theo chi nhánh"
          description="Mức đóng góp của từng chi nhánh trong kỳ đã chọn."
          rows={data.branches.map(branch => ({ id: branch.id, label: branch.name, value: branch.revenue }))}
          onSelect={setStoreId}
        />
        <PanelCard title="Top 5 sản phẩm bán chạy" meta="Theo số lượng">
          <div className="table-scroll">
            <table className="product-table">
              <thead>
                <tr>
                  <th>Sản phẩm / Mã SP</th>
                  <th className="numeric">Số lượng</th>
                  <th className="numeric">Doanh thu</th>
                </tr>
              </thead>
              <tbody>
                {!data.topProducts.length ? (
                  <tr><td colSpan={3}>Chưa có sản phẩm bán trong kỳ.</td></tr>
                ) : (
                  data.topProducts.map(product => (
                    <tr key={product.productCode}>
                      <td>
                        <div className="product-identity">
                          <ProductImage src={product.imageUrl} name={product.productName} />
                          <span>
                            <strong>{product.productName}</strong>
                            <small>{product.productCode}</small>
                          </span>
                        </div>
                      </td>
                      <td className="numeric"><strong>{money(product.quantity)}</strong> {product.unit}</td>
                      <td className="numeric">{money(product.revenue)} đ</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </PanelCard>
      </div>
    </div>
  );
}
