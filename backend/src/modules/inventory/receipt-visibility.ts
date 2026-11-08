import type { Prisma } from '../../generated/prisma/client.js';

/** Called in the receipt transaction, so a failed receipt never marks stock as new. */
export async function markStockReceived(tx: Prisma.TransactionClient, inventoryId: string, skuId: string, quantity: number) {
  if (quantity <= 0) return;
  const lastReceivedAt = new Date();
  await tx.inventory.update({ where: { id: inventoryId }, data: { lastReceivedAt, lastReceivedQuantity: quantity } });
  await tx.product.updateMany({ where: { skus: { some: { id: skuId } } }, data: { lastReceivedAt } });
}
