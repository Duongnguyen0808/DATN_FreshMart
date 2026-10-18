'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Protected, useAuth } from '../../components/auth-provider';
import { ActionLink } from '../../components/ui/action-button';
import { Icon } from '../../components/ui/icon';
import { MetricCard, MetricGrid } from '../../components/ui/metric-card';
import { StatusBadge } from '../../components/ui/status-badge';
import { TabBar, type TabItem } from '../../components/ui/tab-bar';
import { errorMessage } from '../../lib/auth-api';
import * as api from '../../lib/invoices-api';

type Filter = 'all' | api.InvoiceStatus;
const money = (value: number) => new Intl.NumberFormat('vi-VN').format(Math.round(value)) + ' đ';
const dateTime = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const methodName: Record<api.PaymentMethod, string> = { CASH: 'Tiền mặt', QR: 'QR', CARD: 'Thẻ' };
const tabs: TabItem<Filter>[] = [{ value: 'all', label: 'Tất cả', tone: 'blue' }, { value: 'COMPLETED', label: 'Hoàn tất', tone: 'green' }, { value: 'CANCELLED', label: 'Đã hủy', tone: 'red' }];

function InvoiceListPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [result, setResult] = useState<api.InvoiceList>({ items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 }, summary: { total: 0, completed: 0, cancelled: 0, revenue: 0 } });
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = async () => { setLoading(true); setError(''); try { setResult(await api.getInvoices({ q: query.trim() || undefined, status, page })); } catch (reason) { setError(errorMessage(reason)); } finally { setLoading(false); } };
  useEffect(() => { const timer = window.setTimeout(load, 250); return () => window.clearTimeout(timer); }, [query, status, page]);
  useEffect(() => setPage(1), [query, status]);
  const statusBadge = (invoice: api.Invoice) => invoice.status === 'CANCELLED'
    ? <StatusBadge tone="red">Đã hủy</StatusBadge>
    : invoice.refundedAmount >= invoice.total ? <StatusBadge tone="violet">Đã trả toàn bộ</StatusBadge>
      : invoice.refundedAmount > 0 ? <StatusBadge tone="amber">Đã trả một phần</StatusBadge>
        : <StatusBadge tone="green">Hoàn tất</StatusBadge>;

  return <div className="suite-page invoice-page"><header className="suite-heading"><div><div className="breadcrumb">Bán hàng <span>›</span> Hóa đơn</div><h1>Tra cứu hóa đơn bán hàng</h1><p>Đối soát giao dịch, hoàn tiền, phương thức thanh toán và trạng thái hóa đơn theo phạm vi được cấp.</p></div>{user?.permissions.includes('invoices.create') && <ActionLink tone="approve" href="/hoa-don/tao">+ Tạo hóa đơn</ActionLink>}</header><MetricGrid className="suite-kpis" label="Chỉ số hóa đơn"><MetricCard tone="blue" label="TỔNG HÓA ĐƠN" value={result.summary.total}/><MetricCard tone="green" label="HOÀN TẤT" value={result.summary.completed}/><MetricCard tone="amber" label="DOANH THU SAU HOÀN" value={money(result.summary.revenue)}/><MetricCard tone="red" label="ĐÃ HỦY" value={result.summary.cancelled}/></MetricGrid>
    <section className="suite-panel panel"><TabBar value={status} onChange={setStatus} label="Lọc trạng thái" items={tabs.map(tab => ({ ...tab, count: tab.value === 'all' ? result.summary.total : tab.value === 'COMPLETED' ? result.summary.completed : result.summary.cancelled }))}/><div className="suite-filters"><label><Icon name="search"/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm mã hóa đơn, khách hàng, số điện thoại…"/></label><button onClick={() => { setQuery(''); setStatus('all'); }}>Xóa lọc</button></div>{error && <div className="ui-error" role="alert">{error} <button onClick={load}>Thử lại</button></div>}<div className="table-scroll"><table><thead><tr><th>Mã hóa đơn</th><th>Chi nhánh / POS</th><th>Khách hàng</th><th>Thu ngân</th><th>Thanh toán</th><th className="numeric">Tổng tiền</th><th>Trạng thái</th></tr></thead><tbody>{loading ? <tr><td colSpan={7}>Đang tải hóa đơn…</td></tr> : result.items.length === 0 ? <tr><td colSpan={7}>Chưa có hóa đơn phù hợp.</td></tr> : result.items.map(invoice => <tr key={invoice.id} className="clickable-row" tabIndex={0} onClick={() => router.push(`/hoa-don/${invoice.id}`)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); router.push(`/hoa-don/${invoice.id}`); } }}><td><strong className="document-code">{invoice.code}</strong><small>{dateTime(invoice.completedAt)}</small></td><td><strong>{invoice.store.name}</strong><small>{invoice.shift.posCode} · {invoice.shift.code}</small></td><td><strong>{invoice.customerName ?? 'Khách lẻ'}</strong><small>{invoice.customerPhone ?? 'Không có SĐT'}</small></td><td>{invoice.cashier.name}</td><td>{invoice.payments.map(payment => methodName[payment.method]).join(' + ')}</td><td className="numeric"><strong>{money(invoice.total)}</strong>{invoice.refundedAmount > 0 && <small className="negative">Đã hoàn {money(invoice.refundedAmount)}</small>}</td><td>{statusBadge(invoice)}</td></tr>)}</tbody></table></div><footer><span>Hiển thị {result.items.length} trên {result.pagination.total} hóa đơn</span><div className="suite-pagination"><button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>‹ Trước</button><span>Trang {page}/{result.pagination.totalPages}</span><button disabled={page >= result.pagination.totalPages} onClick={() => setPage(value => value + 1)}>Sau ›</button></div></footer></section>
  </div>;
}

export default function InvoicesPage() {
  return <Protected permission="invoices.read"><InvoiceListPage /></Protected>; }
