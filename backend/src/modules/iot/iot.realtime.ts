import type { Server } from 'socket.io';
import type { IotEvent } from '../../generated/prisma/client.js';
import { parseJson } from '../../common/json-field.js';
import { randomUUID } from 'node:crypto';

let io: Server | null = null;

export function attachIotRealtime(server: Server) {
  io = server;
}

export function publishIotEvent(event: Omit<IotEvent, 'payload'> & { payload: unknown }) {
  const normalized = typeof event.payload === 'string'
    ? { ...event, payload: parseJson<Record<string, unknown>>(event.payload) ?? {} }
    : event;
  io?.to(`iot:warehouse:${event.warehouseId}`).emit('iot:event', normalized);
}

export function publishWarehouseAccess(warehouseId: string, update: unknown) {
  io?.to(`iot:warehouse:${warehouseId}`).emit('iot:access', update);
}

/** Invalidate a warehouse snapshot only after its inventory transaction commits. */
export function publishInventoryUpdate(warehouseId: string, reason: string) {
  io?.to(`iot:warehouse:${warehouseId}`).emit('inventory:updated', {
    eventId: randomUUID(), warehouseId, reason, timestamp: new Date().toISOString(),
  });
}
