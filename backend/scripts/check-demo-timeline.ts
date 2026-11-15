// Read-only verification for the additive demo sales timeline.
import { prisma } from '../src/common/database.js';

try {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).replaceAll('-', '');
  const invoices = await prisma.invoice.findMany({
    where: { code: { startsWith: 'HD-DEMO-TL-' } },
    include: { items: true, payments: true, shift: true },
  });
  const ids = invoices.map(invoice => invoice.id);
  const movements = await prisma.inventoryTransaction.findMany({
    where: { referenceType: 'INVOICE', referenceId: { in: ids } },
  });
  const movementByInvoice = new Map(movements.map(movement => [movement.referenceId, movement]));
  const issues: string[] = [];
  for (const invoice of invoices) {
    const item = invoice.items[0];
    const movement = movementByInvoice.get(invoice.id);
    if (invoice.items.length !== 1 || !item || !movement || movement.quantity !== -item.quantity) issues.push(`${invoice.code}: missing or mismatched stock movement`);
    if (invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0) !== Number(invoice.total)) issues.push(`${invoice.code}: payment mismatch`);
    if (Number(invoice.shift.cashRevenue) !== Number(invoice.total)) issues.push(`${invoice.code}: shift revenue mismatch`);
    if (invoice.shift.storeId !== invoice.storeId) issues.push(`${invoice.code}: shift branch mismatch`);
  }
  const todayInvoices = invoices.filter(invoice => invoice.code.includes(`-${today}-`));
  if (todayInvoices.length !== 3) issues.push(`Expected three demo invoices today, found ${todayInvoices.length}`);
  console.log(JSON.stringify({ checkedInvoices: invoices.length, today, todayInvoices: todayInvoices.map(invoice => invoice.code), checkedMovements: movements.length, issues }, null, 2));
  if (issues.length) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
