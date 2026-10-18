'use client';
import { downloadExcel } from '../../lib/excel-export';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Protected } from '../../components/auth-provider';
import { Icon } from '../../components/ui/icon';
import { MetricCard, MetricGrid } from '../../components/ui/metric-card';
import { useToast } from '../../components/ui/toast-provider';
import { ProductImage } from '../../components/ui/product-image';
import { errorMessage } from '../../lib/auth-api';
import { getStores, type Store } from '../../lib/organization-api';
import { getCategories, getProducts, type Category, type Product } from '../../lib/products-api';
import { getRevenueReport, type RevenueReport } from '../../lib/reports-api';

const dateText = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const initialTo = dateText(new Date());
const initialFromDate = new Date(); initialFromDate.setDate(initialFromDate.getDate() - 29);
const initialFrom = dateText(initialFromDate);
const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(Math.round(value))} đ`;
const number = (value: number) => new Intl.NumberFormat('vi-VN').format(value);
const knownCategoryTones: Record<string, number> = { DO_UONG_SUA: 0, GIA_VI_THUC_PHAM: 1, BANH_KEO_DO_KHO: 2, TRA_CA_PHE: 3 };
const categoryToneClass = (code: string) => `category-tone-${knownCategoryTones[code] ?? [...code].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6}`;
const empty: RevenueReport = { filters: { from: initialFrom, to: initialTo, storeId: null, productId: null, categoryId: null }, summary: { grossSales: 0, discount: 0, netRevenue: 0, invoiceCount: 0, quantity: 0, averageOrderValue: 0, costOfGoods: 0, grossProfit: 0, grossMargin: 0 }, revenueSeries: [], branches: [], categories: [], categoryProducts: [], topProducts: [] };

function RevenueReportPage() {
  const { showToast } = useToast();
  const [report, setReport] = useState(empty);
  const [stores, setStores] = useState<Store[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [storeId, setStoreId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [productId, setProductId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getStores(), getCategories('true'), getProducts({ active: 'true', pageSize: 100 })])
      .then(([storeRows, categoryRows, productRows]) => { setStores(storeRows.filter(row => row.active)); setCategories(categoryRows); setProducts(productRows.items); })
      .catch(reason => setError(errorMessage(reason)));
  }, []);

  const load = async () => {
    if (from > to) { setError('Ngày bắt đầu không được sau ngày kết thúc.'); setLoading(false); return; }
    setLoading(true); setError('');
    try { setReport(await getRevenueReport({ from, to, storeId: storeId || undefined, categoryId: categoryId || undefined, productId: productId || undefined })); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { const timer = setTimeout(load, 250); return () => clearTimeout(timer); }, [from, to, storeId, categoryId, productId]);

  const filteredProducts = useMemo(() => products.filter(product => !categoryId || product.categoryId === categoryId), [products, categoryId]);
  const categoryGroups = useMemo(() => report.categories.map(category => ({ ...category, products: report.categoryProducts.filter(product => product.categoryId === category.id) })), [report.categories, report.categoryProducts]);
  const chart = useMemo(() => {
    const rows = report.revenueSeries;
    const max = Math.max(...rows.map(row => row.revenue), 1);
    const slot = 700 / Math.max(rows.length, 1);
    const barWidth = Math.max(2, Math.min(20, slot * 0.62));
    return rows.map((row, index) => {
      const height = Math.max(row.revenue > 0 ? 2 : 0, row.revenue * 150 / max);
      return { ...row, x: index * slot + (slot - barWidth) / 2, y: 175 - height, width: barWidth, height };
    });
  }, [report.revenueSeries]);
  const reset = () => { setFrom(initialFrom); setTo(initialTo); setStoreId(''); setCategoryId(''); setProductId(''); };
  const exportExcel = () => {
    const rows = [['BÁO CÁO DOANH THU SMARTCHAIN'], ['Từ ngày', from], ['Đến ngày', to], ['Doanh thu thuần', String(report.summary.netRevenue)], ['Số hóa đơn', String(report.summary.invoiceCount)], ['Số lượng bán', String(report.summary.quantity)], [], ['Sản phẩm', 'Mã sản phẩm', 'Số lượng', 'Doanh thu'], ...report.topProducts.map(row => [row.name, row.productCode, String(row.quantity), String(row.revenue)])];
    const csv = '\uFEFF' + rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n');
    void downloadExcel(csv, `bao-cao-doanh-thu-${from}-${to}.xls`); showToast('Đã xuất báo cáo doanh thu dạng Excel.');
  };

  return <div className="suite-page report-page">
    <header className="suite-heading"><div><div className="breadcrumb">Phân tích <span>›</span> Báo cáo doanh thu</div><h1>Báo cáo doanh thu</h1><p>Dữ liệu từ các hóa đơn đã hoàn tất trong phạm vi chi nhánh được cấp.</p></div><button className="outline-button" onClick={exportExcel} disabled={loading}><Icon name="download" />Xuất Excel</button></header>
    <section className="panel report-filter-panel" aria-label="Bộ lọc báo cáo"><div className="filter-grid"><label>Từ ngày<input type="date" value={from} max={to} onChange={event => setFrom(event.target.value)} /></label><label>Đến ngày<input type="date" value={to} min={from} onChange={event => setTo(event.target.value)} /></label><label>Chi nhánh<select value={storeId} onChange={event => setStoreId(event.target.value)}><option value="">Tất cả chi nhánh</option>{stores.map(store => <option key={store.id} value={store.id}>{store.code} · {store.name}</option>)}</select></label><label>Danh mục<select value={categoryId} onChange={event => { setCategoryId(event.target.value); setProductId(''); }}><option value="">Tất cả danh mục</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Sản phẩm<select value={productId} onChange={event => setProductId(event.target.value)}><option value="">Tất cả sản phẩm</option>{filteredProducts.map(product => <option key={product.id} value={product.id}>{product.code} · {product.name}</option>)}</select></label><button className="text-button" type="button" onClick={reset}>Xóa bộ lọc</button></div></section>
    {error && <div className="ui-error">{error} <button onClick={load}>Thử lại</button></div>}
    <div className="preview-note"><span className="status-dot" />Dữ liệu hóa đơn thực tế<span>{loading ? 'Đang tổng hợp…' : `${from} → ${to}`}</span></div>
    <MetricGrid className="report-kpis" label="Chỉ số doanh thu"><MetricCard tone="blue" label="DOANH THU THUẦN" icon={<Icon name="wallet" />} value={money(report.summary.netRevenue)} caption={`Doanh số trước giảm giá: ${money(report.summary.grossSales)}`} /><MetricCard tone="green" label="HÓA ĐƠN HOÀN TẤT" icon={<Icon name="receipt" />} value={number(report.summary.invoiceCount)} caption={`Giá trị trung bình: ${money(report.summary.averageOrderValue)}`} /><MetricCard tone="amber" label="GIÁ VỐN ƯỚC TÍNH" icon={<Icon name="box" />} value={money(report.summary.costOfGoods)} caption="Theo giá vốn sản phẩm hiện tại" /><MetricCard tone={report.summary.grossProfit >= 0 ? 'green' : 'red'} label="LỢI NHUẬN GỘP ƯỚC TÍNH" icon={<Icon name="chart" />} value={money(report.summary.grossProfit)} caption={`Biên lợi nhuận ${report.summary.grossMargin.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`} /></MetricGrid>
    <section className="panel revenue-panel"><div className="panel-heading"><h2>Doanh thu theo ngày</h2><span className="panel-meta">Biểu đồ cột · đã phân bổ giảm giá theo tỷ trọng dòng hàng</span></div><div className="chart-content"><div className="revenue-chart"><svg viewBox="0 0 700 200" preserveAspectRatio="none" role="img" aria-label="Biểu đồ cột doanh thu theo ngày">{[25, 75, 125, 175].map(y => <line key={y} x1="0" x2="700" y1={y} y2={y} stroke="#e4e9f0" strokeDasharray="3 4" />)}{chart.map(point => <rect key={point.date} x={point.x} y={point.y} width={point.width} height={point.height} rx={Math.min(3, point.width / 3)} fill="#1681c4"><title>{point.date}: {money(point.revenue)} · {point.invoiceCount} hóa đơn</title></rect>)}</svg></div><div className="chart-axis"><span>{from}</span><span>{number(report.summary.quantity)} sản phẩm đã bán</span><span>{to}</span></div></div></section>
    <div className="report-breakdown"><section className="panel"><div className="panel-heading"><h2>Doanh thu theo chi nhánh</h2></div><div className="table-scroll"><table><thead><tr><th>Chi nhánh</th><th className="numeric">Hóa đơn</th><th className="numeric">Số lượng</th><th className="numeric">Doanh thu</th></tr></thead><tbody>{report.branches.length ? report.branches.map(row => <tr key={row.id}><td><strong>{row.name}</strong></td><td className="numeric">{number(row.invoiceCount)}</td><td className="numeric">{number(row.quantity)}</td><td className="numeric"><strong>{money(row.revenue)}</strong></td></tr>) : <tr><td colSpan={4}>Chưa có doanh thu trong kỳ.</td></tr>}</tbody></table></div></section><section className="panel category-structure-panel"><div className="panel-heading"><div><h2>Cơ cấu theo danh mục</h2><span className="panel-meta">Chọn danh mục để xem chi tiết sản phẩm đã bán</span></div></div><div className="table-scroll"><table><thead><tr><th>Danh mục</th><th className="numeric">Số lượng</th><th className="numeric">Doanh thu</th><th className="numeric">Tỷ trọng</th></tr></thead><tbody>{categoryGroups.length ? categoryGroups.map((category, index) => <Fragment key={category.id}><tr className={`category-summary-row category-palette-${index % 7}`}><td><button type="button" className="category-expand-button" aria-expanded={expandedCategoryId === category.id} onClick={() => setExpandedCategoryId(expandedCategoryId === category.id ? null : category.id)}><span aria-hidden="true">{expandedCategoryId === category.id ? '\u25be' : '\u25b8'}</span><strong><span className={`category-chip ${categoryToneClass(category.code)}`}>{category.name}</span></strong><small>{category.products.length} sản phẩm - xem chi tiết</small></button></td><td className="numeric">{number(category.quantity)}</td><td className="numeric"><strong>{money(category.revenue)}</strong></td><td className="numeric">{report.summary.netRevenue ? (category.revenue * 100 / report.summary.netRevenue).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) : 0}%</td></tr>{expandedCategoryId === category.id && <tr className={`category-detail-row category-palette-${index % 7}`}><td colSpan={4}><div className="category-detail"><div className="category-detail-heading"><strong>Sản phẩm / Mã sản phẩm</strong><strong>Số lượng</strong><strong>Thành tiền</strong></div>{category.products.map(product => <div className="category-detail-product" key={product.id}><span>{product.name}<small>{product.productCode}</small></span><span>{number(product.quantity)} {product.unit}</span><strong>{money(product.revenue)}</strong></div>)}<div className="category-detail-total"><strong>Tổng tiền ({category.name})</strong><strong>{number(category.quantity)}</strong><strong>{money(category.revenue)}</strong></div></div></td></tr>}</Fragment>) : <tr><td colSpan={4}>Chưa có dữ liệu danh mục.</td></tr>}</tbody><tfoot><tr className="category-grand-total"><th>TỔNG CỘNG</th><th className="numeric">{number(report.summary.quantity)}</th><th className="numeric">{money(report.summary.netRevenue)}</th><th className="numeric">100%</th></tr></tfoot></table></div></section></div>
    <section className="panel"><div className="panel-heading"><h2>Top 10 sản phẩm theo doanh thu</h2><span className="panel-meta">Dựa trên dòng hàng đã bán</span></div><div className="table-scroll"><table><thead><tr><th>#</th><th>Sản phẩm / Mã sản phẩm</th><th className="numeric">Số lượng</th><th className="numeric">Doanh thu</th></tr></thead><tbody>{report.topProducts.length ? report.topProducts.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td><div className="product-identity"><ProductImage src={row.imageUrl} name={row.name}/><span><strong>{row.name}</strong><small>{row.productCode}</small></span></div></td><td className="numeric">{number(row.quantity)} {row.unit}</td><td className="numeric"><strong>{money(row.revenue)}</strong></td></tr>) : <tr><td colSpan={4}>Chưa có sản phẩm bán trong kỳ.</td></tr>}</tbody></table></div></section>
  </div>;
}

export default function Page() { return <Protected permission="reports.read"><RevenueReportPage /></Protected>; }
