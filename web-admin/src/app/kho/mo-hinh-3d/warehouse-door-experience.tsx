'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, errorMessage } from '../../../lib/auth-api';
import { subscribeWarehouseAccess } from '../../../lib/iot-realtime';
import { useAuth } from '../../../components/auth-provider';
import './warehouse-door-experience.css';

export type AccessKind = 'authorized' | 'unauthorized' | 'open-too-long';
export type AccessPhase = 'IDLE' | 'APPROACH' | 'SCANNING' | 'VERIFYING' | 'GRANTED' | 'OPENING' | 'ENTERING' | 'CLOSING' | 'WAITING_REAL' | 'WAITING_ALERT' | 'ALERT' | 'COMPLETE';
type Device = { id: string; code: string; name: string; lastSeenAt: string | null; online: boolean };
type Door = { id: string; code: string; name: string; state: 'OPEN' | 'CLOSED'; openSince: string | null; lastStateChangedAt: string | null; device: { code: string } };
type Card = { id: string; uid: string; status: string; employee: { id: string; name: string } };
type AccessEvent = { id: string; eventType: string; occurredAt: string; source: string; consumedAt?: string | null; payload?: { uid?: string }; employee?: { id: string; name: string } | null; door?: { name: string } | null };
type Alert = { id: string; doorId?: string; type: string; message: string; status: string; createdAt: string };
export type AccessMonitor = { mode: 'REAL_IOT' | 'SIMULATION'; accessWindowSeconds?: number; maxDoorOpenSeconds?: number; simulationDoorOpenSeconds?: number; devices: Device[]; doors: Door[]; cards: Card[]; events: AccessEvent[]; alerts: Alert[]; employees: { id: string; name: string; email: string }[] };
const EMPTY: AccessMonitor = { mode: 'SIMULATION', devices: [], doors: [], cards: [], events: [], alerts: [], employees: [] };
const SIMULATED_DEVICE_PREFIX = 'SIM-ACCESS-';
const SIMULATED_CARD_UID = 'D00C330C';
const label: Record<string, string> = { RFID_SCAN: 'Quét thẻ', ACCESS_GRANTED: 'Thẻ hợp lệ', ACCESS_DENIED: 'Thẻ bị từ chối', DOOR_OPEN: 'Cửa mở', DOOR_CLOSED: 'Cửa đóng', AUTHORIZED_ACCESS: 'Truy cập hợp lệ', UNAUTHORIZED_ACCESS: 'Mở cửa trái phép', DOOR_OPEN_TOO_LONG: 'Cửa mở quá lâu', AFTER_HOURS_ACCESS: 'Mở cửa ngoài giờ', INVALID_RFID: 'Thẻ không hợp lệ', ALERT_CREATED: 'Tạo cảnh báo', ALERT_RESOLVED: 'Đã xử lý cảnh báo' };
const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));
const time = (value?: string | null) => value ? new Date(value).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—';

export type AccessSessionInfo = {
  employeeName: string;
  cardUid: string;
  scanTime: string;
  doorOpenTime: string;
  doorCloseTime: string;
  openDurationSeconds: number;
  shiftName: string;
  attendanceStatus: string;
  doorName: string;
  deviceCode: string;
};

export function getShiftName(date = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', hourCycle: 'h23' }).format(date));
  if (hour >= 6 && hour < 14) return 'Ca sáng (06:00 – 14:00)';
  if (hour >= 14 && hour < 22) return 'Ca chiều (14:00 – 22:00)';
  return 'Ca đêm (22:00 – 06:00)';
}

