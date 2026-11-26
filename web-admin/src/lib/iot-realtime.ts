'use client';

import { io, type Socket } from 'socket.io-client';
import { getAccessToken, refreshSession } from './auth-api';
import type { IotEvent } from './iot-api';

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1').replace(/\/$/, '');
const socketOrigin = apiBase.replace(/\/api\/v1$/, '');

let sharedSocket: Socket | null = null;
let activeSubscribers = 0;
let refreshing = false;
let disconnectTimer: number | null = null;

function getSharedSocket(): Socket {
  if (disconnectTimer !== null) {
    window.clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }

  if (!sharedSocket) {
    sharedSocket = io(socketOrigin, {
      auth: { token: getAccessToken() },
      reconnection: true,
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });

    sharedSocket.on('connect_error', async error => {
      if (refreshing || !/UNAUTHENTICATED/.test(error.message)) return;
      refreshing = true;
      try {
        await refreshSession();
        if (sharedSocket) {
          sharedSocket.auth = { token: getAccessToken() };
          sharedSocket.connect();
        }
      } catch {
        sharedSocket?.disconnect();
      } finally {
        refreshing = false;
      }
    });
  }

  return sharedSocket;
}

function subscribeChannel<T>(channel: string, onEvent: (event: T) => void, onStatus?: (connected: boolean) => void) {
  const socket = getSharedSocket();
  activeSubscribers++;

  const wrappedListener = (data: unknown) => {
    onEvent(data as T);
  };

  const connectListener = () => onStatus?.(true);
  const disconnectListener = () => onStatus?.(false);

  socket.on(channel, wrappedListener);
  socket.on('connect', connectListener);
  socket.on('disconnect', disconnectListener);

  if (socket.connected) {
    onStatus?.(true);
  }

  return () => {
    socket.off(channel, wrappedListener);
    socket.off('connect', connectListener);
    socket.off('disconnect', disconnectListener);

    activeSubscribers--;
    if (activeSubscribers <= 0) {
      activeSubscribers = 0;
      if (disconnectTimer === null && typeof window !== 'undefined') {
        disconnectTimer = window.setTimeout(() => {
          disconnectTimer = null;
          if (activeSubscribers === 0 && sharedSocket) {
            sharedSocket.disconnect();
            sharedSocket = null;
          }
        }, 15000);
      }
    }
  };
}

export const subscribeIotEvents = (onEvent: (event: IotEvent) => void, onStatus?: (connected: boolean) => void) => subscribeChannel('iot:event', onEvent, onStatus);
export const subscribeWarehouseAccess = (onUpdate: (update: unknown) => void, onStatus?: (connected: boolean) => void) => subscribeChannel('iot:access', onUpdate, onStatus);
export type InventoryUpdate = { eventId: string; warehouseId: string; reason: string; timestamp: string };
export const subscribeInventoryUpdates = (onUpdate: (update: InventoryUpdate) => void, onStatus?: (connected: boolean) => void) => subscribeChannel('inventory:updated', onUpdate, onStatus);
