import 'dotenv/config';
import { prisma } from './common/database.js';
import { readableProductCodes } from './readable-product-codes.js';

const originalCodeByReadable = new Map(Object.entries(readableProductCodes).map(([original, readable]) => [readable, original]));

const products = await prisma.product.findMany({ select: { id: true, code: true } });
let updated = 0;
for (const product of products) {
  let originalCode = originalCodeByReadable.get(product.code) ?? product.code;
  // Older demo databases use numeric codes 100008..100040 for PRD-DEMO-007..040.
  const numericCode = /^1000(\d{2})$/.exec(product.code);
  if (numericCode) originalCode = `PRD-DEMO-${String(Number(numericCode[1]) - 1).padStart(3, '0')}`;
  const imageUrl = `/products/${originalCode.toLowerCase()}.png`;
  await prisma.product.update({ where: { id: product.id }, data: { imageUrl, imagePublicId: null } });
  updated += 1;
}
console.log(`Updated imageUrl for ${updated} products`);
await prisma.$disconnect();
