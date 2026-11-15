import { api } from './auth-api';

export type DemandForecast = {
  store: { id: string; code: string; name: string };
  run: { id: string; model: string; generatedAt: string; horizonDays: number; historyDays: number; forecastFrom: string; forecastTo: string } | null;
  items: {
    skuId: string; skuCode: string; productId: string; productCode: string; imageUrl: string | null; productName: string; unit: string;
    purchaseUnit?: string | null; purchasePackSize?: number; leadTimeDays?: number | null;
    predictedQuantity: number; observedQuantity: number;
    dataQuality: 'SUFFICIENT' | 'SPARSE' | 'NO_SALES';
    availableAtRun: number; safetyStockAtRun: number;
    safetyStockEvidence?: { source: string; sampleCount: number; serviceLevel: number; horizonDays: number; basis: string; configuredQuantity: number } | null;
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

export async function runDemandForecast(storeId: string, horizonDays: number) {
  const result = await api<DemandForecast>('forecasts/demand', 'POST', { storeId, horizonDays }, 120000);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('freshmart-forecast-updated'));
  return result;
}

export type SmartRebalanceTransferSource = {
  sourceWarehouseId: string;
  sourceWarehouseCode: string;
  sourceWarehouseName: string;
  sourceStoreId: string;
  sourceStoreName: string;
  availableStock: number;
  ownRequired: number;
  surplusAvailable: number;
  suggestedTransferQty: number;
};

export type SmartRebalancingPlan = {
  totalShortage: number;
  totalTransferQty: number;
  remainingPurchaseQty: number;
  unitCost: number;
  estimatedCapitalSaved: number;
  strategy: 'FULL_TRANSFER' | 'HYBRID_TRANSFER_PURCHASE' | 'FULL_PURCHASE' | 'NONE';
  headline: string;
  transfers: SmartRebalanceTransferSource[];
};

export type ForecastInventoryAdvice = DemandForecast['items'][number] & {
  costPrice?: number;
  sellingPrice?: number;
  required: number; plannedSupply: number; shortageQuantity: number;
  severity: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  available: number; safetyStock: number; inTransfer: number; incomingPurchase: number;
  surplusQuantity: number;
  timing?: { leadTimeDays: number | null; leadTimeCovered: boolean; firstShortageDay: number | null; urgent: boolean; orderNow: boolean | null; leadTimeNeed: number | null; suggestedPacks: number; roundedPurchaseQuantity: number; basis: string };
  smartRebalancing?: SmartRebalancingPlan;
};
export type ShortageAlertReport = {
  store: DemandForecast['store'];
  run: DemandForecast['run'];
  summary: { total: number; high: number; medium: number; low: number; shortageQuantity: number; transferableQuantity?: number; netPurchaseQuantity?: number; estimatedCapitalSaved?: number };
  analysisItems: ForecastInventoryAdvice[];
  items: (ForecastInventoryAdvice & { severity: 'HIGH' | 'MEDIUM' | 'LOW' })[];
};

export function getShortageAlerts(storeId: string, horizonDays: number) {
  const query = new URLSearchParams({ storeId, horizonDays: String(horizonDays) });
  return api<ShortageAlertReport>(`forecasts/shortages?${query}`);
}

export function executeSmartRebalance(storeId: string, horizonDays: number, skuId: string) {
  return api<{ appliedCount: number; createdCodes?: string[] }>('forecasts/smart-rebalance', 'POST', { storeId, horizonDays, skuId });
}

export type FefoExpiryRiskItem = {
  lotId: string;
  lotCode: string;
  inventoryId: string;
  skuId: string;
  skuCode: string;
  productId: string;
  productCode: string;
  productName: string;
  imageUrl: string | null;
  unit: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  storeId: string;
  storeName: string;
  expiresAt: string;
  daysRemaining: number;
  lotQuantity: number;
  priorLotsQuantity: number;
  priorConsumedDemand?: number;
  evaluatedDays?: number;
  horizonDays: number;
  predictedHorizonDemand: number;
  dailyForecastRate: number;
  projectedSoldBeforeExpiry: number;
  atRiskQuantity: number;
  unsoldRatio?: number;
  costPrice: number;
  sellingPrice: number;
  atRiskValue: number;
  suggestedDiscountPercent: number;
  discountedPrice: number;
  recoverableValue: number;
  riskLevel: 'EXPIRED' | 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'SAFE';
  allocationStatus?:
    | 'EVALUATED_WITHIN_HORIZON'
    | 'BEYOND_FORECAST_HORIZON'
    | 'NO_FORECAST_RUN'
    | 'NO_SALES_HISTORY'
    | 'EXPIRED_OR_QUARANTINED';
  beyondHorizon?: boolean;
  hasValidForecast?: boolean;
  conditionalComboSuggestion?: boolean;
  decisionSource?: 'AI_FORECAST_AND_INVENTORY_BALANCE' | 'RULE_BASED_POLICY' | 'INSUFFICIENT_DATA';
  pendingTransfer: {
    id: string;
    code: string;
    quantity: number;
    destinationWarehouseName: string;
    status: string;
  } | null;
  recommendedTransferBranch: {
    storeId: string;
    storeName: string;
    warehouseId: string;
    warehouseName: string;
    dailyDemandRate: number;
    absorbableQuantity: number;
  } | null;
  aiInsight: string;
};

export type FefoExpiryRiskReport = {
  summary: {
    totalTrackedLots: number;
    atRiskLotsCount: number;
    criticalLotsCount: number;
    totalAtRiskUnits: number;
    totalAtRiskValue: number;
    totalRecoverableValue: number;
  };
  items: FefoExpiryRiskItem[];
};

export function getFefoExpiryRisks(storeId?: string, horizonDays = 14) {
  const params = new URLSearchParams({ horizonDays: String(horizonDays) });
  if (storeId) params.set('storeId', storeId);
  return api<FefoExpiryRiskReport>(`inventory-lots/fefo-ai-risks?${params.toString()}`);
}

export function createFefoRiskTransfer(input: {
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  skuId: string;
  quantity: number;
  lotCode: string;
}) {
  return api<{ id: string; code: string; alreadyExists?: boolean }>('inventory-lots/fefo-ai-transfer', 'POST', input);
}
