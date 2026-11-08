
export type IotEvent = {
  id: string;
  eventId: string;
  deviceId: string;
  eventType: 'RFID_DETECTED' | 'CAMERA_CODE_DETECTED';
  tagId: string;
  warehouseId: string;
  timestamp: string;
  payload: Record<string, unknown>;
  processed: boolean;
  inboundParcelId?: string | null;
  automationStatus?: 'PENDING' | 'WAITING_CONFIRMATION' | 'RECEIVED' | 'ALREADY_RECEIVED' | 'BLOCKED' | 'UNREGISTERED' | null;
  automationMessage?: string | null;
  goodsReceiptId?: string | null;
  source: 'DEVICE' | 'SIMULATED';
  receivedAt: string;
  tagMappingId?: string | null;
  mappedSkuId?: string | null;
  palletCode?: string | null;
  mappedSku?: { id: string; code: string; product: { name: string; unit: string } } | null;
};
