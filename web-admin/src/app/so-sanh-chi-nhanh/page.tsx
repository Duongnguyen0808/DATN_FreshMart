'use client';
import { downloadExcel } from '../../lib/excel-export';

import { useEffect, useMemo, useState } from 'react';
import { Protected } from '../../components/auth-provider';
import { Icon } from '../../components/ui/icon';
import { MetricCard, MetricGrid } from '../../components/ui/metric-card';
import { StatusBadge } from '../../components/ui/status-badge';
import { useToast } from '../../components/ui/toast-provider';
import { errorMessage } from '../../lib/auth-api';
import { getCategories, getProducts, type Category, type Product } from '../../lib/products-api';
import { getBranchComparison, type BranchComparisonReport } from '../../lib/reports-api';

type SortKey = 'revenue' | 'grossProfit' | 'inventoryValue' | 'outstandingDebt';
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const initialTo = localDate(new Date());
const initialFromDate = new Date();
initialFromDate.setDate(initialFromDate.getDate() - 29);
const initialFrom = localDate(initialFromDate);
const empty: BranchComparisonReport = {
  filters: { from: initialFrom, to: initialTo, categoryId: null, productId: null },
  summary: { branchCount: 0, revenue: 0, invoiceCount: 0, quantity: 0, grossProfit: 0, grossMargin: 0, inventoryValue: 0, lowStock: 0, outOfStock: 0, outstandingDebt: 0, overdueDebt: 0 },
  branches: [],
};
const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(Math.round(value))} đ`;
const number = (value: number) => new Intl.NumberFormat('vi-VN').format(value);
const regionLabels: Record<string, string> = { MIEN_BAC: 'Miền Bắc', MIEN_TRUNG: 'Miền Trung', MIEN_NAM: 'Miền Nam' };

function BranchComparisonPage() {
  const { showToast } = useToast();
  const [report, setReport] = useState(empty);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [categoryId, setCategoryId] = useState('');
  const [productId, setProductId] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('revenue');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([getCategories('true'), getProducts({ active: 'true', pageSize: 100 })])
      .then(([categoryRows, productRows]) => { setCategories(categoryRows); setProducts(productRows.items); })
      .catch((reason) => setError(errorMessage(reason)));
  }, []);

  const load = async () => {
    if (from > to) {
      setError('Ngày bắt đầu không được sau ngày kết thúc.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setReport(await getBranchComparison({ from, to, categoryId: categoryId || undefined, productId: productId || undefined }));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [from, to, categoryId, productId]);

  const filteredProducts = useMemo(() => products.filter((row) => !categoryId || row.categoryId === categoryId), [products, categoryId]);
  const branches = useMemo(() => [...report.branches].sort((a, b) => b[sortBy] - a[sortBy]), [report.branches, sortBy]);
  const maxValue = Math.max(...branches.map((row) => row[sortBy]), 1);
  const winner = report.branches[0];
  const bestMargin = [...report.branches].filter((row) => row.revenue > 0).sort((a, b) => b.grossMargin - a.grossMargin)[0];
  const mostRisk = [...report.branches].sort((a, b) => b.lowStock + b.outOfStock - a.lowStock - a.outOfStock)[0];

  const preset = (days: number) => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - days + 1);
    setFrom(localDate(start));
    setTo(localDate(end));
  };
  const reset = () => { setFrom(initialFrom); setTo(initialTo); setCategoryId(''); setProductId(''); setSortBy('revenue'); };
  const exportExcel = () => {
    const rows = [
      ['SO SÁNH HIỆU QUẢ CHI NHÁNH'], ['Từ ngày', from], ['Đến ngày', to], [],
      ['Chi nhánh', 'Doanh thu', 'Hóa đơn', 'SL bán', 'LN gộp ước tính', 'Giá trị tồn', 'sản phẩm cần bổ sung', 'Công nợ', 'Quá hạn'],
      ...report.branches.map((row) => [row.name, String(row.revenue), String(row.invoiceCount), String(row.quantity), String(row.grossProfit), String(row.inventoryValue), String(row.lowStock + row.outOfStock), String(row.outstandingDebt), String(row.overdueDebt)]),
    ];
    const csv = '\uFEFF' + rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n');
    void downloadExcel(csv, `so-sanh-chi-nhanh-${from}-${to}.xlsx`);
    showToast('Đã xuất báo cáo so sánh chi nhánh.');
  };
  const sortLabels: Record<SortKey, string> = { revenue: 'doanh thu', grossProfit: 'lợi nhuận gộp', inventoryValue: 'giá trị tồn', outstandingDebt: 'công nợ' };

  return <div className="suite-page report-page branch-comparison-page">
    <header className="suite-heading">
      <div><div className="breadcrumb">Phân tích <span>›</span> So sánh chi nhánh</div><h1>So sánh hiệu quả chi nhánh</h1><p>Đặt các chi nhánh trên cùng kỳ báo cáo để đánh giá bán hàng, tồn kho và công nợ.</p></div>
      <button className="outline-button" onClick={exportExcel} disabled={loading || !report.branches.length}><Icon name="download" />Xuất Excel</button>
    </header>

    <section className="panel report-filter-panel">
      <div className="filter-grid branch-filter-grid">
        <label>Từ ngày<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>Đến ngày<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
        <label>Danh mục<select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setProductId(''); }}><option value="">Tất cả danh mục</option>{categories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label>Sản phẩm<select value={productId} onChange={(event) => setProductId(event.target.value)}><option value="">Tất cả sản phẩm</option>{filteredProducts.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label>
        <label>Xếp theo<select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortKey)}><option value="revenue">Doanh thu</option><option value="grossProfit">Lợi nhuận gộp</option><option value="inventoryValue">Giá trị tồn</option><option value="outstandingDebt">Công nợ</option></select></label>
        <button className="text-button" onClick={reset}>Xóa bộ lọc</button>
      </div>
      <div className="period-shortcuts"><span>Kỳ nhanh:</span><button onClick={() => preset(7)}>7 ngày</button><button onClick={() => preset(30)}>30 ngày</button><button onClick={() => preset(90)}>90 ngày</button></div>
    </section>

    {error && <div className="ui-error">{error} <button onClick={load}>Thử lại</button></div>}
    <div className="preview-note"><span className="status-dot" />Dữ liệu vận hành thực tế<span>{loading ? 'Đang tổng hợp…' : `${from} → ${to} · ${report.summary.branchCount} chi nhánh`}</span></div>

    <MetricGrid className="report-kpis" label="Chỉ số toàn chuỗi">
      <MetricCard tone="blue" label="DOANH THU" icon={<Icon name="wallet" />} value={money(report.summary.revenue)} caption={`${number(report.summary.invoiceCount)} hóa đơn · ${number(report.summary.quantity)} sản phẩm`} />
      <MetricCard tone={report.summary.grossProfit >= 0 ? 'green' : 'red'} label="LỢI NHUẬN GỘP ƯỚC TÍNH" icon={<Icon name="chart" />} value={money(report.summary.grossProfit)} caption={`Biên ${report.summary.grossMargin.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}% · theo giá vốn hiện tại`} />
      <MetricCard tone="amber" label="GIÁ TRỊ TỒN KHO" icon={<Icon name="store" />} value={money(report.summary.inventoryValue)} caption={`${number(report.summary.lowStock)} sắp thiếu · ${number(report.summary.outOfStock)} hết hàng`} />
      <MetricCard tone="violet" label="CÔNG NỢ PHẢI TRẢ" icon={<Icon name="warning" />} value={money(report.summary.outstandingDebt)} caption={`Quá hạn ${money(report.summary.overdueDebt)}`} />
    </MetricGrid>

    {(categoryId || productId) && <div className="demo-banner"><strong>Phạm vi bộ lọc sản phẩm:</strong> doanh thu và tồn kho được lọc theo sản phẩm hoặc danh mục; công nợ vẫn là tổng nghĩa vụ của cả chi nhánh vì khoản phải trả không phân bổ theo từng sản phẩm.</div>}

    <div className="branch-highlights">
      <article><span>DẪN ĐẦU DOANH THU</span><strong>{winner?.name ?? '—'}</strong><p>{winner ? money(winner.revenue) : 'Chưa có dữ liệu'}</p></article>
      <article><span>BIÊN LỢI NHUẬN CAO NHẤT</span><strong>{bestMargin?.name ?? '—'}</strong><p>{bestMargin ? `${bestMargin.grossMargin.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%` : 'Chưa có dữ liệu'}</p></article>
      <article><span>CẦN CHÚ Ý TỒN KHO</span><strong>{mostRisk?.name ?? '—'}</strong><p>{mostRisk ? `${number(mostRisk.lowStock + mostRisk.outOfStock)} sản phẩm cần bổ sung` : 'Chưa có dữ liệu'}</p></article>
    </div>

    <section className="panel branch-ranking">
      <div className="panel-heading"><h2>Xếp hạng theo {sortLabels[sortBy]}</h2><span className="panel-meta">Sắp xếp từ cao xuống thấp</span></div>
      <div className="branch-bars">{branches.length ? branches.map((row, index) => <div className="rank-bar" key={row.id}><span><b>{index + 1}</b> {row.name}</span><i><b style={{ width: `${row[sortBy] * 100 / maxValue}%` }} /></i><strong>{money(row[sortBy])}</strong></div>) : <p>Chưa có chi nhánh trong phạm vi được cấp.</p>}</div>
    </section>

    <section className="suite-panel panel">
      <div className="panel-heading"><h2>Bảng so sánh chi tiết</h2><span className="panel-meta">Lợi nhuận gộp dùng giá vốn sản phẩm hiện tại</span></div>
      <div className="table-scroll"><table><thead><tr><th>Hạng / Chi nhánh</th><th className="numeric">Doanh thu</th><th className="numeric">So kỳ trước</th><th className="numeric">Hóa đơn</th><th className="numeric">Giá trị đơn TB</th><th className="numeric">SL bán</th><th className="numeric">LN gộp</th><th className="numeric">Biên LN</th><th className="numeric">Giá trị tồn</th><th className="numeric">Cần bổ sung</th><th className="numeric">Công nợ</th><th className="numeric">Quá hạn</th></tr></thead>
        <tbody>{report.branches.length ? report.branches.map((row) => <tr key={row.id}><td><strong><span className="branch-rank">#{row.rank}</span> {row.name}</strong></td><td className="numeric"><strong>{money(row.revenue)}</strong></td><td className={`numeric ${row.revenueGrowth !== null && row.revenueGrowth >= 0 ? 'positive' : 'negative'}`}>{row.revenueGrowth === null ? (row.revenue > 0 ? 'Mới' : '—') : `${row.revenueGrowth >= 0 ? '+' : ''}${row.revenueGrowth.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`}</td><td className="numeric">{number(row.invoiceCount)}</td><td className="numeric">{money(row.averageOrderValue)}</td><td className="numeric">{number(row.quantity)}</td><td className={`numeric ${row.grossProfit >= 0 ? 'positive' : 'negative'}`}>{money(row.grossProfit)}</td><td className="numeric">{row.grossMargin.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%</td><td className="numeric">{money(row.inventoryValue)}</td><td className="numeric"><StatusBadge tone={row.lowStock + row.outOfStock ? 'red' : 'green'}>{number(row.lowStock + row.outOfStock)}</StatusBadge></td><td className="numeric">{money(row.outstandingDebt)}</td><td className="numeric negative">{money(row.overdueDebt)}</td></tr>) : <tr><td colSpan={12}>Chưa có dữ liệu chi nhánh.</td></tr>}</tbody>
      </table></div>
    </section>
  </div>;
}

export default function Page() {
  return <Protected permission="reports.read"><BranchComparisonPage /></Protected>;
}
