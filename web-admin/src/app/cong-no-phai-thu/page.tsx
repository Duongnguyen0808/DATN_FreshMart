'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionLink } from '../../components/ui/action-button';
import { Icon } from '../../components/ui/icon';
import { MetricCard, MetricGrid } from '../../components/ui/metric-card';
import { StatusBadge, type StatusTone } from '../../components/ui/status-badge';
import { TabBar, type TabItem } from '../../components/ui/tab-bar';
import { TablePagination } from '../../components/ui/table-pagination';
import { errorMessage } from '../../lib/auth-api';
import { getCustomers, type Customer } from '../../lib/customers-api';
import { getStores, type Store } from '../../lib/organization-api';
import * as api from '../../lib/receivables-api';

type Filter = 'all' | api.ReceivableStatus | 'DUE_SOON' | 'OVERDUE';
const empty: api.ReceivableList = { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 }, summary: { totalReceivable: 0, collected: 0, dueSoon: 0, overdue: 0 } };
const tabs: TabItem<Filter>[] = [
  { value: 'all', label: 'Tất cả', tone: 'blue' }, { value: 'OPEN', label: 'Chưa thu', tone: 'amber' },
  { value: 'PARTIALLY_PAID', label: 'Đã thu một phần', tone: 'violet' }, { value: 'DUE_SOON', label: 'Sắp đến hạn', tone: 'cyan' },
  { value: 'OVERDUE', label: 'Quá hạn', tone: 'red' }, { value: 'PAID', label: 'Đã thu đủ', tone: 'green' },
];
const timingLabel: Record<api.ReceivableTiming, string> = { CURRENT: 'Trong hạn', DUE_SOON: 'Sắp đến hạn', OVERDUE: 'Quá hạn', PAID: 'Đã thu đủ' };
const timingTone: Record<api.ReceivableTiming, StatusTone> = { CURRENT: 'blue', DUE_SOON: 'amber', OVERDUE: 'red', PAID: 'green' };
const money = (value: number) => new Intl.NumberFormat('vi-VN').format(value) + ' đ';
const date = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' }).format(new Date(value));

export default function ReceivablesPage() {
  const router = useRouter();
  const [result, setResult] = useState(empty); const [customers, setCustomers] = useState<Customer[]>([]); const [stores, setStores] = useState<Store[]>([]);
  const [q, setQ] = useState(''); const [status, setStatus] = useState<Filter>('all'); const [customerId, setCustomerId] = useState(''); const [storeId, setStoreId] = useState('');
  const [page, setPage] = useState(1); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const load = async () => { setLoading(true); setError(''); try { setResult(await api.getReceivables({ q: q.trim() || undefined, status, customerId: customerId || undefined, storeId: storeId || undefined, page })); } catch (reason) { setError(errorMessage(reason)); } finally { setLoading(false); } };
  useEffect(() => { Promise.all([getCustomers({ active: 'all', pageSize: 100 }), getStores()]).then(([customerResult, storeResult]) => { setCustomers(customerResult.items); setStores(storeResult); }).catch(reason => setError(errorMessage(reason))); }, []);
  useEffect(() => { const timer = setTimeout(load, 250); return () => clearTimeout(timer); }, [q, status, customerId, storeId, page]);
  useEffect(() => setPage(1), [q, status, customerId, storeId]);
  const clear = () => { setQ(''); setStatus('all'); setCustomerId(''); setStoreId(''); };
  return <div className="suite-page payable-page receivable-page"><header className="suite-heading"><div><div className="breadcrumb">Tài chính <span>›</span> Phải thu khách hàng</div><h1>Công nợ phải thu khách hàng</h1><p>Theo dõi các hóa đơn bán chịu, hạn thanh toán và lịch sử thu tiền.</p></div></header>
    <MetricGrid className="suite-kpis"><MetricCard tone="red" label="TỔNG CÒN PHẢI THU" value={money(result.summary.totalReceivable)} /><MetricCard tone="green" label="ĐÃ THU" value={money(result.summary.collected)} /><MetricCard tone="amber" label="SẮP ĐẾN HẠN" value={money(result.summary.dueSoon)} /><MetricCard tone="violet" label="QUÁ HẠN" value={money(result.summary.overdue)} /></MetricGrid>
    <section className="suite-panel panel"><TabBar value={status} onChange={setStatus} items={tabs} /><div className="suite-filters"><label><Icon name="search" /><input value={q} onChange={event => setQ(event.target.value)} placeholder="Tìm mã công nợ, hóa đơn, khách hàng..." /></label><select value={customerId} onChange={event => setCustomerId(event.target.value)}><option value="">Tất cả khách hàng</option>{customers.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select><select value={storeId} onChange={event => setStoreId(event.target.value)}><option value="">Tất cả chi nhánh</option>{stores.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select><button onClick={clear}>Xóa lọc</button></div>{error && <div className="ui-error">{error} <button onClick={load}>Thử lại</button></div>}
      <div className="table-scroll"><table><thead><tr><th>Mã công nợ</th><th>Khách hàng</th><th>Hóa đơn</th><th>Chi nhánh</th><th className="numeric">Phát sinh</th><th className="numeric">Đã thu</th><th className="numeric">Còn lại</th><th>Đến hạn</th><th>Trạng thái</th></tr></thead><tbody>{loading ? <tr><td colSpan={9}>Đang tải công nợ…</td></tr> : !result.items.length ? <tr><td colSpan={9}>Chưa có khoản phải thu phù hợp.</td></tr> : result.items.map(item => <tr key={item.id} className="clickable-row" tabIndex={0} onClick={() => router.push(`/cong-no-phai-thu/${item.id}`)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); router.push(`/cong-no-phai-thu/${item.id}`); } }}><td><strong className="document-code">{item.code}</strong></td><td><strong>{item.customer.name}</strong><small>{item.customer.code} · {item.customer.phone}</small></td><td><strong>{item.invoice.code}</strong><small>{date(item.invoice.completedAt)}</small></td><td>{item.store.name}</td><td className="numeric">{money(item.totalAmount)}</td><td className="numeric positive">{money(item.paidAmount)}</td><td className="numeric negative"><strong>{money(item.outstandingAmount)}</strong></td><td>{date(item.dueDate)}</td><td><StatusBadge tone={timingTone[item.timing]}>{timingLabel[item.timing]}</StatusBadge></td></tr>)}</tbody></table></div>
      <TablePagination page={page} totalPages={result.pagination.totalPages} shown={result.items.length} total={result.pagination.total} noun="khoản phải thu" onChange={setPage} />
    </section>
  </div>;
}
