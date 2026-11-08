import 'dotenv/config';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prisma } from './common/database.js';
import { readableProductCodes } from './readable-product-codes.js';

const originalCodeByReadable = new Map(Object.entries(readableProductCodes).map(([original, readable]) => [readable, original]));

const products = await prisma.product.findMany({ where: { archivedAt: null }, select: { id: true, code: true, imageUrl: true } });
let updated = 0;
for (const product of products) {
  if (product.imageUrl?.startsWith('/products/') && existsSync(fileURLToPath(new URL('../../web-admin/public' + product.imageUrl, import.meta.url)))) continue;
  let originalCode = originalCodeByReadable.get(product.code) ?? product.code;
  // Older demo databases use numeric codes 100008..100040 for PRD-DEMO-007..040.
  const numericCode = /^1000(\d{2})$/.exec(product.code);
  if (numericCode) originalCode = `PRD-DEMO-${String(Number(numericCode[1]) - 1).padStart(3, '0')}`;
  const legacyCustom: Record<string, string> = {
    '100001': 'PRD-YM-041',
    '100002': 'PRD-DN-077',
    '100003': 'PRD-CF-088',
    '100004': 'PRD-LV-019',
    '100005': 'PRD-OL-060',
    '100006': 'PRD-TE-077',
    '100007': 'PRD-TEST-001',
  };
  if (legacyCustom[product.code]) originalCode = legacyCustom[product.code];
  const imageUrl = `/products/${originalCode.toLowerCase()}.png`;
  if (!existsSync(fileURLToPath(new URL('../../web-admin/public' + imageUrl, import.meta.url)))) { console.warn(`Missing image for ${product.code}; unchanged`); continue; }
  await prisma.product.update({ where: { id: product.id }, data: { imageUrl, imagePublicId: null } });
  updated += 1;
}
console.log(`Updated imageUrl for ${updated} products`);
await prisma.$disconnect();
