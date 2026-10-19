import type { Invoice, PaymentMethod } from './invoices-api';

const money = (value: number) => new Intl.NumberFormat('vi-VN').format(Math.round(value)) + ' đ';
const dateTime = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const paymentName: Record<PaymentMethod, string> = { CASH: 'Tiền mặt', QR: 'QR / chuyển khoản', CARD: 'Thẻ' };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

export function printInvoice(invoice: Invoice) {
  // Open a full-size tab: Edge sizes its print preview to the opener window, and
  // a small popup makes the receipt preview look tiny even when paper sizing is correct.
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    window.alert('Trình duyệt đang chặn cửa sổ in. Hãy cho phép cửa sổ bật lên rồi thử lại.');
    return;
  }

  const items = invoice.items.map((item, index) => `
    <tr>
      <td><strong>${index + 1}. ${escapeHtml(item.productName)}</strong><small>${escapeHtml(item.productCode)} · ${item.quantity} ${escapeHtml(item.unit)} × ${escapeHtml(money(item.unitPrice))}</small></td>
      <td>${escapeHtml(money(item.lineTotal))}</td>
    </tr>`).join('');
  const payments = invoice.payments.map(payment => `<div><span>${escapeHtml(paymentName[payment.method])}</span><strong>${escapeHtml(money(payment.amount))}</strong></div>`).join('');
  const phone = invoice.customerPhone ? `<div><span>Điện thoại</span><strong>${escapeHtml(invoice.customerPhone)}</strong></div>` : '';
  const cancelMark = invoice.status === 'CANCELLED' ? '<div class="cancelled">HÓA ĐƠN ĐÃ HỦY</div>' : '';
  const credit = invoice.creditAmount > 0 ? `<div><span>Còn nợ</span><strong>${escapeHtml(money(invoice.creditAmount))}</strong></div>` : '';

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
    <html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(invoice.code)}</title>
    <style>
      *{box-sizing:border-box}
      html,body{margin:0;padding:0;background:#fff;color:#111;font:12px/1.4 Arial,sans-serif}
      body{width:80mm;padding:3mm}
      #receipt{width:74mm}
      .brand{text-align:center;padding:0 0 9px;border-bottom:1px dashed #555}
      .brand img{display:block;width:46px;height:46px;object-fit:contain;margin:0 auto 3px}
      .brand h1{font-size:19px;line-height:1.1;margin:0}
      .brand p{font-size:11px;margin:3px 0}
      .brand b{display:block;font-size:13px;margin-top:3px}
      .title{text-align:center;font-size:13px;margin:9px 0 4px}
      .store{text-align:center;font-weight:bold;margin:3px 0}
      .meta{border-top:1px solid #777;border-bottom:1px solid #777;margin:8px 0;padding:6px 0}
      .meta div,.totals div{display:flex;justify-content:space-between;gap:8px;padding:2px 0}
      .meta span,.totals span{flex:0 0 auto}
      .meta strong,.totals strong{text-align:right;overflow-wrap:anywhere}
      .items{width:100%;border-collapse:collapse;margin:8px 0}
      .items th{font-size:10px;text-transform:uppercase;border-top:1px solid #444;border-bottom:1px solid #444;padding:4px 2px;text-align:left}
      .items th:last-child,.items td:last-child{text-align:right;white-space:nowrap}
      .items td{padding:5px 2px;border-bottom:1px dashed #999;vertical-align:top}
      .items td:first-child{width:70%}
      .items small{display:block;font-size:10px;color:#333;margin-top:2px}
      .count{font-size:11px;margin:5px 0}
      .totals{margin:7px 0}
      .totals .grand{border-top:1px solid #222;margin-top:4px;padding-top:6px;font-size:14px;font-weight:bold}
      .cancelled{text-align:center;font-size:13px;font-weight:bold;border:2px solid #111;padding:5px;margin:8px 0}
      .thanks{text-align:center;border-top:1px dashed #555;margin-top:9px;padding-top:7px}
      .thanks strong,.thanks span{display:block}
      .thanks small{display:block;margin-top:6px}
      @media screen{body{margin:18px auto;padding:14px 10px;min-height:100vh;box-shadow:0 0 0 1px #ddd}}
    </style></head><body><main id="receipt">
      <header class="brand"><img src="${window.location.origin}/logo.png" alt="FreshMart"><h1>FreshMart</h1><p>HÓA ĐƠN BÁN HÀNG</p><b>${escapeHtml(invoice.code)}</b></header>
      <h2 class="title">CHI TIẾT THANH TOÁN</h2>
      <p class="store">${escapeHtml(invoice.store.name)} · ${escapeHtml(invoice.shift.posCode)}</p>
      <section class="meta"><div><span>Ngày giờ</span><strong>${escapeHtml(dateTime(invoice.completedAt))}</strong></div><div><span>Thu ngân</span><strong>${escapeHtml(invoice.cashier.name)}</strong></div><div><span>Khách hàng</span><strong>${escapeHtml(invoice.customerName || 'Khách lẻ')}</strong></div>${phone}</section>
      <table class="items"><thead><tr><th>Sản phẩm · SL × đơn giá</th><th>Thành tiền</th></tr></thead><tbody>${items}</tbody></table>
      <p class="count">Tổng số lượng: ${invoice.items.reduce((sum, item) => sum + item.quantity, 0)}</p>
      <section class="totals"><div><span>Tiền hàng</span><strong>${escapeHtml(money(invoice.subtotal))}</strong></div><div><span>Giảm giá</span><strong>${escapeHtml(money(invoice.discount))}</strong></div><div class="grand"><span>Tổng thanh toán</span><strong>${escapeHtml(money(invoice.total))}</strong></div>${payments}${credit}</section>
      ${cancelMark}<footer class="thanks"><strong>Cảm ơn quý khách!</strong><span>Hẹn gặp lại</span><small>FreshMart · ${escapeHtml(invoice.store.name)}</small></footer>
    </main></body></html>`);
  printWindow.document.close();

  window.setTimeout(async () => {
    const images = Array.from(printWindow.document.images);
    await Promise.all(images.map(image => image.decode().catch(() => undefined)));
    const content = printWindow.document.getElementById('receipt');
    const heightMm = Math.max(100, Math.ceil((((content?.scrollHeight ?? 450) * 25.4 / 96) + 6) / 5) * 5);
    const pageStyle = printWindow.document.createElement('style');
    pageStyle.textContent = `@page{size:80mm ${heightMm}mm;margin:3mm}@media print{html,body{width:74mm;margin:0;padding:0}#receipt{width:74mm}}`;
    printWindow.document.head.appendChild(pageStyle);
    printWindow.focus();
    printWindow.print();
  }, 250);
}
