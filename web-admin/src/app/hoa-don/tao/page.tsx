'use client';
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
  const [cardPayment, setCardPayment] = useState('0');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [cardReference, setCardReference] = useState('');
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
      setShifts(shiftRows.items.filter(row => row.cashierId === user?.id || user?.permissions.includes('invoices.cancel')));
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
    if (!warehouseId) { setStockRows([]); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      getInventory({ warehouseId, q: query.trim() || undefined, pageSize: 50 }).then(result => { if (active) setStockRows(result.items); }).catch(reason => { if (active) setError(errorMessage(reason)); });
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
  const cardAmount = parseCurrency(cardPayment);
  const amountToCollect = cashAmount + qrAmount + cardAmount;
  const creditAmount = Math.max(0, total - amountToCollect);
  const paymentExceedsTotal = amountToCollect > total;
  const activePaymentMethod = [cashAmount, qrAmount, cardAmount].filter(amount => amount > 0).length > 1
    ? 'MIXED'
    : qrAmount > 0 ? 'QR' : cardAmount > 0 ? 'CARD' : 'CASH';
  const choosePaymentMethod = (method: 'CASH' | 'QR' | 'CARD' | 'MIXED') => {
    setPayosSelected(method === 'QR' && payosEnabled);
    if (method === 'CASH') { setCashPayment(null); setQrPayment('0'); setCardPayment('0'); }
    if (method === 'QR') { setCashPayment('0'); setQrPayment(String(total)); setCardPayment('0'); }
    if (method === 'CARD') { setCashPayment('0'); setQrPayment('0'); setCardPayment(String(total)); }
    if (method === 'MIXED') { const cash = Math.floor(total / 2); setCashPayment(String(cash)); setQrPayment(bankQrReady && !payosEnabled ? String(total - cash) : '0'); setCardPayment(bankQrReady && !payosEnabled ? '0' : String(total - cash)); }
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
    if (payosEnabled && qrAmount > 0) { setError('Chọn QR thanh toán để thanh toán toàn bộ hóa đơn. Thanh toán kết hợp hiện hỗ trợ tiền mặt và thẻ.'); return false; }
    if (!selectedShift || !warehouseId || !cart.length || invalidStock || paymentExceedsTotal || (qrAmount > 0 && (!bankQrReady || !transferMemo)) || discountInvalid || (creditAmount > 0 && (!customerId || !dueDate))) {
      setError('Ki?m tra ca, kho, t?n kh? d?ng, kh?ch h?ng ghi n? v? t?ng thanh to?n tr??c khi l?u.'); return false;
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
        ...(cardAmount > 0 ? [{ method: 'CARD' as const, amount: cardAmount, ...(cardReference.trim() ? { reference: cardReference.trim() } : {}) }] : []),
      ];
      const invoice = await createInvoice({ shiftId, warehouseId, customerId: customerId || undefined, discount: discountAmount, creditAmount, creditDueDate: creditAmount > 0 ? dueDate : undefined, note: note.trim() || undefined, items: cart.map(line => ({ skuId: line.stock.skuId, quantity: line.quantity })), payments });
      setCheckoutOpen(false); showToast(`\u0110\u00e3 ho\u00e0n t\u1ea5t h\u00f3a \u0111\u01a1n ${invoice.code}; t\u1ed3n kho \u0111\u01b0\u1ee3c c\u1eadp nh\u1eadt.`); router.push(`/hoa-don/${invoice.id}`);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };

  return <div className="suite-page sale-page"><header className="suite-heading"><div><div className="breadcrumb"><Link href="/hoa-don">Hóa đơn</Link> <span>›</span> Bán hàng</div><h1>Tạo hóa đơn bán hàng</h1><p>Thanh toán hợp lệ mới hoàn tất hóa đơn và trừ tồn kho.</p></div><Link className="ui-action-button action-view" href="/hoa-don">‹ Danh sách hóa đơn</Link></header>
    {loading && <p role="status">Đang tải ca và kho…</p>}{error && <div className="ui-error" role="alert">{error}</div>}
    <form className="sale-layout" onSubmit={submit}><section className="panel sale-products"><div className="panel-heading"><h2>Chọn hàng bán</h2></div><div className="sale-fields"><label>Ca đang mở<select required value={shiftId} onChange={event => setShiftId(event.target.value)}><option value="">Chọn ca</option>{shifts.map(shift => <option key={shift.id} value={shift.id}>{shift.code} · {shift.store.name} · {shift.posCode} · {shift.cashier.name}</option>)}</select><small className="sale-shift-cashier">Nhân viên đang làm ca: {selectedShift?.cashier.name ?? "Chưa chọn ca"}</small></label><label>Kho xuất hàng<select required value={warehouseId} onChange={event => { setWarehouseId(event.target.value); setCart([]); }}><option value="">Chọn kho</option>{availableWarehouses.map(row => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label></div>{!loading && shifts.length === 0 && <p className="sale-note">Chưa có ca mở phù hợp. Hãy liên hệ quản lý để bắt đầu bán hàng.</p>}
      {selectedShift && <section className="sale-ai-shortages"><header><div><h3>Sản phẩm cần chú ý ({aiShortages.length})</h3><p>Dự báo 14 ngày · ưu tiên thiếu nhiều/rủi ro cao · tồn cập nhật mỗi phút</p></div><Link href="/du-bao-nhu-cau">Xem toàn bộ dự báo</Link></header>{aiShortagesLoading ? <p className="sale-ai-shortages-empty">Đang kiểm tra tồn kho…</p> : aiShortages.length ? <div className="sale-ai-shortage-list">{aiShortages.slice(0, 8).map(item => <div className="sale-ai-shortage" key={item.skuId}><ProductImage src={item.imageUrl} name={item.productName}/><span><strong>{item.productName} <i className={`sale-ai-priority ${item.severity?.toLowerCase() ?? 'low'}`}>{item.severity === 'HIGH' ? 'Ưu tiên cao' : item.severity === 'MEDIUM' ? 'Ưu tiên vừa' : 'Theo dõi'}</i></strong><small>{item.productCode} · Bán lịch sử {new Intl.NumberFormat('vi-VN').format(item.observedQuantity)} · dự báo {new Intl.NumberFormat('vi-VN').format(item.predictedQuantity)} {item.unit}</small><small>Còn {new Intl.NumberFormat('vi-VN').format(item.available)} · an toàn {new Intl.NumberFormat('vi-VN').format(item.safetyStock)} · đang về {new Intl.NumberFormat('vi-VN').format(item.inTransfer + item.incomingPurchase)} · cần bù {new Intl.NumberFormat('vi-VN').format(item.shortageQuantity)}</small></span><button type="button" disabled={!warehouseId} onClick={() => setQuery(item.productCode)}>Tìm hàng</button></div>)}</div> : <p className="sale-ai-shortages-empty">Chưa có sản phẩm nào được dự báo thiếu trong kỳ này.</p>}</section>}
      <div className="panel-heading"><h2>Tìm hàng hóa</h2></div><div className="sale-search"><Icon name="search" size={17}/><input aria-label="Tìm Mã sản phẩm hoặc barcode" disabled={!warehouseId} value={query} onChange={event => setQuery(event.target.value)} placeholder="Nhập tên sản phẩm, Mã sản phẩm hoặc barcode"/></div><div className="sale-stock-list">{warehouseId && (stockRows.length ? stockRows.map(stock => <div key={stock.id}><span><ProductIdentity name={stock.sku.product.name} code={stock.sku.product.code} imageUrl={stock.sku.product.imageUrl}/></span><span>{money(stock.sku.sellingPrice)}</span><ActionButton tone="approve" disabled={stock.available < 1} onClick={() => add(stock)}>Thêm</ActionButton></div>) : <p>Không có sản phẩm phù hợp trong kho.</p>)}</div>
      </section>
      <section className="panel sale-checkout"><div className="panel-heading"><h2>Kh&aacute;ch h&agrave;ng &amp; h&oacute;a &#273;&#417;n</h2></div><div className="sale-checkout-body"><label>T&igrave;m kh&aacute;ch h&agrave;ng<input value={customerQuery} onFocus={() => setCustomerPickerOpen(true)} onChange={event => { setCustomerQuery(event.target.value); setCustomerId(''); setCustomerPickerOpen(true); }} placeholder="T&ecirc;n ho&#7863;c s&#7889; &#273;i&#7879;n tho&#7841;i"/></label>{customerPickerOpen && <div className="sale-customer-list"><button type="button" onMouseDown={event => event.preventDefault()} onClick={() => { setCustomerId(''); setCustomerQuery(''); setCustomerPickerOpen(false); }}>Kh&aacute;ch v&atilde;ng lai</button>{customers.length === 0 && <span className="sale-customer-empty">Kh&ocirc;ng t&igrave;m th&#7845;y kh&aacute;ch ph&ugrave; h&#7907;p.</span>}{customers.map(customer => <button type="button" key={customer.id} className={customerId === customer.id ? 'selected' : ''} onClick={() => { setCustomerId(customer.id); setCustomerQuery(`${customer.name} · ${customer.phone}`); setCustomerPickerOpen(false); }}>{customer.name} · {customer.phone}</button>)}</div>}
      <div className="sale-cart"><div className="sale-cart-heading"><strong>Gi&#7887; h&agrave;ng</strong><span>{cart.length} m&#7863;t h&agrave;ng</span></div>{cart.length ? <><div className="sale-cart-items">{cart.map(line => <article key={line.stock.skuId}><div className="sale-cart-product"><ProductIdentity name={line.stock.sku.product.name} code={line.stock.sku.product.code} imageUrl={line.stock.sku.product.imageUrl}/><span><small>{money(line.stock.sku.sellingPrice)} / {line.stock.sku.product.unit}</small></span></div><div className="sale-cart-edit"><input aria-label={`S&#7889; l&#432;&#7907;ng ${line.stock.sku.product.code}`} type="number" min={1} max={line.stock.available} step={1} value={line.quantity} onChange={event => setCart(rows => rows.map(item => item.stock.skuId === line.stock.skuId ? { ...item, quantity: Number(event.target.value) } : item))}/><strong>{money(line.quantity * line.stock.sku.sellingPrice)}</strong><ActionButton tone="danger" onClick={() => setCart(rows => rows.filter(item => item.stock.skuId !== line.stock.skuId))}>X&oacute;a</ActionButton></div></article>)}</div><div className="sale-bill-summary"><div><span>Ti&#7873;n h&agrave;ng</span><strong>{money(subtotal)}</strong></div><div><span>Chi&#7871;t kh&#7845;u</span><strong>{money(discountAmount)}</strong></div><div className="sale-bill-total"><span>T&#7893;ng ti&#7873;n</span><strong>{money(total)}</strong></div></div></> : <p className="sale-cart-empty">Ch&#432;a c&oacute; s&#7843;n ph&#7849;m. Ch&#7885;n h&agrave;ng &#7903; danh s&aacute;ch b&ecirc;n tr&aacute;i.</p>}</div>
      <label>Chi&#7871;t kh&#7845;u<select value={discountMode} onChange={event => setDiscountMode(event.target.value as 'amount' | 'percent')}><option value="amount">Theo s&#7889; ti&#7873;n</option><option value="percent">Theo ph&#7847;n tr&#259;m</option></select>{discountMode === 'amount' ? <CurrencyInput min={0} max={subtotal} value={discount} onChange={setDiscount}/> : <input type="number" min="0" max="100" step="0.1" value={discount} onChange={event => setDiscount(event.target.value)} placeholder="0-100%"/>}</label>{discountInvalid && <p className="negative">Chi&#7871;t kh&#7845;u ph&#7843;i n&#7857;m trong gi&#7899;i h&#7841;n cho ph&eacute;p.</p>}
      <div className="sale-method-picker"><strong>Phương thức thanh toán</strong><div role="group" aria-label="Chọn phương thức thanh toán">
        {([['CASH', 'Tiền mặt', 'wallet'], ['QR', 'QR / chuyển khoản', 'card'], ['CARD', 'Thẻ', 'card'], ['MIXED', 'Thanh toán kết hợp', 'receipt']] as const).map(([method, label, icon]) => <button type="button" key={method} className={activePaymentMethod === method ? 'selected' : ''} disabled={method === 'QR' && !bankQrReady && !payosEnabled} title={method === 'QR' && !bankQrReady && !payosEnabled ? 'Cần cấu hình VietQR để tạo mã thanh toán.' : undefined} onClick={() => choosePaymentMethod(method)}><Icon name={icon} size={15}/>{method === 'QR' && payosEnabled ? 'QR thanh toán' : label}</button>)}
      </div>{!bankQrReady && !payosEnabled && <small>Muốn nhận QR, cần cấu hình ngân hàng VietQR. Tiền mặt và thẻ vẫn dùng được.</small>}</div>
      {payosSelected && <p className="sale-checkout-hint">Quét mã QR để trả toàn bộ hóa đơn; hệ thống tự xác minh tiền vào.</p>}
      <p className="sale-checkout-hint">Chọn phương thức, sau đó tiếp tục để xác nhận số tiền và hoàn tất hóa đơn.</p>
      <ActionButton tone="approve" type="submit" disabled={busy || !shiftId || !warehouseId || !cart.length || invalidStock || discountInvalid}>{busy ? '&#272;ang x&#7917; l&yacute;...' : 'Tiếp tục thanh toán'}</ActionButton></div></section></form>
    {pendingPayosId && <p className="suite-panel">Bạn có đơn thanh toán QR cần kiểm tra. <Link href={`/thanh-toan/payos?checkoutId=${encodeURIComponent(pendingPayosId)}`}>Mở lại thanh toán →</Link></p>}
    {checkoutOpen && <div className="ui-modal" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setCheckoutOpen(false); }}><section className="ui-modal-card sale-checkout-modal"><header><div><h2>Thanh to&aacute;n h&oacute;a &#273;&#417;n</h2><p>{customerId ? customerQuery : 'Kh&aacute;ch v&atilde;ng lai'} &middot; {cart.length} m&#7863;t h&agrave;ng</p></div><button type="button" disabled={busy} onClick={() => setCheckoutOpen(false)} aria-label="&#272;&oacute;ng">&times;</button></header><div className="sale-checkout-summary"><div><span>Ti&#7873;n h&agrave;ng</span><strong>{money(subtotal)}</strong></div><div><span>Chi&#7871;t kh&#7845;u</span><strong>{money(discountAmount)}</strong></div><div className="sale-bill-total"><span>T&#7893;ng ti&#7873;n</span><strong>{money(total)}</strong></div></div><div className="sale-checkout-payment">
<label>Ti&#7873;n m&#7863;t<CurrencyInput min={0} max={total} value={cashPayment ?? String(total)} onChange={setCashPayment}/></label>
<label>QR / chuy&#7875;n kho&#7843;n<CurrencyInput min={0} max={total} value={qrPayment} onChange={setQrPayment}/></label>
<label>Th&#7867;<CurrencyInput min={0} max={total} value={cardPayment} onChange={setCardPayment}/></label>
{cardAmount > 0 && <label>M&#227; tham chi&#7871;u th&#7867;<input maxLength={100} value={cardReference} onChange={event => setCardReference(event.target.value)} placeholder="M&#227; giao d&#7883;ch n&#7871;u c&#243;"/></label>}
<div className="sale-autopay"><span>T&#7893;ng kh&#225;ch thanh to&#225;n</span><strong>{money(amountToCollect)}</strong></div>
<div className="sale-autopay"><span>C&#244;ng n&#7907; c&#242;n l&#7841;i</span><strong>{money(creditAmount)}</strong></div>
{paymentExceedsTotal && <p className="negative">T&#7893;ng thanh to&#225;n v&#432;&#7907;t qu&#225; s&#7889; ti&#7873;n h&#243;a &#273;&#417;n.</p>}
{creditAmount > 0 && <label>H&#7841;n thanh to&#225;n<input type="date" required min={new Date().toISOString().slice(0,10)} value={dueDate} onChange={event => setDueDate(event.target.value)}/></label>}
<label>Ghi ch&#250;<textarea maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder="Ghi ch&#250; thanh to&aacute;n (kh&ocirc;ng b&#7855;t bu&#7897;c)"/></label>
{qrAmount > 0 && <section className="sale-bank-qr"><div><strong>Qu&eacute;t m&atilde; &#273;&#7875; chuy&#7875;n kho&#7843;n</strong><span>S&#7889; ti&#7873;n: <b>{money(qrAmount)}</b></span><span>N&#7897;i dung: <b>{transferMemo}</b></span>{bankQrConfig.accountName && <span>Ng&#432;&#7901;i nh&#7853;n: <b>{bankQrConfig.accountName}</b></span>}</div>{qrImageUrl && <img src={qrImageUrl} alt={`QR chuy&#7875;n kho&#7843;n ${money(qrAmount)}`}/>}</section>}{creditAmount > 0 && !customerId && <p className="negative">B&aacute;n ghi n&#7907; c&#7847;n ch&#7885;n kh&aacute;ch h&agrave;ng c&oacute; h&#7891; s&#417;.</p>}{error && <div className="ui-error" role="alert">{error}</div>}</div><footer><ActionButton tone="more" disabled={busy} onClick={() => setCheckoutOpen(false)}>Quay l&#7841;i</ActionButton><ActionButton tone="approve" disabled={busy || paymentExceedsTotal || (creditAmount > 0 && (!customerId || !dueDate)) || (qrAmount > 0 && !bankQrReady)} onClick={() => void completeSale()}>{busy ? '&#272;ang l&#432;u...' : 'X&aacute;c nh&#7853;n thanh to&aacute;n'}</ActionButton></footer></section></div>}
  </div>;
}

export default function Page() { return <Protected permission="invoices.create"><NewInvoicePage /></Protected>; }
