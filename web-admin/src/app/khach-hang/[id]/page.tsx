'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Protected, useAuth } from '../../../components/auth-provider';
import { ActionButton, ActionLink } from '../../../components/ui/action-button';
import { CurrencyInput } from '../../../components/ui/currency-input';
import { Icon } from '../../../components/ui/icon';
import { MetricCard, MetricGrid } from '../../../components/ui/metric-card';
import { StatusBadge } from '../../../components/ui/status-badge';
import { TabBar, type TabItem } from '../../../components/ui/tab-bar';
import { useToast } from '../../../components/ui/toast-provider';
import { errorMessage } from '../../../lib/auth-api';
import * as api from '../../../lib/customers-api';
import * as receivableApi from '../../../lib/receivables-api';

type CustomerTab = 'profile' | 'receivables' | 'payments' | 'sales';
const customerTabs: TabItem<CustomerTab>[] = [
  { value: 'profile', label: 'Tổng quan', tone: 'blue' },
  { value: 'receivables', label: 'Nợ cần thu', tone: 'red' },
  { value: 'payments', label: 'Thanh toán', tone: 'green' },
  { value: 'sales', label: 'Lịch sử bán hàng', tone: 'violet' },
];

const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(Math.round(value))} đ`;
const dateTime = (value: string | null) => value
  ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  : 'Chưa phát sinh';

function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { showToast, confirmAction } = useToast();
  const canManage = !!user && (user.permissions.includes('customers.manage') || user.permissions.includes('*'));
  const [customer, setCustomer] = useState<api.CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<CustomerTab>('profile');
  const [receivables, setReceivables] = useState<receivableApi.Receivable[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<receivableApi.CollectionMethod>('CASH');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [paying, setPaying] = useState(false);
  const [paymentError, setPaymentError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setCustomer(await api.getCustomer(id));
      if (user?.permissions.includes('receivables.read') || user?.permissions.includes('*')) {
        setReceivables((await receivableApi.getReceivables({ customerId: id, page: 1, pageSize: 100 })).items);
      }
    }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [id, user?.id]);

  const changeStatus = async () => {
    if (!customer) return;
    const active = !customer.active;
    if (!await confirmAction(active ? `Mở lại hồ sơ “${customer.name}”?` : `Ngừng hồ sơ “${customer.name}”?`)) return;
    setChanging(true);
    try {
      await api.setCustomerStatus(customer.id, active);
      showToast(active ? 'Đã mở lại hồ sơ khách hàng.' : 'Đã ngừng hồ sơ khách hàng.');
      await load();
    } catch (reason) { showToast(errorMessage(reason), 'error'); }
    finally { setChanging(false); }
  };

  if (loading) return <div className="suite-page"><p role="status">Đang tải hồ sơ khách hàng…</p></div>;
  if (error || !customer) return <div className="suite-page"><div className="ui-error" role="alert">{error || 'Không tìm thấy khách hàng.'} <button onClick={load}>Thử lại</button></div><p className="detail-back"><Link href="/khach-hang">‹ Quay lại danh sách</Link></p></div>;

  const selectedAllocations = receivables.filter(row => (allocations[row.id] ?? 0) > 0).map(row => ({ receivableId: row.id, amount: allocations[row.id]! }));
  const paymentTotal = selectedAllocations.reduce((sum, row) => sum + row.amount, 0);
  const bankQrConfig = { bankId: process.env.NEXT_PUBLIC_VIETQR_BANK_ID ?? '', accountNo: process.env.NEXT_PUBLIC_VIETQR_ACCOUNT_NO ?? '', accountName: process.env.NEXT_PUBLIC_VIETQR_ACCOUNT_NAME ?? '' };
  const qrReady = Boolean(bankQrConfig.bankId && bankQrConfig.accountNo && bankQrConfig.accountName);
  const qrMemo = `THU${customer.code.replace(/[^a-z0-9]/gi, '').slice(-12)}`;
  const qrImage = qrReady && paymentMethod === 'QR' && paymentTotal > 0 ? `https://img.vietqr.io/image/${encodeURIComponent(bankQrConfig.bankId)}-${encodeURIComponent(bankQrConfig.accountNo)}-compact2.png?amount=${paymentTotal}&addInfo=${encodeURIComponent(qrMemo)}&accountName=${encodeURIComponent(bankQrConfig.accountName)}` : '';
  const submitCollection = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setPaying(true); setPaymentError('');
    try {
      await receivableApi.collectCustomerReceivables(customer.id, { method: paymentMethod, reference: paymentMethod === 'CASH' ? undefined : paymentReference.trim() || qrMemo, note: paymentNote.trim() || undefined, allocations: selectedAllocations });
      setPayOpen(false); setAllocations({}); setPaymentReference(''); setPaymentNote(''); showToast('Đã ghi nhận thanh toán công nợ.'); await load();
    } catch (reason) { setPaymentError(errorMessage(reason)); }
    finally { setPaying(false); }
  };

  return <div className="suite-page customer-detail-page">
    <p className="detail-back"><Link href="/khach-hang">‹ Quay lại danh sách khách hàng</Link></p>
    <header className="detail-heading"><div><div className="breadcrumb">Bán hàng <span>›</span> Khách hàng <span>›</span> {customer.code}</div><h1>{customer.name}</h1><p>{customer.code} · Hồ sơ được cập nhật lúc {dateTime(customer.updatedAt)}</p></div><div><StatusBadge tone={customer.active ? 'green' : 'neutral'}>{customer.active ? 'Đang hoạt động' : 'Đã ngừng'}</StatusBadge>{canManage && <ActionButton tone={customer.active ? 'danger' : 'approve'} disabled={changing} onClick={changeStatus}>{changing ? 'Đang lưu…' : customer.active ? 'Ngừng hồ sơ' : 'Mở lại hồ sơ'}</ActionButton>}</div></header>

    <MetricGrid className="detail-kpis" label="Chỉ số khách hàng"><MetricCard tone="blue" label="TỔNG ĐƠN ĐÃ HOÀN TẤT" icon={<Icon name="receipt" />} value={customer.summary.orderCount} caption="Tính trên toàn bộ lịch sử" /><MetricCard tone="green" label="TỔNG CHI TIÊU" icon={<Icon name="wallet" />} value={money(customer.summary.totalSpent)} caption="Không tính hóa đơn đã hủy" /><MetricCard tone="amber" label="GIÁ TRỊ ĐƠN TRUNG BÌNH" icon={<Icon name="chart" />} value={money(customer.summary.orderCount ? customer.summary.totalSpent / customer.summary.orderCount : 0)} caption="Theo các đơn hoàn tất" /><MetricCard tone="violet" label="LẦN MUA GẦN NHẤT" icon={<Icon name="clock" />} value={dateTime(customer.summary.lastPurchaseAt)} caption="Thời điểm hoàn tất hóa đơn" /></MetricGrid>

    {(user?.permissions.includes('receivables.pay') || user?.permissions.includes('*')) && receivables.some(row => row.outstandingAmount > 0) && <ActionButton tone="approve" onClick={() => { setAllocations({}); setPaymentError(''); setPayOpen(true); }}>Thanh toán công nợ</ActionButton>}
    <TabBar className="detail-section-tabs" value={tab} onChange={setTab} label="Nội dung hồ sơ khách hàng" items={customerTabs.map(item => ({ ...item, count: item.value === 'receivables' ? receivables.filter(row => row.outstandingAmount > 0).length : item.value === 'payments' ? receivables.reduce((sum, row) => sum + row.payments.length, 0) : item.value === 'sales' ? customer.invoices.length : undefined }))}/>

    {tab === 'profile' && <section className="detail-grid customer-profile-grid"><article><h2>Thông tin liên hệ</h2><dl><div><dt>Mã khách hàng</dt><dd><code>{customer.code}</code></dd></div><div><dt>Họ và tên</dt><dd>{customer.name}</dd></div><div><dt>Số điện thoại</dt><dd>{customer.phone}</dd></div><div><dt>Email</dt><dd>{customer.email ?? 'Chưa cập nhật'}</dd></div><div><dt>Địa chỉ nhận hàng</dt><dd>{customer.address ?? 'Chưa cập nhật'}</dd></div></dl></article><article><h2>Ghi chú</h2><div className="customer-detail-note">{customer.note || 'Chưa có ghi chú cho khách hàng này.'}</div></article></section>}

    {tab === 'receivables' && <section className="detail-table"><header><h2>Nợ cần thu từ khách hàng</h2><p>Theo dõi số đã thu, số còn lại và hạn thanh toán của từng hóa đơn bán chịu.</p></header><div className="table-scroll"><table><thead><tr><th>Mã công nợ</th><th>Hóa đơn</th><th>Chi nhánh</th><th>Hạn thanh toán</th><th className="numeric">Tổng nợ</th><th className="numeric">Đã thu</th><th className="numeric">Còn lại</th><th>Thao tác</th></tr></thead><tbody>{receivables.length ? receivables.map(row => <tr key={row.id}><td><code>{row.code}</code></td><td>{row.invoice.code}</td><td>{row.store.name}</td><td>{dateTime(row.dueDate)}</td><td className="numeric">{money(row.totalAmount)}</td><td className="numeric positive">{money(row.paidAmount)}</td><td className="numeric negative"><strong>{money(row.outstandingAmount)}</strong></td><td><ActionLink tone={row.outstandingAmount > 0 ? 'approve' : 'view'} href={`/cong-no-phai-thu/${row.id}`}>{row.outstandingAmount > 0 ? 'Thu tiền' : 'Xem'}</ActionLink></td></tr>) : <tr><td colSpan={8}>Khách hàng không có khoản nợ phải thu.</td></tr>}</tbody></table></div></section>}

    {tab === 'payments' && <section className="detail-table"><header><h2>Lịch sử thanh toán công nợ</h2><p>Các lần thu tiền đã ghi nhận cho khách hàng này.</p></header><div className="table-scroll"><table><thead><tr><th>Mã thanh toán</th><th>Mã công nợ</th><th>Thời gian</th><th>Phương thức</th><th>Tham chiếu</th><th>Người thu</th><th className="numeric">Số tiền</th></tr></thead><tbody>{receivables.flatMap(row => row.payments.map(payment => ({ row, payment }))).length ? receivables.flatMap(row => row.payments.map(payment => ({ row, payment }))).map(({ row, payment }) => <tr key={payment.id}><td><code>{payment.code}</code></td><td><Link href={`/cong-no-phai-thu/${row.id}`}>{row.code}</Link></td><td>{dateTime(payment.paidAt)}</td><td>{payment.method}</td><td>{payment.reference || '—'}</td><td>{payment.paidBy.name}</td><td className="numeric positive"><strong>{money(payment.amount)}</strong></td></tr>) : <tr><td colSpan={7}>Chưa có lần thanh toán công nợ nào.</td></tr>}</tbody></table></div></section>}

    {tab === 'sales' && <section className="detail-table customer-invoices"><header><h2>Lịch sử hóa đơn gần nhất</h2><p>Hiển thị tối đa 50 hóa đơn, gồm cả hóa đơn đã hủy để phục vụ truy vết.</p></header><div className="table-scroll"><table><thead><tr><th>Mã hóa đơn</th><th>Thời gian</th><th>Chi nhánh</th><th>Thu ngân</th><th>Trạng thái</th><th className="numeric">Thành tiền</th><th>Thao tác</th></tr></thead><tbody>{customer.invoices.length ? customer.invoices.map(invoice => <tr key={invoice.id}><td><code>{invoice.code}</code></td><td>{dateTime(invoice.completedAt)}</td><td><strong>{invoice.store.name}</strong><small>{invoice.store.code}</small></td><td>{invoice.cashier.name}</td><td><StatusBadge tone={invoice.status === 'COMPLETED' ? 'green' : 'red'}>{invoice.status === 'COMPLETED' ? 'Hoàn tất' : 'Đã hủy'}</StatusBadge></td><td className="numeric"><strong>{money(invoice.total)}</strong></td><td><ActionLink tone="view" href={`/hoa-don/${invoice.id}`}>Xem hóa đơn</ActionLink></td></tr>) : <tr><td colSpan={7}>Khách hàng chưa có hóa đơn được liên kết.</td></tr>}</tbody></table></div></section>}
    {payOpen && <div className="ui-modal" onMouseDown={event => { if (event.target === event.currentTarget && !paying) setPayOpen(false); }}><form className="ui-modal-card" onSubmit={submitCollection}><header><div><h2>Thanh toán công nợ khách hàng</h2><p>{customer.name} · Nợ hiện tại {money(receivables.reduce((sum, row) => sum + row.outstandingAmount, 0))}</p></div><button type="button" disabled={paying} onClick={() => setPayOpen(false)}>×</button></header><div className="form-grid"><fieldset className="full"><legend>Chọn hóa đơn và phân bổ tiền</legend>{receivables.filter(row => row.outstandingAmount > 0).map(row => <label key={row.id} className="payment-allocation-row"><input type="checkbox" checked={(allocations[row.id] ?? 0) > 0} onChange={event => setAllocations(current => ({ ...current, [row.id]: event.target.checked ? row.outstandingAmount : 0 }))}/><span>{row.invoice.code} · Còn nợ {money(row.outstandingAmount)}</span>{(allocations[row.id] ?? 0) > 0 && <CurrencyInput min={1} max={row.outstandingAmount} value={String(allocations[row.id])} onChange={value => setAllocations(current => ({ ...current, [row.id]: Number(value) }))}/>}</label>)}</fieldset><div className="full"><strong>Tổng khách trả: {money(paymentTotal)}</strong></div><label className="full">Phương thức<select value={paymentMethod} onChange={event => setPaymentMethod(event.target.value as receivableApi.CollectionMethod)}><option value="CASH">Tiền mặt</option><option value="QR">QR / chuyển khoản</option><option value="CARD">Thẻ</option></select></label>{paymentMethod !== 'CASH' && <label className="full">Mã tham chiếu<input value={paymentReference} onChange={event => setPaymentReference(event.target.value)} placeholder={paymentMethod === 'QR' ? qrMemo : 'Mã giao dịch'}/></label>}<label className="full">Người thu<input value={user?.name ?? ''} readOnly/></label><label className="full">Ghi chú<textarea value={paymentNote} onChange={event => setPaymentNote(event.target.value)} maxLength={500}/></label>{paymentMethod === 'QR' && <div className="full">{qrImage ? <div className="sale-bank-qr"><div><strong>Quét mã để thanh toán</strong><span>Số tiền: {money(paymentTotal)}</span><span>Nội dung: {qrMemo}</span><span>Người nhận: {bankQrConfig.accountName}</span></div><img src={qrImage} alt="Mã QR thanh toán công nợ"/></div> : <p className="ui-error">Chưa cấu hình tài khoản VietQR. Thiết lập NEXT_PUBLIC_VIETQR_BANK_ID, NEXT_PUBLIC_VIETQR_ACCOUNT_NO và NEXT_PUBLIC_VIETQR_ACCOUNT_NAME để tạo mã.</p>}</div>}{paymentError && <div className="ui-error full" role="alert">{paymentError}</div>}</div><footer><button type="button" className="outline-button" disabled={paying} onClick={() => setPayOpen(false)}>Đóng</button><button className="primary-button" disabled={paying || paymentTotal <= 0 || (paymentMethod === 'QR' && !qrReady)}>{paying ? 'Đang lưu...' : 'Xác nhận thanh toán'}</button></footer></form></div>}
  </div>;
}

export default function Page() { return <Protected permission="customers.read"><CustomerDetailPage /></Protected>; }
