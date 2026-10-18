import { api } from './auth-api';

export type DemandForecast = {
  store: { id: string; code: string; name: string };
  run: { id: string; model: string; generatedAt: string; horizonDays: number; historyDays: number; forecastFrom: string; forecastTo: string } | null;
  items: {
    skuId: string; skuCode: string; productId: string; productCode: string; imageUrl: string | null; productName: string; unit: string;
    predictedQuantity: number; observedQuantity: number;
    dataQuality: 'SUFFICIENT' | 'SPARSE' | 'NO_SALES';
    availableAtRun: number; safetyStockAtRun: number;
  }[];
};

export function getDemandForecast(storeId: string, horizonDays: number) {
  const query = new URLSearchParams({ storeId, horizonDays: String(horizonDays) });
  return api<DemandForecast>(`forecasts/demand?${query}`);
}

export function getDemandForecastById(id: string) {
  return api<DemandForecast>(`forecasts/demand/${encodeURIComponent(id)}`);
}

export type ForecastHistory = {
  store: DemandForecast['store'];
  items: {
    id: string; model: string; generatedAt: string; horizonDays: number; historyDays: number;
    forecastFrom: string; forecastTo: string; skuCount: number; predictedQuantity: number;
  }[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export function getForecastHistory(storeId: string, page = 1) {
  const query = new URLSearchParams({ storeId, page: String(page), pageSize: '10' });
  return api<ForecastHistory>(`forecasts/demand/runs?${query}`);
}

export function runDemandForecast(storeId: string, horizonDays: number) {
  return api<DemandForecast>('forecasts/demand', 'POST', { storeId, horizonDays }, 45000);
}

export type ForecastInventoryAdvice = DemandForecast['items'][number] & {
  required: number; plannedSupply: number; shortageQuantity: number;
  severity: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  available: number; safetyStock: number; inTransfer: number; incomingPurchase: number;
  surplusQuantity: number;
};
export type ShortageAlertReport = {
  store: DemandForecast['store'];
  run: DemandForecast['run'];
  summary: { total: number; high: number; medium: number; low: number; shortageQuantity: number };
  analysisItems: ForecastInventoryAdvice[];
  items: (ForecastInventoryAdvice & { severity: 'HIGH' | 'MEDIUM' | 'LOW' })[];
};

export function getShortageAlerts(storeId: string, horizonDays: number) {
  const query = new URLSearchParams({ storeId, horizonDays: String(horizonDays) });
  return api<ShortageAlertReport>(`forecasts/shortages?${query}`);
}
