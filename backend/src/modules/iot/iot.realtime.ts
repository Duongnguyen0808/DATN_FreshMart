import type { Server } from 'socket.io';
import type { IotEvent } from '../../generated/prisma/client.js';

let io: Server | null = null;

export function attachIotRealtime(server: Server) {
  io = server;
}

export function publishIotEvent(event: IotEvent) {
  io?.to(`iot:warehouse:${event.warehouseId}`).emit('iot:event', event);
}
