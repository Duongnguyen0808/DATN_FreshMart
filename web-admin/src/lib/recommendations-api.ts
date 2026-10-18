import { api } from './auth-api';
import type { DemandForecast } from './forecasts-api';

export type InventoryRecommendation = {
  id: string; type: 'TRANSFER' | 'PURCHASE'; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
  priority: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  skuId: string; skuCode: string; productCode: string; imageUrl: string | null; productName: string; unit: string;
  suggestedQuantity: number; finalQuantity: number | null; decisionNote: string | null;
  createdAt: string; decidedAt: string | null;
  targetStore: { id: string; code: string; name: string };
  sourceWarehouse: { id: string; code: string; name: string; store: { id: string; code: string; name: string } } | null;
  destinationWarehouse: { id: string; code: string; name: string } | null;
  transfer: { id: string; code: string; status: string } | null;
  purchaseRequest: { id: string; code: string; status: string } | null;
  decidedBy: { id: string; name: string } | null;
};
export type RecommendationList = { store: DemandForecast['store']; run: DemandForecast['run']; items: InventoryRecommendation[] };

export function getRecommendations(storeId: string, horizonDays: number) {
  const query = new URLSearchParams({ storeId, horizonDays: String(horizonDays) });
  return api<RecommendationList>(`recommendations?${query}`);
}
export function generateRecommendations(storeId: string, horizonDays: number) {
  return api<RecommendationList>('recommendations/generate', 'POST', { storeId, horizonDays });
}
export function decideRecommendation(id: string, action: 'APPROVE' | 'REJECT', note: string, quantity?: number) {
  return api<InventoryRecommendation>(`recommendations/${id}/decision`, 'POST', { action, note, ...(quantity === undefined ? {} : { quantity }) });
}
