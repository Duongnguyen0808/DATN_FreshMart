export type SourceSurplus = { warehouseId: string; surplus: number };

export function planReplenishment(shortageQuantity: number, sources: SourceSurplus[]) {
  let remaining = shortageQuantity;
  const transfers: { sourceWarehouseId: string; quantity: number }[] = [];
  // A larger available surplus first minimizes the number of source warehouses
  // when every unit is interchangeable; the ID makes equal-capacity plans stable.
  for (const source of [...sources].sort((a, b) => b.surplus - a.surplus || a.warehouseId.localeCompare(b.warehouseId))) {
    if (remaining <= 0) break;
    const quantity = Math.min(remaining, Math.max(0, source.surplus));
    if (quantity > 0) transfers.push({ sourceWarehouseId: source.warehouseId, quantity });
    remaining -= quantity;
  }
  return { transfers, purchaseQuantity: remaining };
}
