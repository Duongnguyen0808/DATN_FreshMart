'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { Protected, useAuth } from '../../../components/auth-provider';
import { ApiError, errorMessage } from '../../../lib/auth-api';
import { cancelPayosCheckout, createPayosCheckout, getPayosCheckout, payosStorageKey, type PayosCheckout, type PayosCheckoutInput } from '../../../lib/payos-api';

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
  return <main className="suite-page payos-page"><section className={`payos-card${paid ? ' payos-complete' : ''}`}>
    <div className="payos-brand">FreshMart <span>Thanh toán hóa đơn</span></div>
    <header><span className={`payos-state-mark${paid ? ' paid' : ''}`}>{paid ? '✓' : closed ? '—' : 'QR'}</span><div><h1>{paid ? 'Thanh toán thành công' : closed ? checkout.status === 'EXPIRED' ? 'Đã hết hạn thanh toán' : 'Đã hủy thanh toán' : 'QR thanh toán'}</h1><p>{paid ? 'Đã nhận đủ tiền. Hóa đơn của bạn đã hoàn tất.' : closed ? 'Hàng giữ chỗ đã được giải phóng; chưa tạo hóa đơn bán hàng.' : 'Mở ứng dụng ngân hàng và quét mã bên dưới.'}</p></div></header>
    {checkout && <><strong className="payos-amount">{new Intl.NumberFormat('vi-VN').format(checkout.amount)} đ</strong><p className="payos-order">Đơn thanh toán #{checkout.orderCode}</p></>}
    {!paid && !closed && checkout?.qrCode && <figure className="payos-qr"><QRCodeSVG value={checkout.qrCode} size={224} marginSize={4} level="M" title="Mã QR thanh toán" /><figcaption><span>Chủ tài khoản</span><strong>{checkout.accountName || 'Xem trên trang thanh toán'}</strong></figcaption></figure>}
    {!paid && !closed && checkout && <><dl><div><dt>Số tài khoản</dt><dd>{checkout.accountNumber ?? '—'}</dd></div><div><dt>Nội dung chuyển khoản</dt><dd>{checkout.description ?? 'Xem trên trang thanh toán'}</dd></div><div><dt>Thời gian còn lại</dt><dd className="payos-countdown">{remaining > 0 ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : 'Đang xác minh trạng thái hết hạn…'}</dd></div></dl><p className="payos-wait" role="status">{checkout.status === 'CREATING' ? 'Đang tạo mã QR. Bấm kiểm tra lại nếu kết nối bị gián đoạn.' : 'Đang chờ thanh toán · Tự động cập nhật khi nhận đủ tiền'}</p></>}
    {paid && checkout && <div className="payos-receipt"><div><span>Phương thức</span><strong>QR thanh toán</strong></div><div><span>Chủ tài khoản nhận</span><strong>{checkout.accountName || '—'}</strong></div><div><span>Trạng thái</span><strong className="payos-confirmed">Đã thanh toán</strong></div></div>}
    {!checkout && !error && <p role="status">Đang tạo yêu cầu thanh toán…</p>}
    {error && <p className="ui-error" role="alert">{error}</p>}
    <footer>{paid && checkout.invoiceId ? <Link className="primary-button" href={`/hoa-don/${checkout.invoiceId}`}>Xem hóa đơn</Link> : closed ? <Link className="primary-button" href="/hoa-don/tao">Quay lại bán hàng</Link> : <>
      {checkout?.checkoutUrl && <a className="primary-button" href={checkout.checkoutUrl} target="_blank" rel="noopener noreferrer">Mở trang thanh toán ↗</a>}
      <button type="button" className="ui-action-button" disabled={busy} onClick={() => void refresh(checkout?.status === 'CREATING' || !checkout)}>Kiểm tra lại</button>
      <button type="button" className="ui-action-button" disabled={busy || !checkout || checkout.status === 'CREATING'} onClick={() => void cancel()}>Hủy thanh toán</button>
    </>}</footer>
    <Link className="payos-back" href="/hoa-don/tao">Về trang bán hàng</Link>
  </section></main>;
}
export default function Page() { return <Protected permission="invoices.create"><PayosPage /></Protected>; }
