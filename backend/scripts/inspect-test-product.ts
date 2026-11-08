import { prisma } from '../src/common/database.js';
import { listInventory } from '../src/modules/inventory/inventory.service.js';
import { inventoryListInput } from '../src/modules/inventory/inventory.schemas.js';
import type { CurrentUser } from '../src/modules/auth/auth.repository.js';
import assert from 'node:assert/strict';
try {
  const target = await prisma.product.findUniqueOrThrow({ where: { code: '100042' } });
  assert(target.archivedAt, 'Target must already be archived');
  const user = { globalAccess: true, stores: [] } as unknown as CurrentUser;
  for (const filter of [{}, { q: 'E2E05' }, { categoryId: target.categoryId }]) {
    const result = await listInventory(user, inventoryListInput.parse({ ...filter, pageSize: 100 }));
    assert(result.items.every(row => row.sku.product.archivedAt === null));
    const expected = await prisma.inventory.count({ where: { sku: { product: { archivedAt: null } } } });
    assert.equal(result.summary.totalSku, expected);
    if ('q' in filter) assert.equal(result.items.length, 0);
  }
  console.log('PASS: archived test product excluded from stock list, search, category filter and summary; historical records preserved.');
} finally { await prisma.$disconnect(); }
