import { api } from './auth-api';

export type Category = { id: string; code: string; name: string; description: string | null; active: boolean; _count: { products: number } };
export type PriceHistory = { id: string; sellingPrice: number; costPrice: number; effectiveAt: string; changedBy: { id: string; name: string; email: string } | null };
export type Sku = { id: string; code: string; barcode: string; sellingPrice: number; costPrice: number; active: boolean; createdAt: string; updatedAt: string; priceHistory?: PriceHistory[] };
export type Product = { id: string; code: string; name: string; unit: string; baseUnit: string | null; unitsPerUnit: number; active: boolean; categoryId: string; imageUrl: string | null; imagePublicId: string | null; category: Category; skus: Sku[]; availableStock?: number; createdAt: string; updatedAt: string };
export type ProductList = { items: Product[]; pagination: { page: number; pageSize: number; total: number; totalPages: number }; summary: { total: number; active: number; inactive: number } };
export type ProductCreate = { name: string; unit: string; baseUnit?: string | null; unitsPerUnit: number; categoryId: string; imageDataUrl?: string; sku: { barcode: string; sellingPrice: number; costPrice: number } };
export type ProductUpdate = Omit<ProductCreate, 'sku'> & { removeImage?: boolean; sku: ProductCreate['sku'] & { code: string; id: string } };
export type SkuInput = ProductCreate['sku'] & { code: string };
export type CategoryInput = { code: string; name: string; description?: string | null };

export const getCategories = (active: 'true' | 'false' | 'all' = 'all') => api<Category[]>(`categories?active=${active}`);
export const createCategory = (data: CategoryInput) => api<Category>('categories', 'POST', data);
export const updateCategory = (id: string, data: Omit<CategoryInput, 'code'>) => api<Category>(`categories/${id}`, 'PUT', data);
export const setCategoryStatus = (id: string, active: boolean) => api<Category>(`categories/${id}/status`, 'PATCH', { active });
export function getProducts(filters: { q?: string; active?: 'true' | 'false' | 'all'; stockStatus?: 'all' | 'IN_STOCK' | 'OUT_OF_STOCK'; categoryId?: string; page?: number; pageSize?: number }) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  params.set('active', filters.active ?? 'all');
  params.set('stockStatus', filters.stockStatus ?? 'all');
  if (filters.categoryId) params.set('categoryId', filters.categoryId);
  params.set('page', String(filters.page ?? 1));
  params.set('pageSize', String(filters.pageSize ?? 20));
  return api<ProductList>(`products?${params}`);
}
export const getProduct = (id: string) => api<Product>(`products/${id}`);
export const getNextProductCode = () => api<string>('products/next-code');
export type ProductAvailability = { codeAvailable: boolean; skuAvailable: boolean; barcodeAvailable: boolean };
export const checkProductAvailability = (values: { code?: string; sku?: string; barcode?: string; excludeProductId?: string; excludeSkuId?: string }) => {
  const params = new URLSearchParams(Object.entries(values).filter(([, value]) => !!value) as [string, string][]);
  return api<ProductAvailability>(`products/availability?${params}`);
};
const imageUploadTimeoutMs = 25000;
export const createProduct = (data: ProductCreate) => api<Product>('products', 'POST', data, imageUploadTimeoutMs);
export const updateProduct = (id: string, data: ProductUpdate) => api<Product>(`products/${id}`, 'PUT', data, imageUploadTimeoutMs);
export const setProductStatus = (id: string, active: boolean) => api<Product>(`products/${id}/status`, 'PATCH', { active });
export const createSku = (productId: string, data: SkuInput) => api<Product>(`products/${productId}/skus`, 'POST', data);
export const updateSku = (productId: string, skuId: string, data: SkuInput) => api<Product>(`products/${productId}/skus/${skuId}`, 'PUT', data);
export const setSkuStatus = (productId: string, skuId: string, active: boolean) => api<Product>(`products/${productId}/skus/${skuId}/status`, 'PATCH', { active });
