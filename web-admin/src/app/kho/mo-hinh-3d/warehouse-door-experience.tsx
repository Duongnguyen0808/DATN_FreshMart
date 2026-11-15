'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, errorMessage } from '../../../lib/auth-api';
import { subscribeWarehouseAccess } from '../../../lib/iot-realtime';
import { useAuth } from '../../../components/auth-provider';
import './warehouse-door-experience.css';

export type AccessKind = 'authorized' | 'unauthorized' | 'open-too-long';
export type AccessPhase =
  | 'IDLE'
  | 'APPROACH'
  | 'SCANNING'
  | 'VERIFYING'
  | 'GRANTED'
  | 'OPENING'
  | 'ENTERING'
  | 'WAITING_CLOSE'
  | 'CLOSING'
  | 'WAITING_REAL'
  | 'WAITING_ALERT'
  | 'ALERT'
  | 'COMPLETE';
type Device = { id: string; code: string; name: string; lastSeenAt: string | null; online: boolean };
type Door = { id: string; code: string; name: string; state: 'OPEN' | 'CLOSED'; openSince: string | null; lastStateChangedAt: string | null; device: { code: string } };
type Card = { id: string; uid: string; status: string; employee: { id: string; name: string } };
type AccessEvent = { id: string; eventType: string; occurredAt: string; source: string; doorId?: string | null; deviceId?: string; consumedAt?: string | null; payload?: { uid?: string }; employee?: { id: string; name: string } | null; door?: { name: string } | null };
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
  doorName: string;
  deviceCode: string;
};

