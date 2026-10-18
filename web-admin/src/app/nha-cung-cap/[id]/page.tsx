'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '../../../components/auth-provider';
import { SupplierFormFields, supplierInput } from '../../../components/suppliers/supplier-form-fields';
import { ActionButton, ActionLink } from '../../../components/ui/action-button';
import { CurrencyInput } from '../../../components/ui/currency-input';
import { StatusBadge } from '../../../components/ui/status-badge';
import { TabBar, type TabItem } from '../../../components/ui/tab-bar';
import { useToast } from '../../../components/ui/toast-provider';
import { errorMessage } from '../../../lib/auth-api';
import * as payableApi from '../../../lib/payables-api';
import * as purchaseApi from '../../../lib/purchase-orders-api';
import * as supplierApi from '../../../lib/suppliers-api';

type SupplierTab = 'profile' | 'payables' | 'purchases';
const tabs: TabItem<SupplierTab>[] = [
  { value: 'profile', label: 'Tổng quan', tone: 'blue' },
  { value: 'payables', label: 'Công nợ & thanh toán', tone: 'red' },
  { value: 'purchases', label: 'Lịch sử nhập hàng', tone: 'violet' },
];
const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(Math.round(value))} đ`;
const date = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' }).format(new Date(value));
const dateTime = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const statusLabel: Record<purchaseApi.PurchaseOrderStatus, string> = { OPEN: 'Đang nhận', PARTIALLY_RECEIVED: 'Nhận một phần', COMPLETED: 'Hoàn tất' };

export default function SupplierDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [row, setRow] = useState<supplierApi.Supplier | null>(null);
  const [payables, setPayables] = useState<payableApi.Payable[]>([]);
  const [orders, setOrders] = useState<purchaseApi.PurchaseOrder[]>([]);
  const [tab, setTab] = useState<SupplierTab>('profile');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState<payableApi.Payable | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<payableApi.PaymentMethod>('BANK_TRANSFER');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const canManage = Boolean(user?.permissions.includes('suppliers.manage') || user?.permissions.includes('*'));

  const load = async () => {
    try {
      setError('');
      const supplier = await supplierApi.getSupplier(id);
      setRow(supplier);
      const tasks: Promise<unknown>[] = [];
      if (user?.permissions.includes('payables.read') || user?.permissions.includes('*')) tasks.push(payableApi.getPayables({ supplierId: id, page: 1, pageSize: 100 }).then(value => setPayables(value.items)));
      if (user?.permissions.includes('purchase_orders.read') || user?.permissions.includes('*')) tasks.push(purchaseApi.getPurchaseOrders({ supplierId: id, page: 1 }).then(value => setOrders(value.items)));
      await Promise.all(tasks);
    } catch (reason) { setError(errorMessage(reason)); }
  };
  useEffect(() => { void load(); }, [id, user?.id]);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true);
    try { setRow(await supplierApi.updateSupplier(id, supplierInput(new FormData(event.currentTarget)))); setEditing(false); showToast('Đã cập nhật hồ sơ nhà cung cấp.'); }
    catch (reason) { showToast(errorMessage(reason), 'error'); }
    finally { setBusy(false); }
  };
  const changeStatus = async () => {
    if (!row) return; setBusy(true);
    try { setRow(await supplierApi.setSupplierStatus(id, !row.active)); showToast(row.active ? 'Đã ngừng hợp tác với nhà cung cấp.' : 'Đã kích hoạt lại nhà cung cấp.'); }
    catch (reason) { showToast(errorMessage(reason), 'error'); }
    finally { setBusy(false); }
  };

  if (error) return <div className="ui-error">{error} <button onClick={load}>Thử lại</button></div>;
  if (!row) return <p>Đang tải nhà cung cấp…</p>;
  const canPay = Boolean(user?.permissions.includes('payables.pay') || user?.permissions.includes('*'));
  const submitPayment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!paying) return; setBusy(true);
    try {
      const updated = await payableApi.payPayable(paying.id, { amount: paymentAmount, method: paymentMethod, reference: paymentReference.trim() || undefined, note: paymentNote.trim() || undefined });
      setPayables(current => current.map(item => item.id === updated.id ? updated : item));
      setPaying(null); setPaymentAmount(0); showToast('Đã ghi nhận thanh toán công nợ.');
      const refreshed = await supplierApi.getSupplier(id); setRow(refreshed);
    } catch (reason) { showToast(errorMessage(reason), 'error'); }
    finally { setBusy(false); }
  };

  return <div className="suite-page supplier-detail-page">
    <div className="detail-back"><Link href="/nha-cung-cap">‹ Quay lại danh sách nhà cung cấp</Link></div>
    <header className="detail-heading"><div><div className="breadcrumb">Mua hàng <span>›</span> Nhà cung cấp <span>›</span> {row.code}</div><h1>{row.name}</h1><p>{row.code}</p></div><div><StatusBadge tone={row.active ? 'green' : 'red'}>{row.active ? 'Đang hợp tác' : 'Ngừng hợp tác'}</StatusBadge>{canManage && <><ActionButton tone="edit" onClick={() => setEditing(true)}>Sửa hồ sơ</ActionButton><ActionButton tone={row.active ? 'danger' : 'approve'} disabled={busy} onClick={changeStatus}>{row.active ? 'Ngừng hợp tác' : 'Kích hoạt lại'}</ActionButton></>}</div></header>
    <TabBar className="detail-section-tabs" value={tab} onChange={setTab} label="Nội dung hồ sơ nhà cung cấp" items={tabs.map(item => ({ ...item, count: item.value === 'payables' ? payables.filter(value => value.outstandingAmount > 0).length : item.value === 'purchases' ? orders.length : undefined }))}/>

    {tab === 'profile' && <section className="detail-grid"><article><h2>Thông tin liên hệ</h2><dl><div><dt>Người liên hệ</dt><dd>{row.contactName}</dd></div><div><dt>Số điện thoại</dt><dd>{row.phone}</dd></div><div><dt>Email</dt><dd>{row.email}</dd></div><div><dt>Địa chỉ</dt><dd>{row.address}</dd></div></dl></article><article><h2>Thông tin quản lý</h2><dl><div><dt>Công nợ hiện tại</dt><dd className={row.currentDebt > 0 ? 'negative' : ''}><strong>{money(row.currentDebt)}</strong></dd></div><div><dt>Ngày tạo</dt><dd>{date(row.createdAt)}</dd></div><div><dt>Cập nhật gần nhất</dt><dd>{date(row.updatedAt)}</dd></div></dl></article></section>}

    {tab === 'payables' && <section className="detail-table"><header><h2>C&ocirc;ng n&#7907; c&#7847;n thanh to&aacute;n</h2><p>Xem s&#7889; c&ograve;n ph&#7843;i tr&#7843; v&agrave; m&#7863;t h&agrave;ng &#273;&atilde; nh&#7853;n thu&#7897;c t&#7915;ng &#273;&#417;n mua.</p><p>T&#7893;ng c&ograve;n ph&#7843;i tr&#7843;: <strong>{money(payables.reduce((sum, value) => sum + value.outstandingAmount, 0))}</strong></p></header><div className="table-scroll"><table><thead><tr><th>&#272;&#417;n mua / kho nh&#7853;n</th><th>M&#7863;t h&agrave;ng &#273;&atilde; nh&#7853;n</th><th className="numeric">T&#7893;ng n&#7907;</th><th className="numeric">C&ograve;n ph&#7843;i tr&#7843;</th><th>Thao t&aacute;c</th></tr></thead><tbody>{payables.length ? payables.map(value => <tr key={value.id}><td><Link href={`/don-mua-hang/${value.purchaseOrder.id}`}><strong>{value.purchaseOrder.code}</strong></Link><small>{value.purchaseOrder.warehouse.code} &middot; {value.purchaseOrder.warehouse.name}</small></td><td>{value.purchaseOrder.items.filter(item => item.receivedQuantity > 0).map(item => <div key={item.id}>{item.sku.product.name} &middot; {item.receivedQuantity} {item.sku.product.unit}</div>)}</td><td className="numeric">{money(value.totalAmount)}</td><td className="numeric negative"><strong>{money(value.outstandingAmount)}</strong></td><td>{value.outstandingAmount > 0 && canPay ? <ActionButton tone="approve" onClick={() => { setPaying(value); setPaymentAmount(value.outstandingAmount); }}>Thanh to&aacute;n</ActionButton> : <span>&#272;&atilde; thanh to&aacute;n</span>}</td></tr>) : <tr><td colSpan={5}>Nh&agrave; cung c&#7845;p ch&#432;a c&oacute; c&ocirc;ng n&#7907; ph&#7843;i tr&#7843;.</td></tr>}</tbody></table></div></section>}

    {tab === 'purchases' && <section className="detail-table"><header><h2>Lịch sử nhập hàng</h2><p>Các đơn mua hàng và tiến độ nhận hàng của nhà cung cấp.</p></header><div className="table-scroll"><table><thead><tr><th>Mã PO</th><th>Kho nhận</th><th>Ngày tạo</th><th>Tiến độ</th><th>Trạng thái</th><th className="numeric">Giá trị</th><th>Thao tác</th></tr></thead><tbody>{orders.length ? orders.map(order => <tr key={order.id}><td><code>{order.code}</code></td><td><strong>{order.warehouse.name}</strong><small>{order.warehouse.store.name}</small></td><td>{date(order.createdAt)}</td><td>{order.totalReceived}/{order.totalOrdered}</td><td><StatusBadge tone={order.status === 'COMPLETED' ? 'green' : order.status === 'PARTIALLY_RECEIVED' ? 'amber' : 'blue'}>{statusLabel[order.status]}</StatusBadge></td><td className="numeric"><strong>{money(order.totalAmount)}</strong></td><td><ActionLink tone="view" href={`/don-mua-hang/${order.id}`}>Xem đơn</ActionLink></td></tr>) : <tr><td colSpan={7}>Chưa có đơn mua hàng từ nhà cung cấp này.</td></tr>}</tbody></table></div></section>}

    {paying && <div className="ui-modal"><form className="ui-modal-card payable-payment-modal" onSubmit={submitPayment}><header><div><h2>Thanh to&aacute;n c&ocirc;ng n&#7907;</h2><p>{paying.purchaseOrder.code} &middot; C&ograve;n ph&#7843;i tr&#7843; {money(paying.outstandingAmount)}</p></div><button type="button" disabled={busy} onClick={() => setPaying(null)} aria-label="&#272;&oacute;ng">&times;</button></header><div className="form-grid"><label className="full">S&#7889; ti&#7873;n thanh to&aacute;n<CurrencyInput required min={1} max={paying.outstandingAmount} value={String(paymentAmount)} onChange={value => setPaymentAmount(Number(value))} /></label><label className="full">H&igrave;nh th&#7913;c<select value={paymentMethod} onChange={event => setPaymentMethod(event.target.value as payableApi.PaymentMethod)}><option value="BANK_TRANSFER">Chuy&#7875;n kho&#7843;n</option><option value="CASH">Ti&#7873;n m&#7863;t</option></select></label><label className="full">Người chi<input value={user?.name ?? ''} readOnly /></label><label className="full">Mã tham chiếu<input value={paymentReference} onChange={event => setPaymentReference(event.target.value)} maxLength={100} /></label><label className="full">Ghi chú<textarea value={paymentNote} onChange={event => setPaymentNote(event.target.value)} maxLength={500} /></label></div><footer><ActionButton tone="more" disabled={busy} onClick={() => setPaying(null)}>&#272;&oacute;ng</ActionButton><ActionButton tone="approve" type="submit" disabled={busy}>{busy ? '&#272;ang l&#432;u...' : 'X&aacute;c nh&#7853;n thanh to&aacute;n'}</ActionButton></footer></form></div>}

    {editing && <div className="ui-modal"><form className="ui-modal-card supplier-form-modal" onSubmit={save}><header><div><h2>Cập nhật nhà cung cấp</h2><p>{row.code}</p></div><button type="button" onClick={() => setEditing(false)}>×</button></header><SupplierFormFields supplier={row}/><footer><ActionButton tone="more" onClick={() => setEditing(false)}>Đóng</ActionButton><ActionButton tone="approve" type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu thay đổi'}</ActionButton></footer></form></div>}
  </div>;
}
