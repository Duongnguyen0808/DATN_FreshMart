'use client';
import { AnalyticsHero, DistributionPanel, RevenueExplorer } from './analytics-visuals';
import { downloadExcel } from '../lib/excel-export';
import { useEffect, useState } from 'react'; import Link from 'next/link';
import { Icon } from './ui/icon'; import { MetricCard } from './ui/metric-card'; import { PanelCard } from './ui/page-kit'; import { ProductImage } from './ui/product-image'; import { errorMessage } from '../lib/auth-api'; import { getStores, type Store } from '../lib/organization-api'; import { getDashboard, type Dashboard } from '../lib/dashboard-api';
import { useToast } from './ui/toast-provider';
import { useAuth } from './auth-provider';
import { ForecastShortageBanner, useForecastShortages } from './forecast-shortage-alert';

function DashboardWorkQueue({ summary }: { summary: Dashboard['summary'] }) {
  const tasks = [
    { label: 'Hàng cần bổ sung', detail: 'Kiểm tra mức tồn và đặt thêm hàng', count: summary.lowStock, icon: 'box', href: '/ton-kho' },
    { label: 'Phiếu chuyển sẵn sàng', detail: 'Chuẩn bị hàng để xuất kho', count: summary.pendingTransfers, icon: 'transfer', href: '/dieu-chuyen' },
    { label: 'Khoản phải trả quá hạn', detail: 'Đối chiếu nhà cung cấp', count: summary.overdueCount, icon: 'wallet', href: '/cong-no' },
    { label: 'Khoản phải thu quá hạn', detail: 'Theo dõi thanh toán khách hàng', count: summary.overdueReceivableCount, icon: 'users', href: '/cong-no-phai-thu' },
  ];
  const total = tasks.reduce((sum, task) => sum + task.count, 0);
  return <aside className="commerce-work-queue">
    <header><h2>Cần bạn xử lý</h2><span className="commerce-task-total">{total}</span></header>
    <p className="commerce-work-description">Những việc cần theo dõi trong cửa hàng.</p>
    <div>{tasks.map(task => <Link className={`commerce-task${task.count > 0 ? ' has-work' : ''}${task.count > 0 && task.label.includes('quá hạn') ? ' is-overdue' : ''}`} key={task.href} href={task.href}>
      <span className="commerce-task-icon"><Icon name={task.icon} size={18}/></span>
      <span className="commerce-task-copy"><strong>{task.label}</strong><small>{task.detail}</small></span>
      <b>{task.count}</b><Icon name="chevron" size={14}/>
    </Link>)}</div>
    <footer><Icon name="check" size={16}/><span>{total ? 'Chọn một mục để xem và xử lý chi tiết.' : 'Chưa có việc cần xử lý trong phạm vi này.'}</span></footer>
    <div className="commerce-shortcuts"><h3>Thao tác nhanh</h3><Link href="/nhap-hang"><Icon name="bag" size={17}/>Nhập hàng<Icon name="chevron" size={14}/></Link><Link href="/kho/mo-hinh-3d"><Icon name="store" size={17}/>Theo dõi kho 3D<Icon name="chevron" size={14}/></Link></div>
  </aside>;
}
const money = (value: number) => new Intl.NumberFormat('vi-VN').format(Math.round(value)); const shortMoney = (value: number) => value >= 1_000_000_000 ? `${(value / 1_000_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tỷ` : value >= 1_000_000 ? `${(value / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} triệu` : money(value);
function DashboardNumber({ value, format = money }: { value: number; format?: (value: number) => string }) {
  return <>{format(Number.isFinite(value) ? value : 0)}</>;
}
const empty: Dashboard = { period: 30, from: '', to: '', summary: { revenue: 0, costOfGoods: 0, grossProfit: 0, grossMargin: 0, invoiceCount: 0, stockValue: 0, lowStock: 0, outstandingDebt: 0, overdueDebt: 0, overdueCount: 0, outstandingReceivables: 0, overdueReceivables: 0, overdueReceivableCount: 0, pendingTransfers: 0 }, revenueSeries: [], branches: [], topProducts: [] };
export default function OperationsDashboard() {
  const { showToast } = useToast();
  const { user } = useAuth();
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [data, setData] = useState(empty); const [stores, setStores] = useState<Store[]>([]); const [storeId, setStoreId] = useState(''); const [period, setPeriod] = useState<7 | 30 | 90>(30); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const forecastAlerts = useForecastShortages(storeId);
  const load = async () => { setLoading(true); setError(''); try { setData(await getDashboard(period, storeId || undefined)); setLoadedAt(new Date()); } catch (reason) { setError(errorMessage(reason)); } finally { setLoading(false); } };
  useEffect(() => { getStores().then(rows => setStores(rows.filter(row => row.active))).catch(reason => setError(errorMessage(reason))); }, []); useEffect(() => { load(); }, [period, storeId]);
  const exportExcel = () => { const rows = [['BÁO CÁO DASHBOARD SMARTCHAIN'], ['Từ ngày', data.from.slice(0,10)], ['Đến ngày', data.to.slice(0,10)], ['Doanh thu', String(data.summary.revenue)], ['Giá vốn ước tính', String(data.summary.costOfGoods)], ['Lợi nhuận gộp ước tính', String(data.summary.grossProfit)], ['Biên lợi nhuận gộp (%)', String(data.summary.grossMargin)], ['Số hóa đơn', String(data.summary.invoiceCount)], ['Giá trị tồn kho', String(data.summary.stockValue)], ['Công nợ phải trả', String(data.summary.outstandingDebt)], ['Phải trả quá hạn', String(data.summary.overdueDebt)], ['Công nợ phải thu', String(data.summary.outstandingReceivables)], ['Phải thu quá hạn', String(data.summary.overdueReceivables)], [], ['Chi nhánh','Doanh thu','Số hóa đơn'], ...data.branches.map(row => [row.name,String(row.revenue),String(row.invoiceCount)])]; const csv = '\uFEFF' + rows.map(row => row.map(value => `"${value.replaceAll('"','""')}"`).join(',')).join('\r\n'); void downloadExcel(csv, `dashboard-${new Date().toISOString().slice(0,10)}.xls`); showToast('Đã xuất báo cáo Dashboard dạng Excel.'); };
  return <div className="dashboard commerce-dashboard analytics-dashboard"><div className="dashboard-heading"><div className="dashboard-heading-copy"><span className="dashboard-eyebrow">FRESHMART · QUẢN LÝ BÁN HÀNG</span><span className="dashboard-greeting">{user?.name ? `Xin chào, ${user.name}` : 'Chào mừng đến FreshMart'}</span><h1>Tổng quan vận hành</h1><p>Theo dõi doanh thu, đơn hàng và tồn kho trong {period} ngày gần nhất theo phạm vi được cấp.</p><div className="dashboard-hero-bottom"><span className="dashboard-updated"><span className="status-dot"/>{loading ? 'Đang tải dữ liệu…' : loadedAt ? `Tải lúc ${new Intl.DateTimeFormat('vi-VN', { dateStyle:'short', timeStyle:'short' }).format(loadedAt)}` : 'Chưa có dữ liệu cập nhật'}</span><div className="heading-actions"><label className="date-select"><Icon name="store" size={15} /><select value={storeId} onChange={event => setStoreId(event.target.value)}><option value="">Tất cả chi nhánh</option>{stores.map(store => <option key={store.id} value={store.id}>{store.code} · {store.name}</option>)}</select></label><button className="outline-button" onClick={exportExcel} disabled={loading}><Icon name="download" size={15} />Xuất báo cáo</button></div></div></div><div className="dashboard-heading-art" aria-hidden="true"><img src="/freshmart-banner-overview.svg" alt=""/></div></div>
    {error && <div className="ui-error">{error} <button onClick={load}>Thử lại</button></div>}

    <ForecastShortageBanner {...forecastAlerts} showProducts/>
    <AnalyticsHero revenue={data.summary.revenue} profit={data.summary.grossProfit} margin={data.summary.grossMargin} invoices={data.summary.invoiceCount} period={period} loading={loading}/>
    <div className="dashboard-middle">
      <PanelCard className="revenue-panel" title="Doanh thu theo ngày" meta={`${data.from.slice(0,10)} → ${data.to.slice(0,10)}`} actions={<div className="chart-tabs">{([7,30,90] as const).map(value => <button key={value} className={period === value ? 'selected' : ''} onClick={() => setPeriod(value)}>{value} ngày</button>)}</div>}>
        <RevenueExplorer rows={data.revenueSeries}/>
      </PanelCard>
      <DashboardWorkQueue summary={data.summary}/>
    </div>

    <section className="commerce-balances" aria-label="Inventory and balances"><MetricCard tone="indigo" label="GIÁ TRỊ TỒN KHO" icon={<Icon name="store" size={17} />} value={<><DashboardNumber value={data.summary.stockValue} format={shortMoney} /> <small>đ</small></>} caption={`${data.summary.lowStock} sản phẩm chạm hoặc dưới mức an toàn`} /><MetricCard tone="orange" label="CÔNG NỢ PHẢI TRẢ" icon={<Icon name="warning" size={17} />} value={<><DashboardNumber value={data.summary.outstandingDebt} format={shortMoney} /> <small>đ</small></>} caption={`${data.summary.overdueCount} khoản quá hạn · ${shortMoney(data.summary.overdueDebt)} đ`} /><MetricCard tone="cyan" label="CÔNG NỢ PHẢI THU" icon={<Icon name="wallet" size={17} />} value={<><DashboardNumber value={data.summary.outstandingReceivables} format={shortMoney} /> <small>đ</small></>} caption={`${data.summary.overdueReceivableCount} khoản quá hạn · ${shortMoney(data.summary.overdueReceivables)} đ`} /></section>
    <div className="dashboard-visuals"><DistributionPanel title="Doanh thu theo chi nhánh" description="Mức đóng góp của từng chi nhánh trong kỳ đã chọn." rows={data.branches.map(branch => ({ id: branch.id, label: branch.name, value: branch.revenue }))} onSelect={setStoreId}/><PanelCard title="Top 5 sản phẩm bán chạy" meta="Theo số lượng"><div className="table-scroll"><table className="product-table"><thead><tr><th>Sản phẩm / Mã SP</th><th className="numeric">Số lượng</th><th className="numeric">Doanh thu</th></tr></thead><tbody>{!data.topProducts.length ? <tr><td colSpan={3}>Chưa có sản phẩm bán trong kỳ.</td></tr> : data.topProducts.map(product => <tr key={product.productCode}><td><div className="product-identity"><ProductImage src={product.imageUrl} name={product.productName}/><span><strong>{product.productName}</strong><small>{product.productCode}</small></span></div></td><td className="numeric"><strong>{money(product.quantity)}</strong> {product.unit}</td><td className="numeric">{money(product.revenue)} đ</td></tr>)}</tbody></table></div></PanelCard></div>
  </div>;
}
