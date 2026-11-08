'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { Protected, useAuth } from '../../../components/auth-provider';
import { ApiError, errorMessage } from '../../../lib/auth-api';
import { cancelPayosCheckout, createPayosCheckout, getPayosCheckout, payosStorageKey, type PayosCheckout, type PayosCheckoutInput } from '../../../lib/payos-api';
import './payos-qr.css';

function PayosPage() {
  const { user } = useAuth();
  const [checkout, setCheckout] = useState<PayosCheckout | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const pending = useRef(false);
  const settled = useRef(false);
  const id = useRef('');
  const storage = user ? payosStorageKey(user.id) : '';
  const refresh = useCallback(async (create = false) => {
    if (!storage || pending.current || !id.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const saved = sessionStorage.getItem(`${storage}-request`);
      const input: PayosCheckoutInput | null = saved ? JSON.parse(saved) : null;
      const row = create && input?.checkoutId === id.current ? await createPayosCheckout(input) : await getPayosCheckout(id.current);
      setCheckout(row); setError('');
      if (['PAID', 'CANCELLED', 'EXPIRED'].includes(row.status)) {
        settled.current = true;
        if (localStorage.getItem(storage) === row.id) localStorage.removeItem(storage);
        if (input?.checkoutId === row.id) sessionStorage.removeItem(`${storage}-request`);
      }
    } catch (reason) {
      setError(errorMessage(reason));
      // Clear an invalid draft only after a definite rejection and a confirmed absence.
      // Network timeouts keep the stable ID because the provider may have accepted it.
      if (create && reason instanceof ApiError && [400, 409, 503].includes(reason.status)) {
        try { setCheckout(await getPayosCheckout(id.current)); }
        catch (lookupError) {
          if (lookupError instanceof ApiError && lookupError.status === 404) {
            if (localStorage.getItem(storage) === id.current) localStorage.removeItem(storage);
            sessionStorage.removeItem(`${storage}-request`);
          }
        }
      }
    }
    finally { pending.current = false; setBusy(false); }
  }, [storage]);
  useEffect(() => {
    if (!storage) return;
    const checkoutId = new URLSearchParams(window.location.search).get('checkoutId') ?? localStorage.getItem(storage) ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(checkoutId)) { setError('Không tìm thấy mã đơn thanh toán.'); return; }
    id.current = checkoutId;
    void refresh(true);
    const timer = window.setInterval(() => { if (!document.hidden && !settled.current) void refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, [storage, refresh]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const cancel = async () => {
    if (!id.current || pending.current) return;
    pending.current = true; setBusy(true);
    try {
      const row = await cancelPayosCheckout(id.current);
      setCheckout(row); setError('');
      if (row.status !== 'PENDING' && row.status !== 'CREATING') {
        settled.current = true;
        if (localStorage.getItem(storage) === row.id) localStorage.removeItem(storage);
        sessionStorage.removeItem(`${storage}-request`);
      }
    } catch (reason) { setError(errorMessage(reason)); }
    finally { pending.current = false; setBusy(false); }
  };
  const paid = checkout?.status === 'PAID';
  const closed = checkout && ['CANCELLED', 'EXPIRED'].includes(checkout.status);
  const remaining = checkout ? Math.max(0, Math.ceil((Date.parse(checkout.expiresAt) - now) / 1000)) : 0;
  const [copied, setCopied] = useState('');
  const copy = (key: string, value?: string | null) => { if (!value) return; void navigator.clipboard?.writeText(value).then(() => { setCopied(key); window.setTimeout(() => setCopied(''), 1500); }); };
  const amountText = checkout ? new Intl.NumberFormat('vi-VN').format(checkout.amount) : '';
  const waiting = !paid && !closed && !!checkout;
  return <main className="pq-page">
    <div className="pq-top"><span className="pq-logo"><img src="/logo.png" alt=""/>FreshMart POS</span>{waiting && <span className="pq-timer">Còn lại <b>{remaining > 0 ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : '—'}</b></span>}</div>
    <section className={`pq-card${paid ? ' is-paid' : ''}${closed ? ' is-closed' : ''}`}>
      <header className="pq-head"><div><h1>{paid ? 'Thanh toán thành công' : closed ? checkout.status === 'EXPIRED' ? 'Đã hết hạn thanh toán' : 'Đã hủy thanh toán' : 'Chi tiết thanh toán'}</h1><p>{paid ? 'Đã nhận đủ tiền. Hóa đơn đã hoàn tất.' : closed ? 'Hàng giữ chỗ đã được giải phóng; chưa tạo hóa đơn bán hàng.' : <>Mở app ngân hàng bất kỳ để <b>quét mã VietQR</b> hoặc <b>chuyển khoản</b> chính xác số tiền bên dưới.</>}</p></div>{checkout && <span className="pq-order">Đơn #{checkout.orderCode}</span>}</header>
      {waiting && <div className="pq-body">
        <figure className="pq-qr">
          <img className="pq-qr-top-img" src="/vietqr-top.png" alt="VietQR PRO" />
          <div className="pq-qr-box">{checkout.qrCode ? <QRCodeSVG value={checkout.qrCode} size={236} marginSize={1} level="M" title="Mã QR thanh toán" imageSettings={{ src: '/vietqr-center.png', height: 34, width: 34, excavate: true }} /> : <span className="pq-qr-loading">Đang tạo mã…</span>}</div>
          <img className="pq-qr-bottom-img" src="/vietqr-bottom.png" alt="napas 247 | MB" />
        </figure>
        <div className="pq-info">
          <div className="pq-row"><div><span>Chủ tài khoản</span><strong>{checkout.accountName || '—'}</strong></div></div>
          <div className="pq-row"><div><span>Số tài khoản</span><strong>{checkout.accountNumber ?? '—'}</strong></div><button type="button" onClick={() => copy('acc', checkout.accountNumber)}>{copied === 'acc' ? 'Đã chép' : 'Sao chép'}</button></div>
          <div className="pq-row"><div><span>Số tiền</span><strong className="pq-amount">{amountText} đ</strong></div><button type="button" onClick={() => copy('amt', String(checkout.amount))}>{copied === 'amt' ? 'Đã chép' : 'Sao chép'}</button></div>
          <div className="pq-row"><div><span>Nội dung</span><strong>{checkout.description ?? '—'}</strong></div><button type="button" onClick={() => copy('desc', checkout.description)}>{copied === 'desc' ? 'Đã chép' : 'Sao chép'}</button></div>
          <p className="pq-note">Lưu ý: nhập chính xác số tiền <b>{amountText} đ</b> và nội dung khi chuyển khoản.</p>
          <p className="pq-wait" role="status"><i/>{checkout.status === 'CREATING' ? 'Đang tạo mã QR…' : 'Đang chờ thanh toán · tự động cập nhật'}</p>
        </div>
      </div>}
      {paid && checkout && <div className="pq-status-view">
        <div className="pq-status-badge is-paid"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>
        <strong className="pq-status-amount">{amountText} đ</strong>
        <span className="pq-status-pill ok">Giao dịch hoàn tất</span>
        <dl className="pq-status-summary">
          <div><dt>Mã giao dịch</dt><dd>#{checkout.orderCode}</dd></div>
          <div><dt>Phương thức</dt><dd>VietQR chuyển khoản</dd></div>
          <div><dt>Tài khoản nhận</dt><dd>{checkout.accountName || '—'}</dd></div>
          <div><dt>Trạng thái hóa đơn</dt><dd className="ok">Đã tạo hóa đơn & trừ kho</dd></div>
        </dl>
      </div>}
      {closed && checkout && <div className="pq-status-view">
        <div className="pq-status-badge is-cancelled"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/></svg></div>
        <strong className="pq-status-amount is-cancelled">{amountText} đ</strong>
        <span className="pq-status-pill cancelled">{checkout.status === 'EXPIRED' ? 'Giao dịch đã hết hạn' : 'Giao dịch đã hủy'}</span>
        <dl className="pq-status-summary">
          <div><dt>Mã đơn thanh toán</dt><dd>#{checkout.orderCode}</dd></div>
          <div><dt>Nội dung chuyển khoản</dt><dd>{checkout.description || `FM${checkout.orderCode}`}</dd></div>
          <div><dt>Trạng thái tồn kho</dt><dd>Đã hoàn trả hàng giữ chỗ</dd></div>
          <div><dt>Trạng thái hóa đơn</dt><dd className="cancelled">Chưa phát sinh thu tiền</dd></div>
        </dl>
      </div>}
      {!checkout && !error && <p className="pq-loading" role="status">Đang tạo yêu cầu thanh toán…</p>}
      {error && <p className="ui-error" role="alert">{error}</p>}
      <footer className="pq-actions">{paid && checkout.invoiceId ? <><Link className="pq-btn" href="/hoa-don/tao">Bán đơn mới</Link><Link className="pq-btn primary" href={`/hoa-don/${checkout.invoiceId}`}>Xem hóa đơn →</Link></> : closed ? <Link className="pq-btn primary" href="/hoa-don/tao">← Quay lại màn hình bán hàng</Link> : <>
        <button type="button" className="pq-btn danger" disabled={busy || !checkout || checkout.status === 'CREATING'} onClick={() => void cancel()}>Hủy thanh toán</button>
        <button type="button" className="pq-btn" disabled={busy} onClick={() => void refresh(checkout?.status === 'CREATING' || !checkout)}>Kiểm tra lại</button>
        {checkout?.checkoutUrl && <a className="pq-btn primary" href={checkout.checkoutUrl} target="_blank" rel="noopener noreferrer">Mở trang payOS ↗</a>}
      </>}</footer>
    </section>
  </main>;
}
export default function Page() { return <Protected permission="invoices.create"><PayosPage /></Protected>; }
