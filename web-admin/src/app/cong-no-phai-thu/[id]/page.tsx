'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '../../../components/auth-provider';
import { CurrencyInput } from '../../../components/ui/currency-input';
import { ActionButton } from '../../../components/ui/action-button';
import { MetricCard, MetricGrid } from '../../../components/ui/metric-card';
import { StatusBadge, type StatusTone } from '../../../components/ui/status-badge';
import { useToast } from '../../../components/ui/toast-provider';
import { errorMessage } from '../../../lib/auth-api';
import * as api from '../../../lib/receivables-api';

const timingLabel: Record<api.ReceivableTiming, string> = { CURRENT: 'Trong hạn', DUE_SOON: 'Sắp đến hạn', OVERDUE: 'Quá hạn', PAID: 'Đã thu đủ' };
const timingTone: Record<api.ReceivableTiming, StatusTone> = { CURRENT: 'blue', DUE_SOON: 'amber', OVERDUE: 'red', PAID: 'green' };
const methodLabel: Record<api.CollectionMethod, string> = { CASH: 'Tiền mặt', QR: 'QR / chuyển khoản', CARD: 'Thẻ' };
const money = (value: number) => new Intl.NumberFormat('vi-VN').format(value) + ' đ';
const dateTime = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

export default function ReceivableDetailPage() {
  const { id } = useParams<{ id: string }>(); const { user } = useAuth(); const { showToast } = useToast();
  const [item, setItem] = useState<api.Receivable | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false); const [amount, setAmount] = useState(0); const [method, setMethod] = useState<api.CollectionMethod>('CASH');
  const [reference, setReference] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const canCollect = Boolean(user?.permissions.includes('receivables.pay') || user?.permissions.includes('*'));
  const load = async () => { setLoading(true); try { setError(''); setItem(await api.getReceivable(id)); } catch (reason) { setError(errorMessage(reason)); } finally { setLoading(false); } };
  useEffect(() => { load(); }, [id]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      const updated = await api.collectReceivable(id, { amount, method, reference: reference.trim() || undefined, note: note.trim() || undefined });
      setItem(updated); setOpen(false); setAmount(0); setReference(''); setNote(''); showToast(`Đã ghi nhận thu ${money(amount)} từ khách hàng.`);
    } catch (reason) { showToast(errorMessage(reason), 'error'); } finally { setBusy(false); }
  };
  if (loading) return <p>Đang tải công nợ…</p>;
  if (!item) return <div className="ui-error">{error} <button onClick={load}>Thử lại</button></div>;
  const progress = item.totalAmount ? Math.min(100, item.paidAmount * 100 / item.totalAmount) : 0;
  return <div className="suite-page payable-detail receivable-detail"><header className="suite-heading"><div><div className="breadcrumb"><Link href="/cong-no-phai-thu">Phải thu khách hàng</Link><span>›</span>{item.code}</div><div className="po-title"><h1>{item.code}</h1><StatusBadge tone={timingTone[item.timing]}>{timingLabel[item.timing]}</StatusBadge></div><p>{item.customer.code} · {item.customer.name}</p></div>{canCollect && item.outstandingAmount > 0 && <ActionButton tone="approve" onClick={() => { setAmount(item.outstandingAmount); setOpen(true); }}>Ghi nhận thu tiền</ActionButton>}</header>
    <MetricGrid className="suite-kpis"><MetricCard tone="blue" label="TỔNG PHÁT SINH" value={money(item.totalAmount)} /><MetricCard tone="green" label="ĐÃ THU" value={money(item.paidAmount)} /><MetricCard tone="red" label="CÒN PHẢI THU" value={money(item.outstandingAmount)} /><MetricCard tone="amber" label="NGÀY ĐẾN HẠN" value={new Intl.DateTimeFormat('vi-VN').format(new Date(item.dueDate))} /></MetricGrid>
    <section className="panel po-info"><div><span>Hóa đơn bán hàng</span><Link href={`/hoa-don/${item.invoice.id}`}><strong>{item.invoice.code}</strong></Link><small>{dateTime(item.invoice.completedAt)}</small></div><div><span>Chi nhánh</span><strong>{item.store.name}</strong><small>{item.store.code}</small></div><div><span>Khách hàng</span><Link href={`/khach-hang/${item.customer.id}`}><strong>{item.customer.name}</strong></Link><small>{item.customer.phone}{item.customer.email ? ` · ${item.customer.email}` : ''}</small></div><div><span>Tiến độ thu nợ</span><strong>{Math.round(progress)}%</strong><div className="po-progress"><span style={{ width: `${progress}%` }} /></div></div></section>
    <section className="suite-panel panel"><header className="po-section-title"><div><h2>Lịch sử thu tiền</h2><p>Mỗi lần thu được lưu riêng để đối soát với khách hàng.</p></div><StatusBadge tone="violet">{item.payments.length} giao dịch</StatusBadge></header><div className="table-scroll"><table><thead><tr><th>Mã phiếu thu</th><th>Thời gian</th><th>Hình thức</th><th>Tham chiếu</th><th>Người ghi nhận</th><th>Nội dung</th><th className="numeric">Số tiền</th></tr></thead><tbody>{!item.payments.length ? <tr><td colSpan={7}>Chưa có giao dịch thu tiền.</td></tr> : item.payments.map(payment => <tr key={payment.id}><td><strong>{payment.code}</strong></td><td>{dateTime(payment.paidAt)}</td><td><StatusBadge tone={payment.method === 'CASH' ? 'amber' : payment.method === 'QR' ? 'blue' : 'violet'}>{methodLabel[payment.method]}</StatusBadge></td><td>{payment.reference || '—'}</td><td><strong>{payment.paidBy.name}</strong><small>{payment.paidBy.email}</small></td><td>{payment.note || '—'}</td><td className="numeric positive"><strong>{money(payment.amount)}</strong></td></tr>)}</tbody></table></div></section>
    {open && <div className="ui-modal"><form className="ui-modal-card payable-payment-modal" onSubmit={submit}><header><div><h2>Ghi nhận thu tiền</h2><p>Số dư hiện tại: <strong>{money(item.outstandingAmount)}</strong></p></div><button type="button" aria-label="Đóng" onClick={() => setOpen(false)}>×</button></header><div className="form-grid"><label>Số tiền<CurrencyInput required min={1} max={item.outstandingAmount} value={String(amount)} onChange={value => setAmount(Number(value))} /></label><label>Hình thức<select value={method} onChange={event => setMethod(event.target.value as api.CollectionMethod)}><option value="CASH">Tiền mặt</option><option value="QR">QR / chuyển khoản</option><option value="CARD">Thẻ</option></select></label>{method !== 'CASH' && <label className="full">Mã tham chiếu<input required maxLength={100} value={reference} onChange={event => setReference(event.target.value)} placeholder="Mã giao dịch ngân hàng hoặc thẻ" /></label>}<label className="full">Ghi chú<textarea maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder="Nội dung thu tiền (không bắt buộc)" /></label></div><footer><ActionButton tone="more" onClick={() => setOpen(false)}>Đóng</ActionButton><ActionButton tone="approve" type="submit" disabled={busy}>{busy ? 'Đang ghi nhận…' : 'Xác nhận thu tiền'}</ActionButton></footer></form></div>}
  </div>;
}
