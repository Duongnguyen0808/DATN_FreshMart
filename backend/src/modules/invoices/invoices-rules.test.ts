import { describe, expect, it } from 'vitest';
import { isInvoicePaymentBalanced } from './invoices.service.js';
import { createInvoiceInput } from './invoices.schemas.js';

const uuid = '11111111-1111-4111-8111-111111111111';

describe('BR-01 invoice payments', () => {
  it('accepts combined cash, QR and card payments for a one-million invoice', () => {
    const parsed = createInvoiceInput.safeParse({
      shiftId: uuid, warehouseId: uuid, discount: 0,
      items: [{ skuId: uuid, quantity: 1 }],
      payments: [
        { method: 'CASH', amount: 300_000 },
        { method: 'QR', amount: 400_000, reference: 'QR123' },
        { method: 'CARD', amount: 300_000, reference: 'CARD123' },
      ],
    });
    expect(parsed.success).toBe(true);
    expect(isInvoicePaymentBalanced(1_000_000, 0, [300_000, 400_000, 300_000])).toBe(true);
  });

  it('rejects missing or excess payment value and permits a balanced credit sale', () => {
    expect(isInvoicePaymentBalanced(1_000_000, 0, [300_000, 400_000])).toBe(false);
    expect(isInvoicePaymentBalanced(1_000_000, 0, [300_000, 400_000, 300_001])).toBe(false);
    expect(isInvoicePaymentBalanced(1_000_000, 200_000, [300_000, 500_000])).toBe(true);
  });

  it('does not allow duplicate payment methods', () => {
    const result = createInvoiceInput.safeParse({
      shiftId: uuid, discount: 0, items: [{ skuId: uuid, quantity: 1 }],
      payments: [{ method: 'CARD', amount: 400 }, { method: 'CARD', amount: 600 }],
    });
    expect(result.success).toBe(false);
  });
});