export function useWarehouseDoor(warehouseId: string, speedMultiplier: number = 1, enabled = true) {
  const { user } = useAuth();
  const canManage = !!user && (user.permissions.includes('warehouses.manage') || user.permissions.includes('*'));
  const canSimulate = !!user && (user.permissions.includes('inventory.read') || user.permissions.includes('*'));
  const [monitor, setMonitor] = useState<AccessMonitor>(EMPTY);
  const [sourceMode, setSourceMode] = useState<'AUTO' | 'SIMULATION'>('AUTO');
  const [connected, setConnected] = useState(false);
  const [phase, setPhase] = useState<AccessPhase>('IDLE');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<AccessSessionInfo | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const latestMonitor = useRef(monitor);
  latestMonitor.current = monitor;
  const lastSeenScanId = useRef<string | null>(null);
  const sequence = useRef(0);
  const pendingMotion = useRef<{ phase: AccessPhase; resolve: (completed: boolean) => void } | null>(null);
  const motionComplete = useCallback((completed: AccessPhase) => {
    if (pendingMotion.current?.phase !== completed) return;
    pendingMotion.current.resolve(true);
    pendingMotion.current = null;
  }, []);

  const currentWarehouse = useRef(warehouseId);
  const provisioning = useRef(false);
  const setupAttempted = useRef('');
  currentWarehouse.current = warehouseId;

  const refresh = useCallback(async () => {
    if (!warehouseId) return EMPTY;
    const raw = await api<AccessMonitor>(`iot/access/monitor?warehouseId=${encodeURIComponent(warehouseId)}`);
    const data: AccessMonitor = sourceMode === 'SIMULATION' ? { ...raw, mode: 'SIMULATION' } : raw;
    if (currentWarehouse.current === warehouseId) { latestMonitor.current = data; setMonitor(data); }
    return data;
  }, [warehouseId, sourceMode]);

  useEffect(() => {
    sequence.current++;
    pendingMotion.current?.resolve(false); pendingMotion.current = null;
    lastSeenScanId.current = null;
    setBusy(false);
    setMonitor(EMPTY); setPhase('IDLE'); setError(''); setNotice('');
    if (!warehouseId) return;
    let active = true;
    const reload = () => { void (async () => {
      try {
        const data = await refresh();
        if (active && enabled && canSimulate && data.mode === 'SIMULATION' && setupAttempted.current !== warehouseId && (!(data.devices ?? []).some(item => item.code.startsWith(SIMULATED_DEVICE_PREFIX)) || !(data.doors ?? []).some(item => item.device.code.startsWith(SIMULATED_DEVICE_PREFIX))) && !provisioning.current) {
          setupAttempted.current = warehouseId;
          provisioning.current = true;
          try { await api('iot/access/simulation/setup', 'POST', { warehouseId }); if (active) await refresh(); }
          catch (err) { setupAttempted.current = ''; throw err; }
          finally { provisioning.current = false; }
        }
      } catch (reason) { if (active) setError(errorMessage(reason)); }
    })(); };
    reload();
    const timer = window.setInterval(reload, 1500);
    const unsubscribe = subscribeWarehouseAccess(reload, setConnected);
    return () => { active = false; window.clearInterval(timer); unsubscribe(); sequence.current++; pendingMotion.current?.resolve(false); pendingMotion.current = null; };
  }, [warehouseId, refresh, canSimulate, enabled]);

  const suffix = warehouseId ? warehouseId.replaceAll('-', '').toUpperCase() : '';
  const simDeviceCode = `${SIMULATED_DEVICE_PREFIX}${suffix}`;

  // Ưu tiên cửa thật và thiết bị thật (ESP32-WH01, DOOR-WH01-01) để mô hình 3D phản hồi theo phần cứng thật
  const realDoor = (monitor.doors ?? []).find(item => !item.device.code.startsWith(SIMULATED_DEVICE_PREFIX));
  const simDoor = (monitor.doors ?? []).find(item => item.device.code.startsWith(SIMULATED_DEVICE_PREFIX));
  const door = (monitor.mode === 'REAL_IOT' ? realDoor : simDoor) ?? (monitor.doors ?? [])[0] ?? { id: 'door-wh01', code: 'DOOR-WH01-01', name: 'Cửa cuốn kho chính', state: 'CLOSED' as const, openSince: null, lastStateChangedAt: null, device: { code: 'ESP32-WH01' } };

  const realDevice = (monitor.devices ?? []).find(item => !item.code.startsWith(SIMULATED_DEVICE_PREFIX));
  const simDevice = (monitor.devices ?? []).find(item => item.code.startsWith(SIMULATED_DEVICE_PREFIX));
  const device = (door ? (monitor.devices ?? []).find(item => item.code === door.device.code) : null) ?? realDevice ?? simDevice ?? (monitor.devices ?? [])[0] ?? { id: 'esp32-wh01', code: 'ESP32-WH01', name: 'ESP32 cửa kho', lastSeenAt: null, online: false };

  const activeAlerts = (monitor.alerts ?? []).filter(row => row.status === 'OPEN' && (!row.doorId || row.doorId === door?.id) && !(monitor.mode === 'SIMULATION' && row.type === 'AFTER_HOURS_ACCESS'));
  const lastAccess = (monitor.events ?? []).find(row => row.doorId === door.id && (row.eventType === 'ACCESS_GRANTED' || row.eventType === 'ACCESS_DENIED'));
  const lastDoor = (monitor.events ?? []).find(row => row.doorId === door.id && (row.eventType === 'DOOR_OPEN' || row.eventType === 'DOOR_CLOSED'));
  const elapsedOpenSeconds = door?.openSince ? Math.max(0, Math.floor((now - new Date(door.openSince).getTime()) / 1000)) : 0;
  const openLimit = monitor.mode === 'SIMULATION' ? monitor.simulationDoorOpenSeconds ?? 10 : monitor.maxDoorOpenSeconds ?? 30;

  useEffect(() => {
    if (!busy && monitor.mode === 'REAL_IOT' && activeAlerts.length && door.state === 'OPEN') {
      setPhase('ALERT'); setNotice(activeAlerts[0].message);
    }
  }, [busy, monitor, door.state]);

  const simulate = useCallback(async (body: object) => {
    if (!warehouseId) throw new Error('Hãy chọn kho.');
    if (latestMonitor.current.mode === 'REAL_IOT') throw new Error('Chế độ IoT thật chỉ nhận tín hiệu thiết bị.');
    const targetDevice = door?.device?.code ?? simDeviceCode;
    const result = await api<{ duplicate: boolean; event: AccessEvent | null }>('iot/access/simulate', 'POST', { warehouseId, deviceId: targetDevice, ...body });
    await refresh();
    return result;
  }, [warehouseId, refresh, door?.device?.code, simDeviceCode]);

  const stop = useCallback(() => {
    sequence.current++;
    pendingMotion.current?.resolve(false);
    pendingMotion.current = null;
    setBusy(false);
    if (latestMonitor.current.mode === 'REAL_IOT') {

      setPhase('WAITING_REAL');

      setNotice('Sẵn sàng: hãy đưa thẻ nhân viên kho vào đầu đọc RC522 để mở cửa cuốn kho chính.');
    } else {
      setPhase('IDLE');
      setNotice('');

    }
  }, []);

  useEffect(() => { if (!enabled) stop(); }, [enabled, stop]);

  const start = useCallback(async (kind: AccessKind, physicalGrant?: AccessEvent) => {
    const real = latestMonitor.current.mode === 'REAL_IOT';
    if (real && !physicalGrant) {
      setNotice('Đưa thẻ vào RC522; mở và đóng cửa thật để cảm biến gửi trạng thái.');
      setPhase('WAITING_REAL');
      return;
    }
    if (!real && !canSimulate) return;
    if (!real && door.state === 'OPEN') { setError('Đóng cửa trước khi chạy lượt mới.'); return; }
    const id = ++sequence.current;
    const valid = () => sequence.current === id;
    const stage = async (next: AccessPhase) => {
      if (!valid()) return false;
      return new Promise<boolean>(resolve => { pendingMotion.current = { phase: next, resolve }; setPhase(next); });
    };
    const findEvent = (type: string, since: string) => latestMonitor.current.events.find(e =>
      e.doorId === door.id && e.source === (real ? 'IOT_DEVICE' : 'SIMULATION') &&
      e.eventType === type && new Date(e.occurredAt).getTime() >= new Date(since).getTime());
    const waitEvent = async (type: string, since: string, deadline?: number): Promise<AccessEvent | null> => {
      while (valid()) {
        const event = findEvent(type, since);
        if (event) return event;
        if (deadline && Date.now() > deadline) throw new Error('Quyền mở cửa đã hết hạn. Hãy quét lại thẻ.');
        await wait(250);
      }
      return null;
    };
    setBusy(true); setError(''); setSessionInfo(null);
    try {
      if (kind === 'unauthorized' && !real) {
        const grant = latestMonitor.current.events.find(e => e.doorId === door.id && e.eventType === 'ACCESS_GRANTED' && !e.consumedAt);
        if (grant) {
          const remaining = new Date(grant.occurredAt).getTime() + (monitor.accessWindowSeconds ?? 10) * 1000 - Date.now() + 100;
          if (remaining > 0) { setNotice('Đợi quyền mở cửa trước đó hết hạn…'); await wait(remaining); }
        }
        if (!valid()) return;
        const result = await simulate({ action: 'DOOR', doorId: door.code, state: 'OPEN' });
        if (result.event?.eventType !== 'DOOR_OPEN') throw new Error('Backend chưa ghi nhận cửa mở.');
        if (!await stage('OPENING')) return;
        setPhase('ALERT'); setNotice('Cửa mở không có xác thực hợp lệ. Kiểm tra cảnh báo và nhật ký.');
        return;
      }
      if (!await stage('APPROACH')) return;
      setPhase('SCANNING'); setNotice('Đang quét thẻ RFID…');
      const grant = physicalGrant ?? (await simulate({ action: 'RFID', uid: SIMULATED_CARD_UID })).event;
      if (!valid()) return;
      if (grant?.eventType !== 'ACCESS_GRANTED') { setPhase('ALERT'); setNotice('Thẻ không được phép truy cập kho.'); return; }
      setPhase('VERIFYING'); setNotice('Đã xác thực. Chờ cảm biến báo cửa mở.');
      if (!await stage('GRANTED')) return;
      const opened = real
        ? await waitEvent('DOOR_OPEN', grant.occurredAt, new Date(grant.occurredAt).getTime() + (monitor.accessWindowSeconds ?? 10) * 1000)
        : (await simulate({ action: 'DOOR', doorId: door.code, state: 'OPEN' })).event;
      if (!valid()) return;
      if (opened?.eventType !== 'DOOR_OPEN') throw new Error('Backend chưa ghi nhận cửa mở.');
      // A real door may already have closed while the visual approach was playing.
      if (!findEvent('DOOR_CLOSED', opened.occurredAt)) {
        if (real) {
          await Promise.race([stage('OPENING'), waitEvent('DOOR_CLOSED', opened.occurredAt)]);
          pendingMotion.current?.resolve(false); pendingMotion.current = null;
        } else if (!await stage('OPENING')) return;
        if (!valid()) return;
        if (real && !findEvent('DOOR_CLOSED', opened.occurredAt)) {
          await Promise.race([stage('ENTERING'), waitEvent('DOOR_CLOSED', opened.occurredAt)]);
          pendingMotion.current?.resolve(false); pendingMotion.current = null;
        } else if (!real && !await stage('ENTERING')) return;
      }
      if (!valid()) return;
      if (kind === 'open-too-long' && !real) {
        setPhase('WAITING_ALERT'); setNotice('Giữ cửa mở; backend theo dõi thời gian.');
        while (valid()) {
          if (latestMonitor.current.alerts.some(a => a.doorId === door.id && a.type === 'DOOR_OPEN_TOO_LONG' && a.status === 'OPEN')) {
            setPhase('ALERT'); setNotice('Cửa mở quá lâu. Đóng cửa để kết thúc cảnh báo.'); return;
          }
          await wait(500);
        }
        return;
      }
      setPhase('WAITING_CLOSE'); setNotice('Chờ cảm biến báo cửa đóng.');
      const closed = real ? await waitEvent('DOOR_CLOSED', opened.occurredAt)
        : (await simulate({ action: 'DOOR', doorId: door.code, state: 'CLOSED' })).event;
      if (!valid()) return;
      if (closed?.eventType !== 'DOOR_CLOSED') throw new Error('Backend chưa ghi nhận cửa đóng.');
      if (!await stage('CLOSING')) return;
      setSessionInfo({ employeeName: grant.employee?.name ?? 'Nhân viên', cardUid: grant.payload?.uid ?? '—',
        scanTime: grant.occurredAt, doorOpenTime: opened.occurredAt, doorCloseTime: closed.occurredAt,
        openDurationSeconds: Math.max(0, Math.round((new Date(closed.occurredAt).getTime() - new Date(opened.occurredAt).getTime()) / 1000)),
        doorName: door.name, deviceCode: device.code });
      setPhase('COMPLETE'); setNotice('Cửa đã đóng. Nhật ký truy cập đã được lưu.');
    } catch (reason) {
      if (valid()) { setError(errorMessage(reason)); setPhase('IDLE'); }
    } finally { if (valid()) setBusy(false); }
  }, [canSimulate, door, device, monitor.accessWindowSeconds, simulate]);

  useEffect(() => {
    if (!enabled || monitor.mode !== 'REAL_IOT') return;
    const scan = monitor.events.find(e => e.doorId === door.id && e.source === 'IOT_DEVICE' &&
      ['ACCESS_GRANTED', 'ACCESS_DENIED'].includes(e.eventType));
    if (!scan || scan.id === lastSeenScanId.current || busy) return;
    lastSeenScanId.current = scan.id;
    if (Date.now() - new Date(scan.occurredAt).getTime() > (monitor.accessWindowSeconds ?? 10) * 1000) return;
    if (scan.eventType === 'ACCESS_DENIED') { setPhase('ALERT'); setNotice('Thẻ không hợp lệ hoặc không có quyền vào kho.'); }
    else void start('authorized', scan);
  }, [monitor, door.id, busy, start, enabled]);

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
  const close = async () => { if (!door) return; setBusy(true); setError(''); try { const result = await simulate({ action: 'DOOR', doorId: door.code, state: 'CLOSED' }); if (result.event?.eventType !== 'DOOR_CLOSED') throw new Error('Chưa ghi nhận cửa đóng.'); sequence.current++; setNotice('Đã đóng cửa; cảnh báo mở lâu được giải quyết tự động.'); await new Promise<boolean>(resolve => { pendingMotion.current = { phase: 'CLOSING', resolve }; setPhase('CLOSING'); }); setPhase('COMPLETE'); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); } };
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

  return { monitor, connected, phase, error, notice, busy, canManage, canSimulate, device, door, activeAlerts, lastAccess, lastDoor, refresh, start, stop, action, resolve, close, configure, deleteCard, motionComplete, elapsedOpenSeconds, openLimit, sessionInfo, sourceMode, setSourceMode };
}

