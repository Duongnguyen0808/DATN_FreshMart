// Additive, idempotent demo sales history through the current Vietnam date.
// All generated codes contain DEMO-TL. Existing non-demo records are never updated.
import { prisma } from '../src/common/database.js';

const dryRun = process.argv.includes('--dry-run');
const DAYS = 30;
const timeZone = 'Asia/Ho_Chi_Minh';
const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const localNoon = new Date(`${today}T12:00:00+07:00`);
const todayStart = new Date(`${today}T00:00:00+07:00`);
const now = new Date();

function dateForDaysAgo(days: number): { key: string; saleAt: Date; openedAt: Date; closedAt: Date } {
  const base = new Date(localNoon.getTime() - days * 86_400_000);
  const key = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(base).replaceAll('-', '');
  const saleAt = days === 0 ? now : base;
  return {
    key,
    saleAt,
    openedAt: new Date(saleAt.getTime() - (days === 0 ? 60 : 4 * 60) * 60_000),
    closedAt: days === 0 ? now : new Date(saleAt.getTime() + 8 * 60 * 60_000),
  };
}

async function main() {
  const stores = await prisma.store.findMany({
    where: { code: { in: ['CN001', 'CN002', 'CN003'] }, active: true },
    include: { warehouses: { where: { active: true }, take: 1 } },
    orderBy: { code: 'asc' },
  });
  const actor = await prisma.user.findFirst({ where: { active: true }, orderBy: { createdAt: 'asc' } });
  if (stores.length !== 3 || stores.some(store => !store.warehouses.length) || !actor) {
    throw new Error('Need the three seeded branches, active warehouses and one active user. Run the normal seed first.');
  }
  const candidates = new Map<string, Awaited<ReturnType<typeof prisma.inventory.findMany>>>();
  for (const store of stores) {
    const rows = await prisma.inventory.findMany({
      where: { warehouseId: store.warehouses[0]!.id, sku: { code: { startsWith: 'SKU-DEMO-' }, active: true } },
      include: { sku: { include: { product: true } }, lots: { select: { id: true } } },
      orderBy: { sku: { code: 'asc' } },
    });
    const eligible = rows.filter(row => row.onHand >= 12 && row.reserved === 0 && row.lots.length === 0);
    if (eligible.length < 3) throw new Error(`Insufficient untracked demo inventory in ${store.code}; no data was changed.`);
    candidates.set(store.code, eligible);
  }
  let created = 0;
  let skipped = 0;
  for (let days = DAYS - 1; days >= 0; days--) {
    const when = dateForDaysAgo(days);
    for (const store of stores) {
      const code = `HD-DEMO-TL-${when.key}-${store.code}`;
      if (await prisma.invoice.findUnique({ where: { code }, select: { id: true } })) { skipped++; continue; }
      if (dryRun) { created++; continue; }
      const rows = candidates.get(store.code)!;
      const preferred = rows[(days + stores.indexOf(store) * 3) % rows.length]!;
      const quantity = 1 + (days % 3);
      const amount = Number(preferred.sku.sellingPrice) * quantity;
      const shiftCode = `CA-DEMO-TL-${when.key}-${store.code}`;
      await prisma.$transaction(async tx => {
        // Recheck inside the transaction so an interrupted run can be resumed safely.
        if (await tx.invoice.findUnique({ where: { code }, select: { id: true } })) return;
        const stock = await tx.inventory.findUniqueOrThrow({ where: { id: preferred.id } });
        if (stock.onHand - stock.reserved < quantity) throw new Error(`Insufficient stock for ${code}`);
        const shift = await tx.workShift.upsert({
          where: { code: shiftCode }, update: {},
          create: {
            code: shiftCode, storeId: store.id, cashierId: actor.id,
            posCode: 'POS-DEMO-TL', name: 'Ca bán hàng dữ liệu demo', status: 'CLOSED',
            openingCash: 500_000, cashRevenue: amount, closingCash: 500_000 + amount,
            cashDiscrepancy: 0, openedAt: when.openedAt, closedAt: when.closedAt,
            approvedAt: when.closedAt, approvedById: actor.id,
            managerNote: 'Dữ liệu DEMO-TL, không phải giao dịch thực.',
          },
        });
        const invoice = await tx.invoice.create({ data: {
          code, shiftId: shift.id, warehouseId: store.warehouses[0]!.id,
          storeId: store.id, cashierId: actor.id, status: 'COMPLETED',
          subtotal: amount, total: amount, completedAt: when.saleAt, createdAt: when.saleAt,
          note: 'Dữ liệu DEMO-TL để kiểm thử báo cáo và dự báo.',
          items: { create: {
            skuId: preferred.skuId, productCode: preferred.sku.product.code,
            skuCode: preferred.sku.code, productName: preferred.sku.product.name,
            unit: preferred.sku.product.unit, quantity,
            unitPrice: preferred.sku.sellingPrice, costPrice: preferred.sku.costPrice, lineTotal: amount,
          } },
          payments: { create: { method: 'CASH', amount } },
        } });
        await tx.inventory.update({ where: { id: stock.id }, data: {
          onHand: { decrement: quantity },
          transactions: { create: {
            warehouseId: stock.warehouseId, skuId: stock.skuId, type: 'SALE',
            quantity: -quantity, beforeQuantity: stock.onHand, afterQuantity: stock.onHand - quantity,
            referenceType: 'INVOICE', referenceId: invoice.id,
            reason: `Bán hàng DEMO-TL ${code}`, actorId: actor.id, occurredAt: when.saleAt,
          } },
        } });
      }, { isolationLevel: 'Serializable', timeout: 15_000 });
      created++;
    }
  }
  console.log(JSON.stringify({ dryRun, throughVietnamDate: today, plannedOrCreated: created, alreadyPresent: skipped, dateWindowDays: DAYS, todayStart: todayStart.toISOString() }));
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
