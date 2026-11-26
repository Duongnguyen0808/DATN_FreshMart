import { apiClient } from './api';
import { IoTMonitorData } from '../types';
import { fetchWarehousesForStore } from './mobile-ops.service';

export interface IoTMonitorExtended extends IoTMonitorData {
  warehouseId: string | null;
  warehouseName: string | null;
  updatedAt: string;
  hasError: boolean;
  errorMessage?: string;
  onlineCount: number;
  totalCount: number;
  grantedCount: number;
  deniedCount: number;
}

export async function fetchIoTMonitorData(
  storeId?: string,
  explicitWarehouseId?: string
): Promise<IoTMonitorExtended> {
  const updatedAt = new Date().toISOString();
  let warehouseId: string | null = explicitWarehouseId ?? null;
  let warehouseName: string | null = null;

  if (!warehouseId) {
    const warehouses = await fetchWarehousesForStore(storeId);
    if (warehouses.length > 0) {
      warehouseId = warehouses[0].id;
      warehouseName = warehouses[0].name;
    }
  }

  let hasError = false;
  let errorMessage: string | undefined;

  const monitorPromise = (async () => {
    if (!warehouseId) return null;
    try {
      return await apiClient<any>(`/iot/access/monitor?warehouseId=${encodeURIComponent(warehouseId)}`);
    } catch (err: any) {
      hasError = true;
      errorMessage = err?.message || 'Không thể tải dữ liệu trạm RFID cửa kho.';
      return null;
    }
  })();

  const cameraPromise = (async () => {
    try {
      return await apiClient<any>('/iot/camera-device-status');
    } catch {
      return null;
    }
  })();

  const [monitorRes, cameraRes] = await Promise.all([monitorPromise, cameraPromise]);

  const devices = (monitorRes?.devices || []).map((d: any) => ({
    id: d.id,
    code: d.code,
    name: d.name,
    active: !!d.active,
    lastSeenAt: d.lastSeenAt,
    online: !!d.online,
    warehouseId: d.warehouseId,
  }));

  const doors = (monitorRes?.doors || []).map((door: any) => ({
    id: door.id,
    code: door.code,
    name: door.name,
    device: door.device,
  }));

  const events = (monitorRes?.events || []).map((e: any) => ({
    id: e.id,
    eventType: e.eventType,
    occurredAt: e.occurredAt,
    employee: e.employee,
    door: e.door,
    result: e.result,
    detail: e.detail,
    granted:
      e.eventType === 'ACCESS_DENIED' || e.result === 'DENIED'
        ? false
        : e.granted !== false,
  }));

  const alerts = (monitorRes?.alerts || []).map((a: any) => ({
    id: a.id,
    alertType: a.alertType,
    message: a.message,
    severity: a.severity || 'HIGH',
    status: a.status || 'PENDING',
    createdAt: a.createdAt,
    warehouseId: a.warehouseId,
  }));

  const hasCameraIp = Boolean(cameraRes?.cameraIp && String(cameraRes.cameraIp).trim().length > 0);
  const cameraStatus = cameraRes
    ? {
        cameraIp: cameraRes.cameraIp || null,
        online: Boolean(cameraRes.online || hasCameraIp),
        connected: Boolean(cameraRes.connected || hasCameraIp),
        lastSeenAt: cameraRes.lastSeenAt || cameraRes.updatedAt || null,
      }
    : undefined;

  const rfidOnline = devices.filter((d: any) => d.online).length;
  const hasCameraRecord = !!cameraStatus;
  const cameraOnline = cameraStatus?.online ? 1 : 0;

  const totalCount = devices.length + (hasCameraRecord ? 1 : 0);
  const onlineCount = rfidOnline + cameraOnline;

  const grantedCount = events.filter((e: any) => e.granted).length;
  const deniedCount = events.filter((e: any) => !e.granted).length;

  return {
    devices,
    doors,
    events,
    alerts,
    cameraStatus,
    mode: monitorRes?.mode || 'REAL_IOT',
    warehouseId,
    warehouseName,
    updatedAt,
    hasError,
    errorMessage,
    onlineCount,
    totalCount,
    grantedCount,
    deniedCount,
  };
}
