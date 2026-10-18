'use client';

import { io, type Socket } from 'socket.io-client';
import { getAccessToken, refreshSession } from './auth-api';
import type { IotEvent } from './iot-api';

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1').replace(/\/$/, '');
const socketOrigin = apiBase.replace(/\/api\/v1$/, '');

export function subscribeIotEvents(onEvent: (event: IotEvent) => void, onStatus?: (connected: boolean) => void) {
  let socket: Socket | null = null;
  let closed = false;
  let refreshing = false;

  const connect = () => {
    if (closed) return;
    socket = io(socketOrigin, { auth: { token: getAccessToken() }, reconnection: true });
    socket.on('iot:event', onEvent);
    socket.on('connect', () => onStatus?.(true));
    socket.on('disconnect', () => onStatus?.(false));
    socket.on('connect_error', async error => {
      if (refreshing || !/UNAUTHENTICATED/.test(error.message)) return;
      refreshing = true;
      try {
        await refreshSession();
        if (!closed && socket) {
          socket.auth = { token: getAccessToken() };
          socket.connect();
        }
      } catch {
        socket?.disconnect();
      } finally {
        refreshing = false;
      }
    });
  };

  connect();
  return () => {
    closed = true;
    socket?.disconnect();
  };
}
