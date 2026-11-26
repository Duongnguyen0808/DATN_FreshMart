'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ExcelJS from 'exceljs';
import { QRCodeSVG } from 'qrcode.react';
import { CameraPreview } from './camera-preview';
import { Protected, useAuth } from '../../../components/auth-provider';
import { ProductImage } from '../../../components/ui/product-image';
import { EspStation, isEspEvent, PrepareCameraDemo, type CameraParcel } from './prepare-camera-demo';
import { api, errorMessage } from '../../../lib/auth-api';
import { getInventory, type Inventory } from '../../../lib/inventory-api';
import { getWarehouses, type Warehouse } from '../../../lib/organization-api';
import { getPurchaseOrders, type PurchaseOrder } from '../../../lib/purchase-orders-api';
import { createFefoRiskTransfer, getFefoExpiryRisks, type FefoExpiryRiskItem } from '../../../lib/forecasts-api';
import { createTransfer, dispatchTransfer, getTransfer, getTransfers, receiveTransfer, type Transfer } from '../../../lib/transfers-api';
import type { IotEvent } from '../../../lib/iot-api';
import { subscribeIotEvents, subscribeInventoryUpdates } from '../../../lib/iot-realtime';
import type { DemoState } from './warehouse-twin-scene';
import { useWarehouseDoor, WarehouseDoorPanel, WarehouseCardStaffModal, WarehouseAccessCompleteModal, type AccessKind, type AccessPhase } from './warehouse-door-experience';
const WarehouseTwinScene = dynamic(() => import('./warehouse-twin-scene').then(m => m.WarehouseTwinScene), { ssr: false, loading: () => <p>Đang tải mô hình minh họa…</p> });
import './live-inbound.css';

type Parcel = { id: string; tagId: string; palletCode: string; deviceId: string; skuId: string; quantity: number; lotCode: string; expiresAt: string | null; noExpiry: boolean; evidenceUrls?: string[] | null; status: string; purchaseOrderId: string; purchaseOrderItemId?: string; purchaseOrderCode?: string; product?: { name: string; unit: string; imageUrl?: string | null }; goodsReceiptId: string | null };
type SupplierParcelRow = { key: string; poCode: string; supplierName: string; skuCode: string; productName: string; purchaseOrderItemId: string; quantity: number; tagId: string; palletCode: string; lotCode: string; expiresAt: string | null; noExpiry: boolean; status: 'PENDING_UID' | 'REGISTERED' | 'ERROR'; message: string };
async function loadWarehouseStock(warehouseId: string): Promise<Inventory[]> {
  const first = await getInventory({ warehouseId, pageSize: 100 });
  const rest = await Promise.all(Array.from({ length: Math.max(0, first.pagination.totalPages - 1) }, (_, i) => getInventory({ warehouseId, pageSize: 100, page: i + 2 })));
  return [...first.items, ...rest.flatMap(page => page.items)];
}
const statuses: Record<string, string> = { WAITING_CONFIRMATION: 'Chờ xác nhận nhập kho', RECEIVED: 'Đã nhập kho', ALREADY_RECEIVED: 'Đã nhận trước đó · bỏ qua lượt lặp', BLOCKED: 'Cần xử lý ngoại lệ', UNREGISTERED: 'Chưa đăng ký kiện', PENDING: 'Đang xử lý', READY: 'Chờ thẻ thật', CANCELLED: 'Đã hủy đăng ký' };

type DemoFlow = 'inbound' | 'transfer';
type TimelineStep = { title: string; detail: string; states: DemoState[] };
const TIMELINE: Record<DemoFlow, TimelineStep[]> = {
  inbound: [
    { title: 'Xe đến kho', detail: 'Xe giao hàng vào khu nhận', states: ['TRUCK_APPROACHING', 'TRUCK_DOCKING'] },
    { title: 'Dỡ hàng', detail: 'Xe nâng đưa pallet xuống', states: ['TRUCK_UNLOADING', 'FORKLIFT_TO_TRUCK', 'PALLET_UNLOADING'] },
    { title: 'ESP32-CAM quét QR', detail: 'Đưa kiện tới trạm và đọc tem QR', states: ['IOT_CAMERA_SIMULATED', 'WAITING_CONFIRMATION'] },
    { title: 'Xác nhận nhập', detail: 'Đối chiếu rồi cập nhật tồn', states: ['GOODS_RECEIVED'] },
    { title: 'Đưa lên kệ', detail: 'Xe nâng cất hàng vào kho', states: ['MOVE_TO_STORAGE', 'STORED'] },
  ],
  transfer: [
    { title: 'Lấy hàng từ kệ nguồn', detail: 'Xe nâng vào lối kệ lấy pallet cần chuyển', states: ['TRANSFER_PREPARING', 'FORKLIFT_PICKUP'] },
    { title: 'ESP32-CAM quét xuất', detail: 'Đưa kiện qua cổng xuất và đọc tem QR phiếu', states: ['MOVE_TO_OUTBOUND', 'IOT_CAMERA_OUT_SIMULATED', 'WAITING_DISPATCH_CONFIRM'] },
    { title: 'Xếp lên xe & Vận chuyển', detail: 'Đưa pallet lên xe tải, rời kho nguồn sang kho đích', states: ['FORKLIFT_DELIVER_TO_TRUCK', 'TRANSFER_LOADING_TRUCK', 'DISPATCHED', 'IN_TRANSIT', 'DESTINATION_ARRIVAL'] },
    { title: 'ESP32-CAM quét nhận', detail: 'Dỡ hàng tại kho đích và quét QR đối chiếu', states: ['DESTINATION_PALLET_PICKUP', 'IOT_CAMERA_IN_SIMULATED', 'WAITING_RECEIVE_CONFIRM', 'RECEIVED'] },
    { title: 'Đưa lên kệ kho đích', detail: 'Xe nâng cất hàng vào kệ và đồng bộ tồn kho', states: ['MOVE_TO_STORAGE', 'STORED'] },
  ],
};
const ACCESS_TIMELINE: Record<AccessKind, { title: string; detail: string; phases: AccessPhase[] }[]> = {
  authorized: [
    { title: 'Đến cửa kho', detail: 'Nhân viên tới đầu đọc thẻ', phases: ['APPROACH', 'WAITING_REAL'] },
    { title: 'Quét thẻ RFID', detail: 'Đọc thẻ nhân viên', phases: ['SCANNING'] },
    { title: 'Xác thực', detail: 'Backend kiểm tra quyền', phases: ['VERIFYING', 'GRANTED'] },
    { title: 'Mở cửa', detail: 'Chờ Reed Switch báo mở', phases: ['OPENING'] },
    { title: 'Truy cập kho', detail: 'Hiển thị lượt truy cập', phases: ['ENTERING', 'WAITING_CLOSE'] },
    { title: 'Đóng cửa', detail: 'Reed Switch báo đóng, lưu nhật ký', phases: ['CLOSING', 'COMPLETE'] },
  ],
  unauthorized: [
    { title: 'Không quét thẻ', detail: 'Không có quyền mở cửa gần đây', phases: ['IDLE'] },
    { title: 'Cửa bị mở', detail: 'Reed Switch gửi DOOR_OPEN', phases: ['OPENING'] },
    { title: 'Kiểm tra quyền', detail: 'Backend đối chiếu lượt quét', phases: ['WAITING_REAL'] },
    { title: 'Cảnh báo', detail: 'UNAUTHORIZED_ACCESS', phases: ['ALERT'] },
    { title: 'Ghi nhật ký', detail: 'Lưu sự kiện và cảnh báo', phases: ['COMPLETE'] },
  ],
  'open-too-long': [
    { title: 'Quét thẻ', detail: 'Nhân viên được xác thực', phases: ['APPROACH', 'SCANNING', 'GRANTED'] },
    { title: 'Mở cửa', detail: 'Cảm biến gửi DOOR_OPEN', phases: ['OPENING'] },
    { title: 'Quá thời gian', detail: 'Backend đếm thời gian mở', phases: ['ENTERING', 'WAITING_ALERT', 'WAITING_REAL'] },
    { title: 'Cảnh báo', detail: 'DOOR_OPEN_TOO_LONG', phases: ['ALERT'] },
    { title: 'Đóng cửa', detail: 'Cảnh báo mở lâu được giải quyết', phases: ['CLOSING', 'COMPLETE'] },
  ],
};
const ACCESS_NAMES: Record<AccessKind, string> = { authorized: 'Truy cập cửa kho', unauthorized: 'Truy cập cửa kho', 'open-too-long': 'Truy cập cửa kho' };
// Animation-driven transitions (scene calls onMotionComplete when a movement finishes).
const NEXT_ON_MOTION: Record<DemoFlow, Partial<Record<DemoState, DemoState>>> = {
  inbound: { TRUCK_APPROACHING: 'TRUCK_DOCKING', TRUCK_DOCKING: 'TRUCK_UNLOADING', TRUCK_UNLOADING: 'FORKLIFT_TO_TRUCK', FORKLIFT_TO_TRUCK: 'PALLET_UNLOADING', PALLET_UNLOADING: 'IOT_CAMERA_SIMULATED', IOT_CAMERA_SIMULATED: 'WAITING_CONFIRMATION', MOVE_TO_STORAGE: 'STORED' },
  transfer: { TRANSFER_PREPARING: 'FORKLIFT_PICKUP', FORKLIFT_PICKUP: 'MOVE_TO_OUTBOUND', MOVE_TO_OUTBOUND: 'IOT_CAMERA_OUT_SIMULATED', FORKLIFT_DELIVER_TO_TRUCK: 'TRANSFER_LOADING_TRUCK', IN_TRANSIT: 'DESTINATION_ARRIVAL', DESTINATION_ARRIVAL: 'DESTINATION_PALLET_PICKUP', DESTINATION_PALLET_PICKUP: 'IOT_CAMERA_IN_SIMULATED', MOVE_TO_STORAGE: 'STORED' },
};
// Timed transitions for states without a movement of their own.
const NEXT_ON_TIMER: Record<DemoFlow, Partial<Record<DemoState, [DemoState, number]>>> = {
  inbound: { GOODS_RECEIVED: ['MOVE_TO_STORAGE', 1000], STORED: ['COMPLETE', 1000] },
  transfer: { IOT_CAMERA_OUT_SIMULATED: ['FORKLIFT_DELIVER_TO_TRUCK', 800], DISPATCHED: ['IN_TRANSIT', 700], RECEIVED: ['MOVE_TO_STORAGE', 800], STORED: ['COMPLETE', 1000] },
};

