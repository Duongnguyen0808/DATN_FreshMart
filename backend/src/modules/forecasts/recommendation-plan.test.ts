import { describe, expect, it } from 'vitest';
import { planReplenishment } from './recommendation-plan.js';

describe('replenishment allocation', () => {
  it('uses available surplus, leaves uncovered demand for purchase, and breaks ties consistently', () => {
    const sources = [
      { warehouseId: 'B', surplus: 3 },
      { warehouseId: 'C', surplus: 0 },
      { warehouseId: 'A', surplus: 3 },
    ];
    expect(planReplenishment(8, sources)).toEqual({
      transfers: [{ sourceWarehouseId: 'A', quantity: 3 }, { sourceWarehouseId: 'B', quantity: 3 }],
      purchaseQuantity: 2,
    });
    expect(sources[0].warehouseId).toBe('B');
  });
});
