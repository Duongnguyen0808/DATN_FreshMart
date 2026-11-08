// Read-only audit. Never repairs or seeds business data.
import { prisma } from '../src/common/database.js';

try {
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const inventory = await tx.inventory.findMany({ select: { onHand: true, reserved: true, incoming: true, inTransfer: true, lots: { select: { quantity: true } } } });
    const payable = await tx.payable.findMany({ select: { totalAmount: true, paidAmount: true, payments: { select: { amount: true } } } });
    const receivable = await tx.receivable.findMany({ select: { totalAmount: true, paidAmount: true, payments: { select: { amount: true } } } });
    const orders = await tx.purchaseOrderItem.findMany({ select: { orderedQuantity: true, receivedQuantity: true } });
    const issues = {
      negativeStock: inventory.filter(r => Math.min(r.onHand, r.reserved, r.incoming, r.inTransfer) < 0).length,
      overReserved: inventory.filter(r => r.reserved > r.onHand).length,
      negativeLots: inventory.filter(r => r.lots.some(l => l.quantity < 0)).length,
      lotStockMismatch: inventory.filter(r => r.lots.length && r.lots.reduce((sum, l) => sum + l.quantity, 0) !== r.onHand).length,
      overReceived: orders.filter(r => r.receivedQuantity < 0 || r.receivedQuantity > r.orderedQuantity).length,
      invalidDebtBalance: [...payable, ...receivable].filter(r => Number(r.paidAmount) < 0 || Number(r.paidAmount) > Number(r.totalAmount)).length,
      debtPaymentMismatch: [...payable, ...receivable].filter(r => Math.abs(r.payments.reduce((sum, p) => sum + Number(p.amount), 0) - Number(r.paidAmount)) > .01).length,
    };
    return { checked: { inventory: inventory.length, purchaseOrderItems: orders.length, payables: payable.length, receivables: receivable.length }, issues };
  }, { isolationLevel: 'RepeatableRead' });
  console.log(JSON.stringify(result, null, 2));
  if (Object.values(result.issues).some(Boolean)) process.exitCode = 1;
} finally { await prisma.$disconnect(); }
