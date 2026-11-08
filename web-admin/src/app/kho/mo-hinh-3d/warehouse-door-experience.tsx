'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

export function useWarehouseDoor(warehouseId: string) {
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
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const latestMonitor = useRef(monitor);
  latestMonitor.current = monitor;
  const sequence = useRef(0);
  const pendingMotion = useRef<{ phase: AccessPhase; resolve: (completed: boolean) => void } | null>(null);
  const motionComplete = useCallback((completed: AccessPhase) => {
    if (pendingMotion.current?.phase !== completed) {
      if (latestMonitor.current.mode === 'REAL_IOT') {
        if (completed === 'CLOSING') setStartedAt(Date.now());
        setPhase(current => {
          if (current !== completed) return current;
          if (completed === 'APPROACH') return 'SCANNING';
          if (completed === 'SCANNING') return latestMonitor.current.events.some(event => event.eventType === 'ACCESS_GRANTED' && !event.consumedAt) ? 'GRANTED' : 'VERIFYING';
          if (completed === 'GRANTED' && latestMonitor.current.doors[0]?.state === 'OPEN') return 'OPENING';
          if (completed === 'OPENING') return 'ENTERING';
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
    const timer = window.setInterval(reload, 5000);
    const unsubscribe = subscribeWarehouseAccess(reload, setConnected);
    return () => { active = false; window.clearInterval(timer); unsubscribe(); sequence.current++; pendingMotion.current?.resolve(false); pendingMotion.current = null; };
  }, [warehouseId, refresh, canSimulate]);

  const door = monitor.mode === 'SIMULATION' ? (monitor.doors.find(item => item.device.code.startsWith(SIMULATED_DEVICE_PREFIX)) ?? monitor.doors[0]) : (monitor.doors.find(item => !item.device.code.startsWith(SIMULATED_DEVICE_PREFIX)) ?? monitor.doors[0]);
  const device = monitor.devices.find(item => item.code === door?.device.code) ?? monitor.devices[0];
  const activeAlerts = monitor.alerts.filter(row => row.status === 'OPEN' && (!row.doorId || row.doorId === door?.id) && !(monitor.mode === 'SIMULATION' && row.type === 'AFTER_HOURS_ACCESS'));
  const lastAccess = monitor.events.find(row => row.eventType === 'ACCESS_GRANTED' || row.eventType === 'ACCESS_DENIED');
  const lastDoor = monitor.events.find(row => row.eventType === 'DOOR_OPEN' || row.eventType === 'DOOR_CLOSED');
  const elapsedOpenSeconds = door?.openSince ? Math.max(0, Math.floor((now - new Date(door.openSince).getTime()) / 1000)) : 0;
  const openLimit = monitor.mode === 'SIMULATION' ? monitor.simulationDoorOpenSeconds ?? 10 : monitor.maxDoorOpenSeconds ?? 30;
  const simulate = useCallback(async (body: object) => {
    if (!device || !warehouseId) throw new Error('Hãy đăng ký thiết bị và cửa cho kho trước khi mô phỏng.');
    const result = await api<{ duplicate: boolean; event: { eventType: string } | null }>('iot/access/simulate', 'POST', { warehouseId, deviceId: device.code, ...body });
    await refresh();
    return result;
  }, [device, warehouseId, refresh]);

  const stop = useCallback(() => { sequence.current++; pendingMotion.current?.resolve(false); pendingMotion.current = null; setBusy(false); if (latestMonitor.current.mode === 'REAL_IOT') { setStartedAt(Date.now()); setPhase('WAITING_REAL'); setRealWaiting(true); setNotice('Chờ thẻ nhân viên và Reed Switch từ ESP32 thật.'); } else { setPhase('IDLE'); setNotice(''); setRealWaiting(false); } }, []);
  const start = useCallback(async (kind: AccessKind) => {
    if (!canSimulate) { setError('Bạn cần quyền xem tồn kho để chạy demo cửa kho.'); return; }
    if (!device || !door) { setError('Hãy khai báo thiết bị ESP32 và cửa kho ở phần Thiết lập bên dưới.'); return; }
    if (door.state === 'OPEN') { setError('Cửa đang mở. Đóng cửa trước khi chạy luồng mới.'); return; }
    const id = ++sequence.current;
    const valid = () => sequence.current === id;
    // Scene completion, not a guessed timeout, advances the choreography.
    const stage = async (next: AccessPhase) => {
      if (!valid()) return false;
      const completed = await new Promise<boolean>(resolve => { pendingMotion.current = { phase: next, resolve }; setPhase(next); });
      return completed && valid();
    };
    setError(''); setNotice(''); setBusy(true); setStartedAt(Date.now()); setRealWaiting(false);
    if (monitor.mode === 'REAL_IOT') {
      setPhase('WAITING_REAL'); setRealWaiting(true); setNotice('ESP32 đang trực tuyến. Đưa thẻ và thao tác cửa thật; mô hình sẽ chờ sự kiện từ thiết bị.'); setBusy(false); return;
    }
    try {
      if (kind === 'unauthorized') {
        // A previous valid scan must expire so this demo still uses the normal backend access rule.
        const grant = monitor.events.find(row => row.eventType === 'ACCESS_GRANTED' && !row.consumedAt);
        if (grant) { const remaining = (monitor.accessWindowSeconds ?? 10) * 1000 + 200 - (Date.now() - new Date(grant.occurredAt).getTime()); if (remaining > 0) { setNotice(`Đợi ${Math.ceil(remaining / 1000)} giây để quyền mở cửa trước đó hết hạn.`); await wait(remaining); } }
        if (!valid()) return;
        const opened = await simulate({ action: 'DOOR', doorId: door.code, state: 'OPEN' });
        if (!valid()) return;
        if (opened.event?.eventType !== 'DOOR_OPEN') throw new Error('Cửa chưa chuyển sang mở. Hãy kiểm tra cảm biến hoặc trạng thái cửa.');
        if (!await stage('OPENING')) return;
        setPhase('ALERT'); setNotice('Cửa mở không có thẻ hợp lệ. Backend đã ghi cảnh báo truy cập trái phép.');
      } else {
        if (!await stage('APPROACH') || !await stage('SCANNING')) return;
        const recentScan = monitor.events.find(row => row.eventType === 'RFID_SCAN');
        if (recentScan) { const cooldown = 3200 - (Date.now() - new Date(recentScan.occurredAt).getTime()); if (cooldown > 0) { setNotice('Đợi đầu đọc hết thời gian chống quét trùng…'); await wait(cooldown); if (!valid()) return; } }
        setPhase('VERIFYING');
        const scanned = await simulate({ action: 'RFID', uid: SIMULATED_CARD_UID });
        if (!valid()) return;
        if (scanned.event?.eventType !== 'ACCESS_GRANTED') throw new Error('Backend chưa cấp quyền. Hãy kiểm tra thẻ và quyền nhân viên.');
        if (!await stage('GRANTED')) return;
        const opened = await simulate({ action: 'DOOR', doorId: door.code, state: 'OPEN' });
        if (!valid()) return;
        if (opened.event?.eventType !== 'DOOR_OPEN') throw new Error('Cửa chưa chuyển sang mở.');
        if (!await stage('OPENING') || !await stage('ENTERING')) return;
        if (kind === 'open-too-long') {
          setPhase('WAITING_ALERT'); setNotice('Đang giữ cửa mở. Backend sẽ tự ghi cảnh báo khi vượt ngưỡng mô phỏng.');
          let detected = false;
          for (let attempt = 0; attempt < 42 && valid(); attempt++) {
            const data = await refresh();
            if (data.alerts.some(row => row.type === 'DOOR_OPEN_TOO_LONG' && row.status === 'OPEN')) { detected = true; setPhase('ALERT'); setNotice('Cửa mở quá lâu: cảnh báo đã được lưu trong PostgreSQL.'); break; }
            await wait(1000);
          }
          if (valid() && !detected) throw new Error('Chưa nhận được cảnh báo từ backend. Kiểm tra tiến trình giám sát cửa.');
          return;
        }
        const closed = await simulate({ action: 'DOOR', doorId: door.code, state: 'CLOSED' });
        if (!valid()) return;
        if (closed.event?.eventType !== 'DOOR_CLOSED') throw new Error('Chưa ghi nhận cửa đóng.');
        if (!await stage('CLOSING')) return;
        setPhase('COMPLETE'); setNotice('Đã ghi truy cập hợp lệ, cửa đóng và nhật ký đã cập nhật.');
      }
    } catch (reason) { if (valid()) { setError(errorMessage(reason)); setPhase('IDLE'); } }
    finally { if (valid()) setBusy(false); }
  }, [canSimulate, device, door, monitor, refresh, simulate]);

  useEffect(() => {
    if (monitor.mode !== 'REAL_IOT') return;
    sequence.current++; pendingMotion.current?.resolve(false); pendingMotion.current = null;
    setBusy(false); setStartedAt(Date.now()); setRealWaiting(true); setPhase('WAITING_REAL');
    setNotice('Chờ thẻ nhân viên và Reed Switch từ ESP32 thật.');
  }, [monitor.mode]);

  useEffect(() => {
    if (!realWaiting || !startedAt) return;
    const recent = monitor.events.filter(row => new Date(row.occurredAt).getTime() >= startedAt);
    const closed = recent.some(row => row.eventType === 'DOOR_CLOSED') && recent.some(row => row.eventType === 'DOOR_OPEN');
    if (closed && door?.state === 'CLOSED') { setPhase(current => current === 'COMPLETE' ? current : 'CLOSING'); }
    else if (monitor.alerts.some(row => row.status === 'OPEN' && new Date(row.createdAt).getTime() >= startedAt)) setPhase('ALERT');
    else if (recent.some(row => row.eventType === 'ACCESS_GRANTED')) setPhase(current => ['IDLE','WAITING_REAL','COMPLETE'].includes(current) ? 'APPROACH' : current === 'VERIFYING' ? 'GRANTED' : current === 'GRANTED' && door?.state === 'OPEN' ? 'OPENING' : current);
    else if (recent.some(row => row.eventType === 'DOOR_OPEN')) setPhase('ALERT');
    else if (recent.some(row => row.eventType === 'RFID_SCAN')) setPhase('SCANNING');
  }, [monitor.events, monitor.alerts, realWaiting, startedAt, door?.state, phase]);

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
  const configure = async (path: string, body: object, success: string) => { setBusy(true); setError(''); try { await api(`iot/access/${path}`, 'POST', body); await refresh(); setNotice(success); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); } };

  return { monitor, connected, phase, error, notice, busy, canManage, canSimulate, device, door, activeAlerts, lastAccess, lastDoor, refresh, start, stop, action, resolve, close, configure, motionComplete, elapsedOpenSeconds, openLimit };
}

export type DoorController = ReturnType<typeof useWarehouseDoor>;
export function WarehouseDoorPanel({ access, warehouseId, warehouseName, active }: { access: DoorController; warehouseId: string; warehouseName: string; active: boolean }) {
  const { monitor, device, door, activeAlerts, lastAccess, lastDoor, canManage, busy } = access;
  const [deviceCode, setDeviceCode] = useState('ESP32-WH01');
  const [doorCode, setDoorCode] = useState('DOOR-WH01-01');
  const [uid, setUid] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  useEffect(() => { setEmployeeId(current => monitor.employees.some(row => row.id === current) ? current : monitor.employees[0]?.id ?? ''); }, [monitor.employees]);
  if (!active) return null;
  return <div className="warehouse-door-experience">
    {(access.error || access.notice) && <p className={access.error ? 'wde-error' : 'wde-notice'} role={access.error ? 'alert' : 'status'}>{access.error || access.notice}</p>}
    <div className="wde-status" aria-label="Trạng thái cửa kho"><div><span>Kho · cửa</span><strong>{warehouseName} · {door?.name ?? (monitor.mode === 'SIMULATION' ? 'Đang chuẩn bị cửa mô phỏng' : 'Chưa đăng ký cửa')}</strong></div><div><span>Trạng thái cửa</span><strong className={activeAlerts.length ? "warning" : ""}>{activeAlerts.length ? "WARNING" : door?.state ?? "UNKNOWN"}</strong></div><div><span>Reed Switch</span><strong className={door?.state === 'OPEN' ? 'warning' : ''}>{door?.state === 'OPEN' ? 'Đang mở' : door ? 'Đã đóng' : 'Chưa có dữ liệu'}</strong></div><div><span>Thiết bị</span><strong>{monitor.mode === 'SIMULATION' ? 'ESP32 MÔ PHỎNG' : (device?.code ?? 'Chưa đăng ký') + ' · ' + (device?.online ? 'ONLINE' : 'OFFLINE')}</strong></div><div><span>Nguồn</span><strong className="wde-source">{monitor.mode === 'REAL_IOT' ? '● REAL IOT' : '◇ SIMULATION'}</strong></div><div><span>Thẻ gần nhất</span><strong>{lastAccess?.employee?.name ?? 'Chưa quét'}{lastAccess?.payload?.uid ? ' · ' + lastAccess.payload.uid : ''} · {time(lastAccess?.occurredAt)}</strong></div><div><span>Cảnh báo</span><strong className={activeAlerts.length ? 'warning' : ''}>{activeAlerts[0] ? label[activeAlerts[0].type] ?? activeAlerts[0].type : 'Không có'}</strong></div></div>
    {door?.state === 'OPEN' && <div className="wde-open-timer">Cửa mở từ {time(door.openSince)} · đã mở {access.elapsedOpenSeconds} giây · giới hạn {access.openLimit} giây.</div>}
    {activeAlerts.length > 0 && <div className="wde-alerts">{activeAlerts.slice(0, 3).map(alert => <div key={alert.id}><strong>{label[alert.type] ?? alert.type}</strong><span>{alert.message}</span>{(canManage || (access.canSimulate && monitor.mode === 'SIMULATION')) && <button type="button" disabled={busy} onClick={() => void access.resolve(alert.id)}>Đã xử lý</button>}</div>)}</div>}
    {access.canSimulate && monitor.mode === 'SIMULATION' && <div className="wde-actions"><span>Thao tác thử:</span><button disabled={busy || !device || !door} onClick={() => void access.action({ action: 'RFID', uid: SIMULATED_CARD_UID }, 'Backend đã xác thực thẻ mô phỏng.')}>Quét thẻ hợp lệ</button><button disabled={busy || !device || !door} onClick={() => void access.action({ action: 'RFID', uid: 'FFFFFFFF' }, 'Backend đã từ chối thẻ mô phỏng.')}>Thẻ bị từ chối</button><button disabled={busy || !door || door.state === 'OPEN'} onClick={() => void access.action({ action: 'DOOR', doorId: door?.code, state: 'OPEN' }, 'Cửa đã mở theo sự kiện backend.')}>Mở cửa</button><button disabled={busy || !door || door.state === 'CLOSED'} onClick={() => void access.close()}>Đóng cửa</button></div>}
    <section className="wde-log"><h3>Nhật ký truy cập · {monitor.events.length} sự kiện gần nhất</h3><div className="table-scroll"><table><thead><tr><th>Giờ</th><th>Sự kiện</th><th>Nhân viên / cửa</th><th>Nguồn</th></tr></thead><tbody>{monitor.events.slice(0, 10).map(event => <tr key={event.id}><td>{time(event.occurredAt)}</td><td>{label[event.eventType] ?? event.eventType}</td><td>{event.employee?.name ?? event.door?.name ?? '—'}</td><td>{event.source === 'IOT_DEVICE' ? 'REAL IOT' : event.source === 'SIMULATION' ? 'SIMULATION' : 'BACKEND'}</td></tr>)}{monitor.events.length === 0 && <tr><td colSpan={4}>Chưa có sự kiện cửa kho.</td></tr>}</tbody></table></div></section>
    {canManage && <details className="wde-setup"><summary>Thiết lập thiết bị, cửa và thẻ nhân viên</summary><div className="wde-setup-grid"><form onSubmit={event => { event.preventDefault(); void access.configure('devices', { code: deviceCode.trim(), name: 'ESP32 cửa kho', warehouseId }, 'Đã lưu thiết bị.'); }}><label>Mã thiết bị<input value={deviceCode} onChange={event => setDeviceCode(event.target.value)} required/></label><button disabled={busy}>Lưu thiết bị</button></form><form onSubmit={event => { event.preventDefault(); void access.configure('doors', { code: doorCode.trim(), name: 'Cửa kho chính', deviceCode: device?.code ?? deviceCode, warehouseId }, 'Đã lưu cửa.'); }}><label>Mã cửa<input value={doorCode} onChange={event => setDoorCode(event.target.value)} required/></label><button disabled={busy || !device}>Lưu cửa</button></form><form onSubmit={event => { event.preventDefault(); void access.configure('cards', { uid: uid.trim(), employeeId, warehouseId, status: 'ACTIVE' }, 'Đã gán thẻ.'); }}><label>Nhân viên<select value={employeeId} onChange={event => setEmployeeId(event.target.value)}>{monitor.employees.map(row => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label>UID thẻ<input value={uid} onChange={event => setUid(event.target.value)} placeholder="D00C330C" required/></label><button disabled={busy || !door || !employeeId}>Gán thẻ</button></form></div><div className="wde-card-list">{monitor.cards.map(card => <span key={card.id}>{card.uid} · {card.employee.name} · {card.status === 'ACTIVE' ? 'Hoạt động' : 'Đã khóa'} {card.status === 'ACTIVE' && <button onClick={() => void access.configure('cards', { uid: card.uid, employeeId: card.employee.id, warehouseId, status: 'REVOKED' }, 'Đã khóa thẻ.')}>Khóa</button>}</span>)}</div><small>ESP32 online sẽ khóa mô phỏng để ưu tiên tín hiệu thật.</small></details>}
  </div>;
}