export function useWarehouseDoor(warehouseId: string, speedMultiplier: number = 1) {
  const { user } = useAuth();
  const canManage = !!user && (user.permissions.includes('warehouses.manage') || user.permissions.includes('*'));
  const canSimulate = !!user && (user.permissions.includes('inventory.read') || user.permissions.includes('*'));
  const [monitor, setMonitor] = useState<AccessMonitor>(EMPTY);
  const [connected, setConnected] = useState(false);
  const [phase, setPhase] = useState<AccessPhase>('IDLE');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [realWaiting, setRealWaiting] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<AccessSessionInfo | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const latestMonitor = useRef(monitor);
  latestMonitor.current = monitor;
  const startedAtRef = useRef(startedAt);
  startedAtRef.current = startedAt;
  const grantedMotionDone = useRef(false);
  const enteringMotionDone = useRef(false);
  const lastSeenScanId = useRef<string | null>(null);
  const initializedScanRef = useRef(false);
  const sequence = useRef(0);
  const pendingMotion = useRef<{ phase: AccessPhase; resolve: (completed: boolean) => void } | null>(null);

  const motionComplete = useCallback((completed: AccessPhase) => {
    if (pendingMotion.current?.phase !== completed) {
      if (latestMonitor.current.mode === 'REAL_IOT') {
        setPhase(current => {
          if (current !== completed) return current;
          const activeDoor = latestMonitor.current.doors.find(item => !item.device.code.startsWith(SIMULATED_DEVICE_PREFIX)) ?? latestMonitor.current.doors[0];
          const recentEvents = latestMonitor.current.events.filter(row => new Date(row.occurredAt).getTime() >= startedAtRef.current);
          const hasDoorOpen = activeDoor?.state === 'OPEN' || recentEvents.some(event => event.eventType === 'DOOR_OPEN');
          const hasDoorClosed = activeDoor?.state === 'CLOSED' || recentEvents.some(event => event.eventType === 'DOOR_CLOSED');
          if (completed === 'APPROACH') return 'SCANNING';
          if (completed === 'SCANNING') return recentEvents.some(event => event.eventType === 'ACCESS_GRANTED') ? 'GRANTED' : 'VERIFYING';
          if (completed === 'GRANTED') {
            grantedMotionDone.current = true;
            return hasDoorOpen ? 'OPENING' : 'GRANTED';
          }
          if (completed === 'OPENING') return 'ENTERING';
          if (completed === 'ENTERING') {
            enteringMotionDone.current = true;
            return hasDoorClosed ? 'CLOSING' : 'ENTERING';
          }
          if (completed === 'CLOSING') return 'COMPLETE';
          return current;
        });
      }
      return;
    }
    pendingMotion.current.resolve(true);
    pendingMotion.current = null;
  }, []);

  const currentWarehouse = useRef(warehouseId);
  const provisioning = useRef(false);
  currentWarehouse.current = warehouseId;

  const refresh = useCallback(async () => {
    if (!warehouseId) return EMPTY;
    const data = await api<AccessMonitor>(`iot/access/monitor?warehouseId=${encodeURIComponent(warehouseId)}`);
    if (currentWarehouse.current === warehouseId) setMonitor(data);
    return data;
  }, [warehouseId]);

  useEffect(() => {
    sequence.current++;
    pendingMotion.current?.resolve(false); pendingMotion.current = null;
    grantedMotionDone.current = false;
    enteringMotionDone.current = false;
    lastSeenScanId.current = null;
    initializedScanRef.current = false;
    setBusy(false);
    setMonitor(EMPTY); setPhase('IDLE'); setError(''); setNotice(''); setStartedAt(0); setRealWaiting(false);
    if (!warehouseId) return;
    let active = true;
    const reload = () => { void (async () => {
      try {
        const data = await refresh();
        if (active && canSimulate && data.mode === 'SIMULATION' && (!data.devices.some(item => item.code.startsWith(SIMULATED_DEVICE_PREFIX)) || !data.doors.some(item => item.device.code.startsWith(SIMULATED_DEVICE_PREFIX))) && !provisioning.current) {
          provisioning.current = true;
          try { await api('iot/access/simulation/setup', 'POST', { warehouseId }); if (active) await refresh(); }
          finally { provisioning.current = false; }
        }
      } catch (reason) { if (active) setError(errorMessage(reason)); }
    })(); };
    reload();
    const timer = window.setInterval(reload, 1500);
    const unsubscribe = subscribeWarehouseAccess(reload, setConnected);
    return () => { active = false; window.clearInterval(timer); unsubscribe(); sequence.current++; pendingMotion.current?.resolve(false); pendingMotion.current = null; };
  }, [warehouseId, refresh, canSimulate]);

  const suffix = warehouseId ? warehouseId.replaceAll('-', '').toUpperCase() : '';
  const simDeviceCode = `${SIMULATED_DEVICE_PREFIX}${suffix}`;
  const simDoorCode = `SIM-DOOR-${suffix}`;

  // Ưu tiên cửa thật và thiết bị thật (ESP32-WH01, DOOR-WH01-01) để mô hình 3D phản hồi theo phần cứng thật
  const realDoor = monitor.doors.find(item => !item.device.code.startsWith(SIMULATED_DEVICE_PREFIX));
  const simDoor = monitor.doors.find(item => item.device.code.startsWith(SIMULATED_DEVICE_PREFIX));
  const door = realDoor ?? simDoor ?? monitor.doors[0] ?? { id: 'door-wh01', code: 'DOOR-WH01-01', name: 'Cửa cuốn kho chính', state: 'CLOSED' as const, openSince: null, lastStateChangedAt: null, device: { code: 'ESP32-WH01' } };

  const realDevice = monitor.devices.find(item => !item.code.startsWith(SIMULATED_DEVICE_PREFIX));
  const simDevice = monitor.devices.find(item => item.code.startsWith(SIMULATED_DEVICE_PREFIX));
  const device = (door ? monitor.devices.find(item => item.code === door.device.code) : null) ?? realDevice ?? simDevice ?? monitor.devices[0] ?? { id: 'esp32-wh01', code: 'ESP32-WH01', name: 'ESP32 cửa kho', lastSeenAt: null, online: false };

  const activeAlerts = monitor.alerts.filter(row => row.status === 'OPEN' && (!row.doorId || row.doorId === door?.id) && !(monitor.mode === 'SIMULATION' && row.type === 'AFTER_HOURS_ACCESS'));
  const lastAccess = monitor.events.find(row => row.eventType === 'ACCESS_GRANTED' || row.eventType === 'ACCESS_DENIED');
  const lastDoor = monitor.events.find(row => row.eventType === 'DOOR_OPEN' || row.eventType === 'DOOR_CLOSED');
  const elapsedOpenSeconds = door?.openSince ? Math.max(0, Math.floor((now - new Date(door.openSince).getTime()) / 1000)) : 0;
  const openLimit = monitor.mode === 'SIMULATION' ? monitor.simulationDoorOpenSeconds ?? 10 : monitor.maxDoorOpenSeconds ?? 30;

  const simulate = useCallback(async (body: object) => {
    if (!warehouseId) throw new Error('Hãy chọn kho.');
    const targetDevice = door?.device?.code ?? simDeviceCode;
    const result = await api<{ duplicate: boolean; event: { eventType: string } | null }>('iot/access/simulate', 'POST', { warehouseId, deviceId: targetDevice, ...body });
    await refresh();
    return result;
  }, [warehouseId, refresh, door?.device?.code, simDeviceCode]);

  const stop = useCallback(() => {
    sequence.current++;
    pendingMotion.current?.resolve(false);
    pendingMotion.current = null;
    grantedMotionDone.current = false;
    enteringMotionDone.current = false;
    setBusy(false);
    if (latestMonitor.current.mode === 'REAL_IOT') {
      setStartedAt(Date.now());
      setPhase('WAITING_REAL');
      setRealWaiting(true);
      setNotice('Sẵn sàng: hãy đưa thẻ nhân viên kho vào đầu đọc RC522 để mở cửa cuốn kho chính.');
    } else {
      setPhase('IDLE');
      setNotice('');
      setRealWaiting(false);
    }
  }, []);

  const start = useCallback(async (kind: AccessKind) => {
    if (!canSimulate) { setError('Bạn cần quyền xem tồn kho để chạy demo cửa kho.'); return; }
    if (door.state === 'OPEN') { setError('Cửa đang mở. Đóng cửa trước khi chạy luồng mới.'); return; }
    const id = ++sequence.current;
    const valid = () => sequence.current === id;
    const stage = async (next: AccessPhase) => {
      if (!valid()) return false;
      const completed = await new Promise<boolean>(resolve => { pendingMotion.current = { phase: next, resolve }; setPhase(next); });
      return completed && valid();
    };
    setError(''); setNotice(''); setBusy(true);
    const startTimestamp = Date.now();
    setStartedAt(startTimestamp - 3000);
    startedAtRef.current = startTimestamp - 3000;
    setRealWaiting(false);
    grantedMotionDone.current = false;
    enteringMotionDone.current = false;
    setSessionInfo(null);
    try {
      if (kind === 'unauthorized') {
        const grant = monitor.events.find(row => row.eventType === 'ACCESS_GRANTED' && !row.consumedAt);
        if (grant) { const remaining = (monitor.accessWindowSeconds ?? 10) * 1000 + 200 - (Date.now() - new Date(grant.occurredAt).getTime()); if (remaining > 0) { setNotice(`Đợi ${Math.ceil(remaining / 1000)} giây để quyền mở cửa trước đó hết hạn.`); await wait(remaining); } }
        if (!valid()) return;
        const opened = await simulate({ action: 'DOOR', doorId: door.code, state: 'OPEN' });
        if (!valid()) return;
        if (opened.event?.eventType !== 'DOOR_OPEN') throw new Error('Cửa chưa chuyển sang mở. Hãy kiểm tra cảm biến hoặc trạng thái cửa.');
        if (!await stage('OPENING')) return;
        setPhase('ALERT'); setNotice('Cửa mở không có thẻ hợp lệ. Backend đã ghi cảnh báo truy cập trái phép.');
      } else {
        if (!await stage('APPROACH')) return;
        setPhase('SCANNING');
        setNotice('Nhân viên đã đến cổng: Đang đợi quét thẻ RFID trên đầu đọc RC522…');

        // Chờ nhận diện thẻ từ đầu đọc RC522 thật (hoặc bấm nút Quét thẻ thử)
        let verifiedEvent: AccessEvent | null = null;
        let pollCount = 0;
        while (valid()) {
          pollCount++;
          let freshEvents = latestMonitor.current.events;
          if (pollCount % 2 === 0) {
            try {
              const freshData = await refresh();
              freshEvents = freshData.events;
            } catch {
              // ignore
            }
          }
          const found = freshEvents.find(
            e => new Date(e.occurredAt).getTime() >= startedAtRef.current &&
            (e.eventType === 'ACCESS_GRANTED' || e.eventType === 'ACCESS_DENIED')
          );
          if (found) {
            if (found.eventType === 'ACCESS_DENIED') {
              setPhase('ALERT');
              setError(`Thẻ ${found.payload?.uid ?? ''} không hợp lệ hoặc đã bị khóa!`);
              return;
            }
            verifiedEvent = found;
            break;
          }
          await wait(200);
        }
        if (!valid() || !verifiedEvent) return;

        const scanTime = verifiedEvent.occurredAt || new Date().toISOString();
        const empName = verifiedEvent.employee?.name ?? 'Lý Chí Chương';
        const cardUid = verifiedEvent.payload?.uid ?? '6563CC04';

        setPhase('VERIFYING');
        setNotice(`Đã xác thực: ${empName} (${cardUid}). Đang mở cửa cuốn…`);
        await wait(600);

        if (!await stage('GRANTED')) return;

        let doorOpenTime = new Date().toISOString();
        if (latestMonitor.current.mode === 'SIMULATION') {
          const opened = await simulate({ action: 'DOOR', doorId: door.code, state: 'OPEN' });
          if (!valid()) return;
          doorOpenTime = new Date().toISOString();
          if (opened.event?.eventType !== 'DOOR_OPEN') throw new Error('Cửa chưa chuyển sang mở.');
        } else {
          for (let i = 0; i < 40 && valid(); i++) {
            const currentDoor = latestMonitor.current.doors.find(d => d.id === door.id);
            const openEv = latestMonitor.current.events.find(e => e.eventType === 'DOOR_OPEN' && new Date(e.occurredAt).getTime() >= startedAtRef.current);
            if (currentDoor?.state === 'OPEN' || openEv) {
              doorOpenTime = openEv?.occurredAt || new Date().toISOString();
              break;
            }
            await wait(250);
          }
        }

        if (!await stage('OPENING') || !await stage('ENTERING')) return;

        if (kind === 'open-too-long') {
          setPhase('WAITING_ALERT'); setNotice('Đang giữ cửa mở. Backend sẽ tự ghi cảnh báo khi vượt ngưỡng.');
          let detected = false;
          for (let attempt = 0; attempt < 42 && valid(); attempt++) {
            const data = await refresh();
            if (data.alerts.some(row => row.type === 'DOOR_OPEN_TOO_LONG' && row.status === 'OPEN')) { detected = true; setPhase('ALERT'); setNotice('Cửa mở quá lâu: cảnh báo đã được lưu trong PostgreSQL.'); break; }
            await wait(1000);
          }
          if (valid() && !detected) throw new Error('Chưa nhận được cảnh báo từ backend. Kiểm tra tiến trình giám sát cửa.');
          return;
        }

        // Giữ cửa mở để quan sát thực tế và nhân viên vào kho an toàn (khoảng 8-10 giây ở 1x)
        const holdSeconds = Math.max(5, Math.round(9 / (speedMultiplier || 1)));
        for (let sec = holdSeconds; sec >= 1 && valid(); sec--) {
          setNotice(`Cửa cuốn đang mở · Nhân viên đã vào kho an toàn · Tự động hạ xuống sau ${sec}s…`);
          await wait(1000 / (speedMultiplier || 1));
        }

        let doorCloseTime = new Date().toISOString();
        if (latestMonitor.current.mode === 'SIMULATION') {
          const closed = await simulate({ action: 'DOOR', doorId: door.code, state: 'CLOSED' });
          if (!valid()) return;
          if (closed.event?.eventType !== 'DOOR_CLOSED') throw new Error('Chưa ghi nhận cửa đóng.');
        } else {
          for (let i = 0; i < 40 && valid(); i++) {
            const closeEv = latestMonitor.current.events.find(e => e.eventType === 'DOOR_CLOSED' && new Date(e.occurredAt).getTime() > new Date(doorOpenTime).getTime());
            if (closeEv) {
              doorCloseTime = closeEv.occurredAt;
              break;
            }
            await wait(250);
          }
        }

        if (!await stage('CLOSING')) return;
        doorCloseTime = new Date().toISOString();

        const openDur = Math.max(holdSeconds, Math.round((new Date(doorCloseTime).getTime() - new Date(doorOpenTime).getTime()) / 1000));
        setSessionInfo({
          employeeName: empName,
          cardUid,
          scanTime,
          doorOpenTime,
          doorCloseTime,
          openDurationSeconds: openDur,
          shiftName: getShiftName(new Date(scanTime)),
          attendanceStatus: 'Đúng giờ · Đã check-in ca trực',
          doorName: door.name,
          deviceCode: device.code,
        });

        setPhase('COMPLETE');
        setNotice('Đã ghi nhận truy cập hợp lệ, cửa đóng an toàn và hoàn tất phiên.');
      }
    } catch (reason) { if (valid()) { setError(errorMessage(reason)); setPhase('IDLE'); } }
    finally { if (valid()) setBusy(false); }
  }, [canSimulate, door, device, monitor.accessWindowSeconds, refresh, simulate]);

  useEffect(() => {
    if (monitor.mode !== 'REAL_IOT') return;
    sequence.current++; pendingMotion.current?.resolve(false); pendingMotion.current = null;
    grantedMotionDone.current = false;
    enteringMotionDone.current = false;
    setBusy(false); setStartedAt(Date.now()); setRealWaiting(true); setPhase('WAITING_REAL');
    setNotice('Sẵn sàng: đưa thẻ nhân viên kho vào đầu đọc RC522 để mở cửa cuốn kho chính.');
  }, [monitor.mode]);

  useEffect(() => {
    const newestScan = monitor.events.find(row => row.eventType === 'ACCESS_GRANTED' || row.eventType === 'ACCESS_DENIED' || row.eventType === 'RFID_SCAN');
    if (!initializedScanRef.current && monitor.events.length > 0) {
      initializedScanRef.current = true;
      const ageMs = newestScan ? Date.now() - new Date(newestScan.occurredAt).getTime() : Infinity;
      if (ageMs > 3000) {
        lastSeenScanId.current = newestScan?.id ?? null;
      }
    }
    if (monitor.mode === 'REAL_IOT' && newestScan && newestScan.id !== lastSeenScanId.current) {
      const scanTime = new Date(newestScan.occurredAt).getTime();
      if (Date.now() - scanTime < 15000) {
        lastSeenScanId.current = newestScan.id;
        if (['IDLE', 'WAITING_REAL', 'COMPLETE', 'ALERT'].includes(phase)) {
          grantedMotionDone.current = false;
          enteringMotionDone.current = false;
          const nextStart = Math.min(Date.now(), scanTime) - 200;
          startedAtRef.current = nextStart;
          setStartedAt(nextStart);
          setRealWaiting(true);
          if (newestScan.eventType === 'ACCESS_DENIED') {
            setPhase('ALERT');
            setNotice(`Thẻ ${newestScan.payload?.uid ?? ''} không hợp lệ hoặc đã khóa!`);
          } else {
            setPhase('APPROACH');
            const empName = newestScan.employee?.name ?? 'Nhân viên kho';
            const scannedUid = newestScan.payload?.uid ? ` (${newestScan.payload.uid})` : '';
            setNotice(`Đã nhận thẻ${scannedUid} · ${empName} — Đang mở cửa cuốn kho chính!`);
          }
          return;
        }
      }
    }

    if (!realWaiting || !startedAt) return;
    const recent = monitor.events.filter(row => new Date(row.occurredAt).getTime() >= startedAt);
    const hasGrant = recent.some(row => row.eventType === 'ACCESS_GRANTED');
    const hasScan = recent.some(row => row.eventType === 'RFID_SCAN');
    const hasDoorOpen = door?.state === 'OPEN' || recent.some(row => row.eventType === 'DOOR_OPEN');
    const hasDoorClosed = door?.state === 'CLOSED' || recent.some(row => row.eventType === 'DOOR_CLOSED');

    if (monitor.alerts.some(row => row.status === 'OPEN' && new Date(row.createdAt).getTime() >= startedAt)) {
      setPhase('ALERT');
      return;
    }
    if (hasGrant) {
      setPhase(current => {
        if (['IDLE', 'WAITING_REAL', 'COMPLETE'].includes(current)) {
          grantedMotionDone.current = false;
          enteringMotionDone.current = false;
          return 'APPROACH';
        }
        if (current === 'VERIFYING') return 'GRANTED';
        if (current === 'GRANTED' && grantedMotionDone.current && hasDoorOpen) return 'OPENING';
        if (current === 'ENTERING' && enteringMotionDone.current && hasDoorClosed) return 'CLOSING';
        return current;
      });
    } else if (recent.some(row => row.eventType === 'DOOR_OPEN')) {
      setPhase('ALERT');
    } else if (hasScan) {
      setPhase(current => ['IDLE', 'WAITING_REAL', 'COMPLETE'].includes(current) ? 'SCANNING' : current);
    }
  }, [monitor.events, monitor.alerts, monitor.mode, realWaiting, startedAt, door?.state, phase]);

  useEffect(() => {
    if (monitor.mode !== 'REAL_IOT' || phase !== 'GRANTED') return;
    const timer = window.setTimeout(() => {
      grantedMotionDone.current = true;
      setPhase(current => current === 'GRANTED' ? 'OPENING' : current);
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [monitor.mode, phase]);

  const action = async (body: object, success: string) => {
    setBusy(true); setError('');
    try { await simulate(body); setNotice(success); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  const resolve = async (alertId: string) => {
    setBusy(true); setError('');
    try { await api(`iot/access/${monitor.mode === 'SIMULATION' ? 'simulation/' : ''}alerts/${alertId}/resolve`, 'POST', {}); await refresh(); setNotice('Đã ghi nhận xử lý cảnh báo.'); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  const close = async () => { if (!door) return; setBusy(true); setError(''); try { const result = await simulate({ action: 'DOOR', doorId: door.code, state: 'CLOSED' }); if (result.event?.eventType !== 'DOOR_CLOSED') throw new Error('Chưa ghi nhận cửa đóng.'); sequence.current++; setRealWaiting(false); setNotice('Đã đóng cửa; cảnh báo mở lâu được giải quyết tự động.'); await new Promise<boolean>(resolve => { pendingMotion.current = { phase: 'CLOSING', resolve }; setPhase('CLOSING'); }); setPhase('COMPLETE'); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); } };
  const configure = async (path: string, body: object, success: string) => { setBusy(true); setError(''); try { const res = await api(`iot/access/${path}`, 'POST', body); await refresh(); setNotice(success); return res; } catch (reason) { setError(errorMessage(reason)); return null; } finally { setBusy(false); } };
  const deleteCard = async (uid: string) => {
    setBusy(true); setError('');
    try {
      await api(`iot/access/cards/${uid}?warehouseId=${warehouseId}`, 'DELETE');
      await refresh();
      setNotice(`Đã xóa thẻ ${uid}.`);
      return true;
    } catch (reason) {
      setError(errorMessage(reason));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { monitor, connected, phase, error, notice, busy, canManage, canSimulate, device, door, activeAlerts, lastAccess, lastDoor, refresh, start, stop, action, resolve, close, configure, deleteCard, motionComplete, elapsedOpenSeconds, openLimit, sessionInfo };
}

export type DoorController = ReturnType<typeof useWarehouseDoor>;

export function WarehouseDoorPanel({ access: _access, warehouseId: _warehouseId, warehouseName: _warehouseName, active: _active }: { access: DoorController; warehouseId: string; warehouseName: string; active: boolean }) {
  // Empty underneath the 3D scene: bottom clutter removed per user request.
  return null;
}

export function WarehouseCardStaffModal({
  isOpen,
  onClose,
  access,
  warehouseId,
  warehouseName,
}: {
  isOpen: boolean;
  onClose: () => void;
  access: DoorController;
  warehouseId: string;
  warehouseName: string;
}) {
  const { monitor, busy, lastAccess } = access;
  const [tab, setTab] = useState<'assign' | 'employee' | 'list'>('assign');
  const [employeeId, setEmployeeId] = useState('');
  const [uid, setUid] = useState('');
  const [newEmployeeName, setNewEmployeeName] = useState('');
  const [modalNotice, setModalNotice] = useState('');
  const [modalError, setModalError] = useState('');
  const [listeningUid, setListeningUid] = useState(false);
  const lastCapturedScanId = useRef<string | null>(null);

  useEffect(() => {
    if (monitor.employees.length > 0 && !employeeId) {
      const truong = monitor.employees.find(e =>
        e.name.toLowerCase().includes('trường') ||
        e.name.toLowerCase().includes('truong')
      );
      setEmployeeId(truong?.id ?? monitor.employees[0].id);
    }
  }, [monitor.employees, employeeId]);

  useEffect(() => {
    if (!listeningUid) return;
    const latestScan = monitor.events.find(e => e.payload?.uid);
    if (latestScan?.payload?.uid && latestScan.id !== lastCapturedScanId.current) {
      lastCapturedScanId.current = latestScan.id;
      setUid(latestScan.payload.uid);
      setListeningUid(false);
      setModalNotice(`Đã nhận UID ${latestScan.payload.uid} từ đầu đọc RC522.`);
    }
  }, [monitor.events, listeningUid]);

  if (!isOpen) return null;

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid.trim() || !employeeId) return;
    setModalError('');
    setModalNotice('');
    const targetEmp = monitor.employees.find(emp => emp.id === employeeId);
    const cleanUid = uid.trim().toUpperCase();

    // Kiểm tra an ninh: Mỗi người chỉ được gán 1 mã thẻ! Có mã thứ 2 là báo lỗi ngay
    const existingEmpCard = monitor.cards.find(c => c.employee.id === employeeId && c.status === 'ACTIVE' && c.uid !== cleanUid);
    if (existingEmpCard) {
      setModalError(`Nhân viên "${targetEmp?.name ?? 'này'}" đã được gán thẻ RFID (${existingEmpCard.uid}). Mỗi người chỉ được gắn tối đa 1 mã thẻ, không thể thêm mã thứ 2! Vui lòng khóa hoặc đổi thẻ cũ trước.`);
      return;
    }

    const res = await access.configure('cards', { uid: cleanUid, employeeId, warehouseId, status: 'ACTIVE' }, `Đã gán thẻ ${cleanUid} cho ${targetEmp?.name ?? 'nhân viên kho'}.`);
    if (res) {
      setModalNotice(`Gán thành công thẻ ${cleanUid} cho nhân viên ${targetEmp?.name ?? ''}. Khi quét thẻ này ở đầu đọc RC522, cửa kho sẽ tự động mở.`);
    } else {
      setModalError(access.error || 'Không gán được thẻ. Mỗi người chỉ được phép sở hữu tối đa 1 mã thẻ RFID.');
    }
  };

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newEmployeeName.trim();
    if (cleanName.length < 2) return;
    setModalError('');
    setModalNotice('');
    const created = await access.configure('employees', { name: cleanName, warehouseId }, `Đã thêm nhân viên "${cleanName}".`) as { id?: string } | null;
    if (created?.id) {
      setNewEmployeeName('');
      setEmployeeId(created.id);
      setModalNotice(`Đã tạo thành công nhân viên kho "${cleanName}". Đã tự động chọn nhân viên này để gán thẻ.`);
      setTab('assign');
    } else {
      setModalError('Không tạo được nhân viên. Vui lòng thử lại.');
    }
  };

  return createPortal(
    <div className="wde-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wde-modal" role="dialog" aria-modal="true" aria-labelledby="wde-modal-title">
        <header className="wde-modal-header">
          <div>
            <div className="wde-modal-badge">KHO & THẺ RFID</div>
            <h2 id="wde-modal-title">Quản lý & Gán thẻ RFID cho nhân viên</h2>
            <small>{warehouseName} · Dữ liệu lưu trực tiếp vào cơ sở dữ liệu</small>
          </div>
          <button type="button" className="wde-modal-close" onClick={onClose} aria-label="Đóng">×</button>
        </header>

        <nav className="wde-modal-tabs">
          <button type="button" className={tab === 'assign' ? 'active' : ''} onClick={() => setTab('assign')}>
            1. Gán thẻ RFID
          </button>
          <button type="button" className={tab === 'employee' ? 'active' : ''} onClick={() => setTab('employee')}>
            2. Thêm nhân viên kho
          </button>
          <button type="button" className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>
            3. Danh sách thẻ ({monitor.cards.length})
          </button>
        </nav>

        {(modalNotice || modalError) && (
          <p className={modalError ? 'wde-error' : 'wde-notice'} role="status">
            {modalError || modalNotice}
          </p>
        )}

        <div className="wde-modal-body">
          {tab === 'assign' && (
            <form onSubmit={handleAssign} className="wde-modal-form">
              <label>
                <span>Nhân viên kho sở hữu thẻ:</span>
                <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} required>
                  {monitor.employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} {emp.email ? `(${emp.email})` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Mã UID thẻ RFID:</span>
                <div className="wde-uid-input-row">
                  <input
                    value={uid}
                    onChange={e => setUid(e.target.value.toUpperCase())}
                    placeholder="VD: 6563CC04"
                    required
                  />
                  <button
                    type="button"
                    className={listeningUid ? 'is-listening' : ''}
                    onClick={() => {
                      lastCapturedScanId.current = monitor.events.find(row => row.payload?.uid)?.id ?? null;
                      setListeningUid(v => !v);
                    }}
                  >
                    {listeningUid ? 'Đang đợi quét RC522…' : 'Quét RC522 lấy UID'}
                  </button>
                </div>
              </label>

              {lastAccess?.payload?.uid && (
                <button type="button" className="wde-use-last-uid" onClick={() => setUid(lastAccess.payload?.uid ?? '')}>
                  Dùng UID vừa quét: <b>{lastAccess.payload.uid}</b>
                </button>
              )}

              <footer className="wde-modal-foot">
                <button type="submit" className="wde-primary-btn" disabled={busy || !employeeId || !uid.trim()}>
                  {busy ? 'Đang lưu…' : 'Lưu gán thẻ cho nhân viên này'}
                </button>
              </footer>
            </form>
          )}

          {tab === 'employee' && (
            <form onSubmit={handleCreateEmployee} className="wde-modal-form">
              <label>
                <span>Họ và tên nhân viên kho mới:</span>
                <input
                  value={newEmployeeName}
                  onChange={e => setNewEmployeeName(e.target.value)}
                  placeholder="VD: Nguyễn Văn An, Trần Văn Bình…"
                  required
                />
              </label>
              <small className="wde-help-text">
                Nhân viên kho mới được tạo sẽ tự động được gán quyền xem kho và nhận hàng tại chi nhánh {warehouseName}, sẵn sàng gán thẻ RFID để quét vào kho.
              </small>
              <footer className="wde-modal-foot">
                <button type="submit" className="wde-primary-btn" disabled={busy || newEmployeeName.trim().length < 2}>
                  {busy ? 'Đang tạo…' : '+ Tạo nhân viên kho'}
                </button>
              </footer>
            </form>
          )}

          {tab === 'list' && (
            <div className="wde-modal-cards-list">
              <table className="wde-modal-table">
                <thead>
                  <tr>
                    <th>Mã thẻ UID</th>
                    <th>Nhân viên sở hữu</th>
                    <th>Trạng thái</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {monitor.cards.map(card => (
                    <tr key={card.id}>
                      <td><code>{card.uid}</code></td>
                      <td><strong>{card.employee.name}</strong></td>
                      <td>
                        <span className={`wde-pill ${card.status === 'ACTIVE' ? 'ok' : 'bad'}`}>
                          {card.status === 'ACTIVE' ? 'Hoạt động' : 'Đã khóa'}
                        </span>
                      </td>
                      <td>
                        <div className="wde-table-actions">
                          <button
                            type="button"
                            onClick={() => {
                              setUid(card.uid);
                              setEmployeeId(card.employee.id);
                              setTab('assign');
                            }}
                          >
                            Đổi NV
                          </button>
                          {card.status === 'ACTIVE' ? (
                            <button
                              type="button"
                              className="danger"
                              onClick={() => void access.configure('cards', { uid: card.uid, employeeId: card.employee.id, warehouseId, status: 'REVOKED' }, 'Đã khóa thẻ.')}
                            >
                              Khóa
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void access.configure('cards', { uid: card.uid, employeeId: card.employee.id, warehouseId, status: 'ACTIVE' }, 'Đã mở khóa thẻ.')}
                            >
                              Mở
                            </button>
                          )}
                          <button
                            type="button"
                            className="danger"
                            title="Xóa vĩnh viễn thẻ này"
                            onClick={async () => {
                              if (confirm(`Bạn có chắc muốn xóa thẻ ${card.uid} không?`)) {
                                const ok = await access.deleteCard(card.uid);
                                if (ok) setModalNotice(`Đã xóa thẻ ${card.uid} khỏi hệ thống.`);
                              }
                            }}
                          >
                            Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {monitor.cards.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', padding: '20px', color: '#64748b' }}>
                        Chưa có thẻ nào được gán cho kho này.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <footer className="wde-modal-actions">
          <button type="button" className="li-ghost" onClick={onClose}>Đóng</button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

export function WarehouseAccessCompleteModal({
  isOpen,
  onClose,
  access,
  warehouseName,
  onRestart,
}: {
  isOpen: boolean;
  onClose: () => void;
  access: DoorController;
  warehouseName: string;
  onRestart?: () => void;
}) {
  if (!isOpen) return null;

  const info = access.sessionInfo;
  const event = access.lastAccess;
  const employeeName = info?.employeeName ?? event?.employee?.name ?? 'Trường';
  const cardUid = info?.cardUid ?? event?.payload?.uid ?? 'D00C330C';
  const doorName = info?.doorName ?? access.door?.name ?? 'Cửa cuốn kho chính';
  const deviceCode = info?.deviceCode ?? access.device?.code ?? 'ESP32-WH01';

  const formatT = (val?: string | null) => val ? new Date(val).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
  const formatD = (val?: string | null) => val ? new Date(val).toLocaleDateString('vi-VN') : new Date().toLocaleDateString('vi-VN');

  const scanTimeStr = info?.scanTime ? formatT(info.scanTime) : formatT(event?.occurredAt);
  const scanDateStr = info?.scanTime ? formatD(info.scanTime) : formatD(event?.occurredAt);
  const doorOpenTimeStr = info?.doorOpenTime ? formatT(info.doorOpenTime) : '—';
  const doorCloseTimeStr = info?.doorCloseTime ? formatT(info.doorCloseTime) : '—';
  const durationSec = info?.openDurationSeconds ?? 10;
  const shiftName = info?.shiftName ?? getShiftName();
  const attendanceStatus = info?.attendanceStatus ?? 'Đúng giờ · Đã check-in ca trực';

  const initials = employeeName
    .split(' ')
    .filter(Boolean)
    .slice(-2)
    .map(p => p[0]?.toUpperCase() ?? '')
    .join('') || 'TR';

  return createPortal(
    <div className="wde-complete-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wde-complete-card" role="dialog" aria-modal="true" aria-labelledby="access-complete-title">
        {/* Header (No giant icon, clean typography) */}
        <div className="wde-comp-hero">
          <span className="wde-comp-pill">XÁC THỰC CỬA KHO</span>
          <h2 id="access-complete-title">Mở cửa thành công</h2>
          <p className="wde-comp-sub-hero">Cửa cuốn kho đã mở & đóng an toàn</p>
        </div>

        {/* Employee Profile (Without ACTIVE badge) */}
        <div className="wde-comp-profile">
          <div className="wde-comp-avatar">{initials}</div>
          <div className="wde-comp-profile-info">
            <div className="wde-comp-name-row">
              <h3>{employeeName}</h3>
              <span className="wde-comp-card-chip">
                <code>RFID: {cardUid}</code>
              </span>
            </div>
            <p className="wde-comp-sub">
              {warehouseName} · {doorName}
            </p>
            <div className="wde-comp-auth-status">
              <span>Quyền truy cập:</span> <strong>Hợp lệ</strong>
            </div>
          </div>
        </div>

        {/* Shift Attendance Card (No clock emoji) */}
        <div className="wde-comp-attendance">
          <div className="wde-att-header">
            <span className="wde-att-label">Điểm danh ca trực nhân viên</span>
            <span className="wde-att-date">{scanDateStr}</span>
          </div>
          <div className="wde-att-content">
            <strong className="wde-att-shift">{shiftName}</strong>
            <span className="wde-att-ok">✓ {attendanceStatus}</span>
          </div>
        </div>

        {/* Sleek Vertical Timeline (No arrows, connected step dots) */}
        <div className="wde-comp-timeline-v">
          <div className="wde-step-item">
            <div className="wde-step-indicator">
              <span className="wde-step-dot" />
              <span className="wde-step-line" />
            </div>
            <div className="wde-step-body">
              <div className="wde-step-head">
                <span className="wde-step-title">1. Quẹt thẻ RFID</span>
                <span className="wde-step-time">{scanTimeStr}</span>
              </div>
              <small className="wde-step-desc">Đầu đọc RC522 nhận diện thẻ</small>
            </div>
          </div>

          <div className="wde-step-item">
            <div className="wde-step-indicator">
              <span className="wde-step-dot" />
              <span className="wde-step-line" />
            </div>
            <div className="wde-step-body">
              <div className="wde-step-head">
                <span className="wde-step-title">2. Cửa cuốn mở</span>
                <span className="wde-step-time">{doorOpenTimeStr}</span>
              </div>
              <small className="wde-step-desc">Cửa nâng lên · Nhân viên vào kho</small>
            </div>
          </div>

          <div className="wde-step-item is-last">
            <div className="wde-step-indicator">
              <span className="wde-step-dot ok" />
            </div>
            <div className="wde-step-body">
              <div className="wde-step-head">
                <span className="wde-step-title">3. Cửa cuốn đóng</span>
                <span className="wde-step-time">{doorCloseTimeStr}</span>
              </div>
              <small className="wde-step-desc">Hạ an toàn · Thời gian mở {durationSec}s</small>
            </div>
          </div>
        </div>

        {/* Hardware Status Strip (WITHOUT Nhật ký) */}
        <div className="wde-comp-hardware">
          <div><span>Thiết bị:</span> <code>{deviceCode}</code></div>
          <div><span>Cảm biến:</span> <strong>Reed Switch (Đã đóng)</strong></div>
        </div>

        {/* Actions */}
        <div className="wde-comp-actions">
          {onRestart && (
            <button type="button" className="wde-comp-btn-secondary" onClick={onRestart}>
              Chạy lại demo
            </button>
          )}
          <button type="button" className="wde-comp-btn-primary" onClick={onClose}>
            Hoàn tất & Đóng
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
