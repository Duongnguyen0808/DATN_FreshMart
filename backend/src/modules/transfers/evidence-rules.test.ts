import { describe, expect, it } from 'vitest';
import { dispatchTransferInput, receiveTransferInput } from './transfers.schemas.js';

const skuId = '11111111-1111-4111-8111-111111111111';

describe('transfer evidence', () => {
  it('accepts image evidence on dispatch and receipt', () => {
    expect(dispatchTransferInput.safeParse({ evidence: ['data:image/jpeg;base64,YQ=='] }).success).toBe(true);
    expect(receiveTransferInput.safeParse({ evidence: ['data:image/jpeg;base64,YQ=='], items: [{ skuId, quantity: 2 }] }).success).toBe(true);
  });

  it('rejects more than three evidence images', () => {
    expect(dispatchTransferInput.safeParse({ evidence: ['a', 'b', 'c', 'd'] }).success).toBe(false);
  });
});
