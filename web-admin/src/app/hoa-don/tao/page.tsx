'use client';
import { PosCatalog, PosQuantity } from '../../../components/invoices/pos-catalog';
import { ProductIdentity, ProductImage } from '../../../components/ui/product-image';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Protected, useAuth } from '../../../components/auth-provider';
import { ActionButton } from '../../../components/ui/action-button';
import { CurrencyInput, parseCurrency } from '../../../components/ui/currency-input';
import { Icon } from '../../../components/ui/icon';
import { useToast } from '../../../components/ui/toast-provider';
import { errorMessage } from '../../../lib/auth-api';
import { getCustomers, type Customer } from '../../../lib/customers-api';
import { getInventory, type Inventory } from '../../../lib/inventory-api';
import { getPayosConfig, payosStorageKey, type PayosCheckoutInput } from '../../../lib/payos-api';
import { createInvoice, type PaymentMethod } from '../../../lib/invoices-api';
import { getWarehouses, type Warehouse } from '../../../lib/organization-api';
import { getShifts, type Shift } from '../../../lib/shifts-api';
import { getDemandForecast, getShortageAlerts, runDemandForecast, type ForecastInventoryAdvice } from '../../../lib/forecasts-api';

type CartLine = { stock: Inventory; quantity: number };
const bankQrConfig = { bankId: process.env.NEXT_PUBLIC_VIETQR_BANK_ID ?? '', accountNo: process.env.NEXT_PUBLIC_VIETQR_ACCOUNT_NO ?? '', accountName: process.env.NEXT_PUBLIC_VIETQR_ACCOUNT_NAME ?? '' };
const money = (value: number) => new Intl.NumberFormat('vi-VN').format(value) + ' đ';

