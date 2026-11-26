import { apiClient } from './api';
import { ProductSku, ProductStockDetail, InventoryLot } from '../types';

export interface FeaturedProductItem {
  id: string;
  code: string;
  name: string;
  unit: string;
  imageUrl?: string | null;
  categoryName?: string;
  barcode: string;
  sellingPrice: number;
}

export async function fetchFeaturedProducts(limit = 8): Promise<FeaturedProductItem[]> {
  try {
    const res = await apiClient<any>(`/products?limit=${limit}&active=true`);
    const list = Array.isArray(res) ? res : Array.isArray(res?.items) ? res.items : [];
    return list.slice(0, limit).map((item: any) => {
      const primarySku = Array.isArray(item.skus) && item.skus.length > 0 ? item.skus[0] : null;
      return {
        id: item.id,
        code: item.code || primarySku?.code || '',
        name: item.name || 'Sản phẩm',
        unit: item.unit || 'sp',
        imageUrl: item.imageUrl || null,
        categoryName: item.category?.name || 'Bán lẻ',
        barcode: primarySku?.barcode || item.barcode || '',
        sellingPrice: Number(primarySku?.sellingPrice ?? item.sellingPrice ?? 0),
      };
    });
  } catch (err) {
    console.warn('Could not fetch featured products', err);
    return [];
  }
}

export async function lookupProductByBarcode(
  barcode: string,
  storeId?: string
): Promise<ProductStockDetail> {
  const cleaned = barcode.trim();
  if (!cleaned) {
    throw new Error('Mã vạch không được để trống.');
  }

  // 1. Fetch SKU and base product metadata
  let sku: ProductSku;
  if (/^\d{8,14}$/.test(cleaned)) {
    sku = await apiClient<ProductSku>(`/products/barcode/${encodeURIComponent(cleaned)}`);
  } else {
    // Cho phép tra cứu thủ công bằng mã sản phẩm / mã SKU (VD: 100020)
    const searchRes = await apiClient<any>(`/products?q=${encodeURIComponent(cleaned)}&limit=5`);
    const list = Array.isArray(searchRes) ? searchRes : Array.isArray(searchRes?.items) ? searchRes.items : [];
    const matched = list.find(
      (p: any) =>
        p.code?.toLowerCase() === cleaned.toLowerCase() ||
        p.skus?.some((s: any) => s.code?.toLowerCase() === cleaned.toLowerCase() || s.barcode === cleaned)
    );
    const primarySku = matched?.skus?.[0];
    if (!matched || !primarySku) {
      throw new Error(`Không tìm thấy sản phẩm với mã "${cleaned}". Mã vạch sản phẩm cần gồm 8–14 chữ số.`);
    }
    sku = {
      id: primarySku.id,
      code: primarySku.code || matched.code,
      barcode: primarySku.barcode || cleaned,
      sellingPrice: Number(primarySku.sellingPrice ?? 0),
      costPrice: Number(primarySku.costPrice ?? 0),
      product: {
        id: matched.id,
        code: matched.code,
        name: matched.name,
        unit: matched.unit,
        imageUrl: matched.imageUrl || null,
        category: matched.category,
      },
    };
  }

  // 2. Fetch lot stock details for this SKU
  let lots: InventoryLot[] = [];
  try {
    const allLots = await apiClient<any[]>('/inventory-lots');
    if (Array.isArray(allLots)) {
      lots = allLots
        .filter((l) => l.inventory?.skuId === sku.id || l.inventory?.sku?.id === sku.id)
        .map((l) => ({
          id: l.id,
          lotNumber: l.code || l.lotNumber || 'Lô mặc định',
          quantity: Number(l.quantity || 0),
          unitCost: l.unitCost ? Number(l.unitCost) : undefined,
          expiresAt: l.expiresAt,
          daysRemaining: l.daysRemaining ?? null,
          expired: !!l.expired,
          status: l.status,
          zone: l.zone || (l.status === 'AVAILABLE' ? 'Kệ hàng' : 'Khu cách ly'),
          warehouseId: l.inventory?.warehouseId,
          warehouseName: l.inventory?.warehouse?.name,
        }));
    }
  } catch (err) {
    console.warn('Could not fetch lots for barcode', err);
  }

  // 3. Compute totals
  const totalOnHand = lots.reduce((sum, l) => sum + (l.status === 'AVAILABLE' ? l.quantity : 0), 0);
  const totalAvailable = lots
    .filter((l) => l.status === 'AVAILABLE' && !l.expired)
    .reduce((sum, l) => sum + l.quantity, 0);

  return {
    sku,
    totalOnHand,
    totalAvailable,
    lots,
  };
}
