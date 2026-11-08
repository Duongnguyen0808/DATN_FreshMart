import 'dotenv/config';
import assert from 'node:assert/strict';
import { prisma } from './src/common/database.js';
import { publicUser, userInclude } from './src/modules/auth/auth.repository.js';
import { upsertTagMapping } from './src/modules/iot/iot.service.js';

// Local, user-requested demo setup. Does not synthesize device scans or receive stock.
try {
  const account = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@gmail.com' }, include: userInclude });
  const user = publicUser(account);
  assert(user.active && user.permissions.includes('warehouses.manage'));
  const warehouse = await prisma.warehouse.findUniqueOrThrow({ where: { code: 'KHO001' } });
  const before = await prisma.inventory.findMany({ orderBy: { id: 'asc' } });
  for (const item of [{ tagId: 'D00C330C', productCode: '100009', palletCode: 'PL001' }, { tagId: 'F31B93DC', productCode: '100040', palletCode: 'PL002' }]) {
    const sku = await prisma.sku.findFirstOrThrow({ where: { active: true, product: { code: item.productCode, active: true, archivedAt: null } }, include: { product: true } });
    const existing = await prisma.iotTagMapping.findUnique({ where: { tagId: item.tagId } });
    assert(!existing || (existing.skuId === sku.id && existing.warehouseId === warehouse.id), 'Tag already assigned elsewhere; review before replacing');
    const result = await upsertTagMapping(user, { tagId: item.tagId, skuId: sku.id, warehouseId: warehouse.id, palletCode: item.palletCode });
    console.log(JSON.stringify({ tagId: result.tagId, product: sku.product.name, pallet: result.palletCode, warehouse: warehouse.name }));
  }
  assert.deepEqual(await prisma.inventory.findMany({ orderBy: { id: 'asc' } }), before);
  console.log('Verified: mappings saved, inventory unchanged. Scan physical tags again to create mapped events.');
} finally { await prisma.$disconnect(); }
