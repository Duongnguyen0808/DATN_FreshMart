import { apiClient } from './api';
import { FefoRiskAlert, ShortageAlert } from '../types';

export interface AlertsResult<T> {
  items: T[];
  updatedAt: string;
  hasError: boolean;
  errorMessage?: string;
}

export async function fetchFefoRiskAlertsResult(storeId?: string): Promise<AlertsResult<FefoRiskAlert>> {
  const updatedAt = new Date().toISOString();
  try {
    const query = storeId ? `?storeId=${encodeURIComponent(storeId)}` : '';
    const raw = await apiClient<any>(`/inventory-lots/fefo-ai-risks${query}`);
    const res = Array.isArray(raw) ? raw : Array.isArray(raw?.alerts) ? raw.alerts : Array.isArray(raw?.items) ? raw.items : [];
    if (Array.isArray(res)) {
      const mapped: FefoRiskAlert[] = res.map((item, index) => ({
        id: item.id || `fefo-${index}`,
        lotId: item.lotId,
        skuId: item.skuId || item.id,
        skuCode: item.skuCode || item.code || 'SKU',
        productName: item.productName || item.name || 'Sản phẩm',
        barcode: item.barcode,
        imageUrl: item.imageUrl || null,
        lotNumber: item.lotNumber || 'LÔ-MẶC-ĐỊNH',
        expiresAt: item.expiresAt || '',
        daysRemaining: Number(item.daysRemaining ?? item.daysLeft ?? 0),
        quantity: Number(item.quantity || 0),
        unit: item.unit || 'sp',
        riskLevel: item.riskLevel || (Number(item.daysRemaining ?? 0) <= 7 ? 'CRITICAL' : 'HIGH'),
        recommendedAction:
          item.recommendedAction ||
          (Number(item.daysRemaining ?? 0) <= 7 ? 'DISCOUNT_PROMO' : 'FEFO_PRIORITY'),
        discountPercent: typeof item.discountPercent === 'number' ? item.discountPercent : undefined,
        estimatedLoss: typeof item.estimatedLoss === 'number' ? item.estimatedLoss : undefined,
        storeName: item.storeName,
      }));
      return { items: mapped, updatedAt, hasError: false };
    }
    return { items: [], updatedAt, hasError: false };
  } catch (err: any) {
    return {
      items: [],
      updatedAt,
      hasError: true,
      errorMessage: err?.message || 'Không thể tải dữ liệu cảnh báo cận hạn FEFO.',
    };
  }
}

export async function quarantineInventoryLot(lotId: string, reason: string) {
  return apiClient(`/inventory-lots/${encodeURIComponent(lotId)}/quarantine`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function fetchShortageAlertsResult(storeId?: string): Promise<AlertsResult<ShortageAlert>> {
  const updatedAt = new Date().toISOString();
  if (!storeId) {
    return { items: [], updatedAt, hasError: false };
  }
  try {
    const query = `?storeId=${encodeURIComponent(storeId)}&horizonDays=7`;
    const raw = await apiClient<any>(`/inventory/forecast-alerts${query}`);
    const res = Array.isArray(raw) ? raw : Array.isArray(raw?.alerts) ? raw.alerts : Array.isArray(raw?.items) ? raw.items : [];
    if (Array.isArray(res)) {
      const mapped: ShortageAlert[] = res.map((item, index) => {
        const onHand = Number(item.available ?? item.onHand ?? item.currentStock ?? 0);
        const safety = Number(item.safetyStock ?? 0);
        const forecasted = Number(item.predictedQuantity ?? item.forecastedDemand ?? item.forecast ?? 0);
        const shortage =
          typeof item.shortageQuantity === 'number'
            ? item.shortageQuantity
            : typeof item.shortageUnits === 'number'
            ? item.shortageUnits
            : Math.max(0, forecasted + safety - onHand);
        const risk =
          item.severity ||
          item.riskLevel ||
          (onHand <= 0 ? 'CRITICAL' : onHand < safety ? 'HIGH' : 'MEDIUM');

        return {
          skuId: item.skuId || item.id || `shortage-${index}`,
          skuCode: item.skuCode || item.code || 'SKU',
          productName: item.productName || item.name || 'Sản phẩm',
          barcode: item.barcode || '',
          imageUrl: item.imageUrl || null,
          currentStock: onHand,
          safetyStock: safety,
          forecastedDemand: forecasted,
          shortageUnits: shortage,
          // Không tự tạo xác suất nếu Backend không cung cấp
          stockoutRiskPercent:
            typeof item.stockoutRiskPercent === 'number' ? item.stockoutRiskPercent : -1,
          riskLevel: risk,
          recommendedPurchaseQty:
            typeof item.recommendedPurchaseQty === 'number'
              ? item.recommendedPurchaseQty
              : Math.max(0, shortage),
          storeName: item.storeName || item.warehouseName,
        };
      });
      return { items: mapped, updatedAt, hasError: false };
    }
    return { items: [], updatedAt, hasError: false };
  } catch (err: any) {
    return {
      items: [],
      updatedAt,
      hasError: true,
      errorMessage: err?.message || 'Không thể tải dữ liệu cảnh báo thiếu hàng AI.',
    };
  }
}

export async function fetchFefoRiskAlerts(storeId?: string): Promise<FefoRiskAlert[]> {
  const res = await fetchFefoRiskAlertsResult(storeId);
  return res.items;
}

export async function fetchShortageAlerts(storeId?: string): Promise<ShortageAlert[]> {
  const res = await fetchShortageAlertsResult(storeId);
  return res.items;
}
