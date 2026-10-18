type ReturnLine = { quantity: number; restock: boolean; lineRefund: unknown };
type SalesLine = { quantity: number; lineTotal: unknown; costPrice: unknown; salesReturnItems: ReturnLine[] };

export function calculateNetSalesLine(invoice: { subtotal: unknown; total: unknown }, item: SalesLine) {
  const subtotal = Number(invoice.subtotal);
  const discountRatio = subtotal > 0 ? Number(invoice.total) / subtotal : 0;
  const returnedQuantity = item.salesReturnItems.reduce((sum, row) => sum + row.quantity, 0);
  const restockedQuantity = item.salesReturnItems.reduce((sum, row) => sum + (row.restock ? row.quantity : 0), 0);
  const refundedAmount = item.salesReturnItems.reduce((sum, row) => sum + Number(row.lineRefund), 0);
  return {
    grossSales: Number(item.lineTotal),
    netRevenue: Number(item.lineTotal) * discountRatio - refundedAmount,
    costOfGoods: (item.quantity - restockedQuantity) * Number(item.costPrice),
    netQuantity: item.quantity - returnedQuantity,
  };
}
