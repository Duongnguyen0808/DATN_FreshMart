'use client';
import { downloadExcel } from '../../lib/excel-export';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Protected } from '../../components/auth-provider';
import { Icon } from '../../components/ui/icon';
import { MetricCard, MetricGrid } from '../../components/ui/metric-card';
import { StatusBadge } from '../../components/ui/status-badge';
import { TabBar, type TabItem } from '../../components/ui/tab-bar';
import { TablePagination } from '../../components/ui/table-pagination';
import { useToast } from '../../components/ui/toast-provider';
import { errorMessage } from '../../lib/auth-api';
import { getPaymentTransactions, type InvoiceStatus, type PaymentMethod, type PaymentTransactionList } from '../../lib/invoices-api';
import { getStores, type Store } from '../../lib/organization-api';

type MethodFilter = 'all' | PaymentMethod;
const empty: PaymentTransactionList = {
  items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
  summary: { total: 0, amount: 0, methods: { CASH: { count: 0, amount: 0 }, QR: { count: 0, amount: 0 }, CARD: { count: 0, amount: 0 } } },
};
const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(Math.round(value))} đ`;
const dateTime = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const methodLabels: Record<PaymentMethod, string> = { CASH: 'Tiền mặt', QR: 'QR / chuyển khoản', CARD: 'Thẻ' };
const methodTones = { CASH: 'green', QR: 'blue', CARD: 'violet' } as const;

function PaymentTransactionsPage() {
  const { showToast } = useToast();
  const [result, setResult] = useState(empty);
  const [stores, setStores] = useState<Store[]>([]);
  const [q, setQ] = useState('');
  const [method, setMethod] = useState<MethodFilter>('all');
  const [status, setStatus] = useState<'all' | InvoiceStatus>('all');
  const [storeId, setStoreId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    if (from && to && from > to) { setError('Ngày bắt đầu không được sau ngày kết thúc.'); setLoading(false); return; }
    setLoading(true); setError('');
    try { setResult(await getPaymentTransactions({ q: q.trim() || undefined, method, status, storeId: storeId || undefined, from: from || undefined, to: to || undefined, page })); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { getStores().then((rows) => setStores(rows.filter((row) => row.active))).catch((reason) => setError(errorMessage(reason))); }, []);
  useEffect(() => { const timer = window.setTimeout(load, 250); return () => window.clearTimeout(timer); }, [q, method, status, storeId, from, to, page]);
  useEffect(() => setPage(1), [q, method, status, storeId, from, to]);

  const tabs: TabItem<MethodFilter>[] = [
    { value: 'all', label: 'Tất cả giao dịch', count: result.summary.total, tone: 'blue' },
    { value: 'CASH', label: 'Tiền mặt', count: result.summary.methods.CASH.count, tone: 'green' },
    { value: 'QR', label: 'QR / chuyển khoản', count: result.summary.methods.QR.count, tone: 'cyan' },
    { value: 'CARD', label: 'Thẻ', count: result.summary.methods.CARD.count, tone: 'violet' },
  ];
  const reset = () => { setQ(''); setMethod('all'); setStatus('all'); setStoreId(''); setFrom(''); setTo(''); };
  const exportExcel = () => {
    const rows = [
      ['TRA CỨU GIAO DỊCH THANH TOÁN'], [],
      ['Hóa đơn', 'Thời gian', 'Phương thức', 'Mã tham chiếu', 'Khách hàng', 'Chi nhánh', 'Thu ngân', 'Số tiền', 'Trạng thái hóa đơn'],
      ...result.items.map((item) => [item.invoice.code, dateTime(item.invoice.completedAt), methodLabels[item.method], item.reference ?? '', item.invoice.customerName ?? 'Khách lẻ', item.invoice.store.name, item.invoice.cashier.name, String(item.amount), item.invoice.status === 'COMPLETED' ? 'Hoàn tất' : 'Đã hủy']),
    ];
    const csv = '\uFEFF' + rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n');
    void downloadExcel(csv, `giao-dich-thanh-toan-trang-${page}.xls`);
    showToast(result.pagination.total > result.items.length ? 'Đã xuất các giao dịch của trang hiện tại.' : 'Đã xuất danh sách giao dịch.');
  };

  return <div className="suite-page payment-transactions-page">
    <header className="suite-heading"><div><div className="breadcrumb">Bán hàng <span>›</span> Giao dịch</div><h1>Tra cứu giao dịch thanh toán</h1><p>Đối soát từng khoản tiền mặt, QR hoặc thẻ đã ghi nhận trên hóa đơn.</p></div><button className="outline-button" disabled={loading || !result.items.length} onClick={exportExcel}><Icon name="download" />Xuất Excel</button></header>

    <MetricGrid className="report-kpis" label="Tổng hợp theo bộ lọc">
      <MetricCard tone="blue" label="TỔNG GIAO DỊCH" icon={<Icon name="receipt" />} value={result.summary.total} caption={`Tổng giá trị ${money(result.summary.amount)}`} />
      <MetricCard tone="green" label="TIỀN MẶT" icon={<Icon name="wallet" />} value={money(result.summary.methods.CASH.amount)} caption={`${result.summary.methods.CASH.count} giao dịch`} />
      <MetricCard tone="amber" label="QR / CHUYỂN KHOẢN" icon={<Icon name="transfer" />} value={money(result.summary.methods.QR.amount)} caption={`${result.summary.methods.QR.count} giao dịch`} />
      <MetricCard tone="violet" label="THẺ" icon={<Icon name="card" />} value={money(result.summary.methods.CARD.amount)} caption={`${result.summary.methods.CARD.count} giao dịch`} />
    </MetricGrid>

    <section className="panel report-filter-panel"><div className="filter-grid payment-filter-grid">
      <label>Tìm kiếm<input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Mã tham chiếu, hóa đơn, khách hàng…" /></label>
      <label>Chi nhánh<select value={storeId} onChange={(event) => setStoreId(event.target.value)}><option value="">Tất cả chi nhánh</option>{stores.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label>
      <label>Trạng thái hóa đơn<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">Tất cả trạng thái</option><option value="COMPLETED">Hoàn tất</option><option value="CANCELLED">Đã hủy</option></select></label>
      <label>Từ ngày<input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>Đến ngày<input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label>
      <button className="text-button" onClick={reset}>Xóa bộ lọc</button>
    </div></section>

    {error && <div className="ui-error" role="alert">{error} <button onClick={load}>Thử lại</button></div>}
    <section className="suite-panel panel">
      <TabBar items={tabs} value={method} onChange={setMethod} label="Lọc phương thức thanh toán" />
      <div className="table-scroll"><table><thead><tr><th>Hóa đơn / Thời gian</th><th>Phương thức</th><th>Mã tham chiếu</th><th>Khách hàng</th><th>Chi nhánh / POS</th><th>Thu ngân</th><th className="numeric">Số tiền giao dịch</th><th className="numeric">Tổng hóa đơn</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{loading ? <tr><td colSpan={10}>Đang tải giao dịch…</td></tr> : result.items.length ? result.items.map((item) => <tr key={item.id}><td><strong>{item.invoice.code}</strong><small>{dateTime(item.invoice.completedAt)}</small></td><td><StatusBadge tone={methodTones[item.method]}>{methodLabels[item.method]}</StatusBadge></td><td><code>{item.reference ?? '—'}</code></td><td><strong>{item.invoice.customerName ?? 'Khách lẻ'}</strong><small>{item.invoice.customerPhone ?? 'Không có SĐT'}</small></td><td><strong>{item.invoice.store.name}</strong><small>{item.invoice.shift.posCode} · {item.invoice.shift.code}</small></td><td>{item.invoice.cashier.name}</td><td className="numeric"><strong>{money(item.amount)}</strong></td><td className="numeric">{money(item.invoice.total)}</td><td><StatusBadge tone={item.invoice.status === 'COMPLETED' ? 'green' : 'red'}>{item.invoice.status === 'COMPLETED' ? 'Hoàn tất' : 'Đã hủy'}</StatusBadge></td><td><Link className="ui-action-button action-view" href={`/hoa-don/${item.invoice.id}`}>Xem hóa đơn</Link></td></tr>) : <tr><td colSpan={10}>Không có giao dịch phù hợp bộ lọc.</td></tr>}</tbody></table></div>
      <TablePagination page={result.pagination.page} totalPages={result.pagination.totalPages} shown={result.items.length} total={result.pagination.total} noun="giao dịch" onChange={setPage} />
    </section>
  </div>;
}

export default function Page() {
  return <Protected permission="invoices.read"><PaymentTransactionsPage /></Protected>;
}
