'use client';
import { ProductIdentity } from '../../../components/ui/product-image';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Protected, useAuth } from '../../../components/auth-provider';
import { ActionButton } from '../../../components/ui/action-button';
import { StatusBadge } from '../../../components/ui/status-badge';
import { useToast } from '../../../components/ui/toast-provider';
import { errorMessage } from '../../../lib/auth-api';
import * as api from '../../../lib/invoices-api';
import { printInvoice } from '../../../lib/print-invoice';

const money = (value: number) => new Intl.NumberFormat('vi-VN').format(Math.round(value)) + ' đ';
const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
const paymentName: Record<api.PaymentMethod, string> = { CASH: 'Tiền mặt', QR: 'QR / chuyển khoản', CARD: 'Thẻ' };

function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { showToast } = useToast();
  const canReturn = !!user && (user.permissions.includes('returns.manage') || user.permissions.includes('*'));
  const canCancel = !!user && (user.permissions.includes('invoices.cancel') || user.permissions.includes('*'));
  const [invoice, setInvoice] = useState<api.Invoice | null>(null);
  const [error, setError] = useState('');
  const [returnOpen, setReturnOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const load = async () => { try { setError(''); setInvoice(await api.getInvoice(id)); } catch (reason) { setError(errorMessage(reason)); } };
  useEffect(() => { void load(); }, [id]);
  useEffect(() => {
    if (!invoice || typeof window === 'undefined' || new URLSearchParams(window.location.search).get('return') !== '1') return;
    if (invoice.status === 'COMPLETED' && invoice.refundedAmount < invoice.total) openReturn();
    window.history.replaceState({}, '', window.location.pathname);
  }, [invoice?.id]);

  const returned = useMemo(() => {
    const values = new Map<string, number>();
    for (const salesReturn of invoice?.salesReturns ?? []) for (const item of salesReturn.items) values.set(item.invoiceItemId, (values.get(item.invoiceItemId) ?? 0) + item.quantity);
    return values;
  }, [invoice]);
  const returnableItems = invoice?.items.map(item => ({ ...item, remaining: item.quantity - (returned.get(item.id) ?? 0) })).filter(item => item.remaining > 0) ?? [];
  const refundPreview = invoice ? returnableItems.reduce((sum, item) => sum + Math.round(item.unitPrice * (invoice.subtotal ? invoice.total / invoice.subtotal : 0)) * (quantities[item.id] ?? 0), 0) : 0;
  const openReturn = () => { setQuantities({}); setRestock(Object.fromEntries(returnableItems.map(item => [item.id, true]))); setReturnOpen(true); setError(''); };
  const submitReturn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!invoice) return;
    const data = new FormData(event.currentTarget);
    const items = returnableItems.filter(item => (quantities[item.id] ?? 0) > 0).map(item => ({ invoiceItemId: item.id, quantity: quantities[item.id]!, restock: restock[item.id] ?? true }));
    if (!items.length) { setError('Vui lòng chọn ít nhất một sản phẩm và nhập số lượng trả.'); return; }
    setBusy(true); setError('');
    try {
      const updated = await api.createSalesReturn(invoice.id, { reason: String(data.get('reason')), refundMethod: data.get('refundMethod') as api.PaymentMethod, items });
      setInvoice(updated); setReturnOpen(false); showToast(`Đã tạo phiếu trả hàng và ghi nhận hoàn ${money(updated.refundedAmount - invoice.refundedAmount)}.`);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  const submitCancel = async (event: React.FormEvent) => { event.preventDefault(); if (!invoice) return; setBusy(true); setError(''); try { const updated = await api.cancelInvoice(invoice.id, cancelReason.trim()); setInvoice(updated); setCancelOpen(false); setCancelReason(''); showToast(`Đã hủy hóa đơn ${updated.code} và ghi nhận hoàn tồn kho.`); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); } };

  if (error && !invoice) return <div className="ui-error" role="alert">{error} <button onClick={load}>Thử lại</button></div>;
  if (!invoice) return <p role="status">Đang tải chi tiết hóa đơn…</p>;
  const fullyReturned = invoice.refundedAmount >= invoice.total;

  return <div className="suite-page invoice-detail-page"><div className="detail-back"><Link href="/hoa-don">‹ Quay lại danh sách hóa đơn</Link></div><header className="detail-heading"><div><div className="breadcrumb">Bán hàng <span>›</span> Hóa đơn <span>›</span> {invoice.code}</div><h1>{invoice.code}</h1><p>{invoice.store.name} · {invoice.shift.posCode} · {dateTime(invoice.completedAt)}</p></div><div><StatusBadge tone={invoice.status === 'CANCELLED' ? 'red' : fullyReturned ? 'violet' : invoice.refundedAmount > 0 ? 'amber' : 'green'}>{invoice.status === 'CANCELLED' ? 'Đã hủy' : fullyReturned ? 'Đã trả toàn bộ' : invoice.refundedAmount > 0 ? 'Đã trả một phần' : 'Hoàn tất'}</StatusBadge><ActionButton tone="print" onClick={() => printInvoice(invoice)}>In bill</ActionButton>{canReturn && invoice.status === 'COMPLETED' && !fullyReturned && returnableItems.length > 0 && <ActionButton tone="danger" onClick={openReturn}>Tạo phiếu trả hàng</ActionButton>}{canCancel && invoice.status === 'COMPLETED' && invoice.salesReturns.length === 0 && invoice.shift.status === 'OPEN' && <ActionButton tone="danger" onClick={() => { setError(''); setCancelOpen(true); }}>Hủy hóa đơn</ActionButton>}</div></header>
    <div className="detail-grid"><article><h2>Thông tin giao dịch</h2><dl><div><dt>Khách hàng</dt><dd>{invoice.customerName ?? 'Khách lẻ'}</dd></div><div><dt>Số điện thoại</dt><dd>{invoice.customerPhone ?? '—'}</dd></div><div><dt>Thu ngân</dt><dd>{invoice.cashier.name}</dd></div><div><dt>Ca làm việc</dt><dd>{invoice.shift.code} · {invoice.shift.name}</dd></div><div><dt>Ghi chú</dt><dd>{invoice.note ?? '—'}</dd></div></dl></article><article><h2>Thanh toán</h2><dl>{invoice.payments.map(payment => <div key={payment.id}><dt>{paymentName[payment.method]}{payment.reference ? ` · ${payment.reference}` : ''}</dt><dd>{money(payment.amount)}</dd></div>)}{invoice.creditAmount > 0 && <div><dt>Bán chịu</dt><dd>{invoice.receivable ? <Link href={`/cong-no-phai-thu/${invoice.receivable.id}`}><strong>{money(invoice.creditAmount)} · {invoice.receivable.code}</strong></Link> : money(invoice.creditAmount)}</dd></div>}<div><dt>Tiền hàng</dt><dd>{money(invoice.subtotal)}</dd></div><div><dt>Giảm giá</dt><dd>{money(invoice.discount)}</dd></div><div><dt>Tổng thanh toán</dt><dd><strong>{money(invoice.total)}</strong></dd></div><div><dt>Đã hoàn</dt><dd className="negative"><strong>{money(invoice.refundedAmount)}</strong></dd></div><div><dt>Doanh thu còn lại</dt><dd className="positive"><strong>{money(invoice.total - invoice.refundedAmount)}</strong></dd></div></dl></article></div>
    <section className="detail-table"><header><h2>Sản phẩm bán ra</h2><p>Mã sản phẩm là mã nội bộ; PRD = Product (sản phẩm), tiền tố trong mã dữ liệu mẫu. Số có thể trả đã trừ các phiếu trả trước đó.</p></header><div className="table-scroll"><table><thead><tr><th>Mã sản phẩm</th><th>Sản phẩm</th><th>ĐVT</th><th className="numeric">Đã mua</th><th className="numeric">Đã trả</th><th className="numeric">Còn có thể trả</th><th className="numeric">Đơn giá</th><th className="numeric">Thành tiền</th></tr></thead><tbody>{invoice.items.map(item => { const returnedQuantity = returned.get(item.id) ?? 0; return <tr key={item.id}><td><strong className="document-code">{item.productCode}</strong></td><td><div className="invoice-product-cell">{item.sku.product.imageUrl ? <img src={item.sku.product.imageUrl} alt="" /> : <span aria-hidden="true">{item.productName.slice(0,1)}</span>}<strong>{item.productName}</strong></div></td><td>{item.unit}</td><td className="numeric">{item.quantity}</td><td className="numeric negative">{returnedQuantity}</td><td className="numeric positive"><strong>{item.quantity - returnedQuantity}</strong></td><td className="numeric">{money(item.unitPrice)}</td><td className="numeric"><strong>{money(item.lineTotal)}</strong></td></tr>; })}</tbody></table></div></section>
    {invoice.salesReturns.length > 0 && <section className="detail-table return-history"><header><h2>Lịch sử trả hàng và hoàn tiền</h2><p>Mỗi phiếu lưu người xử lý, phương thức hoàn và trạng thái nhập lại kho.</p></header>{invoice.salesReturns.map(salesReturn => <article key={salesReturn.id}><div><strong>{salesReturn.code}</strong><span>{dateTime(salesReturn.createdAt)} · {salesReturn.processedBy.name}</span><StatusBadge tone="red">Hoàn {money(salesReturn.refundAmount)}</StatusBadge></div><p><b>Lý do:</b> {salesReturn.reason} · <b>Hình thức:</b> {paymentName[salesReturn.refundMethod]}{salesReturn.refundReference ? ` · ${salesReturn.refundReference}` : ''}</p><ul>{salesReturn.items.map(item => <li key={item.id}><span>{item.invoiceItem.productCode} · {item.invoiceItem.productName}</span><strong>{item.quantity} {item.invoiceItem.unit} · {money(item.lineRefund)}</strong><StatusBadge tone={item.restock ? 'green' : 'neutral'}>{item.restock ? 'Đã nhập lại kho' : 'Không nhập kho'}</StatusBadge></li>)}</ul></article>)}</section>}
    {invoice.status === 'CANCELLED' && <section className="invoice-cancel-note"><strong>Hóa đơn đã hủy</strong><p>{invoice.cancellationReason}</p><small>{dateTime(invoice.cancelledAt)} · {invoice.cancelledBy?.name ?? 'Người dùng hệ thống'}</small></section>}
    <section className="invoice-print-receipt" aria-label={"H\u00f3a \u0111\u01a1n in"}>
      <header className="receipt-brand" style={{ display: 'grid', gridTemplateColumns: '1fr', justifyItems: 'center', gap: 3, textAlign: 'center' }}><img src="/logo.png" alt="" style={{ display: 'block', width: 52, height: 52, objectFit: 'contain' }}/><strong style={{ display: 'block', fontSize: 20, lineHeight: 1.1 }}>FreshMart</strong><span style={{ display: 'block', fontSize: 11 }}>H\u00d3A \u0110\u01a0N B\u00c1N H\u00c0NG</span><b style={{ display: 'block', fontSize: 13 }}>{invoice.code}</b></header>
      <h2 className="receipt-copy-title" style={{ margin: '9px 0 5px', textAlign: 'center', fontSize: 13 }}>IN L\u1ea0I - H\u00d3A \u0110\u01a0N THANH TO\u00c1N</h2>
      <p className="receipt-store" style={{ margin: '5px 0', textAlign: 'center', fontWeight: 700 }}>{invoice.store.name} - {invoice.shift.posCode}</p>
      <div className="receipt-meta" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 5, margin: '8px 0', padding: '7px 0', borderTop: '1px solid #777', borderBottom: '1px solid #777' }}><div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: '3px 5px', alignContent: 'start' }}><span>M\u00e3 H\u0110</span><b>#{invoice.code}</b><span>Kh\u00e1ch</span><b>{invoice.customerName || 'Kh\u00e1ch l\u1ebb'}</b><span>S\u0110T</span><b>{invoice.customerPhone || '\u2014'}</b></div><div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: '3px 5px', alignContent: 'start' }}><span>Thu ng\u00e2n</span><b>{invoice.cashier.name}</b><span>Ng\u00e0y gi\u1edd</span><b>{dateTime(invoice.completedAt)}</b></div></div>
      <table><thead><tr><th>T\u00ean h\u00e0ng / SL \u00d7 \u0110\u01a1n gi\u00e1</th><th>Th\u00e0nh ti\u1ec1n</th></tr></thead><tbody>{invoice.items.map(item => <tr key={item.id}><td><strong>{item.productName}</strong><small>{item.productCode} \u00b7 {item.quantity} {item.unit} \u00d7 {money(item.unitPrice)}</small></td><td>{money(item.lineTotal)}</td></tr>)}</tbody></table>
      <p className="receipt-item-count">T\u1ed5ng s\u1ed1 m\u1eb7t h\u00e0ng: {invoice.items.reduce((sum, item) => sum + item.quantity, 0)}</p>
      <dl><div><dt>Ti\u1ec1n h\u00e0ng</dt><dd>{money(invoice.subtotal)}</dd></div><div><dt>Gi\u1ea3m gi\u00e1</dt><dd>{money(invoice.discount)}</dd></div><div className="receipt-total"><dt>T\u1ed4NG THANH TO\u00c1N</dt><dd>{money(invoice.total)}</dd></div>{invoice.payments.map(payment => <div key={payment.id}><dt>{paymentName[payment.method]}</dt><dd>{money(payment.amount)}</dd></div>)}{invoice.creditAmount > 0 && <div><dt>C\u00f2n n\u1ee3</dt><dd>{money(invoice.creditAmount)}</dd></div>}</dl>
      {invoice.status === 'CANCELLED' && <strong className="receipt-cancelled">{"H\u00d3A \u0110\u01a0N \u0110\u00c3 H\u1ee6Y"}</strong>}
      <footer><strong>C\u1ea3m \u01a1n qu\u00fd kh\u00e1ch!</strong><span>H\u1eb9n g\u1eb7p l\u1ea1i</span><small>FreshMart - {invoice.store.name}</small></footer>
    </section>    {returnOpen && <div className="ui-modal" onMouseDown={event => { if (event.target === event.currentTarget) setReturnOpen(false); }}><form className="ui-modal-card sales-return-modal" onSubmit={submitReturn}><header><div><h2>Tạo phiếu trả hàng</h2><p>{invoice.code} · tối đa còn lại {money(invoice.total - invoice.refundedAmount)}</p></div><button type="button" onClick={() => setReturnOpen(false)}>×</button></header>{error && <div className="ui-error" role="alert">{error}</div>}<fieldset><legend>Sản phẩm trả</legend><div className="sales-return-lines">{returnableItems.map(item => <div key={item.id}><span><strong>{item.productName}</strong><small>{item.productCode} · đã mua {item.quantity}, còn {item.remaining} {item.unit}</small></span><label>Số lượng<input type="number" min={0} max={item.remaining} value={quantities[item.id] ?? ''} onChange={event => setQuantities(old => { const next = { ...old }; if (event.target.value === '') delete next[item.id]; else next[item.id] = Number(event.target.value); return next; })} /></label><label className="check"><input type="checkbox" checked={restock[item.id] ?? true} onChange={event => setRestock(old => ({ ...old, [item.id]: event.target.checked }))} />Nhập lại kho</label></div>)}</div></fieldset><div className="form-grid"><label>Lý do trả hàng<textarea name="reason" required minLength={3} maxLength={500} rows={3} placeholder="Ví dụ: hàng lỗi, sai quy cách…" /></label><label>Phương thức hoàn tiền<select name="refundMethod" defaultValue="CASH"><option value="CASH">Tiền mặt</option><option value="QR">QR / chuyển khoản</option></select></label></div><div className="return-refund-preview"><span>Số tiền dự kiến hoàn</span><strong>{money(refundPreview)}</strong></div><footer><ActionButton tone="more" onClick={() => setReturnOpen(false)}>Đóng</ActionButton><ActionButton tone="danger" type="submit" disabled={busy}>{busy ? 'Đang xử lý…' : 'Xác nhận trả hàng'}</ActionButton></footer></form></div>}
    {cancelOpen && <div className="ui-modal" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setCancelOpen(false); }}><form className="ui-modal-card" onSubmit={submitCancel}><header><div><h2>Hủy hóa đơn {invoice.code}</h2><p>Hệ thống sẽ hoàn tồn kho và điều chỉnh doanh thu ca theo giao dịch.</p></div><button type="button" aria-label="Đóng" disabled={busy} onClick={() => setCancelOpen(false)}>×</button></header>{error && <div className="ui-error" role="alert">{error}</div>}<label>Lý do hủy<textarea autoFocus required minLength={3} maxLength={500} value={cancelReason} onChange={event => setCancelReason(event.target.value)} placeholder="Ghi rõ lý do hủy hóa đơn"/></label><footer><ActionButton tone="more" onClick={() => setCancelOpen(false)} disabled={busy}>Đóng</ActionButton><ActionButton tone="danger" type="submit" disabled={busy || cancelReason.trim().length < 3}>{busy ? 'Đang hủy…' : 'Xác nhận hủy'}</ActionButton></footer></form></div>}
  </div>;
}

export default function InvoiceDetailPage() { return <Protected permission="invoices.read"><InvoiceDetail /></Protected>; }
