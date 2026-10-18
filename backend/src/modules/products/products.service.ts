import { z } from 'zod';
import { prisma } from '../../common/database.js';
import { AppError } from '../../common/app-error.js';
import { logger } from '../../common/logger.js';
import type { CurrentUser } from '../auth/auth.repository.js';
import { destroyProductImage, uploadProductImage } from './cloudinary.service.js';

const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,39}$/);
const price = z.coerce.number().finite().min(0).max(999_999_999_999);
export const idInput = z.string().uuid();
export const barcodeInput = z.string().trim().regex(/^\d{8,14}$/);
export const listInput = z.object({ q: z.string().trim().max(100).optional(), active: z.enum(['true', 'false', 'all']).default('all'), stockStatus: z.enum(['all', 'IN_STOCK', 'OUT_OF_STOCK']).default('all'), categoryId: z.string().uuid().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }).strict();
export const availabilityInput = z.object({ code: code.optional(), sku: code.optional(), barcode: barcodeInput.optional(), excludeProductId: z.string().uuid().optional(), excludeSkuId: z.string().uuid().optional() }).strict();
export const categoryListInput = listInput.pick({ q: true, active: true });
export const categoryInput = z.object({ code, name: z.string().trim().min(1).max(100), description: z.string().trim().max(500).optional().nullable().transform(value => value || null) }).strict();
export const categoryUpdate = categoryInput.omit({ code: true });
const skuInput = z.object({ code, barcode: barcodeInput, sellingPrice: price, costPrice: price }).strict();
const validSkuPrice = (value: z.infer<typeof skuInput>) => value.sellingPrice >= value.costPrice;
export const skuCreateInput = skuInput.refine(validSkuPrice, { message: 'Giá bán phải lớn hơn hoặc bằng giá vốn.', path: ['sellingPrice'] });
export const skuUpdateInput = skuCreateInput;
const productBase = z.object({
  code,
  name: z.string().trim().min(1).max(150),
  unit: z.string().trim().min(1).max(30),
  baseUnit: z.string().trim().min(1).max(30).optional().nullable().transform(value => value || null),
  unitsPerUnit: z.coerce.number().int().min(1).max(100_000).default(1),
  categoryId: z.string().uuid(),
  imageDataUrl: z.string().max(7_100_000).optional(),
  sku: skuInput,
}).strict();
const validPrice = <T extends { sku: { sellingPrice: number; costPrice: number } }>(value: T) => value.sku.sellingPrice >= value.sku.costPrice;
export const productInput = productBase.omit({ code: true }).extend({ sku: skuInput.omit({ code: true }) }).refine(validPrice, { message: 'Giá bán phải lớn hơn hoặc bằng giá vốn.', path: ['sku', 'sellingPrice'] });
export const productUpdate = productBase.omit({ code: true }).extend({ removeImage: z.boolean().optional().default(false), sku: skuInput.extend({ id: z.string().uuid() }) })
  .refine(value => !(value.imageDataUrl && value.removeImage), { message: 'Không thể vừa thay vừa xóa ảnh sản phẩm.', path: ['imageDataUrl'] })
  .refine(validPrice, { message: 'Giá bán phải lớn hơn hoặc bằng giá vốn.', path: ['sku', 'sellingPrice'] });
export const statusInput = z.object({ active: z.boolean() }).strict();

const includeList = { category: true, skus: { orderBy: { createdAt: 'asc' as const } } };
const includeDetail = { category: true, skus: { orderBy: { createdAt: 'asc' as const }, include: { priceHistory: { orderBy: { effectiveAt: 'desc' as const }, take: 30, include: { changedBy: { select: { id: true, name: true, email: true } } } } } } };
const presentSku = <T extends { sellingPrice: unknown; costPrice: unknown }>(sku: T) => ({ ...sku, sellingPrice: Number(sku.sellingPrice), costPrice: Number(sku.costPrice) });
const presentProduct = <T extends { skus: Array<{ sellingPrice: unknown; costPrice: unknown }> }>(product: T) => ({ ...product, skus: product.skus.map(presentSku) });

async function requireActiveCategory(categoryId: string) {
  const category = await prisma.category.findUnique({ where: { id: categoryId }, select: { active: true } });
  if (!category) throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy danh mục sản phẩm.');
  if (!category.active) throw new AppError(409, 'CATEGORY_INACTIVE', 'Danh mục đã ngừng hoạt động.');
}