function NewInvoicePage() {
  const router = useRouter();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [shiftId, setShiftId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [query, setQuery] = useState('');
  const [stockLoading, setStockLoading] = useState(false);
  const [stockRows, setStockRows] = useState<Inventory[]>([]);
  const [aiShortages, setAiShortages] = useState<ForecastInventoryAdvice[]>([]);
  const [aiShortagesLoading, setAiShortagesLoading] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [discount, setDiscount] = useState('');
  const [discountMode, setDiscountMode] = useState<'amount' | 'percent'>('amount');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [cashPayment, setCashPayment] = useState<string | null>(null);
  const [qrPayment, setQrPayment] = useState('0');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [transferMemo, setTransferMemo] = useState('');
  const [payosEnabled, setPayosEnabled] = useState(false);
  const [payosSelected, setPayosSelected] = useState(false);
  const [pendingPayosId, setPendingPayosId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!user) return;
    void getPayosConfig().then(config => setPayosEnabled(config.enabled)).catch(() => setPayosEnabled(false));
    setPendingPayosId(localStorage.getItem(payosStorageKey(user.id)) ?? '');
  }, [user?.id]);
  const bankQrReady = Boolean(bankQrConfig.bankId && bankQrConfig.accountNo && bankQrConfig.accountName);
  useEffect(() => { setTransferMemo(`SC${Date.now().toString().slice(-9)}`); }, []);
  const selectedShift = shifts.find(row => row.id === shiftId);
  const availableWarehouses = warehouses.filter(row => row.active && row.store.active && row.storeId === selectedShift?.storeId);

  useEffect(() => {
    Promise.all([getShifts({ status: 'OPEN', pageSize: 100 }), getWarehouses()]).then(([shiftRows, warehouseRows]) => {
      const allowed = shiftRows.items.filter(row => row.cashierId === user?.id || user?.permissions.includes('invoices.cancel') || user?.permissions.includes('*'));
      setShifts(allowed);
      if (allowed.length === 1) setShiftId(allowed[0]!.id);
      setWarehouses(warehouseRows);
      setLoading(false);
    }).catch(reason => { setError(errorMessage(reason)); setLoading(false); });
  }, [user?.id]);
  useEffect(() => {
    if (!selectedShift) { setWarehouseId(''); return; }
    setWarehouseId(availableWarehouses.length === 1 ? availableWarehouses[0]!.id : '');
    setCart([]);
  }, [shiftId, warehouses]);
  useEffect(() => {
    const storeId = selectedShift?.storeId;
    if (!storeId) { setAiShortages([]); return; }
    let active = true;
    const refresh = async (ensureDailyForecast = false) => {
      try {
        if (ensureDailyForecast) {
          let current = await getDemandForecast(storeId, 14);
          const generatedDay = current.run && new Date(current.run.generatedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
          const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
          if (!current.run || generatedDay !== today) await runDemandForecast(storeId, 14);
        }
        const result = await getShortageAlerts(storeId, 14);
        if (active) setAiShortages(result.items);
      } catch { if (active) setAiShortages([]); }
      finally { if (active) setAiShortagesLoading(false); }
    };
    setAiShortagesLoading(true); void refresh(true);
    const timer = window.setInterval(() => { void refresh(false); }, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [selectedShift?.storeId]);
  useEffect(() => {
    if (!warehouseId) { setStockRows([]); setStockLoading(false); return; }
    setStockLoading(true);
    let active = true;
    const timer = window.setTimeout(() => {
      getInventory({ warehouseId, q: query.trim() || undefined, pageSize: 50 }).then(result => { if (active) { setStockRows(result.items); setStockLoading(false); } }).catch(reason => { if (active) { setError(errorMessage(reason)); setStockLoading(false); } });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [warehouseId, query]);
  useEffect(() => {
    if (!customerPickerOpen) { setCustomers([]); return; }
    let active = true;
    const timer = window.setTimeout(() => { getCustomers({ q: customerQuery.trim() || undefined, active: 'true', pageSize: 10 }).then(result => { if (active) setCustomers(result.items); }).catch(reason => { if (active) setError(errorMessage(reason)); }); }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [customerQuery, customerPickerOpen]);

  const subtotal = useMemo(() => cart.reduce((sum, line) => sum + line.quantity * line.stock.sku.sellingPrice, 0), [cart]);
  const discountAmount = discountMode === 'percent' ? Math.round(subtotal * Math.max(0, Math.min(100, Number(discount.replace(',', '.')) || 0)) / 100) : parseCurrency(discount);
  const discountInvalid = discountMode === 'percent' ? (Number(discount.replace(',', '.')) || 0) > 100 || (Number(discount.replace(',', '.')) || 0) < 0 : discountAmount > subtotal;

  const total = Math.max(0, subtotal - discountAmount);
  const cashAmount = parseCurrency(cashPayment ?? String(total));
  const qrAmount = parseCurrency(qrPayment);
  const amountToCollect = cashAmount + qrAmount;
  const creditAmount = Math.max(0, total - amountToCollect);
  const paymentExceedsTotal = amountToCollect > total;
  const activePaymentMethod = [cashAmount, qrAmount].filter(amount => amount > 0).length > 1
    ? 'MIXED'
    : qrAmount > 0 ? 'QR' : 'CASH';
  const choosePaymentMethod = (method: 'CASH' | 'QR' | 'MIXED') => {
    setPayosSelected(method === 'QR' && payosEnabled);
    if (method === 'CASH') { setCashPayment(null); setQrPayment('0'); }
    if (method === 'QR') { setCashPayment('0'); setQrPayment(String(total)); }
    if (method === 'MIXED') { const cash = Math.floor(total / 2); setCashPayment(String(cash)); setQrPayment(bankQrReady && !payosEnabled ? String(total - cash) : '0'); }
  };
  const invalidStock = cart.some(line => line.quantity > line.stock.available || line.quantity < 1);
  const qrImageUrl = bankQrReady && qrAmount > 0 ? `https://img.vietqr.io/image/${encodeURIComponent(bankQrConfig.bankId)}-${encodeURIComponent(bankQrConfig.accountNo)}-compact2.png?amount=${qrAmount}&addInfo=${encodeURIComponent(transferMemo)}&accountName=${encodeURIComponent(bankQrConfig.accountName)}` : '';
  const add = (stock: Inventory) => {
    if (stock.available < 1) return;
    setCart(rows => rows.some(line => line.stock.skuId === stock.skuId) ? rows.map(line => line.stock.skuId === stock.skuId ? { ...line, quantity: Math.min(line.quantity + 1, line.stock.available) } : line) : [...rows, { stock, quantity: 1 }]);
  };
  const validateSale = () => {
    if (payosSelected) {
      if (!selectedShift || !warehouseId || !cart.length || invalidStock || discountInvalid || total <= 0) { setError('Kiểm tra ca, kho, tồn hàng và tổng tiền trước khi tạo QR.'); return false; }
      setError(''); return true;
    }
    if (payosEnabled && qrAmount > 0) { setError('Chọn QR thanh toán để thanh toán toàn bộ hóa đơn. Thanh toán kết hợp chỉ hỗ trợ tiền mặt và công nợ.'); return false; }
    if (!selectedShift || !warehouseId || !cart.length || invalidStock || paymentExceedsTotal || (qrAmount > 0 && (!bankQrReady || !transferMemo)) || discountInvalid || (creditAmount > 0 && (!customerId || !dueDate))) {
      setError('Kiểm tra ca, kho, tồn khả dụng, khách hàng ghi nợ và tổng thanh toán trước khi lưu.'); return false;
    }
    setError(''); return true;
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!validateSale()) return;
    if (payosSelected) { startPayos(); return; }
    setCheckoutOpen(true);
  };
  const startPayos = () => {
    if (!user || busy) return;
    const existing = localStorage.getItem(payosStorageKey(user.id));
    if (existing) { router.push(`/thanh-toan/payos?checkoutId=${encodeURIComponent(existing)}`); return; }
    const checkoutId = crypto.randomUUID();
    const input: PayosCheckoutInput = { checkoutId, shiftId, warehouseId, customerId: customerId || undefined, discount: discountAmount, note: note.trim() || undefined, items: cart.map(line => ({ skuId: line.stock.skuId, quantity: line.quantity })) };
    sessionStorage.setItem(`${payosStorageKey(user.id)}-request`, JSON.stringify(input));
    localStorage.setItem(payosStorageKey(user.id), checkoutId);
    setBusy(true);
    router.push(`/thanh-toan/payos?checkoutId=${checkoutId}`);
  };
  const completeSale = async () => {
    if (!validateSale()) return;
    setBusy(true); setError('');
    try {
      const payments = [
        ...(cashAmount > 0 ? [{ method: 'CASH' as const, amount: cashAmount }] : []),
        ...(qrAmount > 0 ? [{ method: 'QR' as const, amount: qrAmount, reference: transferMemo }] : []),
      ];
      const invoice = await createInvoice({ shiftId, warehouseId, customerId: customerId || undefined, discount: discountAmount, creditAmount, creditDueDate: creditAmount > 0 ? dueDate : undefined, note: note.trim() || undefined, items: cart.map(line => ({ skuId: line.stock.skuId, quantity: line.quantity })), payments });
      setCheckoutOpen(false); showToast(`\u0110\u00e3 ho\u00e0n t\u1ea5t h\u00f3a \u0111\u01a1n ${invoice.code}; t\u1ed3n kho \u0111\u01b0\u1ee3c c\u1eadp nh\u1eadt.`); router.push(`/hoa-don/${invoice.id}`);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };

  return <div className="suite-page sale-page pos-workspace"><header className="suite-heading"><div><div className="breadcrumb"><Link href="/hoa-don">Hóa đơn</Link> <span>›</span> Bán hàng</div><h1>Tạo hóa đơn bán hàng</h1><p>Chọn sản phẩm, kiểm tra giỏ hàng và thanh toán.</p></div><Link className="ui-action-button action-view" href="/hoa-don">‹ Danh sách hóa đơn</Link></header>
    {loading && <p role="status">Đang tải ca và kho…</p>}{error && <div className="ui-error" role="alert">{error}</div>}
    <form className="sale-layout" onSubmit={submit}><section className="pos-sessionbar"><div className="sale-fields"><label>Ca đang mở<select required value={shiftId} onChange={event => setShiftId(event.target.value)}><option value="">Chọn ca</option>{shifts.map(shift => <option key={shift.id} value={shift.id}>{shift.code} · {shift.store.name} · {shift.posCode} · {shift.cashier.name}</option>)}</select><small className="sale-shift-cashier">Nhân viên đang làm ca: {selectedShift?.cashier.name ?? "Chưa chọn ca"}</small></label><label>Kho xuất hàng<select required value={warehouseId} onChange={event => { setWarehouseId(event.target.value); setCart([]); }}><option value="">Chọn kho</option>{availableWarehouses.map(row => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label></div>{!loading && shifts.length === 0 && <p className="sale-note">Chưa có ca mở phù hợp. Hãy liên hệ quản lý để bắt đầu bán hàng.</p>}
</section><section className="panel sale-products">      <PosCatalog key={warehouseId} rows={stockRows} ready={!!warehouseId} loading={stockLoading} query={query} onQuery={setQuery} onAdd={add} quantities={Object.fromEntries(cart.map(line => [line.stock.skuId, line.quantity]))}/>
      </section>
      <section className="panel sale-checkout pos-ticket"><div className="panel-heading"><h2>Hóa đơn hiện tại</h2><span className="pos-ticket-count">{cart.reduce((sum, line) => sum + line.quantity, 0)} sản phẩm</span></div><div className="sale-checkout-body"><label>T&igrave;m kh&aacute;ch h&agrave;ng<input value={customerQuery} onFocus={() => setCustomerPickerOpen(true)} onChange={event => { setCustomerQuery(event.target.value); setCustomerId(''); setCustomerPickerOpen(true); }} placeholder="Khách lẻ / tìm tên hoặc số điện thoại"/></label>{customerPickerOpen && <div className="sale-customer-list"><button type="button" onMouseDown={event => event.preventDefault()} onClick={() => { setCustomerId(''); setCustomerQuery(''); setCustomerPickerOpen(false); }}>Kh&aacute;ch v&atilde;ng lai</button>{customers.length === 0 && <span className="sale-customer-empty">Kh&ocirc;ng t&igrave;m th&#7845;y kh&aacute;ch ph&ugrave; h&#7907;p.</span>}{customers.map(customer => <button type="button" key={customer.id} className={customerId === customer.id ? 'selected' : ''} onClick={() => { setCustomerId(customer.id); setCustomerQuery(`${customer.name} · ${customer.phone}`); setCustomerPickerOpen(false); }}>{customer.name} · {customer.phone}</button>)}</div>}
      <div className="sale-cart"><div className="sale-cart-heading"><strong>Gi&#7887; h&agrave;ng</strong><span>{cart.length} m&#7863;t h&agrave;ng</span></div>{cart.length ? <><div className="sale-cart-items">{cart.map(line => <article key={line.stock.skuId}><div className="sale-cart-product"><ProductIdentity name={line.stock.sku.product.name} code={line.stock.sku.product.code} imageUrl={line.stock.sku.product.imageUrl}/><span><small>{money(line.stock.sku.sellingPrice)} / {line.stock.sku.product.unit}</small></span></div><div className="sale-cart-edit"><PosQuantity name={line.stock.sku.product.name} value={line.quantity} max={line.stock.available} onChange={quantity => setCart(rows => rows.map(item => item.stock.skuId === line.stock.skuId ? { ...item, quantity } : item))}/><strong>{money(line.quantity * line.stock.sku.sellingPrice)}</strong><ActionButton tone="danger" onClick={() => setCart(rows => rows.filter(item => item.stock.skuId !== line.stock.skuId))}>X&oacute;a</ActionButton></div></article>)}</div></> : <div className="sale-cart-empty"><Icon name="bag" size={32}/><strong>Giỏ hàng đang trống</strong><span>Chọn sản phẩm để bắt đầu hóa đơn.</span></div>}</div>
<details className="pos-discount"><summary>Chiết khấu <span>{money(discountAmount)}</span></summary>      <label>Chi&#7871;t kh&#7845;u<select value={discountMode} onChange={event => setDiscountMode(event.target.value as 'amount' | 'percent')}><option value="amount">Theo s&#7889; ti&#7873;n</option><option value="percent">Theo ph&#7847;n tr&#259;m</option></select>{discountMode === 'amount' ? <CurrencyInput min={0} max={subtotal} value={discount} onChange={setDiscount}/> : <input type="number" min="0" max="100" step="0.1" value={discount} onChange={event => setDiscount(event.target.value)} placeholder="0-100%"/>}</label>{discountInvalid && <p className="negative">Chi&#7871;t kh&#7845;u ph&#7843;i n&#7857;m trong gi&#7899;i h&#7841;n cho ph&eacute;p.</p>}
</details><div className="sale-bill-summary"><div><span>Ti&#7873;n h&agrave;ng</span><strong>{money(subtotal)}</strong></div><div><span>Chi&#7871;t kh&#7845;u</span><strong>{money(discountAmount)}</strong></div><div className="sale-bill-total"><span>T&#7893;ng ti&#7873;n</span><strong>{money(total)}</strong></div></div>
      <div className="sale-method-picker"><strong>Phương thức thanh toán</strong><div role="group" aria-label="Chọn phương thức thanh toán">
        {([['CASH', 'Tiền mặt', 'wallet'], ['QR', 'QR / chuyển khoản', 'card'], ['MIXED', 'Thanh toán kết hợp', 'receipt']] as const).map(([method, label, icon]) => <button type="button" key={method} className={activePaymentMethod === method ? 'selected' : ''} disabled={method === 'QR' && !bankQrReady && !payosEnabled} title={method === 'QR' && !bankQrReady && !payosEnabled ? 'Cần cấu hình VietQR để tạo mã thanh toán.' : undefined} onClick={() => choosePaymentMethod(method)}><Icon name={icon} size={15}/>{method === 'QR' && payosEnabled ? 'QR thanh toán' : label}</button>)}
      </div>{!bankQrReady && !payosEnabled && <small>Thanh toán QR chưa khả dụng tại cửa hàng này.</small>}</div>
      {payosSelected && <p className="sale-checkout-hint">Quét mã QR để trả toàn bộ hóa đơn; hệ thống tự xác minh tiền vào.</p>}
      <p className="sale-checkout-hint">Chọn phương thức, sau đó tiếp tục để xác nhận số tiền và hoàn tất hóa đơn.</p>
      <ActionButton tone="approve" type="submit" disabled={busy || !shiftId || !warehouseId || !cart.length || invalidStock || discountInvalid}>{busy ? 'Đang xử lý...' : `Thanh toán · ${money(total)}`}</ActionButton></div></section></form><details className="pos-stock-advice"><summary>Thông tin bổ sung về tồn kho</summary>{selectedShift && <section className="sale-ai-shortages"><header><div><h3>Sản phẩm cần chú ý ({aiShortages.length})</h3><p>Dự báo 14 ngày · ưu tiên thiếu nhiều/rủi ro cao · tồn cập nhật mỗi phút</p></div><Link href="/du-bao-nhu-cau">Xem toàn bộ dự báo</Link></header>{aiShortagesLoading ? <p className="sale-ai-shortages-empty">Đang kiểm tra tồn kho…</p> : aiShortages.length ? <div className="sale-ai-shortage-list">{aiShortages.slice(0, 8).map(item => <div className="sale-ai-shortage" key={item.skuId}><ProductImage src={item.imageUrl} name={item.productName}/><span><strong>{item.productName} <i className={`sale-ai-priority ${item.severity?.toLowerCase() ?? 'low'}`}>{item.severity === 'HIGH' ? 'Ưu tiên cao' : item.severity === 'MEDIUM' ? 'Ưu tiên vừa' : 'Theo dõi'}</i></strong><small>{item.productCode} · Bán lịch sử {new Intl.NumberFormat('vi-VN').format(item.observedQuantity)} · dự báo {new Intl.NumberFormat('vi-VN').format(item.predictedQuantity)} {item.unit}</small><small>Còn {new Intl.NumberFormat('vi-VN').format(item.available)} · an toàn {new Intl.NumberFormat('vi-VN').format(item.safetyStock)} · đang về {new Intl.NumberFormat('vi-VN').format(item.inTransfer + item.incomingPurchase)} · cần bù {new Intl.NumberFormat('vi-VN').format(item.shortageQuantity)}</small></span><button type="button" disabled={!warehouseId} onClick={() => setQuery(item.productCode)}>Tìm hàng</button></div>)}</div> : <p className="sale-ai-shortages-empty">Chưa có sản phẩm nào được dự báo thiếu trong kỳ này.</p>}</section>}</details>
    {pendingPayosId && <p className="suite-panel">Bạn có đơn thanh toán QR cần kiểm tra. <Link href={`/thanh-toan/payos?checkoutId=${encodeURIComponent(pendingPayosId)}`}>Mở lại thanh toán →</Link></p>}
    {checkoutOpen && <div className="ui-modal" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setCheckoutOpen(false); }}><section className="ui-modal-card sale-checkout-modal"><header><div><h2>Thanh to&aacute;n h&oacute;a &#273;&#417;n</h2><p>{customerId ? customerQuery : 'Kh&aacute;ch v&atilde;ng lai'} &middot; {cart.length} m&#7863;t h&agrave;ng</p></div><button type="button" disabled={busy} onClick={() => setCheckoutOpen(false)} aria-label="&#272;&oacute;ng">&times;</button></header><div className="sale-checkout-summary"><div><span>Ti&#7873;n h&agrave;ng</span><strong>{money(subtotal)}</strong></div><div><span>Chi&#7871;t kh&#7845;u</span><strong>{money(discountAmount)}</strong></div><div className="sale-bill-total"><span>T&#7893;ng ti&#7873;n</span><strong>{money(total)}</strong></div></div><div className="sale-checkout-payment">
<label>Ti&#7873;n m&#7863;t<CurrencyInput min={0} max={total} value={cashPayment ?? String(total)} onChange={setCashPayment}/></label>
<label>QR / chuy&#7875;n kho&#7843;n<CurrencyInput min={0} max={total} value={qrPayment} onChange={setQrPayment}/></label>
<div className="sale-autopay"><span>T&#7893;ng kh&#225;ch thanh to&#225;n</span><strong>{money(amountToCollect)}</strong></div>
<div className="sale-autopay"><span>C&#244;ng n&#7907; c&#242;n l&#7841;i</span><strong>{money(creditAmount)}</strong></div>
{paymentExceedsTotal && <p className="negative">T&#7893;ng thanh to&#225;n v&#432;&#7907;t qu&#225; s&#7889; ti&#7873;n h&#243;a &#273;&#417;n.</p>}
{creditAmount > 0 && <label>H&#7841;n thanh to&#225;n<input type="date" required min={new Date().toISOString().slice(0,10)} value={dueDate} onChange={event => setDueDate(event.target.value)}/></label>}
<label>Ghi ch&#250;<textarea maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder="Ghi ch&#250; thanh to&aacute;n (kh&ocirc;ng b&#7855;t bu&#7897;c)"/></label>
{qrAmount > 0 && <section className="sale-bank-qr"><div><strong>Qu&eacute;t m&atilde; &#273;&#7875; chuy&#7875;n kho&#7843;n</strong><span>S&#7889; ti&#7873;n: <b>{money(qrAmount)}</b></span><span>N&#7897;i dung: <b>{transferMemo}</b></span>{bankQrConfig.accountName && <span>Ng&#432;&#7901;i nh&#7853;n: <b>{bankQrConfig.accountName}</b></span>}</div>{qrImageUrl && <img src={qrImageUrl} alt={`QR chuy&#7875;n kho&#7843;n ${money(qrAmount)}`}/>}</section>}{creditAmount > 0 && !customerId && <p className="negative">B&aacute;n ghi n&#7907; c&#7847;n ch&#7885;n kh&aacute;ch h&agrave;ng c&oacute; h&#7891; s&#417;.</p>}{error && <div className="ui-error" role="alert">{error}</div>}</div><footer><ActionButton tone="more" disabled={busy} onClick={() => setCheckoutOpen(false)}>Quay l&#7841;i</ActionButton><ActionButton tone="approve" disabled={busy || paymentExceedsTotal || (creditAmount > 0 && (!customerId || !dueDate)) || (qrAmount > 0 && !bankQrReady)} onClick={() => void completeSale()}>{busy ? '&#272;ang l&#432;u...' : 'X&aacute;c nh&#7853;n thanh to&aacute;n'}</ActionButton></footer></section></div>}
  </div>;
}

export default function Page() { return <Protected permission="invoices.create"><NewInvoicePage /></Protected>; }
