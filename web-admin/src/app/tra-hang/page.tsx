'use client';
import { downloadExcel } from '../../lib/excel-export';

import { useEffect, useState } from 'react';
import { Protected } from '../../components/auth-provider';
import { ActionButton, ActionLink } from '../../components/ui/action-button';
import { Icon } from '../../components/ui/icon';
import { MetricCard, MetricGrid } from '../../components/ui/metric-card';
import { StatusBadge } from '../../components/ui/status-badge';
import { TablePagination } from '../../components/ui/table-pagination';
import { useToast } from '../../components/ui/toast-provider';
import { errorMessage } from '../../lib/auth-api';
import * as invoiceApi from '../../lib/invoices-api';
import { getStores, type Store } from '../../lib/organization-api';

type MethodFilter = 'all' | invoiceApi.PaymentMethod;
const empty: invoiceApi.SalesReturnList = { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 }, summary: { total: 0, refundAmount: 0, restockedQuantity: 0, nonRestockedQuantity: 0 } };
const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(Math.round(value))} đ`;
const number = (value: number) => new Intl.NumberFormat('vi-VN').format(value);
const dateTime = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const methodNames: Record<invoiceApi.PaymentMethod, string> = { CASH: 'Tiền mặt', QR: 'QR / chuyển khoản', CARD: 'Thẻ' };

function SalesReturnsPage() {
  const { showToast } = useToast();
  const [result, setResult] = useState(empty);
  const [stores, setStores] = useState<Store[]>([]);
  const [q, setQ] = useState('');
  const [refundMethod, setRefundMethod] = useState<MethodFilter>('all');
  const [storeId, setStoreId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [invoiceQuery, setInvoiceQuery] = useState('');
  const [invoiceOptions, setInvoiceOptions] = useState<invoiceApi.Invoice[]>([]);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  useEffect(() => { getStores().then(rows => setStores(rows.filter(row => row.active))).catch(reason => setError(errorMessage(reason))); }, []);
  const load = async () => { setLoading(true); setError(''); try { setResult(await invoiceApi.getSalesReturns({ q: q.trim() || undefined, refundMethod, storeId: storeId || undefined, from: from || undefined, to: to || undefined, page })); } catch (reason) { setError(errorMessage(reason)); } finally { setLoading(false); } };
  useEffect(() => { const timer = window.setTimeout(load, 250); return () => window.clearTimeout(timer); }, [q, refundMethod, storeId, from, to, page]);
  useEffect(() => setPage(1), [q, refundMethod, storeId, from, to]);
  const reset = () => { setQ(''); setRefundMethod('all'); setStoreId(''); setFrom(''); setTo(''); };
  useEffect(() => {
    if (!createOpen) return;
    const timer = window.setTimeout(async () => {
      setInvoiceLoading(true);
      try { setInvoiceOptions((await invoiceApi.getInvoices({ q: invoiceQuery.trim() || undefined, status: 'COMPLETED', page: 1 })).items.filter(invoice => invoice.refundedAmount < invoice.total)); }
      catch (reason) { showToast(errorMessage(reason), 'error'); }
      finally { setInvoiceLoading(false); }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [createOpen, invoiceQuery, showToast]);
  const exportExcel = () => {
    const rows = [['LỊCH SỬ TRẢ HÀNG'], [], ['Mã phiếu', 'Hóa đơn', 'Thời gian', 'Chi nhánh', 'Khách hàng', 'Hoàn tiền', 'Phương thức', 'Người xử lý', 'Lý do'], ...result.items.map(item => [item.code, item.invoice.code, dateTime(item.createdAt), item.invoice.store.name, item.invoice.customerName ?? 'Khách lẻ', String(item.refundAmount), methodNames[item.refundMethod], item.processedBy.name, item.reason])];
    const csv = '\uFEFF' + rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n');
    void downloadExcel(csv, `tra-hang-trang-${page}.xls`); showToast(result.pagination.total > result.items.length ? 'Đã xuất các phiếu trả hàng của trang hiện tại.' : 'Đã xuất lịch sử trả hàng.');
  };

  return <div className="suite-page sales-returns-page"><header className="suite-heading"><div><div className="breadcrumb">Bán hàng <span>›</span> Trả hàng</div><h1>Lịch sử trả hàng và hoàn tiền</h1><p>Tra cứu phiếu trả theo hóa đơn gốc, phương thức hoàn tiền và tình trạng nhập lại kho.</p></div><div className="heading-actions"><button className="outline-button" onClick={exportExcel} disabled={loading || !result.items.length}><Icon name="download"/>Xuất Excel</button><ActionButton tone="approve" onClick={() => setCreateOpen(true)}>＋ Tạo phiếu trả hàng</ActionButton></div></header>
    <MetricGrid className="suite-kpis" label="Chỉ số trả hàng"><MetricCard tone="blue" label="TỔNG PHIẾU TRẢ" icon={<Icon name="receipt"/>} value={number(result.summary.total)} caption="Theo bộ lọc hiện tại"/><MetricCard tone="red" label="TỔNG TIỀN ĐÃ HOÀN" icon={<Icon name="wallet"/>} value={money(result.summary.refundAmount)} caption="Đã trừ khỏi doanh thu"/><MetricCard tone="green" label="ĐÃ NHẬP LẠI KHO" icon={<Icon name="store"/>} value={number(result.summary.restockedQuantity)} caption="Đơn vị hàng đủ điều kiện"/><MetricCard tone="amber" label="KHÔNG NHẬP KHO" icon={<Icon name="warning"/>} value={number(result.summary.nonRestockedQuantity)} caption="Hàng lỗi hoặc không đạt điều kiện"/></MetricGrid>
    <section className="panel report-filter-panel"><div className="filter-grid return-filter-grid"><label>Tìm kiếm<input value={q} onChange={event => setQ(event.target.value)} placeholder="Mã phiếu, hóa đơn, khách hàng…"/></label><label>Chi nhánh<select value={storeId} onChange={event => setStoreId(event.target.value)}><option value="">Tất cả chi nhánh</option>{stores.map(store => <option key={store.id} value={store.id}>{store.code} · {store.name}</option>)}</select></label><label>Hình thức hoàn<select value={refundMethod} onChange={event => setRefundMethod(event.target.value as MethodFilter)}><option value="all">Tất cả hình thức</option><option value="CASH">Tiền mặt</option><option value="QR">QR / chuyển khoản</option><option value="CARD">Thẻ</option></select></label><label>Từ ngày<input type="date" value={from} max={to || undefined} onChange={event => setFrom(event.target.value)}/></label><label>Đến ngày<input type="date" value={to} min={from || undefined} onChange={event => setTo(event.target.value)}/></label><button className="text-button" onClick={reset}>Xóa bộ lọc</button></div></section>
    {error && <div className="ui-error" role="alert">{error} <button onClick={load}>Thử lại</button></div>}
    <section className="suite-panel panel"><div className="table-scroll"><table><thead><tr><th>Phiếu trả / Thời gian</th><th>Hóa đơn gốc</th><th>Chi nhánh</th><th>Khách hàng</th><th>Sản phẩm trả</th><th>Nhập lại kho</th><th>Hoàn tiền</th><th>Người xử lý</th><th>Lý do</th><th>Thao tác</th></tr></thead><tbody>{loading ? <tr><td colSpan={10}>Đang tải lịch sử trả hàng…</td></tr> : result.items.length ? result.items.map(item => { const returnedQuantity = item.items.reduce((sum, line) => sum + line.quantity, 0); const restockedQuantity = item.items.filter(line => line.restock).reduce((sum, line) => sum + line.quantity, 0); return <tr key={item.id}><td><strong>{item.code}</strong><small>{dateTime(item.createdAt)}</small></td><td><strong>{item.invoice.code}</strong></td><td><strong>{item.invoice.store.name}</strong><small>{item.invoice.store.code}</small></td><td><strong>{item.invoice.customerName ?? 'Khách lẻ'}</strong><small>{item.invoice.customerPhone ?? 'Không có SĐT'}</small></td><td><strong>{number(returnedQuantity)} đơn vị</strong><small>{item.items.length} sản phẩm</small></td><td><StatusBadge tone={restockedQuantity === returnedQuantity ? 'green' : restockedQuantity ? 'amber' : 'neutral'}>{restockedQuantity}/{returnedQuantity}</StatusBadge></td><td><strong className="negative">{money(item.refundAmount)}</strong><small>{methodNames[item.refundMethod]}{item.refundReference ? ` · ${item.refundReference}` : ''}</small></td><td><strong>{item.processedBy.name}</strong><small>{item.processedBy.email}</small></td><td className="return-reason-cell">{item.reason}</td><td><ActionLink tone="view" href={`/hoa-don/${item.invoice.id}`}>Xem hóa đơn</ActionLink></td></tr>; }) : <tr><td colSpan={10}>Không có phiếu trả hàng phù hợp.</td></tr>}</tbody></table></div><TablePagination page={result.pagination.page} totalPages={result.pagination.totalPages} shown={result.items.length} total={result.pagination.total} noun="phiếu trả" onChange={setPage}/></section>
    {createOpen && <div className="ui-modal" onMouseDown={event => { if (event.target === event.currentTarget) setCreateOpen(false); }}><section className="ui-modal-card return-invoice-picker"><header><div><h2>Chọn hóa đơn cần trả hàng</h2><p>Chỉ hiển thị hóa đơn hoàn tất và vẫn còn sản phẩm có thể trả.</p></div><button type="button" aria-label="Đóng" onClick={() => setCreateOpen(false)}>×</button></header><div className="return-invoice-search"><Icon name="search"/><input autoFocus value={invoiceQuery} onChange={event => setInvoiceQuery(event.target.value)} placeholder="Tìm mã hóa đơn, tên hoặc số điện thoại khách hàng…"/></div><div className="return-invoice-list">{invoiceLoading ? <p>Đang tìm hóa đơn…</p> : invoiceOptions.length ? invoiceOptions.map(invoice => <article key={invoice.id}><div><strong>{invoice.code}</strong><small>{dateTime(invoice.completedAt)} · {invoice.store.name}</small></div><div><strong>{invoice.customerName ?? 'Khách lẻ'}</strong><small>{invoice.customerPhone ?? 'Không có SĐT'}</small></div><div><strong>{money(invoice.total - invoice.refundedAmount)}</strong><small>Còn có thể hoàn</small></div><ActionLink tone="approve" href={`/hoa-don/${invoice.id}?return=1`}>Chọn hóa đơn</ActionLink></article>) : <p>Không tìm thấy hóa đơn còn có thể trả hàng.</p>}</div><footer><ActionButton tone="more" onClick={() => setCreateOpen(false)}>Đóng</ActionButton></footer></section></div>}
  </div>;
}

export default function Page() { return <Protected permission="returns.read"><SalesReturnsPage/></Protected>; }
