import 'dotenv/config';
import { prisma } from './common/database.js';
import { readableProductCodes } from './readable-product-codes.js';

const originalCodeByReadable = new Map(Object.entries(readableProductCodes).map(([original, readable]) => [readable, original]));

const products = await prisma.product.findMany({ select: { id: true, code: true } });
let updated = 0;
for (const product of products) {
  const originalCode = originalCodeByReadable.get(product.code) ?? product.code;
  const imageUrl = `/products/${originalCode.toLowerCase()}.svg`;
  await prisma.product.update({ where: { id: product.id }, data: { imageUrl, imagePublicId: null } });
  updated += 1;
}
console.log(`Updated imageUrl for ${updated} products`);
await prisma.$disconnect();
