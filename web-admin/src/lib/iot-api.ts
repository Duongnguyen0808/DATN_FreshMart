import { api } from './auth-api';

export type IotEvent = {
  id: string;
  eventId: string;
  deviceId: string;
  eventType: 'RFID_DETECTED';
  tagId: string;
  warehouseId: string;
  timestamp: string;
  payload: Record<string, unknown>;
  processed: boolean;
  source: 'DEVICE' | 'SIMULATED';
  receivedAt: string;
  tagMappingId?: string | null;
  mappedSkuId?: string | null;
  palletCode?: string | null;
  mappedSku?: { id: string; code: string; product: { name: string; unit: string } } | null;
};

export async function simulateRfidEvent(event: {
  eventId: string;
  deviceId: string;
  tagId: string;
  warehouseId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}) {
  return api<{ event: IotEvent; duplicate: boolean; waitingForConfirmation: boolean }>('iot/simulate', 'POST', {
    ...event,
    eventType: 'RFID_DETECTED',
  });
}
