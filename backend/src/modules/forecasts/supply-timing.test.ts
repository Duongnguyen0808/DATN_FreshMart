import { describe, expect, it } from 'vitest';
import { supplyTiming } from './supply-timing.js';
const base = { predictedQuantity: 70, horizonDays: 7, available: 20, safetyStock: 10, leadTimeDays: 4, packSize: 24, shortage: 50, receipts: [] };
describe('supply timing', () => {
  it('warns before supplier delivery and rounds purchasing to whole packs', () => {
    const result = supplyTiming(base);
    expect(result.firstShortageDay).toBe(2);
    expect(result.urgent).toBe(true);
    expect(result.leadTimeNeed).toBe(30);
    expect(result.roundedPurchaseQuantity).toBe(72);
  });
  it('does not pretend a late PO prevents an earlier stockout', () => {
    expect(supplyTiming({ ...base, receipts: [{ day: 5, quantity: 100 }] }).firstShortageDay).toBe(2);
    expect(supplyTiming({ ...base, receipts: [{ day: 1, quantity: 100 }] }).firstShortageDay).toBeNull();
  });
  it('does not infer unknown or out-of-horizon lead times', () => {
    expect(supplyTiming({ ...base, leadTimeDays: null }).orderNow).toBeNull();
    expect(supplyTiming({ ...base, leadTimeDays: 30 }).leadTimeCovered).toBe(false);
  });
  it('does not count overdue deliveries as arrived', () => {
    expect(supplyTiming({ ...base, receipts: [{ day: -1, quantity: 100 }] }).firstShortageDay).toBe(2);
    expect(supplyTiming({ ...base, receipts: [{ day: -1, quantity: 100 }] }).leadTimeNeed).toBe(30);
  });
});
