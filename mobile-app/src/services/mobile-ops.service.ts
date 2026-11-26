import { apiClient } from './api';

export interface WarehouseOption {
  id: string;
  code: string;
  name: string;
  storeId: string;
  active: boolean;
}

export interface DailyChecklistItem {
  id: string;
  storeId: string;
  dateKey: string;
  category: 'FEFO' | 'SHELF' | 'STOCK' | 'IOT' | string;
  title: string;
  description?: string | null;
  sortOrder: number;
  completed: boolean;
  completedById?: string | null;
  completedByName?: string | null;
  completedAt?: string | null;
  note?: string | null;
}

export interface DailyChecklistResponse {
  storeId: string;
  dateKey: string;
  items: DailyChecklistItem[];
  summary: {
    total: number;
    completed: number;
    percent: number;
  };
}

export interface QuickStocktakeRecord {
  id: string;
  code: string;
  storeId: string;
  warehouseId?: string | null;
  skuId: string;
  skuCode: string;
  barcode: string;
  productName: string;
  systemQuantity: number;
  actualQuantity: number;
  difference: number;
  note?: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reportedById: string;
  reportedByName: string;
  reviewedByName?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
  createdAt: string;
}

export interface IncidentReportRecord {
  id: string;
  code: string;
  storeId: string;
  warehouseId?: string | null;
  type: 'DAMAGED' | 'EXPIRED' | 'STOCK_MISMATCH' | 'IOT_DEVICE';
  title: string;
  description: string;
  relatedCode?: string | null;
  relatedName?: string | null;
  imageUrl?: string | null;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
  reportedById: string;
  reportedByName: string;
  handledByName?: string | null;
  handledAt?: string | null;
  resolutionNote?: string | null;
  createdAt: string;
}

export interface PersonalActivityRecord {
  id: string;
  activityType: 'BARCODE_SCAN' | 'RFID_SCAN' | 'CHECKLIST_DONE' | 'STOCKTAKE_SUBMIT' | 'INCIDENT_REPORT' | string;
  title: string;
  detail?: string | null;
  targetCode?: string | null;
  createdAt: string;
}

export async function fetchWarehousesForStore(storeId?: string): Promise<WarehouseOption[]> {
  try {
    const query = storeId ? `?storeId=${encodeURIComponent(storeId)}` : '';
    const res = await apiClient<any>(`/warehouses${query}`);
    const list = Array.isArray(res) ? res : Array.isArray(res?.items) ? res.items : [];
    return list
      .filter((w: any) => w && w.active !== false)
      .map((w: any) => ({
        id: w.id,
        code: w.code,
        name: w.name,
        storeId: w.storeId,
        active: w.active !== false,
      }));
  } catch {
    return [];
  }
}

export async function fetchDailyChecklist(storeId?: string, dateKey?: string): Promise<DailyChecklistResponse> {
  const params = new URLSearchParams();
  if (storeId) params.set('storeId', storeId);
  if (dateKey) params.set('date', dateKey);
  const qs = params.toString();
  return apiClient<DailyChecklistResponse>(`/mobile-ops/checklist${qs ? `?${qs}` : ''}`);
}

export async function toggleDailyChecklistItem(
  id: string,
  completed: boolean,
  note?: string | null
): Promise<DailyChecklistItem> {
  return apiClient<DailyChecklistItem>(`/mobile-ops/checklist/${id}/toggle`, {
    method: 'PATCH',
    body: JSON.stringify({ completed, note }),
  });
}

export async function submitQuickStocktake(payload: {
  storeId?: string;
  warehouseId?: string;
  barcode: string;
  actualQuantity: number;
  note?: string | null;
}): Promise<QuickStocktakeRecord> {
  return apiClient<QuickStocktakeRecord>('/mobile-ops/quick-stocktakes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchQuickStocktakes(params?: {
  storeId?: string;
  status?: string;
  mineOnly?: boolean;
}): Promise<QuickStocktakeRecord[]> {
  const sp = new URLSearchParams();
  if (params?.storeId) sp.set('storeId', params.storeId);
  if (params?.status) sp.set('status', params.status);
  if (params?.mineOnly) sp.set('mineOnly', 'true');
  const qs = sp.toString();
  return apiClient<QuickStocktakeRecord[]>(`/mobile-ops/quick-stocktakes${qs ? `?${qs}` : ''}`);
}

export async function submitIncidentReport(payload: {
  storeId?: string;
  warehouseId?: string;
  type: 'DAMAGED' | 'EXPIRED' | 'STOCK_MISMATCH' | 'IOT_DEVICE';
  title: string;
  description: string;
  relatedCode?: string | null;
  relatedName?: string | null;
  imageUrl?: string | null;
}): Promise<IncidentReportRecord> {
  return apiClient<IncidentReportRecord>('/mobile-ops/incidents', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchIncidentReports(params?: {
  storeId?: string;
  status?: string;
  type?: string;
  mineOnly?: boolean;
}): Promise<IncidentReportRecord[]> {
  const sp = new URLSearchParams();
  if (params?.storeId) sp.set('storeId', params.storeId);
  if (params?.status) sp.set('status', params.status);
  if (params?.type) sp.set('type', params.type);
  if (params?.mineOnly) sp.set('mineOnly', 'true');
  const qs = sp.toString();
  return apiClient<IncidentReportRecord[]>(`/mobile-ops/incidents${qs ? `?${qs}` : ''}`);
}

export async function logBarcodeScanActivity(payload: {
  storeId?: string | null;
  barcode: string;
  productName: string;
  availableQty: number;
}): Promise<void> {
  try {
    await apiClient('/mobile-ops/activities', {
      method: 'POST',
      body: JSON.stringify({
        storeId: payload.storeId ?? undefined,
        activityType: 'BARCODE_SCAN',
        title: `Quét tra cứu: ${payload.productName}`,
        detail: `Barcode ${payload.barcode} · Tồn khả dụng: ${payload.availableQty}`,
        targetCode: payload.barcode,
      }),
    });
  } catch {
    // non-blocking telemetry
  }
}

export async function fetchPersonalActivities(
  range: 'today' | '7d' | '30d' | 'all' = '7d'
): Promise<PersonalActivityRecord[]> {
  return apiClient<PersonalActivityRecord[]>(`/mobile-ops/activities?range=${range}`);
}