export function listCategories(input: z.infer<typeof categoryListInput>) {
  return prisma.category.findMany({ where: { ...(input.active === 'all' ? {} : { active: input.active === 'true' }), ...(input.q ? { OR: [{ code: { contains: input.q, mode: 'insensitive' as const } }, { name: { contains: input.q, mode: 'insensitive' as const } }] } : {}) }, include: { _count: { select: { products: true } } }, orderBy: { name: 'asc' } });
}

export async function createCategory(user: CurrentUser, input: z.infer<typeof categoryInput>) {
  return prisma.$transaction(async tx => { const row = await tx.category.create({ data: input }); await tx.auditLog.create({ data: { actorId: user.id, action: 'category.create', targetId: row.id } }); return row; });
}

export async function updateCategory(user: CurrentUser, id: string, input: z.infer<typeof categoryUpdate>) {
  return prisma.$transaction(async tx => { const row = await tx.category.update({ where: { id }, data: input }); await tx.auditLog.create({ data: { actorId: user.id, action: 'category.update', targetId: id } }); return row; });
}

export async function changeCategoryStatus(user: CurrentUser, id: string, active: boolean) {
  if (!active && await prisma.product.count({ where: { categoryId: id, active: true } })) throw new AppError(409, 'CATEGORY_IN_USE', 'Hãy ngừng các sản phẩm đang kinh doanh trước khi ngừng danh mục.');
  return prisma.$transaction(async tx => { const row = await tx.category.update({ where: { id }, data: { active } }); await tx.auditLog.create({ data: { actorId: user.id, action: active ? 'category.activate' : 'category.deactivate', targetId: id } }); return row; });
}

