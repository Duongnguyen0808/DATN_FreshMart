import { BarcodeFormat, EncodeHintType, QRCodeWriter } from '@zxing/library';
import type { Invoice, PaymentMethod } from './invoices-api';

const CASH_REF_REGEX = /^CASH_TENDERED:(\d+)\|CHANGE:(\d+)$/;
const INVOICE_UUID_URL_REGEX =
  /\/hoa-don\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;
const INVOICE_PREFIX_UUID_REGEX =
  /^(?:FM-RETURN|INV-RETURN|HD-ID):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const INVOICE_CODE_REGEX = /\b(HD-\d{8}-\d{4,10})\b/i;

export type CashTenderInfo = {
  tendered: number;
  change: number;
};

export type CashDenominationSuggestion = {
  amount: number;
  label: string;
  isExact?: boolean;
};

export type InvoiceReturnTarget =
  | { kind: 'id'; invoiceId: string }
  | { kind: 'code'; invoiceCode: string };

const formatMoney = (value: number) => `${new Intl.NumberFormat('vi-VN').format(Math.round(value))} đ`;

const formatShortVnd = (value: number) => {
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return Number.isInteger(m) ? `${m}tr` : `${m.toFixed(1)}tr`;
  }
  if (value >= 1_000 && value % 1_000 === 0) return `${value / 1_000}k`;
  return new Intl.NumberFormat('vi-VN').format(value);
};

export function buildCashTenderReference(tendered: number, change: number): string {
  const safeTendered = Math.max(0, Math.round(tendered));
  const safeChange = Math.max(0, Math.round(change));
  return `CASH_TENDERED:${safeTendered}|CHANGE:${safeChange}`;
}

export function parseCashTenderReference(reference: string | null | undefined): CashTenderInfo | null {
  if (!reference) return null;
  const match = CASH_REF_REGEX.exec(reference.trim());
  if (!match) return null;
  const tendered = Number(match[1]);
  const change = Number(match[2]);
  if (!Number.isFinite(tendered) || !Number.isFinite(change)) return null;
  return { tendered, change };
}

export function getInvoiceCashTenderInfo(invoice: Pick<Invoice, 'payments'>): CashTenderInfo | null {
  const cashPayment = invoice.payments.find(p => p.method === 'CASH');
  if (!cashPayment) return null;
  const parsed = parseCashTenderReference(cashPayment.reference);
  if (parsed) return parsed;
  if (cashPayment.amount > 0) {
    return { tendered: cashPayment.amount, change: 0 };
  }
  return null;
}

export function formatPaymentReferenceLabel(method: PaymentMethod, reference: string | null | undefined): string | null {
  if (!reference) return null;
  if (method === 'CASH') {
    const parsed = parseCashTenderReference(reference);
    if (parsed) {
      return `Khách đưa ${formatMoney(parsed.tendered)} · Tiền thừa ${formatMoney(parsed.change)}`;
    }
  }
  return reference;
}

/**
 * Generates Circle K / FamilyMart style quick cash buttons:
 * Always offers exact amount + practical VNĐ banknotes and convenient rounded amounts >= due.
 */
export function suggestCashDenominations(dueAmount: number): CashDenominationSuggestion[] {
  const due = Math.max(0, Math.round(dueAmount));
  if (due <= 0) return [];

  const values = new Set<number>([due]);
  const standardBills = [10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000];

  for (const bill of standardBills) {
    if (bill > due) values.add(bill);
  }

  // Add helpful rounded combinations for larger totals (e.g. 123k -> 150k, 235k -> 250k / 300k)
  if (due > 50_000 && due < 500_000) {
    const next50k = Math.ceil(due / 50_000) * 50_000;
    if (next50k > due) values.add(next50k);
    const next100k = Math.ceil(due / 100_000) * 100_000;
    if (next100k > due) values.add(next100k);
  } else if (due >= 500_000) {
    const next100k = Math.ceil(due / 100_000) * 100_000;
    const next500k = Math.ceil(due / 500_000) * 500_000;
    if (next100k > due) values.add(next100k);
    if (next500k > due) values.add(next500k);
  }

  const sorted = [...values].sort((a, b) => a - b).slice(0, 6);
  return sorted.map(amount => ({
    amount,
    isExact: amount === due,
    label: amount === due ? `Đúng ${formatShortVnd(amount)}` : formatShortVnd(amount),
  }));
}

export function buildInvoiceReturnQrUrl(invoiceId: string, origin?: string): string {
  const base = (origin ?? (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');
  return `${base}/hoa-don/${invoiceId}?return=1`;
}

export function extractInvoiceReturnTarget(rawCode: string): InvoiceReturnTarget | null {
  const trimmed = rawCode.trim();
  if (!trimmed) return null;

  const urlMatch = INVOICE_UUID_URL_REGEX.exec(trimmed);
  if (urlMatch?.[1]) {
    return { kind: 'id', invoiceId: urlMatch[1] };
  }

  const prefixMatch = INVOICE_PREFIX_UUID_REGEX.exec(trimmed);
  if (prefixMatch?.[1]) {
    return { kind: 'id', invoiceId: prefixMatch[1] };
  }

  const codeMatch = INVOICE_CODE_REGEX.exec(trimmed);
  if (codeMatch?.[1]) {
    return { kind: 'code', invoiceCode: codeMatch[1].toUpperCase() };
  }

  return null;
}

/**
 * Generates an inline vector QR SVG locally using @zxing/library (zero external HTTP requests,
 * sharp thermal print quality on K80 printers).
 */
export function renderQrSvgMarkup(text: string, size = 124): string {
  try {
    const writer = new QRCodeWriter();
    const hints = new Map<EncodeHintType, unknown>([
      [EncodeHintType.MARGIN, 1],
      [EncodeHintType.ERROR_CORRECTION, 'M'],
    ]);
    const matrix = writer.encode(text, BarcodeFormat.QR_CODE, 1, 1, hints);
    const width = matrix.getWidth();
    const height = matrix.getHeight();
    const parts: string[] = [];
    for (let y = 0; y < height; y += 1) {
      let x = 0;
      while (x < width) {
        if (!matrix.get(x, y)) {
          x += 1;
          continue;
        }
        const startX = x;
        while (x < width && matrix.get(x, y)) x += 1;
        parts.push(`M${startX} ${y}h${x - startX}v1h-${x - startX}z`);
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges" role="img" aria-label="Mã QR tra cứu đổi trả hóa đơn"><rect width="${width}" height="${height}" fill="#ffffff"/><path fill="#000000" d="${parts.join('')}"/></svg>`;
  } catch {
    return '';
  }
}
