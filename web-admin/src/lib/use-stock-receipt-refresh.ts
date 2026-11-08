'use client';
import { useEffect, useRef } from 'react';
import { subscribeIotEvents } from './iot-realtime';

export function useStockReceiptRefresh(refresh: () => void) {
  const callback = useRef(refresh);
  useEffect(() => { callback.current = refresh; }, [refresh]);
  useEffect(() => {
    const seen = new Set<string>();
    const unsubscribe = subscribeIotEvents(event => {
      if (event.automationStatus !== 'RECEIVED' || !event.goodsReceiptId || seen.has(event.goodsReceiptId)) return;
      if (seen.size > 200) seen.clear();
      seen.add(event.goodsReceiptId);
      callback.current();
    });
    const onFocus = () => callback.current();
    window.addEventListener('focus', onFocus);
    return () => { unsubscribe(); window.removeEventListener('focus', onFocus); };
  }, []);
}
