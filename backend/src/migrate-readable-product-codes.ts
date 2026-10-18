import 'dotenv/config';
import { prisma } from './common/database.js';
import { readableProductCodes } from './readable-product-codes.js';

try {
  const existing = await prisma.product.findMany({
    where: { code: { in: Object.keys(readableProductCodes) } },
    select: { id: true, code: true, name: true },
  });
  const currentCodes = new Set(existing.map(product => product.code));
  const planned = existing.map(product => ({ ...product, nextCode: readableProductCodes[product.code]! }));
  const collisions = planned.filter(product => currentCodes.has(product.nextCode) && !planned.some(candidate => candidate.code === product.nextCode));
  if (collisions.length) throw new Error(`Mã đích đã được dùng: ${collisions.map(item => `${item.code} → ${item.nextCode}`).join(', ')}`);

  await prisma.$transaction(async tx => {
    for (const product of planned) {
      await tx.product.update({ where: { id: product.id }, data: { code: `TMP${product.id.replaceAll('-', '')}` } });
    }
    for (const product of planned) {
      await tx.product.update({ where: { id: product.id }, data: { code: product.nextCode } });
    }
  }, { timeout: 30000 });

  console.log(`Đã đổi ${planned.length} mã sản phẩm:`, JSON.stringify(planned.map(({ code, nextCode, name }) => ({ from: code, to: nextCode, name }))));
  const remainingLegacy = await prisma.product.findMany({ where: { code: { startsWith: 'PRD-' } }, select: { code: true, name: true } });
  if (remainingLegacy.length) console.log('Mã sản phẩm cũ chưa có quy tắc đổi:', JSON.stringify(remainingLegacy));
} catch (error) {
  console.error('Không thể đổi mã sản phẩm.', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