export type DoorController = ReturnType<typeof useWarehouseDoor>;

export function WarehouseDoorPanel({ access: _access, warehouseId: _warehouseId, warehouseName: _warehouseName, active: _active }: { access: DoorController; warehouseId: string; warehouseName: string; active: boolean }) {
  if (!_active) return null;
  const events = _access.monitor.events.filter(event => event.doorId === _access.door.id);
  return <section className="wde-access-log"><label>Nguồn sự kiện{' '}
    <select aria-label="Nguồn sự kiện cửa kho" disabled={_access.busy} value={_access.sourceMode} onChange={e => _access.setSourceMode(e.target.value as 'AUTO' | 'SIMULATION')}>
      <option value="AUTO">Tự động theo thiết bị</option><option value="SIMULATION">Mô phỏng</option>
    </select></label><details>
    <summary>Nhật ký cửa kho · {_warehouseName} · {_access.monitor.mode === 'REAL_IOT' ? 'REAL IOT' : 'SIMULATION'} · {_access.door.state}</summary>
    {_access.activeAlerts.map(alert => <p key={alert.id} role="alert">
      <strong>{label[alert.type] ?? alert.type}: </strong>{alert.message}{' '}
      {(_access.canManage || _access.monitor.mode === 'SIMULATION') && alert.type !== 'DOOR_OPEN_TOO_LONG' &&
        <button disabled={_access.busy} onClick={() => void _access.resolve(alert.id)}>Đã xử lý</button>}
    </p>)}
    <p>ESP32: {_access.device.online ? 'ONLINE' : 'OFFLINE'} · Thẻ gần nhất: {_access.lastAccess?.employee?.name ?? 'Chưa xác thực'}</p>
    <table><thead><tr><th>Thời gian</th><th>Sự kiện</th><th>Nhân viên</th></tr></thead>
      <tbody>{events.slice(0, 20).map(event => <tr key={event.id}><td>{time(event.occurredAt)}</td><td>{label[event.eventType] ?? event.eventType}</td><td>{event.employee?.name ?? '—'}</td></tr>)}</tbody>
    </table>
  </details></section>;
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
  const [tab, setTab] = useState<'assign' | 'list'>('assign');
  const [employeeId, setEmployeeId] = useState('');
  const [uid, setUid] = useState('');
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
      setModalNotice(`Gán thành công thẻ ${cleanUid} cho nhân viên ${targetEmp?.name ?? ''}. Khi quét thẻ này ở đầu đọc RC522, hệ thống sẽ xác thực quyền truy cập kho.`);
    } else {
      setModalError(access.error || 'Không gán được thẻ. Mỗi người chỉ được phép sở hữu tối đa 1 mã thẻ RFID.');
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
          <button type="button" className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>
            2. Danh sách thẻ ({monitor.cards.length})
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
  onOpenStaffModal,
  onOpenDeviceDrawer,
}: {
  isOpen: boolean;
  onClose: () => void;
  access: DoorController;
  warehouseName: string;
  onRestart?: () => void;
  onOpenStaffModal?: () => void;
  onOpenDeviceDrawer?: () => void;
}) {
  if (!isOpen) return null;

  const info = access.sessionInfo;
  return createPortal(<div className="wde-complete-backdrop">
    <div className="wde-complete-card" role="dialog" aria-modal="true" aria-labelledby="access-complete-title">
      <div className="wde-comp-hero"><span className="wde-comp-pill">NHẬT KÝ TRUY CẬP CỬA KHO</span>
        <h2 id="access-complete-title">Đã ghi nhận cửa đóng</h2>
        <p>{warehouseName} · {access.door.name}</p></div>
      {info && <div className="wde-comp-nav-list">
        <p><strong>{info.employeeName}</strong> · Thẻ {info.cardUid}</p>
        <p>Xác thực: {time(info.scanTime)} · Mở cửa: {time(info.doorOpenTime)} · Đóng cửa: {time(info.doorCloseTime)}</p>
        <p>Thời gian cửa mở: {info.openDurationSeconds} giây.</p>
      </div>}
      <div className="wde-comp-actions">
        {onOpenStaffModal && <button onClick={onOpenStaffModal}>Thẻ nhân viên</button>}
        {onOpenDeviceDrawer && <button onClick={onOpenDeviceDrawer}>Thiết bị & nhật ký</button>}
        {onRestart && access.monitor.mode === 'SIMULATION' && <button onClick={onRestart}>Chạy lại demo</button>}
        <button className="wde-comp-btn-primary" onClick={onClose}>Đóng</button>
      </div>
    </div></div>, document.body);
}