function uint8ToBase64DataUrl(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

export function LiveInbound({ section = 'scene' }: { section?: 'scene' | 'rfid' }) {
  const [prepareOpen, setPrepareOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false), [loadedWarehouse, setLoadedWarehouse] = useState('');
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [prepared, setPrepared] = useState<CameraParcel | null>(null);
  const demoSession = useRef<{ parcel: CameraParcel; started: number } | null>(null);
  const motionRef = useRef<DemoState>('IDLE');
  const [tagId, setTagId] = useState(''), [deviceId, setDeviceId] = useState('FRESHMART-RFID-IN-01');
  const [readingTag, setReadingTag] = useState(false), [paused, setPaused] = useState(false);
  const readingTagRef = useRef(false);
  const registrationRef = useRef<HTMLElement>(null);
  const captureTag = (event: IotEvent) => { setTagId(event.tagId); setDeviceId(event.deviceId); setReadingTag(false); readingTagRef.current = false; setScanQueue([]); setNotice(`Đã lấy UID ${event.tagId}. Chọn đơn mua hàng và đăng ký kiện, sau đó quét lại để nhận hàng.`); registrationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const [scanQueue, setScanQueue] = useState<IotEvent[]>([]);
  const [confirming, setConfirming] = useState(false), [confirmError, setConfirmError] = useState('');
  const [receiptExpiry, setReceiptExpiry] = useState(''), [receiptNoExpiry, setReceiptNoExpiry] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const scan = scanQueue[0];
  useEffect(() => { setReceiptExpiry(''); setReceiptNoExpiry(false); }, [scan?.id]);
  const { user } = useAuth();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]), [warehouseId, setWarehouseId] = useState('');
  const [items, setItems] = useState<Inventory[]>([]), [orders, setOrders] = useState<PurchaseOrder[]>([]), [parcels, setParcels] = useState<Parcel[]>([]), [events, setEvents] = useState<IotEvent[]>([]);
  const [connected, setConnected] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [speedMultiplier, setSpeedMultiplier] = useState<1 | 1.5 | 2>(1.5);
  const [accessKind, setAccessKind] = useState<AccessKind | null>(null);
  const access = useWarehouseDoor(warehouseId, speedMultiplier, section === 'scene' && accessKind !== null);
  const [doorInspector, setDoorInspector] = useState(false);
  const [lineId, setLineId] = useState(''), [noExpiry, setNoExpiry] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [parcelPhoto, setParcelPhoto] = useState('');
  const [supplierRows, setSupplierRows] = useState<SupplierParcelRow[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [motion, setMotion] = useState<DemoState>('IDLE'), [run, setRun] = useState(0), [movingEvent, setMovingEvent] = useState<IotEvent | null>(null);
  motionRef.current = motion;
  const [queue, setQueue] = useState<IotEvent[]>([]), [selected, setSelected] = useState<Inventory | null>(null), [zone, setZone] = useState('overview');
  // Inbound waits for a real camera-code event; transfer remains a simulated visualization.
  const [flow, setFlow] = useState<DemoFlow>('inbound'), [destId, setDestId] = useState(''), [transferSkuId, setTransferSkuId] = useState('');
  const [transferQty, setTransferQty] = useState(5);
  const [useRealTransfer, setUseRealTransfer] = useState(true);
  const [selectedExistingTransferId, setSelectedExistingTransferId] = useState('');
  const [fefoRisks, setFefoRisks] = useState<FefoExpiryRiskItem[]>([]);
  const [realTransfers, setRealTransfers] = useState<Transfer[]>([]);
  const [selectedFefoRisk, setSelectedFefoRisk] = useState<FefoExpiryRiskItem | null>(null);
  const [activeTransfer, setActiveTransfer] = useState<Transfer | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState('');
  const transferFrameRef = useRef<{ bytes: Uint8Array; at: number } | null>(null);
  const transferScanInFlight = useRef(false);
  const [destItems, setDestItems] = useState<Inventory[]>([]);
  const [campusStock, setCampusStock] = useState<Record<string, Inventory[]>>({});
  useEffect(() => {
    if (section !== 'scene' || !warehouseId) return;
    let active = true;
    const neighbors = warehouses.filter(w => w.id !== warehouseId)
      .sort((a, b) => Number(b.id === destId && flow === 'transfer') - Number(a.id === destId && flow === 'transfer')).slice(0, 2);
    setCampusStock({});
    void Promise.all(neighbors.map(async w => {
      const first = await getInventory({ warehouseId: w.id, pageSize: 100 });
      const rest = await Promise.all(Array.from({ length: Math.max(0, first.pagination.totalPages - 1) }, (_, i) => getInventory({ warehouseId: w.id, pageSize: 100, page: i + 2 })));
      return [w.id, [...first.items, ...rest.flatMap(p => p.items)].filter(i => i.onHand > 0)] as const;
    })).then(rows => { if (active) setCampusStock(Object.fromEntries(rows)); })
      .catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [warehouses, warehouseId, destId, flow, section]);
  const currentWarehouse = useRef(''), refreshVersion = useRef(0), seen = useRef(new Set<string>());
  const dismissedScanIds = useRef(new Set<string>()), dismissedTagIds = useRef(new Set<string>());
  currentWarehouse.current = warehouseId;
  const canReceive = user?.permissions.includes('purchase_orders.receive') || user?.permissions.includes('*');
  const canReadOrders = user?.permissions.includes('purchase_orders.read') || user?.permissions.includes('*');
  useEffect(() => { dismissedScanIds.current.clear(); dismissedTagIds.current.clear(); setScanQueue([]); setConfirmError(''); setTagId(''); setReadingTag(false); readingTagRef.current = false; setPaused(false); }, [warehouseId]);
  const dismissScan = useCallback(() => {
    const wasProcessed = Boolean(scan?.processed);
    if (scan) {
      dismissedScanIds.current.add(scan.id);
      if (!wasProcessed && scan.tagId) dismissedTagIds.current.add(scan.tagId);
    }
    setConfirmError('');
    if (section === 'scene' && !wasProcessed) {
      demoSession.current = null;
      motionRef.current = 'IDLE';
      setPrepared(null);
      setScanQueue([]);
      setQueue([]);
      setPaused(false);
      setMotion('IDLE');
      setZone('overview');
      access.stop();
      setNotice('Đã hủy phiên xác nhận kiện hàng.');
    } else {
      setScanQueue(q => q.slice(1));
    }
  }, [scan, section, access]);
  useEffect(() => {
    if (!scan) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirming) dismissScan();
      if (e.key === 'Tab') {
        const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]');
        if (!nodes?.length) { e.preventDefault(); return; }
        if (e.shiftKey && (document.activeElement === nodes[0] || document.activeElement === dialogRef.current)) { e.preventDefault(); nodes[nodes.length - 1].focus(); }
        if (!e.shiftKey && document.activeElement === nodes[nodes.length - 1]) { e.preventDefault(); nodes[0].focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [scan?.id, confirming, dismissScan]);
  const refresh = useCallback(async (id: string) => {
    const version = ++refreshVersion.current;
    const [stock, po, registered, history] = await Promise.all([
      getInventory({ warehouseId: id, pageSize: 100 }),
      (user?.permissions.includes('purchase_orders.read') || user?.permissions.includes('*')) ? getPurchaseOrders({ warehouseId: id }) : Promise.resolve(null),
      api<Parcel[]>(`iot/inbound-parcels?warehouseId=${id}`), api<IotEvent[]>(`iot/events?warehouseId=${id}&limit=50`),
    ]);
    const stockPages = await Promise.all(Array.from({ length: Math.max(0, stock.pagination.totalPages - 1) }, (_, i) => getInventory({ warehouseId: id, pageSize: 100, page: i + 2 })));
    const poPages = po ? await Promise.all(Array.from({ length: Math.max(0, po.pagination.totalPages - 1) }, (_, i) => getPurchaseOrders({ warehouseId: id, page: i + 2 }))) : [];
    if (currentWarehouse.current !== id || refreshVersion.current !== version) return;
    const latestItems = [...stock.items, ...stockPages.flatMap(p => p.items)];
    setItems(latestItems);
    setSelected(previous => previous ? latestItems.find(item => item.id === previous.id) ?? null : null);
    setOrders([...(po?.items ?? []), ...poPages.flatMap(p => p.items)].filter(p => p.status === 'OPEN'));
    setParcels(registered); setEvents(history.filter(e => e.source === 'DEVICE' && (section === 'scene' ? isEspEvent(e) : e.eventType === 'RFID_DETECTED')));
    setLoadedWarehouse(id);
    setScanQueue(q => q.filter(e => !dismissedScanIds.current.has(e.id) && !dismissedTagIds.current.has(e.tagId)).map(e => history.find(h => h.id === e.id) ?? e));
  }, [user, section]);
  useEffect(() => {
    const reload = () => { if (currentWarehouse.current) void refresh(currentWarehouse.current).catch(e => setError(errorMessage(e))); };
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [refresh]);
  useEffect(() => { getWarehouses().then(rows => { const active = rows.filter(w => w.active); setWarehouses(active); setWarehouseId(active.find(w => w.code === 'KHO001')?.id ?? active[0]?.id ?? ''); }).catch(e => setError(errorMessage(e))); }, []);
  useEffect(() => {
    demoSession.current = null; setPrepared(null); setLoadedWarehouse('');
    setItems([]); setOrders([]); setParcels([]); setEvents([]); setLineId(''); setMotion('IDLE'); setMovingEvent(null); setQueue([]); setSelected(null); seen.current.clear();
    if (warehouseId) void refresh(warehouseId).catch(e => setError(errorMessage(e)));
  }, [warehouseId, refresh]);
  useEffect(() => subscribeIotEvents(event => {
    if (event.source !== 'DEVICE') return;
    const session = demoSession.current;
    const matchesDemo = section === 'scene' && session && motionRef.current === 'WAITING_CONFIRMATION' && event.tagId === session.parcel.tagId && event.deviceId === session.parcel.deviceId && new Date(event.receivedAt).getTime() >= session.started;
    if (event.warehouseId !== currentWarehouse.current && !matchesDemo) return;
    if (section === 'scene' ? !isEspEvent(event) : event.eventType !== 'RFID_DETECTED') return;
    if (section === 'scene' && !matchesDemo) return;
    if (dismissedScanIds.current.has(event.id) || dismissedTagIds.current.has(event.tagId)) return;
    setEvents(previous => [event, ...previous.filter(e => e.id !== event.id)].slice(0, 50));
    if (readingTagRef.current) {
      captureTag(event);
      void refresh(event.warehouseId).catch(e => setError(errorMessage(e)));
      return;
    }
    setScanQueue(previous => {
      const key = event.inboundParcelId ?? event.tagId;
      const index = previous.findIndex(e => (e.inboundParcelId ?? e.tagId) === key);
      if (index >= 0) return previous.map((e, i) => i === index ? event : e);
      return ['WAITING_CONFIRMATION', 'UNREGISTERED', 'BLOCKED'].includes(event.automationStatus ?? '') ? [...previous, event] : previous;
    });
    if (event.automationStatus === 'RECEIVED' && !seen.current.has(event.id)) {
      seen.current.add(event.id); setQueue(previous => [...previous, event]);
    }
    void refresh(event.warehouseId).catch(e => setError(errorMessage(e)));
  }, online => { setConnected(online); if (online && currentWarehouse.current) void refresh(currentWarehouse.current).catch(e => setError(errorMessage(e))); }), [refresh, section]);
  useEffect(() => {
    if (section !== 'scene') return;
    return subscribeInventoryUpdates(update => {
      if (update.warehouseId === currentWarehouse.current) {
        void refresh(update.warehouseId).catch(e => setError(errorMessage(e)));
      } else if (update.warehouseId === destId && flow === 'transfer') {
        void loadWarehouseStock(update.warehouseId).then(setDestItems).catch(e => setError(errorMessage(e)));
      }
    }, online => { if (online && currentWarehouse.current) void refresh(currentWarehouse.current).catch(e => setError(errorMessage(e))); });
  }, [section, refresh, destId, flow]);
  useEffect(() => {
    // A real confirmed receipt plays the inbound "store on rack" animation; transfer demo must not be interrupted.
    if (flow === 'inbound' && ['IDLE', 'WAITING_CONFIRMATION'].includes(motion) && queue.length) {
      setMovingEvent(queue[0]); setQueue(previous => previous.slice(1)); setRun(n => n + 1); setMotion('GOODS_RECEIVED'); setZone('receiving');
    }
  }, [flow, motion, queue]);
  useEffect(() => {
    const next = NEXT_ON_TIMER[flow][motion];
    if (paused || !next || (flow === 'inbound' && motion === 'GOODS_RECEIVED' && Boolean(scan))) return;
    const delay = Math.round((flow === 'inbound' && motion === 'GOODS_RECEIVED' ? 450 : next[1]) / speedMultiplier);
    const timer = setTimeout(() => { setMotion(next[0]); if (next[0] === 'IDLE' || next[0] === 'COMPLETE') setZone('overview'); }, delay);
    return () => clearTimeout(timer);
  }, [flow, motion, paused, speedMultiplier, scan]);
  useEffect(() => {
    if (section !== 'scene' || motion !== 'WAITING_CONFIRMATION' || !prepared) return;
    let active = true;
    const poll = async () => {
      try {
        // Search this exact parcel across accessible warehouses, including a
        // mismatched physical station, so a rejected scan cannot disappear.
        const rows = await api<IotEvent[]>(`iot/events?tagId=${encodeURIComponent(prepared.tagId)}&limit=20`);
        const event = rows.find(e => !dismissedScanIds.current.has(e.id) && !dismissedTagIds.current.has(e.tagId) && isEspEvent(e) && e.tagId === prepared.tagId && e.deviceId === prepared.deviceId && new Date(e.receivedAt).getTime() >= (demoSession.current?.started ?? Infinity) && ['WAITING_CONFIRMATION', 'BLOCKED', 'UNREGISTERED', 'ALREADY_RECEIVED'].includes(e.automationStatus ?? ''));
        if (active && event && motionRef.current === 'WAITING_CONFIRMATION') setScanQueue(previous => previous.length ? previous : [event]);
      } catch (reason) { if (active) setError(errorMessage(reason)); }
    };
    void poll(); const timer = setInterval(() => void poll(), 1000);
    return () => { active = false; clearInterval(timer); };
  }, [section, motion, prepared, warehouseId]);
  const onMotionComplete = (state: DemoState) => {
    if (flow === 'transfer' && state === 'TRANSFER_LOADING_TRUCK') {
      setMotion(activeTransfer ? 'WAITING_DISPATCH_CONFIRM' : 'DISPATCHED');
      return;
    }
    if (flow === 'transfer' && state === 'IOT_CAMERA_IN_SIMULATED') {
      setMotion(activeTransfer ? 'WAITING_RECEIVE_CONFIRM' : 'RECEIVED');
      return;
    }
    const next = NEXT_ON_MOTION[flow][state];
    if (next) setMotion(next);
    if (state === 'MOVE_TO_STORAGE') setZone('storage-a');
  };
  const destinations = warehouses.filter(w => w.id !== warehouseId);
  useEffect(() => { setDestId(previous => destinations.some(w => w.id === previous) ? previous : destinations[0]?.id ?? ''); }, [warehouseId, warehouses]);
  useEffect(() => {
    setDestItems([]);
    if (flow !== 'transfer' || !destId) return;
    let alive = true;
    loadWarehouseStock(destId).then(rows => { if (alive) setDestItems(rows); }).catch(() => {});
    return () => { alive = false; };
  }, [flow, destId]);
  useEffect(() => {
    if (section !== 'scene' || flow !== 'transfer') return;
    let alive = true;
    void Promise.all([
      getFefoExpiryRisks(undefined, 14).catch(() => null),
      getTransfers({ status: 'all', page: 1 }).catch(() => null),
    ]).then(([risks, list]) => {
      if (!alive) return;
      if (risks?.items) {
        setFefoRisks(risks.items.filter(item => item.recommendedTransferBranch && item.atRiskQuantity > 0));
      }
      if (list?.items) {
        setRealTransfers(list.items.filter(t => t.status === 'READY' || t.status === 'IN_TRANSIT'));
      }
    });
    return () => { alive = false; };
  }, [section, flow, setupOpen, warehouseId]);
  const confirmTransferStep = useCallback(async (via: 'camera' | 'manual') => {
    if (!activeTransfer || transferBusy) return;
    setTransferBusy(true);
    setTransferError('');
    try {
      if (motionRef.current === 'WAITING_DISPATCH_CONFIRM') {
        const updated = await dispatchTransfer(
          activeTransfer.id,
          via === 'camera' ? 'Quét QR xuất kho qua ESP32-CAM tại mô hình 3D' : 'Xác nhận xuất kho trên mô hình 3D',
        );
        setActiveTransfer(updated);
        setNotice(`Đã quét xuất kho phiếu ${updated.code}. Xe vận chuyển sang ${updated.destinationWarehouse.name}.`);
        setMotion('DISPATCHED');
        void refresh(updated.sourceWarehouseId);
      } else if (motionRef.current === 'WAITING_RECEIVE_CONFIRM') {
        const updated = await receiveTransfer(activeTransfer.id, {
          note: via === 'camera' ? 'Quét QR nhận hàng qua ESP32-CAM tại mô hình 3D' : 'Xác nhận nhận hàng tại kho đích',
          items: activeTransfer.items.map(it => ({
            skuId: it.skuId,
            quantity: it.approvedQuantity ?? it.dispatchedQuantity ?? it.requestedQuantity,
            discrepancyReason: null,
          })),
        });
        setActiveTransfer(updated);
        setNotice(`Hoàn tất phiếu ${updated.code} · Đã cộng tồn kho thực tế tại ${updated.destinationWarehouse.name}.`);
        setMotion('RECEIVED');
        void refresh(updated.sourceWarehouseId);
        if (destId) void loadWarehouseStock(destId).then(setDestItems).catch(() => {});
      }
    } catch (e) {
      setTransferError(errorMessage(e));
    } finally {
      setTransferBusy(false);
    }
  }, [activeTransfer, transferBusy, refresh, destId]);
  useEffect(() => {
    if (section !== 'scene' || flow !== 'transfer' || !activeTransfer) return;
    if (motion !== 'WAITING_DISPATCH_CONFIRM' && motion !== 'WAITING_RECEIVE_CONFIRM') {
      transferScanInFlight.current = false;
      return;
    }
    let alive = true;
    const expectedCode = activeTransfer.code.toUpperCase();
    const expectedBarcodes = new Set(activeTransfer.items.map(i => i.sku.barcode?.trim().toUpperCase()).filter(Boolean));
    const timer = window.setInterval(async () => {
      if (!alive || transferScanInFlight.current || transferBusy) return;
      transferScanInFlight.current = true;
      try {
        // Ask backend to decode its in-memory latestFrame first (0 base64 upload overhead, keeps 25 FPS stream silky smooth!)
        let res = await api<{ decoded: boolean; reason?: string; code: string | null; resolvedBarcode: string | null }>('iot/camera/pos-scan', 'POST', { source: 'esp32' }, 2500);
        if (!res.decoded && res.reason === 'NO_CAMERA_FRAME') {
          const recent = transferFrameRef.current;
          if (recent && Date.now() - recent.at < 2000) {
            res = await api<{ decoded: boolean; reason?: string; code: string | null; resolvedBarcode: string | null }>(
              'iot/camera/pos-scan',
              'POST',
              { source: 'image', imageDataUrl: uint8ToBase64DataUrl(recent.bytes) },
              2500,
            );
          }
        }
        const scanned = res.code?.trim().toUpperCase() ?? '';
        const resolved = res.resolvedBarcode?.trim().toUpperCase() ?? '';
        if (alive && res.decoded && (scanned === expectedCode || (scanned && expectedBarcodes.has(scanned)) || (resolved && expectedBarcodes.has(resolved)))) {
          await confirmTransferStep('camera');
        }
      } catch {
        // Ignore transient camera frame poll errors
      } finally {
        transferScanInFlight.current = false;
      }
    }, 450);
    return () => {
      alive = false;
      transferScanInFlight.current = false;
      window.clearInterval(timer);
    };
  }, [section, flow, activeTransfer, motion, transferBusy, confirmTransferStep]);
  const resetDemo = () => { demoSession.current = null; setPrepared(null); setActiveTransfer(null); setTransferError(''); transferScanInFlight.current = false; setScanQueue([]); setQueue([]); setPaused(false); setMotion('IDLE'); setZone('overview'); access.stop(); };
  const chooseFlow = (next: DemoFlow) => { if (next === flow && !accessKind) return; resetDemo(); setMovingEvent(null); setAccessKind(null); setDoorInspector(false); setFlow(next); };
  const chooseAccess = (next: AccessKind) => { if (next === accessKind) return; resetDemo(); setMovingEvent(null); setAccessKind(next); setDoorInspector(false); };
  const startDemo = () => { if (accessKind) { void access.start(accessKind); return; } if (flow === 'transfer') { setSetupOpen(true); return; } setPrepareOpen(true); };
  const warehouse = warehouses.find(w => w.id === warehouseId);
  const lines = orders.flatMap(po => po.items.filter(line => line.remainingQuantity > 0).map(line => ({ po, line })));
  const normalizeSearch = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  const filteredLines = lines.filter(({ po, line }) => line.id === lineId || normalizeSearch(`${line.sku.product.name} ${po.code}`).includes(normalizeSearch(productSearch.trim())));
  const selectedLine = lines.find(row => row.line.id === lineId);
  const reserved = parcels.filter(p => p.status === 'READY' && p.purchaseOrderItemId === lineId).reduce((sum, p) => sum + p.quantity, 0);
  const remaining = selectedLine ? Math.max(0, selectedLine.line.remainingQuantity - reserved) : 0;
  const register = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const form = e.currentTarget, data = new FormData(form); setBusy(true); setError(''); setNotice('');
    try {
      await api('iot/inbound-parcels', 'POST', { tagId: String(data.get('tagId')).replace(/\s/g, '').toUpperCase(), deviceId: data.get('deviceId'), purchaseOrderItemId: lineId, quantity: Number(data.get('quantity')), expiresAt: noExpiry ? null : data.get('expiresAt'), noExpiry, evidence: parcelPhoto ? [parcelPhoto] : [] });
      form.reset(); setTagId(''); setLineId(''); setNoExpiry(false); setParcelPhoto(''); setNotice('Đã đăng ký kiện. Quét thẻ tại đúng thiết bị để nhận diện kiện hàng.'); await refresh(warehouseId);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const downloadSupplierTemplate = async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'FreshMart';
    const guide = workbook.addWorksheet('Huong dan');
    guide.addRows([
      ['MẪU KÊ KHAI KIỆN GIAO HÀNG - FRESHMART'],
      ['Nhà cung cấp điền sheet Kien hang. Mỗi dòng là một kiện; nếu PO có nhiều kiện cùng mặt hàng, tạo nhiều dòng.'],
      ['UID RFID có thể để trống. Nhân viên kho sẽ quét thẻ tại điểm nhận và gắn UID vào dòng kiện trong FreshMart.'],
      ['Mã đơn mua hàng, mã SKU và barcode được lấy theo PO đang mở; không sửa các cột nhận diện này.'],
      ['Số lượng kiện là số đơn vị tồn trong kiện. Mã lô và hạn sử dụng lấy trên bao bì; hàng không hạn dùng ghi TRUE.'],
      ['Ngày hạn dùng nhập theo YYYY-MM-DD. Không nhập số lượng bằng số kiện nếu đơn vị tồn là lon/chai/hộp.'],
    ]);
    guide.getColumn(1).width = 120;
    guide.getRow(1).font = { bold: true, size: 14, color: { argb: 'FF075985' } };
    const sheet = workbook.addWorksheet('Kien hang');
    sheet.columns = [
      { header: 'Mã đơn mua hàng', key: 'po', width: 24 },
      { header: 'Mã nhà cung cấp', key: 'supplier', width: 22 },
      { header: 'Mã SKU', key: 'sku', width: 22 },
      { header: 'Barcode', key: 'barcode', width: 22 },
      { header: 'Tên sản phẩm', key: 'product', width: 38 },
      { header: 'Số lượng kiện (đơn vị tồn)', key: 'quantity', width: 30 },
      { header: 'UID RFID (để trống nếu kho sẽ quét)', key: 'uid', width: 40 },
      { header: 'Mã kiện nhà cung cấp', key: 'pallet', width: 26 },
      { header: 'Mã lô', key: 'lot', width: 20 },
      { header: 'Hạn sử dụng (YYYY-MM-DD)', key: 'expiry', width: 30 },
      { header: 'Không hạn sử dụng (TRUE/FALSE)', key: 'noExpiry', width: 34 },
    ];
    for (const column of [1, 2, 3, 4, 7, 8, 9, 10]) sheet.getColumn(column).numFmt = '@';
    sheet.getColumn(6).numFmt = '0';
    for (const { po, line } of lines) sheet.addRow({ po: po.code, supplier: po.supplier.code, sku: line.sku.code, barcode: line.sku.barcode, product: line.sku.product.name, quantity: '', uid: '', pallet: '', lot: '', expiry: '', noExpiry: false });
    if (!lines.length) sheet.addRow({ po: '', supplier: '', sku: '', barcode: '', product: '', quantity: '', uid: '', pallet: '', lot: '', expiry: '', noExpiry: false });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: 'K1' };
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0877BD' } };
    const buffer = await workbook.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'mau-ke-khai-kien-nhap-hang-freshmart.xlsx'; anchor.click(); URL.revokeObjectURL(url);
  };
  const parseSupplierFile = async (file: File) => {
    setImportBusy(true); setError(''); setNotice('');
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('File Excel tối đa 10 MB.');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheet = workbook.getWorksheet('Kien hang') ?? workbook.worksheets[0];
      if (!sheet || sheet.rowCount < 2) throw new Error('File chưa có dòng kiện hàng để nhập.');
      const header = sheet.getRow(1).values as (string | ExcelJS.CellValue)[];
      const expected = ['Mã đơn mua hàng', 'Mã nhà cung cấp', 'Mã SKU', 'Barcode', 'Tên sản phẩm', 'Số lượng kiện (đơn vị tồn)', 'UID RFID (để trống nếu kho sẽ quét)', 'Mã kiện nhà cung cấp', 'Mã lô', 'Hạn sử dụng (YYYY-MM-DD)', 'Không hạn sử dụng (TRUE/FALSE)'];
      if (expected.some((value, index) => String(header[index + 1] ?? '').trim() !== value)) throw new Error('Tiêu đề cột không đúng mẫu FreshMart. Hãy tải mẫu mới rồi dán dữ liệu vào sheet “Kien hang”.');
      const imported: SupplierParcelRow[] = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const text = (column: number) => String(row.getCell(column).text ?? '').trim();
        if (Array.from({ length: 11 }, (_, index) => text(index + 1)).every(value => !value)) return;
        const poCode = text(1), supplierCode = text(2), skuCode = text(3), barcode = text(4), quantity = Number(text(6).replace(',', '.'));
        const tagId = text(7).replace(/\s/g, '').toUpperCase();
        const po = orders.find(value => value.code.toUpperCase() === poCode.toUpperCase());
        const line = po?.items.find(value => value.sku.code.toUpperCase() === skuCode.toUpperCase() || value.sku.barcode === barcode);
        const noExpiry = ['TRUE', 'YES', '1', 'CÓ', 'CO', 'X'].includes(text(11).toUpperCase());
        let expiresAt: string | null = null;
        const expiryText = text(10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(expiryText)) expiresAt = expiryText;
        else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(expiryText)) { const [day, month, year] = expiryText.split('/'); expiresAt = `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`; }
        let message = '';
        if (!po) message = 'Không tìm thấy đơn mua hàng đang mở tại kho này.';
        else if (supplierCode && supplierCode.toUpperCase() !== po.supplier.code.toUpperCase()) message = 'Mã nhà cung cấp không khớp đơn mua hàng.';
        else if (!line) message = 'Mã SKU/barcode không có trong đơn mua hàng.';
        else if (!Number.isInteger(quantity) || quantity <= 0) message = 'Số lượng kiện phải là số nguyên dương.';
        else if (tagId && !/^[0-9A-F]{8,20}$/.test(tagId)) message = 'UID RFID phải gồm 8–20 ký tự hex (0–9, A–F).';
        else if (!noExpiry && !expiresAt) message = 'Cần nhập hạn sử dụng hoặc chọn không hạn sử dụng.';
        else if (line && quantity > line.remainingQuantity) message = 'Số lượng vượt số còn phải nhận trên đơn.';
        imported.push({ key: `row-${rowNumber}-${Date.now()}`, poCode, supplierName: po?.supplier.name ?? supplierCode, skuCode: line?.sku.code ?? skuCode, productName: line?.sku.product.name ?? text(5), purchaseOrderItemId: line?.id ?? '', quantity, tagId, palletCode: text(8), lotCode: text(9), expiresAt, noExpiry, status: message ? 'ERROR' : 'PENDING_UID', message: message || (tagId ? 'Chờ đăng ký kiện…' : 'Chờ quét thẻ để gắn UID.') });
      });
      if (!imported.length) throw new Error('Không tìm thấy dòng dữ liệu hợp lệ trong sheet “Kien hang”.');
      setSupplierRows(current => [...imported, ...current]);
      let registered = 0;
      for (const row of imported) if (row.status === 'PENDING_UID' && row.tagId) {
        try {
          await api('iot/inbound-parcels', 'POST', { tagId: row.tagId, deviceId, purchaseOrderItemId: row.purchaseOrderItemId, quantity: row.quantity, palletCode: row.palletCode || undefined, lotCode: row.lotCode || undefined, expiresAt: row.expiresAt, noExpiry: row.noExpiry, evidence: [] });
          setSupplierRows(current => current.map(value => value.key === row.key ? { ...value, status: 'REGISTERED', message: 'Đã đăng ký UID từ file.' } : value)); registered++;
        } catch (reason) { setSupplierRows(current => current.map(value => value.key === row.key ? { ...value, status: 'ERROR', message: errorMessage(reason) } : value)); }
      }
      await refresh(warehouseId);
      setNotice(`Đã đọc ${imported.length} dòng: đăng ký ${registered} kiện có UID; ${imported.filter(row => row.status === 'PENDING_UID' && !row.tagId).length} kiện chờ quét thẻ.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : errorMessage(reason)); }
    finally { setImportBusy(false); }
  };
  const bindImportedUid = async (row: SupplierParcelRow) => {
    if (!tagId || row.status !== 'PENDING_UID') return;
    setBusy(true); setError('');
    try {
      await api('iot/inbound-parcels', 'POST', { tagId: tagId.replace(/\s/g, '').toUpperCase(), deviceId, purchaseOrderItemId: row.purchaseOrderItemId, quantity: row.quantity, palletCode: row.palletCode || undefined, lotCode: row.lotCode || undefined, expiresAt: row.expiresAt, noExpiry: row.noExpiry, evidence: [] });
      const normalizedTag = tagId.replace(/\s/g, '').toUpperCase();
      setSupplierRows(current => current.map(value => value.key === row.key ? { ...value, tagId: normalizedTag, status: 'REGISTERED', message: 'Đã ghép UID và đăng ký kiện.' } : value));
      setTagId(''); setNotice(`Đã gắn UID vào kiện ${row.palletCode || row.skuCode}.`); await refresh(warehouseId);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  const cancel = async (id: string) => { setBusy(true); setError(''); try { await api(`iot/inbound-parcels/${id}/cancel`, 'POST', {}); await refresh(warehouseId); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } };
  const movingStock = items.find(i => i.skuId === movingEvent?.mappedSkuId);
  const scannedParcel = parcels.find(p => p.id === scan?.inboundParcelId);
  const latest = events[0];
  const stockAtScan = items.find(i => i.skuId === scan?.mappedSkuId);
  const scanProductName = scan?.mappedSku?.product.name ?? scannedParcel?.product?.name ?? prepared?.product?.name ?? 'Mã chưa liên kết sản phẩm';
  const scanProductImage =
    scan?.mappedSku?.product.imageUrl ??
    scannedParcel?.product?.imageUrl ??
    prepared?.product?.imageUrl ??
    stockAtScan?.sku.product.imageUrl ??
    orders
      .flatMap(po => po.items)
      .find(i => i.skuId === (scan?.mappedSkuId ?? scannedParcel?.skuId) || i.sku.product.name === scanProductName)
      ?.sku.product.imageUrl ??
    items.find(i => i.sku.product.name === scanProductName)?.sku.product.imageUrl ??
    null;
  const confirmScan = async () => {
    if (!scan || confirming) return;
    setConfirming(true); setConfirmError('');
    try {
      const needsExpiry = scannedParcel && !scannedParcel.expiresAt && !scannedParcel.noExpiry;
      if (needsExpiry && !receiptExpiry && !receiptNoExpiry) { setConfirmError('Nhập hạn sử dụng hoặc xác nhận sản phẩm không có hạn sử dụng.'); return; }
      const result = await api<IotEvent>(`iot/events/${scan.id}/confirm`, 'POST', needsExpiry ? { expiresAt: receiptNoExpiry ? null : receiptExpiry, noExpiry: receiptNoExpiry } : {});
      if (currentWarehouse.current !== result.warehouseId) return;
      setScanQueue(q => q.map(e => e.inboundParcelId === result.inboundParcelId ? result : e));
      if (result.automationStatus === 'RECEIVED' && !seen.current.has(result.id)) { seen.current.add(result.id); setQueue(q => [...q, result]); }
      window.dispatchEvent(new Event('focus'));
      await refresh(result.warehouseId);
    } catch (e) { setConfirmError(errorMessage(e)); } finally { setConfirming(false); }
  };
  const stocked = items.filter(i => i.onHand > 0);
  const running = accessKind ? access.busy || !['IDLE', 'COMPLETE', 'ALERT', 'WAITING_REAL'].includes(access.phase) : motion !== 'IDLE' && motion !== 'COMPLETE';
  const destination = warehouses.find(w => w.id === destId);
  const transferItem = stocked.find(i => i.skuId === transferSkuId) ?? stocked[0];
  const sortedFefoRisks = useMemo(
    () => [...fefoRisks].sort((a, b) => Number(b.warehouseId === warehouseId) - Number(a.warehouseId === warehouseId) || a.daysRemaining - b.daysRemaining),
    [fefoRisks, warehouseId],
  );
  const selectedExistingTransfer = realTransfers.find(t => t.id === selectedExistingTransferId) ?? null;
  const startTransferDemo = async () => {
    setTransferError('');
    if (selectedExistingTransfer) {
      setWarehouseId(selectedExistingTransfer.sourceWarehouseId);
      setDestId(selectedExistingTransfer.destinationWarehouseId);
      setTransferSkuId(selectedExistingTransfer.items[0]?.skuId ?? '');
      setActiveTransfer(selectedExistingTransfer);
      setSetupOpen(false);
      setRun(n => n + 1);
      setPaused(false);
      setMovingEvent(null);
      setZone(selectedExistingTransfer.status === 'IN_TRANSIT' ? 'receiving' : 'shipping');
      setMotion(selectedExistingTransfer.status === 'IN_TRANSIT' ? 'DESTINATION_ARRIVAL' : 'TRANSFER_PREPARING');
      return;
    }
    if (!destination || !transferItem) return;
    const safeQty = Math.max(1, Math.min(Math.round(transferQty) || 1, transferItem.onHand));
    if (useRealTransfer) {
      setTransferBusy(true);
      try {
        let createdId = '';
        if (
          selectedFefoRisk &&
          selectedFefoRisk.warehouseId === warehouseId &&
          selectedFefoRisk.recommendedTransferBranch?.warehouseId === destId &&
          selectedFefoRisk.skuId === transferItem.skuId
        ) {
          const res = await createFefoRiskTransfer({
            sourceWarehouseId: warehouseId,
            destinationWarehouseId: destId,
            skuId: transferItem.skuId,
            quantity: safeQty,
            lotCode: selectedFefoRisk.lotCode,
          });
          createdId = res.id;
        } else {
          const created = await createTransfer({
            sourceWarehouseId: warehouseId,
            destinationWarehouseId: destId,
            reason: `Điều chuyển từ mô hình 3D · ${transferItem.sku.product.name}`,
            items: [{ skuId: transferItem.skuId, quantity: safeQty }],
          });
          createdId = created.id;
        }
        const fullTransfer = await getTransfer(createdId);
        setActiveTransfer(fullTransfer);
        setSetupOpen(false);
        setRun(n => n + 1);
        setPaused(false);
        setMovingEvent(null);
        setZone('shipping');
        setMotion(fullTransfer.status === 'IN_TRANSIT' ? 'DESTINATION_ARRIVAL' : 'TRANSFER_PREPARING');
      } catch (e) {
        setTransferError(errorMessage(e));
      } finally {
        setTransferBusy(false);
      }
      return;
    }
    setActiveTransfer(null);
    setSetupOpen(false);
    setRun(n => n + 1);
    setPaused(false);
    setMovingEvent(null);
    setZone('shipping');
    setMotion('TRANSFER_PREPARING');
  };
  const timeline = accessKind ? ACCESS_TIMELINE[accessKind] : TIMELINE[flow];
  const activeStep = accessKind ? (access.phase === 'IDLE' ? -1 : Math.max(0, ACCESS_TIMELINE[accessKind].findIndex(step => step.phases.includes(access.phase)))) : motion === 'COMPLETE' ? timeline.length : TIMELINE[flow].findIndex(step => step.states.includes(motion));
  const shownStep = Math.max(0, activeStep + (activeStep < 0 && motion !== 'IDLE' ? 1 : 0));
  const motionLabel = accessKind ? (access.phase === 'IDLE' ? 'Sẵn sàng' : access.phase === 'ALERT' ? 'Cảnh báo cửa kho' : access.phase === 'COMPLETE' ? 'Hoàn tất phiên ra vào kho' : access.phase === 'WAITING_REAL' ? 'Chờ tín hiệu ESP32' : access.phase === 'WAITING_ALERT' ? 'Đang theo dõi thời gian mở cửa' : access.phase === 'APPROACH' ? 'Nhân viên đang đến cửa' : access.phase === 'SCANNING' ? 'Chờ quét thẻ nhân viên…' : access.phase === 'VERIFYING' ? 'Backend đang xác thực thẻ' : access.phase === 'GRANTED' ? 'Đã xác thực nhân viên' : access.phase === 'OPENING' ? 'Cửa cuốn đang mở' : access.phase === 'ENTERING' ? 'Nhân viên đang vào kho' : access.phase === 'WAITING_CLOSE' ? 'Chờ cảm biến báo cửa đóng…' : 'Cửa cuốn đang đóng') : paused ? 'Tạm dừng' : motion === 'IDLE' ? 'Sẵn sàng' : motion === 'COMPLETE' ? 'Hoàn tất luồng' : motion === 'WAITING_CONFIRMATION' ? 'Chờ camera quét mã kiện' : motion === 'WAITING_DISPATCH_CONFIRM' ? 'Chờ xác nhận xuất kho' : motion === 'WAITING_RECEIVE_CONFIRM' ? 'Chờ xác nhận nhận hàng' : 'Đang chạy mô phỏng';
  const motionHint = accessKind ? (access.error || access.activeAlerts[0]?.message || (access.phase === 'WAITING_ALERT' || (access.phase === 'ALERT' && access.activeAlerts.some(a => a.type === 'DOOR_OPEN_TOO_LONG')) ? ('Cửa mở ' + access.elapsedOpenSeconds + ' giây · giới hạn ' + access.openLimit + ' giây.') : '') || (access.phase === 'GRANTED' ? access.lastAccess?.employee?.name : '') || access.notice || (accessKind === 'authorized' ? 'Nhân viên → RFID → xác thực → mở cửa → vào kho → đóng cửa' : accessKind === 'unauthorized' ? 'Cửa mở không có thẻ hợp lệ → cảnh báo → lưu nhật ký' : 'Quét thẻ → mở cửa → quá thời gian → cảnh báo → đóng cửa')) : motion === 'IDLE' ? (flow === 'inbound' ? 'Xe đến → dỡ hàng → camera đọc mã kiện → xác nhận nhập → cất lên kệ' : 'Hỗ trợ AI FEFO đề xuất chuyển kho + quét QR ESP32-CAM xác nhận xuất/nhập thật')
    : motion === 'WAITING_CONFIRMATION' ? 'ESP32-CAM: quét tem QR của kiện đang chờ nhận.'
    : motion === 'WAITING_DISPATCH_CONFIRM' ? (activeTransfer ? `ESP32-CAM: quét mã QR phiếu ${activeTransfer.code} để xuất kho thật` : 'Bấm Xác nhận xuất kho để xe rời kho')
    : motion === 'WAITING_RECEIVE_CONFIRM' ? (activeTransfer ? `ESP32-CAM: quét mã QR phiếu ${activeTransfer.code} tại kho đích` : 'Bấm Xác nhận nhận hàng tại kho đích')
    : motion === 'COMPLETE' ? (flow === 'inbound' ? 'Đã nhập kho và cất hàng. Có thể xem phiếu nhập và tồn kho.' : activeTransfer ? `Đã hoàn tất phiếu thật ${activeTransfer.code} · tồn kho đã đồng bộ` : 'Hoàn tất mô phỏng chuyển hàng; bật Thực thi phiếu thật để cập nhật tồn')
    : movingEvent?.automationMessage ?? (flow === 'inbound' ? 'Cảnh minh họa, không tự cộng tồn' : `${activeTransfer ? activeTransfer.code : 'Mô phỏng'} · ${activeTransfer?.items[0]?.sku.product.name ?? transferItem?.sku.product.name ?? 'pallet'} → ${destination?.name ?? 'kho đích'}`);
  const tone = (status?: string | null) => status === 'RECEIVED' ? 'ok' : status === 'WAITING_CONFIRMATION' || status === 'READY' ? 'wait' : status === 'BLOCKED' || status === 'UNREGISTERED' ? 'bad' : 'neutral';
  const scanStepStatus = useMemo(() => {
    if (access.phase === 'SCANNING') {
      return { text: 'Đang chờ quét thẻ RC522…', tone: 'wait' };
    }
    if (access.lastAccess) {
      const scanAgeMs = Date.now() - new Date(access.lastAccess.occurredAt).getTime();
      if (scanAgeMs < 300000) {
        const tStr = new Date(access.lastAccess.occurredAt).toLocaleTimeString('vi-VN');
        if (access.lastAccess.eventType === 'ACCESS_GRANTED') {
          const empName = access.lastAccess.employee?.name ?? 'Nhân viên đã xác thực';
          const uid = access.lastAccess.payload?.uid ? ` (${access.lastAccess.payload.uid})` : '';
          return { text: `✓ Quét thành công: ${empName}${uid} lúc ${tStr}`, tone: 'ok' };
        }
        if (access.lastAccess.eventType === 'ACCESS_DENIED') {
          const uid = access.lastAccess.payload?.uid ? ` (${access.lastAccess.payload.uid})` : '';
          return { text: `✕ Quét bị từ chối · Thẻ chưa cấp quyền${uid} lúc ${tStr}`, tone: 'bad' };
        }
      }
    }
    if (access.phase === 'WAITING_REAL') {
      return { text: 'Đưa thẻ vào RC522 để quét…', tone: 'prompt' };
    }
    return { text: 'RC522 sẵn sàng đọc thẻ', tone: 'neutral' };
  }, [access.phase, access.lastAccess]);
  return <main className="live-inbound">
    {prepareOpen && <PrepareCameraDemo orders={orders} parcels={parcels} warehouses={warehouses} warehouseId={warehouseId} onWarehouseChange={id => { setLoadedWarehouse(''); setWarehouseId(id); }} onClose={() => { setPrepareOpen(false); void refresh(warehouseId).catch(e => setError(errorMessage(e))); }} onStart={parcel => { dismissedTagIds.current.clear(); demoSession.current = { parcel, started: Date.now() }; setPrepared(parcel); void refresh(warehouseId).catch(e => setError(errorMessage(e))); setPrepareOpen(false); setScanQueue([]); setQueue([]); setRun(n => n + 1); setPaused(false); setMovingEvent(null); setZone('receiving'); setMotion('TRUCK_APPROACHING'); }} />}
    {setupOpen && (
      <div className="ui-modal" role="presentation">
        <div
          className="ui-modal-card li-setup-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="demo-setup-title"
          style={{ width: 'min(760px, calc(100vw - 32px))', padding: 0, overflow: 'hidden', borderRadius: 16 }}
        >
          <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid #e2e8f0', background: '#ffffff' }}>
            <div>
              <h2 id="demo-setup-title" style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                {accessKind ? 'Chọn kho truy cập' : 'Chuẩn bị điều chuyển giữa kho'}
              </h2>
              {!accessKind && (
                <p style={{ margin: '3px 0 0', fontSize: 13, color: '#64748b' }}>
                  Chọn kho nguồn, kho đích và mặt hàng cần điều chuyển để chạy mô phỏng hoặc thực thi phiếu thật.
                </p>
              )}
            </div>
            <button type="button" className="li-close" aria-label="Đóng" onClick={() => setSetupOpen(false)}>×</button>
          </header>
          <div
            className="li-form"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '16px 18px',
              padding: '20px 24px',
              margin: 0,
            }}
          >
            {!accessKind && (
              <div
                className="li-transfer-recs"
                style={{
                  gridColumn: '1 / -1',
                  display: 'grid',
                  gap: 10,
                  padding: '13px 16px',
                  border: '1px solid #c7d2fe',
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, #f8faff 0%, #f0fdfa 100%)',
                }}
              >
                <div className="li-transfer-recs-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 13.5, fontWeight: 700, color: '#312e81' }}>
                    Gợi ý chuyển kho lô cận hạn (AI × Nhu cầu 14 ngày)
                  </strong>
                  <small style={{ margin: 0, fontSize: 12.5, color: '#475569' }}>
                    {sortedFefoRisks.length ? `${sortedFefoRisks.length} gợi ý khả dụng — bấm để điền nhanh` : 'Hiện chưa có lô cận hạn cần chuyển gấp'}
                  </small>
                </div>
                {sortedFefoRisks.length > 0 && (
                  <div className="li-transfer-rec-list">
                    {sortedFefoRisks.slice(0, 6).map(risk => {
                      const target = risk.recommendedTransferBranch!;
                      const recQty = Math.max(1, Math.min(risk.lotQuantity, risk.atRiskQuantity, target.absorbableQuantity || risk.atRiskQuantity));
                      const isSelected = selectedFefoRisk?.lotId === risk.lotId && !selectedExistingTransferId;
                      return (
                        <button
                          key={risk.lotId}
                          type="button"
                          className={`li-transfer-rec-item${isSelected ? ' selected' : ''}`}
                          onClick={() => {
                            setSelectedExistingTransferId('');
                            setSelectedFefoRisk(risk);
                            if (risk.warehouseId !== warehouseId) setLoadedWarehouse('');
                            setWarehouseId(risk.warehouseId);
                            setDestId(target.warehouseId);
                            setTransferSkuId(risk.skuId);
                            setTransferQty(recQty);
                            setUseRealTransfer(true);
                          }}
                        >
                          <div className="li-transfer-rec-info">
                            <ProductImage src={risk.imageUrl} name={risk.productName} size="sm" />
                            <div className="li-transfer-rec-copy">
                              <strong>{risk.productName} · Lô {risk.lotCode}</strong>
                              <span>{risk.warehouseName} → {target.warehouseName} · Đề xuất {recQty} {risk.unit} ({target.storeName} tiêu thụ {target.dailyDemandRate.toFixed(1)}/ngày)</span>
                            </div>
                          </div>
                          <span className="li-transfer-rec-pill">Còn {risk.daysRemaining} ngày</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {!accessKind && realTransfers.length > 0 && (
              <label
                className="li-setup-field-full"
                style={{ gridColumn: '1 / -1', display: 'grid', gap: 7, margin: 0, fontSize: 13.5, fontWeight: 600, color: '#1e293b' }}
              >
                <span>Chọn phiếu điều chuyển có sẵn ({realTransfers.length} phiếu)</span>
                <select
                  value={selectedExistingTransferId}
                  onChange={e => setSelectedExistingTransferId(e.target.value)}
                  style={{ height: 44, minHeight: 44, padding: '0 14px', fontSize: 14, fontWeight: 500, borderRadius: 9, border: '1px solid #cbd5e1', width: '100%' }}
                >
                  <option value="">+ Tạo phiếu mới / Chạy theo cấu hình bên dưới</option>
                  {realTransfers.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.code} · {t.sourceWarehouse.name} → {t.destinationWarehouse.name} ({t.items[0]?.sku.product.name ?? 'Hàng'} · SL {t.totalRequested} · {t.status === 'IN_TRANSIT' ? 'Đang vận chuyển' : 'Chờ xuất'})
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!selectedExistingTransfer && (
              <>
                <label style={{ display: 'grid', gap: 7, margin: 0, fontSize: 13.5, fontWeight: 600, color: '#1e293b' }}>
                  <span>{accessKind ? 'Chi nhánh · kho' : 'Chi nhánh · kho nguồn'}</span>
                  <select
                    value={warehouseId}
                    onChange={e => { setLoadedWarehouse(''); setWarehouseId(e.target.value); setTransferSkuId(''); setSelectedFefoRisk(null); }}
                    style={{ height: 44, minHeight: 44, padding: '0 14px', fontSize: 14, fontWeight: 500, borderRadius: 9, border: '1px solid #cbd5e1', width: '100%' }}
                  >
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.store.name} · {w.name}</option>)}
                  </select>
                </label>
                {!accessKind && (
                  <>
                    <label style={{ display: 'grid', gap: 7, margin: 0, fontSize: 13.5, fontWeight: 600, color: '#1e293b' }}>
                      <span>Chi nhánh · kho đích</span>
                      <select
                        value={destId}
                        onChange={e => { setDestId(e.target.value); setSelectedFefoRisk(null); }}
                        style={{ height: 44, minHeight: 44, padding: '0 14px', fontSize: 14, fontWeight: 500, borderRadius: 9, border: '1px solid #cbd5e1', width: '100%' }}
                      >
                        {!destinations.length && <option value="">Cần ít nhất 2 kho</option>}
                        {destinations.map(w => <option key={w.id} value={w.id}>{w.store.name} · {w.name}</option>)}
                      </select>
                    </label>
                    <label style={{ display: 'grid', gap: 7, margin: 0, fontSize: 13.5, fontWeight: 600, color: '#1e293b' }}>
                      <span>Sản phẩm điều chuyển</span>
                      <select
                        value={transferItem?.skuId ?? ''}
                        disabled={loadedWarehouse !== warehouseId || !stocked.length}
                        onChange={e => { setTransferSkuId(e.target.value); setSelectedFefoRisk(null); }}
                        style={{ height: 44, minHeight: 44, padding: '0 14px', fontSize: 14, fontWeight: 500, borderRadius: 9, border: '1px solid #cbd5e1', width: '100%' }}
                      >
                        {loadedWarehouse !== warehouseId ? <option value="">Đang tải hàng...</option> : !stocked.length ? <option value="">Kho nguồn chưa có tồn</option> : stocked.map(i => <option key={i.skuId} value={i.skuId}>{i.sku.product.name} · tồn {i.onHand} {i.sku.product.unit}</option>)}
                      </select>
                    </label>
                    <label style={{ display: 'grid', gap: 7, margin: 0, fontSize: 13.5, fontWeight: 600, color: '#1e293b' }}>
                      <span>Số lượng chuyển ({transferItem?.sku.product.unit ?? 'đơn vị'})</span>
                      <input
                        type="number"
                        min={1}
                        max={transferItem?.onHand ?? 1}
                        value={transferQty}
                        onChange={e => setTransferQty(Math.max(1, Number(e.target.value) || 1))}
                        disabled={!transferItem}
                        style={{ height: 44, minHeight: 44, padding: '0 14px', fontSize: 14.5, fontWeight: 600, borderRadius: 9, border: '1px solid #cbd5e1', width: '100%' }}
                      />
                    </label>
                    <label
                      className="live-checkbox li-setup-field-full"
                      style={{
                        gridColumn: '1 / -1',
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'flex-start',
                        gap: 10,
                        padding: '11px 14px',
                        margin: '2px 0 0',
                        height: 'auto',
                        minHeight: 44,
                        borderRadius: 10,
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        fontSize: 13.5,
                        fontWeight: 600,
                        color: '#0f172a',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={useRealTransfer}
                        onChange={e => setUseRealTransfer(e.target.checked)}
                        style={{ width: 18, height: 18, margin: 0, flexShrink: 0, accentColor: '#0f766e' }}
                      />
                      <span>Tạo phiếu điều chuyển thật & Quét QR qua ESP32-CAM (trừ / cộng tồn kho thực tế)</span>
                    </label>
                  </>
                )}
              </>
            )}
            {transferError && <p role="alert" className="live-error li-setup-field-full" style={{ gridColumn: '1 / -1', margin: 0 }}>{transferError}</p>}
          </div>
          <footer style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, padding: '14px 24px', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
            <button type="button" className="li-ghost" onClick={() => setSetupOpen(false)} style={{ height: 40, padding: '0 16px', borderRadius: 9 }}>
              Đóng
            </button>
            <button
              type="button"
              disabled={transferBusy || (accessKind ? loadedWarehouse !== warehouseId || !access.device || !access.door : (!selectedExistingTransfer && (loadedWarehouse !== warehouseId || !destination || !transferItem)))}
              onClick={() => { if (accessKind) { setSetupOpen(false); void access.start(accessKind); return; } void startTransferDemo(); }}
              style={{ height: 40, padding: '0 18px', borderRadius: 9, fontWeight: 600 }}
            >
              {transferBusy ? 'Đang tạo phiếu…' : 'Bắt đầu chuyển hàng'}
            </button>
          </footer>
        </div>
      </div>
    )}
    {prepared && <section className="li-card" style={{ padding: 16 }}><strong>Kiện đang demo: {prepared.product?.name}</strong><p>{prepared.quantity} {prepared.product?.unit} · {prepared.purchaseOrderCode} · {prepared.deviceId}</p><small>Đưa phiếu QR trước camera khi đến bước Camera quét kiện.</small></section>}
    {scan && createPortal(<div className="rfid-dialog-backdrop"><div className={`rfid-dialog${scan.processed ? ' is-processed' : ''}`} role="dialog" aria-modal="true" aria-labelledby="rfid-dialog-title" ref={dialogRef} tabIndex={-1}>
      {scan.processed ? <>
        <div className="rfid-success-hero">
          <span className="rfid-success-icon" aria-hidden="true">✓</span>
          <div className="rfid-success-hero-copy">
            <span className="rfid-live-badge">NHẬP KHO THÀNH CÔNG</span>
            <h2 id="rfid-dialog-title">Kiện hàng đã được nhập kho</h2>
            <p role="status" className="rfid-success-sub">Đã lưu phiếu nhập kho và cộng tồn thực tế tại {warehouse?.name}. Chọn mục bên dưới để xem chi tiết ngay:</p>
          </div>
        </div>
        <div className="rfid-success-metrics">
          <div className="rfid-metric-card is-plus">
            <small>SỐ LƯỢNG VỪA CỘNG THÊM</small>
            <b className="plus">+{scannedParcel?.quantity ?? 0} {scan.mappedSku?.product.unit ?? scannedParcel?.product?.unit ?? ''}</b>
          </div>
          <div className="rfid-metric-card">
            <small>TỒN HIỆN TẠI TẠI {(warehouse?.name ?? 'KHO').toUpperCase()}</small>
            <b>{stockAtScan ? `${stockAtScan.onHand} ${scan.mappedSku?.product.unit ?? ''}` : 'Đã cập nhật'}</b>
          </div>
        </div>
        <div className="rfid-clickable-list">
          <Link href="/san-pham" className="rfid-clickable-card" onClick={dismissScan}>
            <div className="rfid-clickable-main">
              <ProductImage src={scanProductImage} name={scanProductName} size="md" />
              <div className="rfid-clickable-copy">
                <small>SẢN PHẨM VỪA NHẬP KHO</small>
                <strong>{scanProductName}</strong>
                <span>Mã kiện: {scan.tagId} · Đã cập nhật đủ tồn an toàn</span>
              </div>
            </div>
            <span className="rfid-clickable-cta">Xem sản phẩm →</span>
          </Link>

          <Link href="/nhap-hang" className="rfid-clickable-card" onClick={dismissScan}>
            <div className="rfid-clickable-main">
              <div className="rfid-clickable-copy">
                <small>CHỨNG TỪ & ĐƠN MUA HÀNG</small>
                <strong>Đơn mua: {scannedParcel?.purchaseOrderCode ?? orders.find(p => p.id === scannedParcel?.purchaseOrderId)?.code ?? '—'}</strong>
                <span>Kho nhận: {warehouse?.name} · Thiết bị quét: {scan.deviceId}</span>
              </div>
            </div>
            <span className="rfid-clickable-cta">Xem phiếu nhập →</span>
          </Link>

          <Link href={stockAtScan ? `/ton-kho/${stockAtScan.id}` : '/ton-kho'} className="rfid-clickable-card" onClick={dismissScan}>
            <div className="rfid-clickable-main">
              <div className="rfid-clickable-copy">
                <small>TỒN KHO & LỊCH SỬ THẺ KHO</small>
                <strong>Tồn thực tế: {stockAtScan ? `${stockAtScan.onHand} ${scan.mappedSku?.product.unit ?? ''}` : 'Đã cập nhật'}</strong>
                <span>Cộng thêm +{scannedParcel?.quantity ?? 0} {scan.mappedSku?.product.unit ?? scannedParcel?.product?.unit ?? ''} vào lô hàng tại {warehouse?.name}</span>
              </div>
            </div>
            <span className="rfid-clickable-cta">Xem tồn kho & lịch sử →</span>
          </Link>
        </div>
        <footer>
          <button className="rfid-confirm" onClick={dismissScan}>Hoàn tất & Đóng</button>
        </footer>
      </> : <>
        <span className="rfid-live-badge">{scan.eventType === 'CAMERA_CODE_DETECTED' ? 'CAMERA · QUÉT MÃ KIỆN' : 'RFID · LIVE IOT'}</span><h2 id="rfid-dialog-title">{scan.eventType === 'CAMERA_CODE_DETECTED' ? 'Đã đọc mã kiện bằng camera' : 'Đã quét thẻ RFID'}</h2>
        <div className="rfid-product-hero">
          <ProductImage src={scanProductImage} name={scanProductName} size="md" />
          <div className="rfid-product-hero-copy">
            <h3>{scanProductName}</h3>
            {scannedParcel && (
              <span>
                Kiện đăng ký: <b>{scannedParcel.quantity} {scan.mappedSku?.product.unit ?? scannedParcel.product?.unit ?? ''}</b>
                {stockAtScan ? ` · Tồn sau nhận dự kiến: ${stockAtScan.onHand + scannedParcel.quantity} ${scan.mappedSku?.product.unit ?? ''}` : ''}
              </span>
            )}
          </div>
        </div>
        <dl className="rfid-dl-grid">
          <div><dt>{scan.eventType === 'CAMERA_CODE_DETECTED' ? 'Mã kiện' : 'UID thẻ RFID'}</dt><dd>{scan.tagId}</dd></div>
          <div><dt>Số lượng đăng ký</dt><dd>{scannedParcel ? `${scannedParcel.quantity} ${scan.mappedSku?.product.unit ?? ''}` : 'Chưa có thông tin kiện'}</dd></div>
          <div><dt>Đơn mua hàng</dt><dd>{scannedParcel?.purchaseOrderCode ?? orders.find(p => p.id === scannedParcel?.purchaseOrderId)?.code ?? scannedParcel?.purchaseOrderId ?? '—'}</dd></div>
          <div><dt>Hạn sử dụng</dt><dd>{scannedParcel?.expiresAt?.slice(0, 10) ?? (scannedParcel?.noExpiry ? 'Không hạn sử dụng' : 'Chưa xác nhận')}</dd></div>
          <div><dt>Kho nhận</dt><dd>{warehouse?.name}</dd></div>
          <div><dt>Thời gian & Thiết bị</dt><dd>{new Date(scan.timestamp).toLocaleTimeString('vi-VN')} · {scan.deviceId}</dd></div>
        </dl>
        {scan.warehouseId !== warehouseId && <p role="alert" className="live-error">Camera đã đọc đúng QR nhưng gửi từ {warehouses.find(w => w.id === scan.warehouseId)?.name ?? 'kho khác'}, trong khi kiện nhận tại {warehouse?.name}. Hãy dùng firmware mới và bắt đầu lại demo để camera nhận đúng kho của phiên này. Tồn kho chưa thay đổi.</p>}
        {scan.automationStatus === 'UNREGISTERED' && canReceive && (section === 'scene' ? <Link href="/kho/mo-hinh-3d/camera">Đăng ký kiện và tạo tem QR</Link> : <button onClick={() => captureTag(scan)}>Dùng UID này để đăng ký kiện</button>)}
        {scannedParcel && !scannedParcel.expiresAt && !scannedParcel.noExpiry && <div className="li-form"><label>Hạn sử dụng thực tế<input type="date" value={receiptExpiry} disabled={receiptNoExpiry} onChange={e => setReceiptExpiry(e.target.value)}/></label><label><input type="checkbox" checked={receiptNoExpiry} onChange={e => { setReceiptNoExpiry(e.target.checked); if (e.target.checked) setReceiptExpiry(''); }}/> Sản phẩm không có hạn sử dụng</label></div>}
        {!canReceive && <p>Bạn không có quyền xác nhận nhập hàng.</p>}
        {confirmError && <p role="alert" className="live-error">{confirmError}</p>}
        <footer><button disabled={confirming} onClick={dismissScan}>Để sau</button>
        <button className="rfid-confirm" disabled={confirming || !canReceive || scan.automationStatus !== 'WAITING_CONFIRMATION' || scannedParcel?.status !== 'READY'} onClick={() => void confirmScan()}>{confirming ? 'Đang nhập kho…' : 'Xác nhận nhập kho'}</button></footer>
      </>}
      {scanQueue.length > 1 && <small>Còn {scanQueue.length - 1} kiện chờ xem.</small>}
    </div></div>, document.body)}
    <header className="li-head">
      <div>
        <p className="li-eyebrow">{section === 'scene' ? 'Kho · Mô hình 3D' : 'Kho · RFID'}</p>
        <h1>{section === 'scene' ? 'Mô hình kho 3D · Vận hành & An ninh' : 'Quản lý nhận hàng RFID'}</h1>
        <div className="li-chips">
          <span className={`li-chip ${connected ? 'ok' : 'bad'}`}><i />{connected ? 'Web đã kết nối Backend' : 'Mất kết nối realtime'}</span>
          <span className="li-chip neutral">{latest ? `Lượt quét gần nhất ${new Date(latest.receivedAt).toLocaleTimeString('vi-VN')} · ${latest.deviceId}` : 'Chưa có lượt quét tại kho này'}</span>
        </div>
      </div>
      <div className="li-head-actions">
        {section !== 'scene' && <label className="li-select">Kho nhận<select disabled={running} value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>{warehouses.map(w => <option key={w.id} value={w.id}>{w.store.name} · {w.name}</option>)}</select></label>}
        <div className="li-head-nav">
          {section !== 'scene' && <Link className="outline-button li-top-btn" href="/kho/mo-hinh-3d">Mô hình kho 3D</Link>}
          {section === 'scene' && <Link className="outline-button li-top-btn" href="/dieu-chuyen">Phiếu điều chuyển</Link>}
          {section === 'scene' && (
            <button type="button" className="outline-button li-top-btn" onClick={() => setStaffModalOpen(true)}>
              Gán thẻ nhân viên (RFID)
            </button>
          )}
        </div>
      </div>
    </header>
    {error && <p role="alert" className="live-error">{error}</p>}
    {notice && <p role="status" className="li-notice">{notice}</p>}
    {section === 'scene' && !accessKind && flow === 'inbound' && motion === 'WAITING_CONFIRMATION' && <EspStation connected={connected} latest={events.find(isEspEvent)} waiting={motion === 'WAITING_CONFIRMATION'}/>}
    {section === 'scene' && flow === 'inbound' && motion === 'WAITING_CONFIRMATION' && prepared && !scan && createPortal(<div className="li-qr-backdrop"><section className="li-qr-modal" role="dialog" aria-modal="true" aria-labelledby="li-qr-title"><div className="li-qr-header"><span className="li-qr-badge">BƯỚC 3 · ESP32-CAM</span><h2 id="li-qr-title">Quét mã kiện hàng</h2><p>Đưa mã QR trước camera và nhìn hình bên cạnh để canh.</p></div><div className="li-qr-columns"><div className="li-qr-content"><div className="li-qr-code"><QRCodeSVG value={prepared.tagId} size={260} marginSize={4} level="M"/></div><strong>{prepared.product?.name}</strong><p>{prepared.quantity} {prepared.product?.unit} · {prepared.purchaseOrderCode}</p><code>{prepared.tagId}</code><p className="li-qr-wait"><span/> Đang chờ camera đọc mã…</p></div><CameraPreview compact/></div><div className="li-qr-actions" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 18, paddingTop: 16, borderTop: '1px solid #e2e8f0' }}><button type="button" className="li-qr-cancel-btn" onClick={resetDemo} style={{ minWidth: 140, height: 42, padding: '0 20px', borderRadius: 9, border: '1px solid #dc2626', background: '#dc2626', color: '#ffffff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>Hủy demo</button></div></section></div>, document.body)}
    {section === 'scene' && flow === 'transfer' && activeTransfer && (motion === 'WAITING_DISPATCH_CONFIRM' || motion === 'WAITING_RECEIVE_CONFIRM') && createPortal(<div className="li-qr-backdrop"><section className="li-qr-modal" role="dialog" aria-modal="true" aria-labelledby="li-transfer-qr-title"><div className="li-qr-header"><span className="li-qr-badge">{motion === 'WAITING_DISPATCH_CONFIRM' ? 'XUẤT KHO · QUÉT QR ESP32-CAM' : 'NHẬN KHO ĐÍCH · QUÉT QR ESP32-CAM'}</span><h2 id="li-transfer-qr-title">{motion === 'WAITING_DISPATCH_CONFIRM' ? 'Quét QR xác nhận xuất kho thật' : 'Quét QR xác nhận nhận hàng tại kho đích'}</h2><p>Đưa mã QR phiếu {activeTransfer.code} (hoặc mã vạch SKU) trước ESP32-CAM để cập nhật tồn kho thực tế.</p></div><div className="li-qr-columns"><div className="li-qr-content"><div className="li-qr-code"><QRCodeSVG value={activeTransfer.code} size={260} marginSize={4} level="M"/></div><strong>{activeTransfer.items[0]?.sku.product.name ?? 'Lô hàng điều chuyển'}</strong><p>{activeTransfer.sourceWarehouse.name} → {activeTransfer.destinationWarehouse.name} · SL {activeTransfer.totalRequested}</p><code>{activeTransfer.code}</code><p className="li-qr-wait"><span/> {transferBusy ? 'Đang cập nhật tồn kho…' : 'Đang chờ ESP32-CAM đọc mã phiếu…'}</p>{transferError && <p role="alert" className="live-error">{transferError}</p>}</div><CameraPreview compact onFrameBytes={bytes => { transferFrameRef.current = { bytes, at: Date.now() }; }}/></div><div className="li-qr-actions" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 18, paddingTop: 16, borderTop: '1px solid #e2e8f0' }}><button type="button" className="li-qr-cancel-btn" onClick={resetDemo} disabled={transferBusy} style={{ minWidth: 130, height: 42, padding: '0 22px', borderRadius: 9, border: '1px solid #dc2626', background: '#dc2626', color: '#ffffff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 6px rgba(220, 38, 38, 0.22)' }}>Hủy</button><button type="button" className="li-qr-confirm-btn" disabled={transferBusy} onClick={() => void confirmTransferStep('manual')} style={{ minWidth: 220, height: 42, padding: '0 24px', borderRadius: 9, border: '1px solid #0f766e', background: '#0f766e', color: '#ffffff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 6px rgba(15, 118, 110, 0.22)' }}>{transferBusy ? 'Đang xác nhận…' : motion === 'WAITING_DISPATCH_CONFIRM' ? 'Xác nhận xuất kho thủ công' : 'Xác nhận nhận hàng thủ công'}</button></div></section></div>, document.body)}
    {section === 'scene' && <><section className="li-card li-flow">
      <div className="li-flow-select"><label>Luồng demo<select aria-label="Luồng demo" value={accessKind ? 'access' : flow} disabled={running} onChange={e => { const value = e.target.value; if (value === 'inbound' || value === 'transfer') chooseFlow(value); else chooseAccess('authorized'); }}><option value="inbound">Nhập hàng từ nhà cung cấp</option><option value="transfer">Chuyển hàng giữa kho</option><option value="access">Truy cập cửa kho</option></select></label>{accessKind && <label>Tình huống<select aria-label="Tình huống" value={accessKind} disabled={running || access.monitor.mode === 'REAL_IOT'} onChange={e => chooseAccess(e.target.value as AccessKind)}><option value="authorized">Bình thường</option><option value="unauthorized">Mở cửa trái phép</option><option value="open-too-long">Cửa mở quá lâu</option></select></label>}<small>{accessKind ? 'RFID nhận diện nhân viên · Reed Switch theo dõi cửa · backend kiểm tra quyền và lưu log' : flow === 'inbound' ? 'ESP32-CAM quét QR kiện hàng; xác nhận mới cập nhật tồn kho.' : 'Gợi ý điều chuyển cận hạn + Quét QR ESP32-CAM cập nhật phiếu chuyển thật.'}</small>{accessKind && <span className={`li-access-badge ${access.monitor.mode === 'REAL_IOT' ? 'real' : ''}`}>{access.monitor.mode === 'REAL_IOT' ? '● REAL IOT' : '◇ SIMULATION'}</span>}</div>
    </section>
    <section className="li-card li-scene-card">
        <div className="li-timeline" aria-label={`Tiến trình ${accessKind ? ACCESS_NAMES[accessKind] : flow === 'inbound' ? 'nhập hàng' : 'điều chuyển'}, ${timeline.length} bước`}>
          <div className="li-timeline-heading"><div><h2>Tiến trình · {accessKind ? ACCESS_NAMES[accessKind] : flow === 'inbound' ? 'Nhập hàng' : 'Chuyển hàng'}</h2><small>{(accessKind ? access.phase : motion) === 'IDLE' ? `${timeline.length} bước · sẵn sàng bắt đầu` : (accessKind ? access.phase : motion) === 'COMPLETE' ? `Hoàn tất ${timeline.length}/${timeline.length} bước` : `Bước ${Math.min(shownStep + 1, timeline.length)}/${timeline.length} · ${timeline[Math.max(activeStep, 0)]?.title ?? 'Đang chuẩn bị'}`}</small></div></div>
          <ol className={`li-timeline-list ${accessKind ? 'access' : ''}`}>
            {timeline.map((step, index) => {
              const isDone = index < activeStep || (accessKind ? access.phase : motion) === 'COMPLETE';
              const isCurrent = index === activeStep;
              const isScanStep = accessKind && index === 1;
              return <li key={step.title} className={isDone ? 'done' : isCurrent ? 'current' : ''} aria-current={isCurrent && (accessKind ? access.phase : motion) !== 'IDLE' ? 'step' : undefined}>
                <span className="li-timeline-number">{isDone ? '✓' : index + 1}</span>
                <span className="li-timeline-copy">
                  <strong>{step.title}</strong>
                  {isScanStep ? (
                    <small className={`li-scan-indicator tone-${scanStepStatus.tone}`}>{scanStepStatus.text}</small>
                  ) : (
                    <small>{step.detail}</small>
                  )}
                </span>
              </li>;
            })}
          </ol>
        </div>
        <div className="live-scene">
          {warehouse && <WarehouseTwinScene key={`${flow}-${warehouseId}-${flow === 'transfer' ? destId : ''}`} demoRunId={run} onMotionComplete={onMotionComplete} warehouseName={warehouse.name}
            accessDoorState={access.door?.state ?? 'UNKNOWN'} accessAlert={access.activeAlerts.length > 0}
            accessFocus={!!accessKind || doorInspector} accessEmployeePhase={accessKind || doorInspector ? access.phase : 'IDLE'} accessEmployeeName={access.lastAccess?.employee?.name ?? access.monitor.cards[0]?.employee.name} onAccessMotionComplete={access.motionComplete} onSelectDoor={() => setDoorInspector(true)}
            destinationWarehouseId={flow === 'transfer' ? destId : ''}
            campusWarehouses={[warehouse, ...warehouses.filter(w => w.id !== warehouse.id)
              .sort((a, b) => Number(b.id === destId && flow === 'transfer') - Number(a.id === destId && flow === 'transfer')).slice(0, 2)]
              .map(w => ({ id: w.id, name: w.name, code: w.code, storeName: w.store.name,
                items: w.id === warehouse.id ? stocked : flow === 'transfer' && w.id === destId ? destItems.filter(i => i.onHand > 0) : campusStock[w.id] ?? [] }))}
            transferMode={flow === 'transfer'} items={stocked.slice(0, 9)} selectedItem={selected} onSelectItem={setSelected} selectedZone={zone} onSelectZone={setZone} demoState={motion} demoPaused={paused}
            demoProduct={flow === 'transfer' ? ((activeTransfer?.items[0]?.sku.product ? { ...activeTransfer.items[0].sku.product, code: activeTransfer.code } : null) ?? (transferItem ? { ...transferItem.sku.product, code: transferItem.sku.code } : null)) : (prepared?.product ? { ...prepared.product, code: prepared.tagId } : null) ?? movingStock?.sku.product ?? (movingEvent?.mappedSku ? { ...movingEvent.mappedSku.product, code: movingEvent.mappedSku.code } : null)}
            demoInventory={flow === 'transfer' ? transferItem : movingStock} speedMultiplier={speedMultiplier}/>}
          <div className="live-scene-status" aria-live="polite">
            <span className={`li-dot ${running ? 'on' : ''}`} /><div><span className={`li-flow-tag ${accessKind ? access.phase === 'ALERT' ? 'alert' : 'access' : flow}`}>{accessKind ? `IOT · ${ACCESS_NAMES[accessKind].toUpperCase()}` : flow === 'inbound' ? 'LUỒNG 1 · NHẬP HÀNG' : 'LUỒNG CHUYỂN HÀNG'}</span><strong>{motionLabel}</strong><small>{motionHint}{!accessKind && queue.length > 0 && ` · ${queue.length} kiện chờ hiển thị`}</small></div>
          </div>
          <div className="live-demo-controls">
            {!accessKind && motion === 'WAITING_DISPATCH_CONFIRM' && <button disabled={transferBusy} onClick={() => { if (activeTransfer) void confirmTransferStep('manual'); else setMotion('DISPATCHED'); }}>{transferBusy ? 'Đang xử lý…' : 'Xác nhận xuất kho'}</button>}
            {!accessKind && motion === 'WAITING_RECEIVE_CONFIRM' && <button disabled={transferBusy} onClick={() => { if (activeTransfer) void confirmTransferStep('manual'); else setMotion('RECEIVED'); }}>{transferBusy ? 'Đang xử lý…' : 'Xác nhận nhận hàng'}</button>}
            {accessKind && access.door?.state === 'OPEN' && access.monitor.mode === 'SIMULATION' && <button className="li-ghost" disabled={access.busy} onClick={() => void access.close()}>Đóng cửa kết thúc</button>}
            {!running && <button disabled={!warehouseId || (accessKind ? !access.canSimulate : flow === 'inbound' && (!canReceive || queue.length > 0))} onClick={startDemo}>▶ {(accessKind ? access.phase : motion) === 'COMPLETE' ? 'Chạy lại' : 'Chạy demo'}</button>}
            {running && (accessKind ? <button className="li-ghost" onClick={resetDemo}>Dừng theo dõi</button> : <><button className="li-ghost" onClick={() => setPaused(v => !v)}>{paused ? 'Tiếp tục' : 'Tạm dừng'}</button><button className="li-ghost" onClick={resetDemo}>Đặt lại</button></>)}
            <div className="li-speed-pills" aria-label="Tốc độ demo">
              <span className="li-speed-label">Tốc độ</span>
              {([1, 1.5, 2] as const).map(s => (
                <button key={s} className={`li-speed-btn${speedMultiplier === s ? ' active' : ''}`} onClick={() => setSpeedMultiplier(s)} aria-pressed={speedMultiplier === s}>{s}×</button>
              ))}
            </div>
          </div>
          {doorInspector && <aside className="wde-door-inspector"><header><strong>{access.door?.name ?? 'Cửa kho chính'}</strong><button type="button" className="li-ghost" onClick={() => setDoorInspector(false)} aria-label="Đóng chi tiết cửa">×</button></header><dl><dt>Kho</dt><dd>{warehouse?.name ?? '—'}</dd><dt>Door ID</dt><dd>{access.door?.code ?? '—'}</dd><dt>Reed Switch</dt><dd>{access.door?.state ?? 'UNKNOWN'}</dd><dt>Trạng thái</dt><dd>{access.activeAlerts.length ? 'WARNING' : access.door?.state ?? 'Chưa đăng ký'}</dd><dt>ESP32</dt><dd>{access.device?.online ? 'ONLINE' : 'OFFLINE'}</dd><dt>Thẻ gần nhất</dt><dd>{access.lastAccess?.employee?.name ?? '—'}</dd><dt>Sự kiện gần nhất</dt><dd>{access.monitor.events[0]?.eventType ?? '—'}</dd></dl></aside>}
          {selected && <div className="li-selected"><ProductImage src={selected.sku.product.imageUrl} name={selected.sku.product.name} size="sm"/><div><strong>{selected.sku.product.name}</strong><small>Tồn tại kho: {selected.onHand} {selected.sku.product.unit}. Kệ chỉ minh họa, chưa có dữ liệu vị trí thực.</small></div><button type="button" className="li-close" aria-label="Bỏ chọn" onClick={() => setSelected(null)}>×</button></div>}
          <div className="li-legend"><span><i className="rx" />Cổng nhận</span><span><i className="tx" />Cổng xuất</span><span>Kệ minh họa · tồn theo kho/SKU từ backend</span><span>Kéo để xoay · cuộn để zoom · bấm thùng để xem</span></div>
        </div>
  {section === 'scene' && <WarehouseDoorPanel access={access} warehouseId={warehouseId} warehouseName={warehouse?.name ?? ''} active={!!accessKind}/>}
            <WarehouseCardStaffModal
          isOpen={staffModalOpen}
          onClose={() => setStaffModalOpen(false)}
          access={access}
          warehouseId={warehouseId}
          warehouseName={warehouse?.name ?? 'Kho chưa chọn'}
        />
        <WarehouseAccessCompleteModal
          isOpen={accessKind !== null && access.phase === 'COMPLETE'}
          onClose={access.stop}
          onRestart={() => void access.start('authorized')}
          onOpenStaffModal={() => setStaffModalOpen(true)}
          onOpenDeviceDrawer={() => setDoorInspector(true)}
          access={access}
          warehouseName={warehouse?.name ?? 'Kho Ba Đình'}
        />
    </section></>}
    {section === 'rfid' && <>
    {canReceive && <section className="li-card" ref={registrationRef}>
      <div className="li-card-head"><div><h2>Đăng ký kiện nhận hàng</h2><small>Chọn sản phẩm trong đơn mua hàng, nhập lượng nhận và quét UID thẻ. Mã kiện và mã lô nội bộ được tự tạo từ UID; đăng ký chưa làm tăng tồn.</small></div>
        <div className="li-row">{latest && <button type="button" className="li-ghost" onClick={() => captureTag(latest)}>Dùng UID vừa quét: {latest.tagId}</button>}<button type="button" onClick={() => { readingTagRef.current = !readingTag; setReadingTag(!readingTag); }}>{readingTag ? 'Hủy chờ đọc thẻ' : 'Đọc UID từ đầu đọc'}</button></div></div>
      {readingTag && <p role="status" className="li-notice">Đưa thẻ sát RC522. Lượt quét mới sẽ tự điền UID và thiết bị; chưa nhập kho.</p>}
      <p className="li-muted">Đơn mua hàng là chứng từ ghi sản phẩm, số lượng, nhà cung cấp và kho sẽ nhận. Nhập số lượng theo đơn vị tồn trong đơn; mỗi thẻ gắn với một kiện hàng.</p>
      <div className="li-card li-supplier-import"><div><strong>Nhập danh sách kiện từ nhà cung cấp</strong><small>Tải mẫu theo các đơn mua hàng đang mở. UID có thể để trống; kho quét thẻ rồi gắn vào kiện tương ứng.</small></div><div className="li-row"><button type="button" className="li-ghost" disabled={importBusy} onClick={() => void downloadSupplierTemplate()}>Tải mẫu Excel</button><label className="li-file-button">{importBusy ? 'Đang đọc file…' : 'Chọn file Excel'}<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={importBusy} onChange={event => { const file = event.target.files?.[0]; if (file) void parseSupplierFile(file); event.currentTarget.value = ''; }}/></label></div></div>
      {supplierRows.length > 0 && <div className="li-import-preview"><div className="li-card-head"><h3>Kiện từ file nhà cung cấp</h3><small>{supplierRows.length} dòng</small></div><div className="table-scroll"><table className="li-table"><thead><tr><th>Đơn mua / sản phẩm</th><th>Số lượng / lô</th><th>UID RFID</th><th>Trạng thái / thao tác</th></tr></thead><tbody>{supplierRows.map(row => <tr key={row.key}><td><strong>{row.poCode}</strong><small>{row.productName} · {row.skuCode}</small></td><td>{row.quantity}<small>{row.lotCode || 'Lô tự tạo khi gắn UID'} · {row.expiresAt || (row.noExpiry ? 'Không hạn sử dụng' : 'Chưa có hạn dùng')}</small></td><td><code>{row.tagId || 'Chưa gắn UID'}</code></td><td>{row.status === 'REGISTERED' ? <span className="li-badge ok">{row.message}</span> : row.status === 'ERROR' ? <span className="li-badge bad">{row.message}</span> : <div className="li-row"><span className="li-badge wait">{row.message}</span><button type="button" className="li-ghost" disabled={!tagId || busy} onClick={() => void bindImportedUid(row)}>{tagId ? `Gắn UID ${tagId}` : 'Quét thẻ để gắn UID'}</button></div>}</td></tr>)}</tbody></table></div></div>}
      <form onSubmit={register} className="live-parcel-form">
        <div><label>Tìm tên sản phẩm<input type="search" value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="Gõ tên, ví dụ: Coca, sữa TH…"/></label><label>Sản phẩm trong đơn mua hàng<select required value={lineId} onChange={e => setLineId(e.target.value)}><option value="">{lines.length ? 'Chọn sản phẩm cần nhập' : 'Kho này chưa có đơn mua hàng chờ nhận'}</option>{filteredLines.map(({po, line}) => <option key={line.id} value={line.id}>{line.sku.product.name} · {po.code} · còn {line.remainingQuantity} {line.sku.product.unit}</option>)}</select></label>{productSearch && !filteredLines.length && lines.length > 0 && <small>Không tìm thấy tên này trong đơn mua hàng của kho đang chọn.</small>}</div>
        {selectedLine && <div className="iot-product-preview"><ProductImage src={selectedLine.line.sku.product.imageUrl} name={selectedLine.line.sku.product.name} size="md"/><strong>{selectedLine.line.sku.product.name}</strong><small>Ảnh từ danh mục sản phẩm. <Link href="/san-pham">Quản lý ảnh sản phẩm</Link></small></div>}
        <label>UID thẻ<input name="tagId" required maxLength={30} value={tagId} onChange={e => setTagId(e.target.value)} placeholder="Bấm Đọc UID rồi quét thẻ"/></label>
        <label>Thiết bị được phép nhận<input name="deviceId" required maxLength={100} value={deviceId} onChange={e => setDeviceId(e.target.value)}/></label>
        <label>Số lượng ({selectedLine?.line.sku.product.unit ?? 'đơn vị tồn'})<input name="quantity" type="number" min="1" max={remaining || 0} step="1" required/><small>Còn có thể đăng ký: {remaining}</small></label>
        <label>Hạn sử dụng<input name="expiresAt" type="date" required={!noExpiry} disabled={noExpiry}/></label>
        <label className="live-checkbox"><input type="checkbox" checked={noExpiry} onChange={e => setNoExpiry(e.target.checked)}/>Sản phẩm này không có hạn sử dụng</label>
        <div className="li-parcel-photo-field"><span>Ảnh kiện hàng <small>Không bắt buộc · tối đa 20 MB</small></span><div className={`li-parcel-photo-frame ${parcelPhoto ? 'has-image' : ''}`}>{parcelPhoto ? <><img src={parcelPhoto} alt="Xem trước ảnh kiện hàng"/><div className="li-parcel-photo-actions"><button type="button" className="li-ghost" onClick={() => document.getElementById('li-parcel-photo-input')?.click()}>Đổi ảnh</button><button type="button" className="li-ghost" onClick={() => { setParcelPhoto(''); const input = document.getElementById('li-parcel-photo-input') as HTMLInputElement | null; if (input) input.value = ''; }}>Xóa ảnh</button></div></> : <><span className="li-photo-placeholder" aria-hidden="true">▧</span><strong>Chưa có ảnh kiện hàng</strong><small>JPG, PNG, WEBP hoặc AVIF</small><button type="button" className="li-ghost" onClick={() => document.getElementById('li-parcel-photo-input')?.click()}>Tải ảnh lên</button></>}</div><input id="li-parcel-photo-input" className="li-hidden-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={e => { const file = e.target.files?.[0]; if (!file) { setParcelPhoto(''); return; } if (file.size > 20 * 1024 * 1024) { e.target.value = ''; setError('Ảnh kiện hàng không được vượt quá 20 MB.'); setParcelPhoto(''); return; } setError(''); const reader = new FileReader(); reader.onload = () => setParcelPhoto(String(reader.result ?? '')); reader.onerror = () => setError('Không đọc được ảnh đã chọn.'); reader.readAsDataURL(file); }}/></div>
        <div className="li-form-foot"><button disabled={busy || !selectedLine || !remaining}>{busy ? 'Đang lưu…' : 'Đăng ký kiện RFID'}</button></div>
      </form>
      <div className="li-notice"><strong>Quét thẻ chỉ lấy UID; tên hàng lấy từ sản phẩm bạn chọn.</strong><p>{!canReadOrders ? 'Tài khoản chưa có quyền xem đơn mua hàng.' : !lines.length ? `Chưa có sản phẩm chờ nhận tại ${warehouse?.name ?? 'kho này'}. Tạo đơn mua hàng với đúng kho nhận và sản phẩm, sau đó quay lại đây.` : 'Gõ tên để tìm, chọn sản phẩm rồi nhập số lượng và đăng ký thẻ. Quét lại thẻ để xác nhận nhập kho.'}</p><div className="li-row"><Link className="li-ghost" href="/don-mua-hang" target="_blank" rel="noreferrer">Mở / tạo đơn mua hàng ↗</Link><button type="button" className="li-ghost" disabled={busy || !warehouseId} onClick={() => { setError(''); void refresh(warehouseId).catch(e => setError(errorMessage(e))); }}>Tải lại sản phẩm chờ nhận</button></div></div>
    </section>}
    <section className="li-card"><div className="li-card-head"><h2>Kiện đã đăng ký</h2><small>{parcels.length} kiện</small></div><div className="table-scroll"><table className="li-table"><thead><tr><th>UID thẻ / thiết bị</th><th>Sản phẩm / số lượng</th><th>Hạn sử dụng</th><th>Ảnh kiện</th><th>Trạng thái</th></tr></thead><tbody>{parcels.map(p => <tr key={p.id}><td><code>{p.tagId}</code><small>{p.deviceId}</small></td><td>{p.product?.name ?? items.find(i => i.skuId === p.skuId)?.sku.product.name ?? p.skuId}<small>{p.quantity} {p.product?.unit ?? items.find(i => i.skuId === p.skuId)?.sku.product.unit}</small></td><td>{p.expiresAt?.slice(0, 10) ?? 'Không hạn sử dụng'}</td><td>{p.evidenceUrls?.[0] ? <a href={p.evidenceUrls[0]} target="_blank" rel="noreferrer"><img className="li-parcel-photo-thumb" src={p.evidenceUrls[0]} alt="Ảnh kiện hàng"/></a> : '—'}</td><td><div className="li-row"><span className={`li-badge ${tone(p.status)}`}>{statuses[p.status]}</span>{p.status === 'READY' && canReceive && <button className="li-ghost li-danger" disabled={busy} onClick={() => void cancel(p.id)}>Hủy đăng ký</button>}</div></td></tr>)}{!parcels.length && <tr><td colSpan={5} className="li-empty">Chưa có kiện nào được đăng ký.</td></tr>}</tbody></table></div></section>
<details className="rfid-history"><summary>Lịch sử quét gần đây <span>{events.length} sự kiện</span></summary>    <section className="li-card"><div className="li-card-head"><h2>Sự kiện thiết bị gần nhất</h2><small>{events.length} sự kiện</small></div><div className="table-scroll"><table className="li-table"><thead><tr><th>Thời gian / thiết bị</th><th>Thẻ / sản phẩm</th><th>Kết quả</th><th>Chứng từ</th></tr></thead><tbody>{events.map(event => <tr key={event.id}><td>{new Date(event.receivedAt).toLocaleString('vi-VN')}<small>{event.deviceId}</small></td><td><code>{event.tagId}</code><small>{event.mappedSku?.product.name ?? 'Chưa liên kết sản phẩm'}</small></td><td><span className={`li-badge ${tone(event.automationStatus)}`}>{statuses[event.automationStatus ?? ''] ?? 'Sự kiện lịch sử'}</span><small>{event.automationMessage}</small></td><td>{event.goodsReceiptId ? <Link href="/nhap-hang">Phiếu nhận {event.goodsReceiptId.slice(0, 8)} →</Link> : <button className="li-ghost" onClick={() => { dismissedScanIds.current.delete(event.id); dismissedTagIds.current.delete(event.tagId); setConfirmError(''); setScanQueue([event]); }}>Xem / xác nhận</button>}</td></tr>)}{!events.length && <tr><td colSpan={4} className="li-empty">Chưa có sự kiện từ thiết bị tại kho này.</td></tr>}</tbody></table></div></section>
</details>
    </>}
  </main>;
}
export default function Page() { return <Protected permission="inventory.read"><LiveInbound/></Protected>; }


