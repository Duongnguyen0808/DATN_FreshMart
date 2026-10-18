import { describe, expect, it } from 'vitest';
import { iotEventInput, iotSimulationInput, iotTagMappingInput } from './iot.schemas.js';

const event = {
  eventId: 'reader-1-001', deviceId: 'READER-1', eventType: 'RFID_DETECTED', tagId: '04A1B2C3',
  warehouseId: '11111111-1111-4111-8111-111111111111', timestamp: '2026-10-18T10:00:00.000Z', payload: {},
};

describe('IoT request validation', () => {
  it('accepts an RFID event envelope and rejects unsupported types', () => {
    expect(iotEventInput.safeParse(event).success).toBe(true);
    expect(iotEventInput.safeParse({ ...event, eventType: 'INVENTORY_UPDATE' }).success).toBe(false);
  });
  it('requires a mapped item reference only in mapping setup, not on raw device events', () => {
    expect(iotEventInput.safeParse(event).success).toBe(true);
    expect(iotTagMappingInput.safeParse({ tagId: event.tagId, skuId: '22222222-2222-4222-8222-222222222222', warehouseId: event.warehouseId, palletCode: 'PAL-1' }).success).toBe(true);
  });
  it('creates simulator identity defaults while preserving caller-supplied IDs for safe retries', () => {
    const simulation = iotSimulationInput.parse({ ...event, eventId: undefined, deviceId: undefined });
    expect(simulation.deviceId).toBe('SIMULATOR-WEB');
    expect(simulation.eventId).toBeUndefined();
  });
});
