import { describe, expect, it } from 'vitest';
import { receivePurchaseOrderInput } from './purchase-orders.schemas.js';

describe('purchase receipt evidence', () => {
  it('accepts up to three image data URLs with receipt quantities', () => {
    const result = receivePurchaseOrderInput.safeParse({
      evidence: ['data:image/jpeg;base64,YQ=='],
      items: [{ purchaseOrderItemId: '11111111-1111-4111-8111-111111111111', quantity: 2 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects more than three evidence images', () => {
    const result = receivePurchaseOrderInput.safeParse({
      evidence: ['a', 'b', 'c', 'd'],
      items: [{ purchaseOrderItemId: '11111111-1111-4111-8111-111111111111', quantity: 2 }],
    });
    expect(result.success).toBe(false);
  });
});