export async function listProducts(input: z.infer<typeof listInput>, user: CurrentUser) {
  const warehouseScope = user.globalAccess ? {} : { warehouse: { storeId: { in: user.stores.map(store => store.id) } } };
  const inventoryStock = input.stockStatus === 'IN_STOCK' ? { some: { onHand: { gt: 0 }, ...warehouseScope } } : input.stockStatus === 'OUT_OF_STOCK' ? { none: { onHand: { gt: 0 }, ...warehouseScope } } : undefined;
  const where = { ...(input.active === 'all' ? {} : { active: input.active === 'true' }), ...(input.categoryId ? { categoryId: input.categoryId } : {}), ...(inventoryStock ? { skus: { some: { inventories: inventoryStock } } } : {}), ...(input.q ? { OR: [{ code: { contains: input.q, mode: 'insensitive' as const } }, { name: { contains: input.q, mode: 'insensitive' as const } }, { skus: { some: { OR: [{ code: { contains: input.q, mode: 'insensitive' as const } }, { barcode: { contains: input.q } }] } } }] } : {}) };
  const [items, total, activeCount, inactiveCount] = await prisma.$transaction([
    prisma.product.findMany({ where, include: includeList, orderBy: [{ updatedAt: 'desc' }, { code: 'asc' }], skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
    prisma.product.count({ where }), prisma.product.count({ where: { active: true } }), prisma.product.count({ where: { active: false } }),
  ]);
  const skuIds = items.flatMap(product => product.skus.map(sku => sku.id));
  const inventory = skuIds.length ? await prisma.inventory.groupBy({
    by: ['skuId'],
    where: { skuId: { in: skuIds }, ...warehouseScope },
    _sum: { onHand: true, reserved: true },
  }) : [];
  const stockBySku = new Map(inventory.map(row => [row.skuId, Math.max(0, Number(row._sum.onHand ?? 0) - Number(row._sum.reserved ?? 0))]));
  return { items: items.map(product => ({ ...presentProduct(product), availableStock: product.skus.reduce((sum, sku) => sum + (stockBySku.get(sku.id) ?? 0), 0) })), pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.max(1, Math.ceil(total / input.pageSize)) }, summary: { total: activeCount + inactiveCount, active: activeCount, inactive: inactiveCount } };
}

export async function getNextProductCode() {
  const [row] = await prisma.$queryRaw<Array<{ value: string }>>`SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END::text AS value FROM product_code_sequence`;
  return row!.value;
}

export async function checkProductAvailability(input: z.infer<typeof availabilityInput>) {
  const [product, sku, barcode] = await Promise.all([
    input.code ? prisma.product.findFirst({ where: { code: input.code, ...(input.excludeProductId ? { id: { not: input.excludeProductId } } : {}) }, select: { id: true } }) : null,
    input.sku ? prisma.sku.findFirst({ where: { code: input.sku, ...(input.excludeSkuId ? { id: { not: input.excludeSkuId } } : {}) }, select: { id: true } }) : null,
    input.barcode ? prisma.sku.findFirst({ where: { barcode: input.barcode, ...(input.excludeSkuId ? { id: { not: input.excludeSkuId } } : {}) }, select: { id: true } }) : null,
  ]);
  return { codeAvailable: !product, skuAvailable: !sku, barcodeAvailable: !barcode };
}

export async function getProduct(id: string) {
  const row = await prisma.product.findUnique({ where: { id }, include: includeDetail });
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy sản phẩm.');
  return { ...presentProduct(row), skus: row.skus.map(sku => ({ ...presentSku(sku), priceHistory: sku.priceHistory.map(item => ({ ...item, sellingPrice: Number(item.sellingPrice), costPrice: Number(item.costPrice) })) })) };
}

export async function findByBarcode(value: string) {
  const row = await prisma.sku.findUnique({ where: { barcode: value }, include: { product: { include: { category: true } } } });
  if (!row || !row.active || !row.product.active || !row.product.category.active) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy SKU đang kinh doanh với barcode này.');
  return presentSku(row);
}

export async function createProduct(user: CurrentUser, input: z.infer<typeof productInput>) {
  await requireActiveCategory(input.categoryId);
  const uploaded = input.imageDataUrl ? await uploadProductImage(input.imageDataUrl) : null;
  try {
    return await prisma.$transaction(async tx => {
      const [generated] = await tx.$queryRaw<Array<{ value: string }>>`SELECT nextval('product_code_sequence')::text AS value`;
      const productCode = generated!.value;
      const skuCode = productCode;
      const row = await tx.product.create({ data: { code: productCode, name: input.name, unit: input.unit, baseUnit: input.baseUnit, unitsPerUnit: input.unitsPerUnit, categoryId: input.categoryId, ...uploaded, skus: { create: { code: skuCode, barcode: input.sku.barcode, sellingPrice: input.sku.sellingPrice, costPrice: input.sku.costPrice, priceHistory: { create: { sellingPrice: input.sku.sellingPrice, costPrice: input.sku.costPrice, changedById: user.id } } } } }, include: includeList });
      const warehouses = await tx.warehouse.findMany({ where: { active: true }, select: { id: true } });
      if (warehouses.length) await tx.inventory.createMany({ data: warehouses.map(warehouse => ({ warehouseId: warehouse.id, skuId: row.skus[0]!.id })) });
      await tx.auditLog.create({ data: { actorId: user.id, action: 'product.create', targetId: row.id } });
      return presentProduct(row);
    });
  } catch (error) {
    if (uploaded) await destroyProductImage(uploaded.imagePublicId).catch(reason => logger.warn({ err: reason }, 'Unable to clean up uploaded product image'));
    throw error;
  }
}

export async function updateProduct(user: CurrentUser, id: string, input: z.infer<typeof productUpdate>) {
  await requireActiveCategory(input.categoryId);
  const currentProduct = await prisma.product.findUnique({ where: { id }, select: { imagePublicId: true } });
  if (!currentProduct) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy sản phẩm.');
  const currentSku = await prisma.sku.findFirst({ where: { id: input.sku.id, productId: id } });
  if (!currentSku) throw new AppError(404, 'SKU_NOT_FOUND', 'Không tìm thấy SKU thuộc sản phẩm này.');
  const uploaded = input.imageDataUrl ? await uploadProductImage(input.imageDataUrl) : null;
  try {
    const row = await prisma.$transaction(async tx => {
      const image = uploaded ? uploaded : input.removeImage ? { imageUrl: null, imagePublicId: null } : {};
      await tx.product.update({ where: { id }, data: { name: input.name, unit: input.unit, baseUnit: input.baseUnit, unitsPerUnit: input.unitsPerUnit, categoryId: input.categoryId, ...image } });
      const priceChanged = Number(currentSku.sellingPrice) !== input.sku.sellingPrice || Number(currentSku.costPrice) !== input.sku.costPrice;
      await tx.sku.update({ where: { id: input.sku.id }, data: { code: input.sku.code, barcode: input.sku.barcode, sellingPrice: input.sku.sellingPrice, costPrice: input.sku.costPrice } });
      if (priceChanged) await tx.priceHistory.create({ data: { skuId: input.sku.id, sellingPrice: input.sku.sellingPrice, costPrice: input.sku.costPrice, changedById: user.id } });
      await tx.auditLog.create({ data: { actorId: user.id, action: 'product.update', targetId: id } });
      return presentProduct(await tx.product.findUniqueOrThrow({ where: { id }, include: includeList }));
    });
    if ((uploaded || input.removeImage) && currentProduct.imagePublicId) await destroyProductImage(currentProduct.imagePublicId).catch(reason => logger.warn({ err: reason }, 'Unable to delete replaced product image'));
    return row;
  } catch (error) {
    if (uploaded) await destroyProductImage(uploaded.imagePublicId).catch(reason => logger.warn({ err: reason }, 'Unable to clean up uploaded product image'));
    throw error;
  }
}

export async function createSku(user: CurrentUser, productId: string, input: z.infer<typeof skuCreateInput>) {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!product) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy sản phẩm.');
  await prisma.$transaction(async tx => {
    const sku = await tx.sku.create({ data: { ...input, productId, priceHistory: { create: { sellingPrice: input.sellingPrice, costPrice: input.costPrice, changedById: user.id } } } });
    const warehouses = await tx.warehouse.findMany({ where: { active: true }, select: { id: true } });
    if (warehouses.length) await tx.inventory.createMany({ data: warehouses.map(warehouse => ({ warehouseId: warehouse.id, skuId: sku.id })) });
    await tx.auditLog.create({ data: { actorId: user.id, action: 'sku.create', targetId: sku.id, metadata: { productId } } });
  });
  return getProduct(productId);
}

