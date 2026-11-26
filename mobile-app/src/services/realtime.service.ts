import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { getApiBaseUrl, getStoredTokens } from './api';
import { triggerScanSuccessFeedback } from './audio.service';

let sharedSocket: Socket | null = null;
let activeSubscribers = 0;
let disconnectTimer: any = null;

function getSocketOrigin(): string {
  const base = getApiBaseUrl();
  return base.replace(/\/api\/v1\/?$/, '');
}

export async function getSharedMobileSocket(): Promise<Socket> {
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }

  if (!sharedSocket || !sharedSocket.connected) {
    const origin = getSocketOrigin();
    const { accessToken } = await getStoredTokens();

    sharedSocket = io(origin, {
      auth: { token: accessToken || '' },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: 20,
      timeout: 10000,
    });

    sharedSocket.on('connect', () => {
      console.log('⚡ [Realtime] Socket connected to:', origin);
    });

    sharedSocket.on('disconnect', (reason) => {
      console.log('⚡ [Realtime] Socket disconnected:', reason);
    });

    sharedSocket.on('connect_error', (err) => {
      console.warn('⚡ [Realtime] Socket connect error:', err.message);
    });
  }

  return sharedSocket;
}

export function subscribeToRealtimeEvent<T = any>(
  event: string,
  callback: (data: T) => void
): () => void {
  let isMounted = true;

  getSharedMobileSocket().then((socket) => {
    if (!isMounted) return;
    activeSubscribers++;
    socket.on(event, callback);
  });

  return () => {
    isMounted = false;
    if (sharedSocket) {
      sharedSocket.off(event, callback);
      activeSubscribers--;
      if (activeSubscribers <= 0) {
        activeSubscribers = 0;
        disconnectTimer = setTimeout(() => {
          if (activeSubscribers === 0 && sharedSocket) {
            sharedSocket.disconnect();
            sharedSocket = null;
          }
        }, 30000); // Keep alive for 30s when navigating
      }
    }
  };
}

/**
 * Global Realtime Sync hook for Mobile.
 * Mounts in Root Layout to automatically invalidate React Query caches
 * and trigger instant 0s UI updates across Home, Alerts, Scan, IoT, and Ops screens.
 */
export function useRealtimeSync() {
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);

  useEffect(() => {
    let unsubs: Array<() => void> = [];

    getSharedMobileSocket().then((socket) => {
      setIsConnected(socket.connected);

      const onConnect = () => setIsConnected(true);
      const onDisconnect = () => setIsConnected(false);

      socket.on('connect', onConnect);
      socket.on('disconnect', onDisconnect);

      unsubs.push(() => {
        socket.off('connect', onConnect);
        socket.off('disconnect', onDisconnect);
      });

      // 1. IoT & Door Access Events (Instant RFID scan / door status update)
      const onIotAccess = (data: any) => {
        setLastEventAt(new Date());
        queryClient.invalidateQueries({ queryKey: ['iot-monitor'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
        triggerScanSuccessFeedback();
      };
      socket.on('iot:access', onIotAccess);
      socket.on('iot:event', onIotAccess);
      unsubs.push(() => {
        socket.off('iot:access', onIotAccess);
        socket.off('iot:event', onIotAccess);
      });

      // 2. Inventory & Stock Updates (FEFO / Stockout alerts instant refresh)
      const onInventoryUpdated = (_data: any) => {
        setLastEventAt(new Date());
        queryClient.invalidateQueries({ queryKey: ['fefo-alerts'] });
        queryClient.invalidateQueries({ queryKey: ['shortage-alerts'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
        queryClient.invalidateQueries({ queryKey: ['products'] });
      };
      socket.on('inventory:updated', onInventoryUpdated);
      unsubs.push(() => socket.off('inventory:updated', onInventoryUpdated));

      // 3. Mobile Operations Events (Checklist, Stocktake, Incident Report updates)
      const onOpsChecklist = () => {
        setLastEventAt(new Date());
        queryClient.invalidateQueries({ queryKey: ['daily-checklist'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      };
      socket.on('ops:checklist', onOpsChecklist);
      unsubs.push(() => socket.off('ops:checklist', onOpsChecklist));

      const onOpsStocktake = () => {
        setLastEventAt(new Date());
        queryClient.invalidateQueries({ queryKey: ['quick-stocktakes'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      };
      socket.on('ops:stocktake', onOpsStocktake);
      unsubs.push(() => socket.off('ops:stocktake', onOpsStocktake));

      const onOpsIncident = () => {
        setLastEventAt(new Date());
        queryClient.invalidateQueries({ queryKey: ['incident-reports'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      };
      socket.on('ops:incident', onOpsIncident);
      unsubs.push(() => socket.off('ops:incident', onOpsIncident));
    });

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [queryClient]);

  return { isConnected, lastEventAt };
}
