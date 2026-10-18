export type SourceSurplus = { warehouseId: string; surplus: number };

export function planReplenishment(shortageQuantity: number, sources: SourceSurplus[]) {
  let remaining = shortageQuantity;
  const transfers: { sourceWarehouseId: string; quantity: number }[] = [];
  for (const source of [...sources].sort((a, b) => b.surplus - a.surplus)) {
    if (remaining <= 0) break;
    const quantity = Math.min(remaining, Math.max(0, source.surplus));
    if (quantity > 0) transfers.push({ sourceWarehouseId: source.warehouseId, quantity });
    remaining -= quantity;
  }
  return { transfers, purchaseQuantity: remaining };
}
