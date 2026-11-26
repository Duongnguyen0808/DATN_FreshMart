export interface Role {
  id: string;
  code: string;
  name: string;
}

export interface Store {
  id: string;
  code: string;
  name: string;
  address?: string;
  phone?: string;
  active: boolean;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  active: boolean;
  roles: Role[];
  globalAccess: boolean;
  permissions: string[];
  stores: Store[];
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: CurrentUser;
}

export interface ProductSku {
  id: string;
  code: string;
  barcode: string;
  sellingPrice: number;
  costPrice: number;
  product: {
    id: string;
    code: string;
    name: string;
    unit: string;
    imageUrl?: string | null;
    category?: {
      id: string;
      name: string;
    };
  };
}

export interface InventoryLot {
  id: string;
  lotNumber: string;
  quantity: number;
  unitCost?: number;
  expiresAt: string | null;
  daysRemaining: number | null;
  expired: boolean;
  status: 'AVAILABLE' | 'HOLD' | 'DISPOSED' | 'EXPIRED';
  zone: string;
  warehouseId?: string;
  warehouseName?: string;
}

export interface ProductStockDetail {
  sku: ProductSku;
  totalOnHand: number;
  totalAvailable: number;
  lots: InventoryLot[];
  storeName?: string;
}

export interface FefoRiskAlert {
  id: string;
  lotId?: string;
  skuId: string;
  skuCode: string;
  productName: string;
  barcode?: string;
  imageUrl?: string | null;
  lotNumber: string;
  expiresAt: string;
  daysRemaining: number;
  quantity: number;
  unit: string;
  riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  recommendedAction: 'DISCOUNT_PROMO' | 'TRANSFER_BRANCH' | 'DISPOSE' | 'FEFO_PRIORITY';
  discountPercent?: number;
  estimatedLoss?: number;
  storeId?: string;
  storeName?: string;
}

export interface ShortageAlert {
  skuId: string;
  skuCode: string;
  productName: string;
  barcode: string;
  imageUrl?: string | null;
  currentStock: number;
  safetyStock: number;
  forecastedDemand: number;
  shortageUnits: number;
  stockoutRiskPercent: number;
  riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  recommendedPurchaseQty: number;
  storeId?: string;
  storeName?: string;
}

export interface IoTDevice {
  id: string;
  code: string;
  name: string;
  active: boolean;
  lastSeenAt: string | null;
  online: boolean;
  warehouseId?: string;
}

export interface IoTAccessDoor {
  id: string;
  code: string;
  name: string;
  device?: { code: string };
}

export interface IoTAccessEvent {
  id: string;
  eventType: 'RFID_SCAN' | 'DOOR_OPEN' | 'DOOR_CLOSED' | 'ACCESS_GRANTED' | 'ACCESS_DENIED';
  occurredAt: string;
  employee?: { id: string; name: string };
  door?: { code: string; name: string };
  result?: string;
  detail?: string;
  granted?: boolean;
}

export interface IoTSecurityAlert {
  id: string;
  alertType: string;
  message: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'PENDING' | 'RESOLVED' | 'INVESTIGATING';
  createdAt: string;
  warehouseId?: string;
}

export interface IoTMonitorData {
  devices: IoTDevice[];
  doors: IoTAccessDoor[];
  events: IoTAccessEvent[];
  alerts: IoTSecurityAlert[];
  cameraStatus?: {
    cameraIp: string | null;
    online: boolean;
    connected: boolean;
    lastSeenAt?: string;
  };
  mode: 'REAL_IOT' | 'SIMULATION';
}

export interface DashboardSummary {
  todayRevenue: number;
  todayInvoices: number;
  fefoAlertCount: number;
  shortageAlertCount: number;
  iotOnlineCount: number;
  iotTotalCount: number;
  pendingTasks: Array<{
    id: string;
    title: string;
    subtitle: string;
    badge: string;
    type: 'fefo' | 'shortage' | 'iot';
    targetTab: 'alerts' | 'iot';
  }>;
}