export async function updateSku(user: CurrentUser, productId: string, skuId: string, input: z.infer<typeof skuUpdateInput>) {
  const current = await prisma.sku.findFirst({ where: { id: skuId, productId } });
  if (!current) throw new AppError(404, 'SKU_NOT_FOUND', 'Không tìm thấy SKU thuộc sản phẩm này.');
  await prisma.$transaction(async tx => {
    const priceChanged = Number(current.sellingPrice) !== input.sellingPrice || Number(current.costPrice) !== input.costPrice;
    await tx.sku.update({ where: { id: skuId }, data: input });
    if (priceChanged) await tx.priceHistory.create({ data: { skuId, sellingPrice: input.sellingPrice, costPrice: input.costPrice, changedById: user.id } });
    await tx.auditLog.create({ data: { actorId: user.id, action: 'sku.update', targetId: skuId, metadata: { productId, priceChanged } } });
  });
  return getProduct(productId);
}

export async function changeSkuStatus(user: CurrentUser, productId: string, skuId: string, active: boolean) {
  const current = await prisma.sku.findFirst({ where: { id: skuId, productId }, include: { product: { include: { category: true } } } });
  if (!current) throw new AppError(404, 'SKU_NOT_FOUND', 'Không tìm thấy SKU thuộc sản phẩm này.');
  if (active && (!current.product.active || !current.product.category.active)) throw new AppError(409, 'PRODUCT_INACTIVE', 'Phải kích hoạt sản phẩm và danh mục trước khi mở lại SKU.');
  if (!active && current.product.active) {
    const activeCount = await prisma.sku.count({ where: { productId, active: true } });
    if (activeCount <= 1) throw new AppError(409, 'LAST_ACTIVE_SKU', 'Sản phẩm đang kinh doanh phải còn ít nhất một SKU hoạt động.');
  }
  await prisma.$transaction(async tx => {
    await tx.sku.update({ where: { id: skuId }, data: { active } });
    await tx.auditLog.create({ data: { actorId: user.id, action: active ? 'sku.activate' : 'sku.deactivate', targetId: skuId, metadata: { productId } } });
  });
  return getProduct(productId);
}

export async function changeProductStatus(user: CurrentUser, id: string, active: boolean) {
  const current = await prisma.product.findUnique({ where: { id }, include: { category: true, skus: { where: { active: true }, select: { id: true } } } });
  if (!current) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy sản phẩm.');
  if (active && !current.category.active) throw new AppError(409, 'CATEGORY_INACTIVE', 'Phải kích hoạt danh mục trước.');
  if (active && !current.skus.length) throw new AppError(409, 'NO_ACTIVE_SKU', 'Sản phẩm phải có ít nhất một SKU hoạt động.');
  return prisma.$transaction(async tx => { const row = await tx.product.update({ where: { id }, data: { active }, include: includeList }); await tx.auditLog.create({ data: { actorId: user.id, action: active ? 'product.activate' : 'product.deactivate', targetId: id } }); return presentProduct(row); });
}
