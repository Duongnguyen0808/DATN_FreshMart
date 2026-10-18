'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getInventory, type Inventory } from '../../../lib/inventory-api';
import { getStores, getWarehouses, type Store, type Warehouse } from '../../../lib/organization-api';
import { errorMessage } from '../../../lib/auth-api';
import { getPurchaseOrders, receivePurchaseOrder, type PurchaseOrder } from '../../../lib/purchase-orders-api';
import { dispatchTransfer, getTransfers, receiveTransfer, type Transfer } from '../../../lib/transfers-api';
import { simulateRfidEvent, type IotEvent } from '../../../lib/iot-api';
import { subscribeIotEvents } from '../../../lib/iot-realtime';
import { WarehouseTwinScene, type DemoState } from './warehouse-twin-scene';
import { DemoResultDialog, type DemoResult } from './demo-result-dialog';

const formatNumber = (value: number) => new Intl.NumberFormat('vi-VN').format(value);
async function getAllWarehouseInventory(id: string) {
  const first = await getInventory({ warehouseId: id, status: 'all', page: 1, pageSize: 100 });
  const rest = await Promise.all(Array.from({ length: Math.max(0, first.pagination.totalPages - 1) }, (_, index) =>
    getInventory({ warehouseId: id, status: 'all', page: index + 2, pageSize: 100 }),
  ));
  return [first, ...rest].flatMap((page) => page.items);
}

async function getAllWarehouseOrders(id: string) {
  const first = await getPurchaseOrders({ warehouseId: id, status: 'all', page: 1 });
  const rest = await Promise.all(Array.from({ length: Math.max(0, first.pagination.totalPages - 1) }, (_, index) =>
    getPurchaseOrders({ warehouseId: id, status: 'all', page: index + 2 }),
  ));
  return [first, ...rest].flatMap((page) => page.items);
}

async function getAllWarehouseTransfers(id: string) {
  const first = await getTransfers({ warehouseId: id, status: 'all', page: 1 });
  const rest = await Promise.all(Array.from({ length: Math.max(0, first.pagination.totalPages - 1) }, (_, index) =>
    getTransfers({ warehouseId: id, status: 'all', page: index + 2 }),
  ));
  return [first, ...rest].flatMap((page) => page.items);
}

const stateCopy: Record<DemoState, string> = {
  TRUCK_UNLOADING: 'Xe tải hạ pallet xuống điểm tập kết', IDLE: 'Sẵn sàng nhận hàng', TRUCK_APPROACHING: 'Xe tải vào bãi và dừng bên cạnh cửa kho', TRUCK_DOCKING: 'Xe tải căn chỉnh tại khu dỡ hàng', DOCKED: 'Xe đã dừng · bắt đầu hạ pallet',
  WORKER_APPROACHING: 'Tài xế đưa xe nâng tới khu tập kết', FORKLIFT_TO_TRUCK: 'Xe nâng tiến sát pallet đã hạ xuống', PALLET_UNLOADING: 'Xe nâng nhấc pallet khỏi mặt sân', IOT_RFID_SIMULATED: 'Xe nâng chở pallet qua cổng RFID nhận · tồn chưa đổi', IOT_CAMERA_SIMULATED: 'Camera mô phỏng chụp bằng chứng nhận hàng',
  WAITING_CONFIRMATION: 'Đối chiếu PO và xác nhận số lượng thực nhận', GOODS_RECEIVED: 'Đã xác nhận · tạo phiếu nhận và giao dịch PURCHASE_RECEIPT', MOVE_TO_STORAGE: 'Xe nâng đưa pallet từ cổng nhận vào lối kệ', STORED: 'Pallet đã vào vị trí lưu trữ',
  TRANSFER_PREPARING: 'Đọc phiếu APPROVED · chuẩn bị đúng SKU và số lượng', FORKLIFT_PICKUP: 'Xe nâng lấy pallet theo phiếu · chưa trừ tồn', MOVE_TO_OUTBOUND: 'Đưa pallet qua cổng RFID xuất', IOT_RFID_OUT_SIMULATED: 'RFID mô phỏng đọc pallet tại cổng xuất', FORKLIFT_DELIVER_TO_TRUCK: 'Xe nâng chở pallet từ cổng RFID tới xe tải', TRANSFER_LOADING_TRUCK: 'Xe nâng hạ pallet lên thùng xe tải', WAITING_DISPATCH_CONFIRM: 'Pallet đã được đặt lên xe · chờ xác nhận xuất kho', DISPATCHED: 'Đã xác nhận xuất · giao dịch TRANSFER_OUT', IN_TRANSIT: 'Xe tải di chuyển theo tuyến giữa hai chi nhánh', DESTINATION_ARRIVAL: 'Xe tải hạ pallet xuống bãi nhận', DESTINATION_PALLET_PICKUP: 'Xe nâng áp sát vuông góc, luồn càng và nâng pallet', IOT_RFID_IN_SIMULATED: 'Xe nâng chở pallet qua RFID nhận tại kho đích', WAITING_RECEIVE_CONFIRM: 'Đối chiếu phiếu và xác nhận số lượng thực nhận', RECEIVED: 'Đã xác nhận nhận · giao dịch TRANSFER_IN', COMPLETE: 'Hoàn tất · dock sẵn sàng',
};
const transitionMs: Partial<Record<DemoState, number>> = { TRUCK_APPROACHING: 3000, TRUCK_DOCKING: 3900, DOCKED: 900, WORKER_APPROACHING: 700, FORKLIFT_TO_TRUCK: 3500, PALLET_UNLOADING: 2200, IOT_RFID_SIMULATED: 1100, IOT_CAMERA_SIMULATED: 900, GOODS_RECEIVED: 900, MOVE_TO_STORAGE: 3200, STORED: 900, TRANSFER_PREPARING: 4000, FORKLIFT_PICKUP: 4400, MOVE_TO_OUTBOUND: 5000, IOT_RFID_OUT_SIMULATED: 1000, TRANSFER_LOADING_TRUCK: 2300, DISPATCHED: 700, IN_TRANSIT: 5200, DESTINATION_ARRIVAL: 4000, IOT_RFID_IN_SIMULATED: 1000, RECEIVED: 1000 };
const nextState: Partial<Record<DemoState, DemoState>> = { TRUCK_APPROACHING: 'TRUCK_DOCKING', TRUCK_DOCKING: 'DOCKED', DOCKED: 'TRUCK_UNLOADING', TRUCK_UNLOADING: 'WORKER_APPROACHING', WORKER_APPROACHING: 'FORKLIFT_TO_TRUCK', FORKLIFT_TO_TRUCK: 'PALLET_UNLOADING', PALLET_UNLOADING: 'IOT_RFID_SIMULATED', IOT_RFID_SIMULATED: 'IOT_CAMERA_SIMULATED', IOT_CAMERA_SIMULATED: 'WAITING_CONFIRMATION', GOODS_RECEIVED: 'MOVE_TO_STORAGE', MOVE_TO_STORAGE: 'STORED', STORED: 'COMPLETE', TRANSFER_PREPARING: 'FORKLIFT_PICKUP', FORKLIFT_PICKUP: 'MOVE_TO_OUTBOUND', MOVE_TO_OUTBOUND: 'IOT_RFID_OUT_SIMULATED', IOT_RFID_OUT_SIMULATED: 'FORKLIFT_DELIVER_TO_TRUCK', FORKLIFT_DELIVER_TO_TRUCK: 'TRANSFER_LOADING_TRUCK', TRANSFER_LOADING_TRUCK: 'WAITING_DISPATCH_CONFIRM', DISPATCHED: 'IN_TRANSIT', IN_TRANSIT: 'DESTINATION_ARRIVAL', DESTINATION_ARRIVAL: 'DESTINATION_PALLET_PICKUP', DESTINATION_PALLET_PICKUP: 'IOT_RFID_IN_SIMULATED', IOT_RFID_IN_SIMULATED: 'WAITING_RECEIVE_CONFIRM', RECEIVED: 'MOVE_TO_STORAGE' };
const movementStates: ReadonlySet<DemoState> = new Set(['TRUCK_UNLOADING', 'TRUCK_APPROACHING', 'TRUCK_DOCKING', 'TRANSFER_PREPARING', 'IN_TRANSIT', 'FORKLIFT_TO_TRUCK', 'FORKLIFT_PICKUP', 'MOVE_TO_OUTBOUND', 'IOT_RFID_SIMULATED', 'IOT_RFID_IN_SIMULATED', 'DESTINATION_ARRIVAL', 'DESTINATION_PALLET_PICKUP', 'MOVE_TO_STORAGE', 'FORKLIFT_DELIVER_TO_TRUCK']);
const timelineStep: Record<DemoState, number> = { IDLE: -1, TRUCK_APPROACHING: 1, TRUCK_DOCKING: 1, DOCKED: 2, TRUCK_UNLOADING: 2, WORKER_APPROACHING: 2, FORKLIFT_TO_TRUCK: 2, PALLET_UNLOADING: 2, IOT_RFID_SIMULATED: 3, IOT_CAMERA_SIMULATED: 3, WAITING_CONFIRMATION: 4, GOODS_RECEIVED: 4, MOVE_TO_STORAGE: 5, STORED: 5, TRANSFER_PREPARING: 0, FORKLIFT_PICKUP: 1, MOVE_TO_OUTBOUND: 2, IOT_RFID_OUT_SIMULATED: 2, FORKLIFT_DELIVER_TO_TRUCK: 3, TRANSFER_LOADING_TRUCK: 3, WAITING_DISPATCH_CONFIRM: 3, DISPATCHED: 3, IN_TRANSIT: 3, DESTINATION_ARRIVAL: 3, DESTINATION_PALLET_PICKUP: 4, IOT_RFID_IN_SIMULATED: 4, WAITING_RECEIVE_CONFIRM: 4, RECEIVED: 4, COMPLETE: 5 };

export default function WarehouseTwinPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState('');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [demoRunId, setDemoRunId] = useState(0);
  const [demoResult, setDemoResult] = useState<DemoResult | null>(null);
  const [resultDismissed, setResultDismissed] = useState(false);
  const [items, setItems] = useState<Inventory[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [workflow, setWorkflow] = useState<'inbound' | 'transfer'>('transfer');
  const [transferId, setTransferId] = useState('visual');
  const [transferSkuId, setTransferSkuId] = useState('');
  const [demoDestinationWarehouseId, setDemoDestinationWarehouseId] = useState('');
  const [inventoryByWarehouse, setInventoryByWarehouse] = useState<Record<string, Inventory[]>>({});
  const [visualOnlyTransfer, setVisualOnlyTransfer] = useState(false);
  const [visualOnlyInbound, setVisualOnlyInbound] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [demoState, setDemoState] = useState<DemoState>('IDLE');
  const [demoPaused, setDemoPaused] = useState(false);
  const [eventTime, setEventTime] = useState('');
  const [completedOrderCode, setCompletedOrderCode] = useState('');
  const [receivedProduct, setReceivedProduct] = useState<{ code: string; name: string; unit: string } | null>(null);
  const [iotEventAck, setIotEventAck] = useState('');
  const [latestIotEvent, setLatestIotEvent] = useState<IotEvent | null>(null);
  const [iotEventsByStep, setIotEventsByStep] = useState<Record<string, IotEvent[]>>({});
  const [iotMode, setIotMode] = useState<'DEMO' | 'LIVE'>('DEMO');
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const iotEventIds = useRef(new Map<string, string>());
  const iotEventInFlight = useRef(new Set<string>());
  const liveIotContext = useRef<{ mode: 'DEMO' | 'LIVE'; state: DemoState; runId: number; warehouseId: string; skuIds: string[] }>({ mode: 'DEMO', state: 'IDLE', runId: 0, warehouseId: '', skuIds: [] });

  const reloadInventory = useCallback(async (id: string) => {
    setItems(await getAllWarehouseInventory(id));
  }, []);

  useEffect(() => {
    Promise.all([getStores(), getWarehouses()]).then(([storeRows, warehouseRows]) => {
      const activeStores = storeRows.filter((store) => store.active);
      const activeWarehouses = warehouseRows.filter((warehouse) => warehouse.active && warehouse.store.active);
      const firstStore = activeStores[0];
      setStores(activeStores);
      setWarehouses(activeWarehouses);
      setStoreId(firstStore?.id ?? '');
      setWarehouseId(activeWarehouses.find((warehouse) => warehouse.storeId === firstStore?.id)?.id ?? '');
      setDemoDestinationWarehouseId(activeWarehouses.find((warehouse) => warehouse.id !== activeWarehouses.find((row) => row.storeId === firstStore?.id)?.id)?.id ?? '');
    }).catch((e) => setError(errorMessage(e))).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!warehouses.length) return;
    let alive = true;
    Promise.all(warehouses.map(async (warehouse) => [warehouse.id, await getAllWarehouseInventory(warehouse.id).catch(() => [])] as const))
      .then((rows) => { if (alive) setInventoryByWarehouse(Object.fromEntries(rows)); });
    return () => { alive = false; };
  }, [warehouses]);

  useEffect(() => {
    if (!warehouseId) {
      setItems([]); setOrders([]); setTransfers([]); setOrderId(''); setSelectedItemId(null); setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    Promise.all([
      getAllWarehouseInventory(warehouseId),
      getAllWarehouseOrders(warehouseId),
      getAllWarehouseTransfers(warehouseId),
    ]).then(([inventoryRows, orderRows, transferRows]) => {
      if (!alive) return;
      setItems(inventoryRows);
      setOrders(orderRows.filter((order) => order.totalRemaining > 0));
      setTransfers(transferRows);
      setOrderId((current) => orderRows.some((order) => order.id === current && order.totalRemaining > 0)
        ? current
        : orderRows.find((order) => order.totalRemaining > 0)?.id ?? 'visual');
      setSelectedItemId(null);
      setError('');
    }).catch((e) => { if (alive) setError(errorMessage(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [warehouseId]);

  const handleMotionComplete = useCallback((completed: DemoState) => {
    if (!movementStates.has(completed)) return;
    setDemoState((current) => current === completed ? nextState[current] ?? current : current);
  }, []);
  const demoActive = demoState !== 'IDLE' && demoState !== 'COMPLETE';
  useEffect(() => {
    if (demoPaused || movementStates.has(demoState)) return;
    if (['IOT_RFID_SIMULATED', 'IOT_RFID_OUT_SIMULATED', 'IOT_RFID_IN_SIMULATED'].includes(demoState) && iotEventAck !== `${demoRunId}:${demoState}`) return;
    const duration = transitionMs[demoState];
    const next = nextState[demoState];
    if (!duration || !next) return;
    const timer = window.setTimeout(() => {
      setDemoState(next);
    }, duration);
    return () => window.clearTimeout(timer);
  }, [demoState, demoPaused, visualOnlyTransfer, visualOnlyInbound, demoRunId, iotEventAck]);

  useEffect(() => {
    if (['TRUCK_APPROACHING', 'TRUCK_DOCKING', 'DOCKED', 'TRUCK_UNLOADING', 'WORKER_APPROACHING', 'FORKLIFT_TO_TRUCK', 'PALLET_UNLOADING', 'IOT_RFID_SIMULATED', 'IOT_CAMERA_SIMULATED', 'WAITING_CONFIRMATION', 'DESTINATION_ARRIVAL', 'DESTINATION_PALLET_PICKUP', 'IOT_RFID_IN_SIMULATED', 'WAITING_RECEIVE_CONFIRM'].includes(demoState)) setSelectedZone('receiving');
    else if (['TRANSFER_PREPARING', 'FORKLIFT_PICKUP', 'MOVE_TO_OUTBOUND', 'IOT_RFID_OUT_SIMULATED', 'FORKLIFT_DELIVER_TO_TRUCK', 'TRANSFER_LOADING_TRUCK', 'WAITING_DISPATCH_CONFIRM'].includes(demoState)) setSelectedZone('shipping');
    else if (demoState === 'COMPLETE') setSelectedZone('overview');
    else setSelectedZone('storage-a');
    if (demoState !== 'IDLE') setEventTime(new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()));
  }, [demoState]);

  const selectedWarehouse = warehouses.find((row) => row.id === warehouseId);
  const selectedStore = stores.find((store) => store.id === storeId);
  const branchWarehouses = warehouses.filter((warehouse) => warehouse.storeId === storeId);
  const selectedOrder = orders.find((order) => order.id === orderId) ?? null;
  const inboundVisualInventory = items.find((item) => item.onHand > 0) ?? null;
  const inboundVisualOnly = orderId === 'visual';
  const selectedInboundLine = selectedOrder?.items.find((item) => item.remainingQuantity > 0);
  const outboundTransfers = transfers.filter((transfer) => transfer.sourceWarehouseId === warehouseId && transfer.status === 'APPROVED');
  const activeTransfer = transfers.find((transfer) => transfer.id === transferId) ?? null;
  const selectableTransferStocks = items.filter((item) => item.onHand > 0);
  const visualTransferInventory = selectableTransferStocks.find((item) => item.skuId === transferSkuId) ?? selectableTransferStocks[0] ?? null;
  const transferLine = activeTransfer?.items[0];
  const transferQuantity = activeTransfer ? (transferLine?.approvedQuantity ?? transferLine?.requestedQuantity ?? 0) : visualTransferInventory ? 1 : 0;
  const sourceInventory = activeTransfer && transferLine ? items.find((item) => item.skuId === transferLine.skuId) : visualTransferInventory;
  const transferDestinationId = activeTransfer?.destinationWarehouseId ?? demoDestinationWarehouseId;
  const transferDestination = warehouses.find((warehouse) => warehouse.id === transferDestinationId) ?? warehouses.find((warehouse) => warehouse.id !== warehouseId) ?? null;
  const campusWarehouses = selectedWarehouse ? [selectedWarehouse, ...warehouses.filter((warehouse) => warehouse.id !== selectedWarehouse.id).sort((a, b) => a.code.localeCompare(b.code))].slice(0, 3) : warehouses.slice(0, 3);
  const sceneWarehouses = campusWarehouses.map((warehouse) => ({ id: warehouse.id, name: warehouse.name, code: warehouse.code, storeName: warehouse.store.name, items: (warehouse.id === warehouseId ? items : inventoryByWarehouse[warehouse.id] ?? []).filter((item) => item.onHand > 0) }));
  const transferSku = activeTransfer ? transferLine?.sku.product : visualTransferInventory?.sku.product;
  const isRealApprovedTransfer = Boolean(activeTransfer && activeTransfer.sourceWarehouseId === warehouseId && activeTransfer.status === 'APPROVED' && transferLine && sourceInventory && sourceInventory.available >= transferQuantity);
  const demoProduct = workflow === 'transfer' ? transferSku : selectedInboundLine?.sku.product ?? (inboundVisualOnly ? inboundVisualInventory?.sku.product : null) ?? receivedProduct;
  const sceneDemoInventory = workflow === 'inbound'
    ? selectedInboundLine ? items.find((row) => row.skuId === selectedInboundLine.skuId) : inboundVisualInventory
    : sourceInventory;
  const selectedItem = sceneWarehouses.flatMap((warehouse) => warehouse.items).find((row) => row.id === selectedItemId) ?? null;
  const totalOnHand = items.reduce((sum, row) => sum + row.onHand, 0);
  const lowStockCount = items.filter((row) => row.status === 'LOW').length;
  const inboundTransfers = transfers.filter((transfer) => transfer.destinationWarehouseId === warehouseId && ['APPROVED', 'IN_TRANSIT'].includes(transfer.status));
  const inboundDemoReady = Boolean(selectedWarehouse && (inboundVisualOnly ? inboundVisualInventory : selectedOrder && selectedOrder.totalRemaining > 0));
  const transferDemoReady = Boolean(selectedWarehouse && sourceInventory && (isRealApprovedTransfer ? sourceInventory.available >= transferQuantity : sourceInventory.onHand > 0) && (isRealApprovedTransfer || (transferDestination && transferDestination.id !== warehouseId)));
  const demoReady = workflow === 'inbound' ? inboundDemoReady : transferDemoReady;
  const demoUnavailableReason = !selectedWarehouse ? 'Chi nhánh này chưa có kho hoạt động.' : workflow === 'inbound' ? inboundVisualOnly && !inboundVisualInventory ? 'Cần tồn kho có dữ liệu thật để chọn sản phẩm minh họa.' : !inboundVisualOnly && !selectedOrder ? 'Chọn PO còn hàng hoặc Demo nhập mô phỏng.' : '' : !sourceInventory ? 'Kho chưa có SKU khả dụng để mô phỏng xuất.' : !transferDestination || transferDestination.id === warehouseId ? 'Cần thêm một kho đích đang hoạt động để chạy demo.' : activeTransfer && !isRealApprovedTransfer && transferId !== 'visual' ? 'Phiếu thật chưa APPROVED hoặc tồn khả dụng chưa đủ; chọn Visual Demo để chạy không ghi phiếu/tồn kho.' : '';
  const currentStep = visualOnlyInbound && ['GOODS_RECEIVED', 'MOVE_TO_STORAGE', 'STORED', 'COMPLETE'].includes(demoState) ? 'Demo nhập đã xác nhận · chưa ghi tồn Database'
    : visualOnlyTransfer && ['DISPATCHED', 'RECEIVED'].includes(demoState) ? `${stateCopy[demoState]} · Visual Demo, không ghi database`
    : stateCopy[demoState];

  const isRfidScanState = ['IOT_RFID_SIMULATED', 'IOT_RFID_OUT_SIMULATED', 'IOT_RFID_IN_SIMULATED'].includes(demoState);
  const isInboundScan = workflow === 'inbound';
  const isDestinationScan = demoState === 'IOT_RFID_IN_SIMULATED';
  const scanWarehouseId = isDestinationScan ? transferDestinationId : warehouseId;
  const scanLines = isInboundScan
    ? selectedOrder ? selectedOrder.items.filter(item => item.remainingQuantity > 0).map(item => ({ skuId: item.skuId, quantity: item.remainingQuantity, palletCode: `PAL-${item.sku.code}` }))
      : inboundVisualInventory ? [{ skuId: inboundVisualInventory.skuId, quantity: 1, palletCode: `PAL-${inboundVisualInventory.sku.code}` }] : []
    : activeTransfer ? activeTransfer.items.filter(item => (item.approvedQuantity ?? item.requestedQuantity) > 0).map(item => ({ skuId: item.skuId, quantity: item.approvedQuantity ?? item.requestedQuantity, palletCode: `PAL-${item.sku.code}` }))
      : visualTransferInventory ? [{ skuId: visualTransferInventory.skuId, quantity: 1, palletCode: `PAL-${visualTransferInventory.sku.code}` }] : [];
  const scanKey = `${demoRunId}:${demoState}`;
  liveIotContext.current = { mode: iotMode, state: demoState, runId: demoRunId, warehouseId: scanWarehouseId, skuIds: scanLines.map(line => line.skuId) };

  useEffect(() => subscribeIotEvents(event => {
    setLatestIotEvent(event);
    const context = liveIotContext.current;
    if (context.mode !== 'LIVE' || !['IOT_RFID_SIMULATED', 'IOT_RFID_OUT_SIMULATED', 'IOT_RFID_IN_SIMULATED'].includes(context.state)
      || event.source !== 'DEVICE' || event.processed || event.warehouseId !== context.warehouseId
      || !event.mappedSkuId || !context.skuIds.includes(event.mappedSkuId)) return;
    const key = `${context.runId}:${context.state}`;
    setIotEventsByStep(current => {
      const group = current[key] ?? [];
      return group.some(item => item.id === event.id) ? current : { ...current, [key]: [...group, event] };
    });
  }, setRealtimeConnected), []);

  useEffect(() => {
    if (iotMode !== 'LIVE' || !isRfidScanState || !scanLines.length) return;
    const events = iotEventsByStep[scanKey] ?? [];
    if (!scanLines.every(line => events.some(event => event.mappedSkuId === line.skuId))) return;
    setIotEventAck(scanKey);
    setLatestIotEvent(events.at(-1) ?? null);
    setEventTime(new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(events.at(-1)?.timestamp ?? Date.now())));
  }, [iotMode, isRfidScanState, scanLines, scanKey, iotEventsByStep]);

  useEffect(() => {
    if (iotMode !== 'DEMO' || demoPaused || !isRfidScanState) return;
    if (!scanWarehouseId || iotEventInFlight.current.has(scanKey) || iotEventAck === scanKey) return;
    if (!scanLines.length) return;
    const isInbound = isInboundScan;
    const isDestinationRead = isDestinationScan;
    const eventWarehouseId = scanWarehouseId;
    const key = scanKey;
    iotEventInFlight.current.add(key);
    const reference = isInbound ? selectedOrder?.code ?? 'DEMO-INBOUND' : activeTransfer?.code ?? 'DEMO-TRANSFER';
    const requests = scanLines.map(line => {
      const lineKey = `${key}:${line.skuId}`;
      const eventId = iotEventIds.current.get(lineKey) ?? crypto.randomUUID();
      iotEventIds.current.set(lineKey, eventId);
      return simulateRfidEvent({
        eventId,
        deviceId: 'SIM-RFID-READER-01',
        tagId: `SIM-${line.skuId}`,
        warehouseId: eventWarehouseId,
        timestamp: new Date().toISOString(),
        payload: {
          workflow: isInbound ? 'PURCHASE_RECEIPT' : 'STOCK_TRANSFER',
          stage: isInbound ? 'INBOUND' : isDestinationRead ? 'DESTINATION_RECEIVE' : 'SOURCE_DISPATCH',
          reference,
          skuId: line.skuId,
          quantity: line.quantity,
          palletCode: line.palletCode,
          reader: isDestinationRead ? 'SIM-RFID-RECEIVE' : isInbound ? 'SIM-RFID-INBOUND' : 'SIM-RFID-OUTBOUND',
        },
      });
    });
    void Promise.all(requests).then(results => {
      const events = results.map(result => result.event);
      setIotEventsByStep(current => ({ ...current, [key]: events }));
      setLatestIotEvent(events.at(-1) ?? null);
      setIotEventAck(key);
      setEventTime(new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(events.at(-1)?.timestamp ?? Date.now())));
      setError('');
    }).catch((reason) => {
      setError(errorMessage(reason));
      setDemoPaused(true);
    }).finally(() => iotEventInFlight.current.delete(key));
  }, [iotMode, demoPaused, isRfidScanState, isInboundScan, isDestinationScan, scanWarehouseId, scanKey, scanLines, demoRunId, demoState, workflow, selectedOrder?.code, iotEventAck]);

  const startDemo = () => {
    if (demoState !== 'IDLE' && demoState !== 'COMPLETE') return;
    if (!demoReady) { setError(demoUnavailableReason); return; }
    setError('');
    setDemoRunId((run) => run + 1);
    setResultDismissed(false);
    const simulated = workflow === 'inbound' ? inboundVisualOnly : !isRealApprovedTransfer;
    const resultItems: DemoResult['items'] = workflow === 'inbound'
      ? simulated
        ? inboundVisualInventory ? [{ ...inboundVisualInventory.sku.product, skuId: inboundVisualInventory.skuId, quantity: 1 }] : []
        : (selectedOrder?.items ?? []).filter((item) => item.remainingQuantity > 0).map((item) => ({ ...item.sku.product, skuId: item.skuId, quantity: item.remainingQuantity }))
      : simulated
        ? visualTransferInventory ? [{ ...visualTransferInventory.sku.product, skuId: visualTransferInventory.skuId, quantity: transferQuantity }] : []
        : (activeTransfer?.items ?? []).filter((item) => (item.approvedQuantity ?? 0) > 0).map((item) => ({ ...item.sku.product, skuId: item.skuId, quantity: item.approvedQuantity ?? 0 }));
    setDemoResult({ workflow, simulated,
      reference: simulated ? 'Demo · không tạo chứng từ' : workflow === 'inbound' ? selectedOrder?.code ?? '' : activeTransfer?.code ?? '',
      source: workflow === 'inbound' ? simulated ? 'Xe tải nhập hàng mô phỏng' : selectedOrder?.supplier.name ?? '' : `${selectedStore?.name} · ${selectedWarehouse?.name}`,
      destination: workflow === 'inbound' ? `${selectedStore?.name} · ${selectedWarehouse?.name}` : `${transferDestination?.store.name} · ${transferDestination?.name}`,
      items: resultItems,
    });
    setVisualOnlyTransfer(workflow === 'transfer' && !isRealApprovedTransfer);
    setVisualOnlyInbound(workflow === 'inbound' && inboundVisualOnly);
    setDemoState(workflow === 'inbound' ? 'TRUCK_APPROACHING' : 'TRANSFER_PREPARING');
    setDemoPaused(false);
    setSelectedItemId(null);
    setCompletedOrderCode('');
    setReceivedProduct(null);
    setSelectedZone('receiving');
    setEventTime(new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()));
    setIotEventAck('');
    setLatestIotEvent(null);
    setIotEventsByStep({});
    iotEventIds.current.clear();
    iotEventInFlight.current.clear();
  };

  const confirmReceipt = async () => {
    if (workflow !== 'inbound' || !selectedOrder || demoState !== 'WAITING_CONFIRMATION' || busy) return;
    setBusy(true);
    setError('');
    const receivedOrderCode = selectedOrder.code;
    const product = selectedOrder.items.find((item) => item.remainingQuantity > 0)?.sku.product;
    try {
      const receivedOrder = await receivePurchaseOrder(selectedOrder.id, {
        note: 'Nhân viên xác nhận nhận hàng sau demo Digital Twin / RFID.',
        iotEventIds: iotEventsByStep[`${demoRunId}:IOT_RFID_SIMULATED`]?.map(event => event.id),
        items: selectedOrder.items.filter((item) => item.remainingQuantity > 0).map((item) => ({ purchaseOrderItemId: item.id, quantity: item.remainingQuantity })),
      });
      const receipt = receivedOrder.receipts.at(-1);
      if (receipt) setDemoResult((current) => current ? {
        ...current,
        reference: receipt.code,
        items: receipt.items.map((item) => ({ ...item.sku.product, skuId: item.skuId, quantity: item.quantity })),
      } : null);
      setCompletedOrderCode(receivedOrderCode);
      if (product) setReceivedProduct({ code: product.code, name: product.name, unit: product.unit });
      setDemoState('GOODS_RECEIVED');
      setDemoPaused(false);
      setSelectedZone('storage-a');
      setEventTime(new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()));
      await reloadInventory(warehouseId);
      const refreshedOrders = await getAllWarehouseOrders(warehouseId);
      setOrders(refreshedOrders.filter((order) => order.totalRemaining > 0));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const confirmVisualInbound = () => {
    if (demoState !== 'WAITING_CONFIRMATION' || busy) return;
    setDemoState('GOODS_RECEIVED');
    setDemoPaused(false);
    setEventTime(new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()));
  };

  const confirmVisualTransferStep = (next: 'DISPATCHED' | 'RECEIVED') => {
    setDemoState(next);
    setDemoPaused(false);
    setEventTime(new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()));
  };

  const confirmDispatch = async () => {
    if (workflow !== 'transfer' || !activeTransfer || demoState !== 'WAITING_DISPATCH_CONFIRM' || busy) return;
    setBusy(true);
    setError('');
    try {
      const dispatched = await dispatchTransfer(activeTransfer.id, 'Xuất kho xác nhận trong Digital Twin Demo; RFID là mô phỏng.', iotEventsByStep[`${demoRunId}:IOT_RFID_OUT_SIMULATED`]?.map(event => event.id));
      setTransfers((current) => current.map((transfer) => transfer.id === dispatched.id ? dispatched : transfer));
      await reloadInventory(warehouseId);
      setDemoState('DISPATCHED');
      setEventTime(new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const confirmTransferReceipt = async () => {
    if (workflow !== 'transfer' || !activeTransfer || demoState !== 'WAITING_RECEIVE_CONFIRM' || busy) return;
    setBusy(true);
    setError('');
    try {
      const received = await receiveTransfer(activeTransfer.id, {
        note: 'Nhận hàng xác nhận trong Digital Twin Demo; RFID là mô phỏng.',
        iotEventIds: iotEventsByStep[`${demoRunId}:IOT_RFID_IN_SIMULATED`]?.map(event => event.id),
        items: activeTransfer.items.map((item) => ({ skuId: item.skuId, quantity: item.dispatchedQuantity ?? 0, discrepancyReason: null })),
      });
      setDemoResult((current) => current ? { ...current, items: received.items.filter((item) => (item.receivedQuantity ?? 0) > 0).map((item) => ({ ...item.sku.product, skuId: item.skuId, quantity: item.receivedQuantity ?? 0 })) } : null);
      setTransfers((current) => current.map((transfer) => transfer.id === received.id ? received : transfer));
      const destinationId = received.destinationWarehouseId;
      const destinationItems = await getAllWarehouseInventory(destinationId);
      setInventoryByWarehouse((current) => ({ ...current, [destinationId]: destinationItems }));
      setDemoState('RECEIVED');
      setEventTime(new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const resetDemo = () => { setDemoResult(null); setResultDismissed(false); setDemoRunId((run) => run + 1); setDemoPaused(false); setDemoState('IDLE'); setVisualOnlyInbound(false); setVisualOnlyTransfer(false); setCompletedOrderCode(''); setReceivedProduct(null); setEventTime(''); setIotEventAck(''); setLatestIotEvent(null); setIotEventsByStep({}); iotEventIds.current.clear(); iotEventInFlight.current.clear(); setSelectedZone('overview'); setSelectedItemId(null); setError(''); };

  const iotStepName = iotMode === 'LIVE' ? 'RFID · LIVE IOT' : 'RFID · MÔ PHỎNG';
  const progressSteps = workflow === 'transfer'
    ? ['Kho nguồn', 'Lấy hàng', iotStepName + ' xuất', 'Vận chuyển', iotStepName + ' nhận', 'Kho đích']
    : ['PO sẵn sàng', 'Xe đến dock', 'Dỡ hàng', iotStepName, 'Xác nhận', 'Lưu kho'];
  const progressIndex = timelineStep[demoState];
  const demoComplete = demoState === 'COMPLETE';

  return <main className="suite-page warehouse-twin-page twin-dashboard-page">
    <header className="twin-topbar">
      <div className="twin-brand"><span className="twin-brand-mark">FM</span><span><strong>FreshMart</strong><small>Digital Twin · Branch operations</small></span></div>
      <label className="twin-site-select"><span>CHI NHÁNH</span><select value={storeId} onChange={(event) => { const nextStoreId = event.target.value; const nextWarehouse = warehouses.find((warehouse) => warehouse.storeId === nextStoreId); resetDemo(); setStoreId(nextStoreId); setWarehouseId(nextWarehouse?.id ?? ''); setDemoDestinationWarehouseId(warehouses.find((warehouse) => warehouse.id !== nextWarehouse?.id)?.id ?? ''); setTransferSkuId(''); setItems([]); setOrders([]); setTransfers([]); setOrderId(''); setTransferId('visual'); setSelectedItemId(null); }} disabled={!stores.length || demoActive}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
      <label className="twin-site-select"><span>KHO THUỘC CHI NHÁNH</span><select value={warehouseId} onChange={(event) => { resetDemo(); setWarehouseId(event.target.value); setDemoDestinationWarehouseId(warehouses.find((warehouse) => warehouse.id !== event.target.value)?.id ?? ''); setTransferSkuId(''); setItems([]); setOrders([]); setTransfers([]); setOrderId(''); setTransferId('visual'); setSelectedItemId(null); }} disabled={!branchWarehouses.length || demoActive}><option value="">Chọn kho</option>{branchWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouse.code}</option>)}</select></label>
      <div className="twin-mode-switch" aria-label="Chế độ IoT"><button type="button" className={iotMode === 'DEMO' ? 'selected' : ''} onClick={() => { setIotMode('DEMO'); setIotEventAck(''); }} disabled={demoActive}>DEMO MODE · SIMULATED IOT</button><button type="button" className={iotMode === 'LIVE' ? 'selected' : ''} onClick={() => { setIotMode('LIVE'); setIotEventAck(''); }} disabled={demoActive}>LIVE IOT</button><small>{realtimeConnected ? 'Backend realtime · CONNECTED' : 'Backend realtime · chưa kết nối'}</small></div>
      <Link className="twin-exit-link" href="/kho">Quản lý kho ↗</Link>
    </header>

    {error && <div className="ui-error twin-error" role="alert">{error}</div>}
    {!warehouses.length && !loading && !error && <div className="suite-panel warehouse-twin-empty">Chưa có kho đang hoạt động trong phạm vi tài khoản.</div>}

    <section className="twin-overview-bar">
      <div className="twin-overview-title"><span className="twin-live-dot"/><span><strong>{selectedStore?.name ?? 'Chi nhánh chưa chọn'}{selectedWarehouse ? ` · ${selectedWarehouse.name}` : ''}</strong><small>{demoState !== 'IDLE' ? currentStep : 'Toàn cảnh kho · thông tin nghiệp vụ nằm bên dưới'}</small></span></div>
      <div className="twin-scene-controls"><label className="twin-po-inline">LUỒNG DEMO<select value={workflow} onChange={(event) => { resetDemo(); setWorkflow(event.target.value as 'inbound' | 'transfer'); }} disabled={busy || demoActive}><option value="inbound">Nhập hàng vào kho</option><option value="transfer">Chuyển hàng giữa chi nhánh</option></select></label>{workflow === 'inbound' ? <label className="twin-po-inline">NGUỒN NHẬP<select value={orderId} onChange={(event) => setOrderId(event.target.value)} disabled={busy || demoActive}><option value="visual">Demo nhập mô phỏng · không ghi phiếu/tồn kho</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.code} · còn {formatNumber(order.totalRemaining)}</option>)}</select></label> : <><label className="twin-po-inline">PHIẾU ĐIỀU CHUYỂN<select value={transferId} onChange={(event) => { setTransferId(event.target.value); const transfer = transfers.find((row) => row.id === event.target.value); if (transfer) setDemoDestinationWarehouseId(transfer.destinationWarehouseId); }} disabled={busy || demoActive}><option value="visual">Demo điều chuyển mô phỏng · không ghi phiếu/tồn kho</option>{outboundTransfers.map((transfer) => <option key={transfer.id} value={transfer.id}>{transfer.code} · {transfer.destinationWarehouse.name}</option>)}</select></label>{transferId === 'visual' && <><label className="twin-po-inline">SẢN PHẨM TỪ TỒN KHO<select value={transferSkuId || visualTransferInventory?.skuId || ''} onChange={(event) => setTransferSkuId(event.target.value)} disabled={busy || demoActive}><option value="">Chọn sản phẩm có tồn</option>{selectableTransferStocks.map((item) => <option key={item.skuId} value={item.skuId}>{item.sku.product.code} · {item.sku.product.name} · khả dụng {formatNumber(item.available)} / tồn {formatNumber(item.onHand)}</option>)}</select></label><label className="twin-po-inline">KHO ĐÍCH<select value={demoDestinationWarehouseId} onChange={(event) => setDemoDestinationWarehouseId(event.target.value)} disabled={busy || demoActive}><option value="">Chọn kho đích</option>{campusWarehouses.filter((warehouse) => warehouse.id !== warehouseId).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.store.name} · {warehouse.name}</option>)}</select></label></>}</>}</div>
    </section>

    <section className="twin-metrics-strip" aria-label="Tóm tắt tồn kho">
      <article><span>TỒN KHO ĐANG CHỌN</span><strong>{loading ? '—' : formatNumber(totalOnHand)}</strong><small>{items.length} sản phẩm · dữ liệu Backend</small></article>
      <article><span>ĐIỀU CHUYỂN CHỜ XỬ LÝ</span><strong>{inboundTransfers.length + outboundTransfers.length}</strong><small>{outboundTransfers.length} phiếu đã duyệt · {inboundTransfers.length} phiếu đến</small></article>
      <article><span>SẢN PHẨM SẮP HẾT</span><strong>{loading ? '...' : lowStockCount}</strong><small>Số SKU dưới mức tồn an toàn</small></article>
    </section>

    <section className="twin-scene-stage" aria-label="Digital Twin kho 3D">
      <aside className="twin-demo-progress" aria-label="Tiến trình demo">
        <header><span className="twin-live-dot"/><strong>{workflow === 'transfer' ? 'ĐIỀU CHUYỂN HÀNG' : 'NHẬP HÀNG'}</strong><small>{demoComplete ? 'Hoàn tất' : demoPaused ? 'Tạm dừng' : demoActive ? `${progressIndex + 1} / ${progressSteps.length}` : 'Sẵn sàng'}</small></header>
        {demoState === 'IDLE' ? <p className="twin-progress-idle">Nhấn Chạy demo để theo dõi từng bước.</p> : <>
          <ol>{progressSteps.slice(0, progressIndex + 1).map((step, index) => {
            const done = demoComplete || index < progressIndex;
            return <li key={step} className={done ? 'done' : 'active'} aria-current={!done ? 'step' : undefined}>
              <span className="twin-progress-marker">{done ? '✓' : index + 1}</span>
              <div><strong>{step}</strong>{!done && <p role="status">{demoPaused ? 'Đã tạm dừng · ' : ''}{currentStep}</p>}</div>
            </li>;
          })}</ol>
          {!demoComplete && progressIndex < progressSteps.length - 1 && <footer>Tiếp theo: {progressSteps[progressIndex + 1]}</footer>}
          {demoComplete && <footer role="status">Đã hoàn thành toàn bộ quy trình.</footer>}
        </>}
      </aside>
      {selectedWarehouse ? <WarehouseTwinScene key={warehouseId} demoRunId={demoRunId} onMotionComplete={handleMotionComplete} warehouseName={`${selectedStore?.name ?? 'CHI NHÁNH'} · ${selectedWarehouse.name}`} destinationWarehouseId={transferDestination?.id ?? ''} campusWarehouses={sceneWarehouses} transferMode={workflow === 'transfer'} items={items.filter((item) => item.onHand > 0).slice(0, 9)} selectedItem={selectedItem} onSelectItem={(item) => { setSelectedItemId(item.id); setSelectedZone('storage-a'); }} selectedZone={selectedZone} onSelectZone={setSelectedZone} demoState={demoState} demoPaused={demoPaused} demoProduct={demoProduct ? { code: demoProduct.code, name: demoProduct.name, unit: demoProduct.unit } : null} demoInventory={sceneDemoInventory ?? undefined}/> : <div className="twin-no-warehouse">{loading ? 'Đang tải dữ liệu kho…' : `Chưa có kho hoạt động thuộc ${selectedStore?.name ?? 'chi nhánh này'}. Hãy chọn chi nhánh có kho.`}</div>}
      {selectedItem && <aside className="twin-object-panel twin-object-overlay" aria-label="Chi ti&#7871;t s&#7843;n ph&#7849;m">
        <div className="twin-panel-title"><span>CHI TI&#7870;T S&#7842;N PH&#7848;M</span><button type="button" aria-label="&#272;&#243;ng chi ti&#7871;t" onClick={() => setSelectedItemId(null)}>&#215;</button></div>
        <h2>{selectedItem.sku.product.name}</h2>
        <p>M&#227; s&#7843;n ph&#7849;m <b>{selectedItem.sku.product.code}</b></p>
        <dl>
          <div><dt>Kho</dt><dd>{sceneWarehouses.find((warehouse) => warehouse.items.some((item) => item.id === selectedItem.id))?.name ?? 'Kho'}</dd></div>
          <div><dt>T&#7891;n th&#7921;c t&#7871;</dt><dd>{formatNumber(selectedItem.onHand)} {selectedItem.sku.product.unit}</dd></div>
          <div><dt>Kh&#7843; d&#7909;ng</dt><dd>{formatNumber(selectedItem.available)} {selectedItem.sku.product.unit}</dd></div>
          <div><dt>&#272;ang gi&#7919;</dt><dd>{formatNumber(Math.max(0, selectedItem.onHand - selectedItem.available))} {selectedItem.sku.product.unit}</dd></div>
          <div><dt>Tr&#7841;ng th&#225;i</dt><dd>{selectedItem.status === 'OUT' ? 'Out of stock' : selectedItem.status === 'LOW' ? 'Low stock' : 'In stock'}</dd></div>
        </dl>
      </aside>}
      <div className="twin-stage-demo-controls">
        <button type="button" className="primary-button" onClick={startDemo} disabled={loading || busy || demoActive || !demoReady} title={!demoReady ? demoUnavailableReason : undefined}>▶ {demoState === 'COMPLETE' ? 'Chạy lại demo' : 'Chạy demo'}</button>
        {demoActive && <button type="button" onClick={() => setDemoPaused(true)} disabled={demoPaused}>Tạm dừng</button>}
        {demoPaused && <button type="button" onClick={() => setDemoPaused(false)}>Tiếp tục</button>}
        {demoState !== 'IDLE' && <button type="button" onClick={resetDemo} disabled={busy}>Reset</button>}
      </div>
    </section>

    <section className="twin-compact-details" aria-label="Thông tin demo">
      <details className="twin-iot-guide">
        <summary>IoT hoạt động ở đâu? <span>RFID nhận / xuất tại mỗi kho · hiện đang giả định</span></summary>
        <ol>
          <li><strong>Khu nhận · RFID NHẬN</strong><span>Xe nâng đưa pallet qua cổng → đọc mã kiện, xác định kho nhận và đối chiếu PO hoặc phiếu điều chuyển.</span></li>
          <li><strong>Khu xuất · RFID XUẤT</strong><span>Pallet qua cổng xuất → đọc mã kiện, đối chiếu hàng cần chuyển trước khi nhân viên xác nhận xuất.</span></li>
          <li><strong>Sau khi quét · xác nhận nghiệp vụ</strong><span>IoT chỉ phát hiện kiện, không tự cộng/trừ tồn. Phiếu thật cập nhật tồn sau khi nhân viên xác nhận; DEMO MODE chỉ lưu event và audit, không ghi phiếu hoặc tồn kho.</span></li>
        </ol>
        <p>Cổng có tia quét xanh khi đến bước RFID. Camera nhận hàng cũng đang giả lập; chưa kết nối đầu đọc RFID hay camera thật.</p>
      </details>
      {latestIotEvent && <div className="twin-inline-confirm twin-iot-event" role="status"><span><strong>RFID DETECTED · {latestIotEvent.source === 'SIMULATED' ? 'MÔ PHỎNG RFID' : 'LIVE IOT'}</strong><small>Thẻ {latestIotEvent.tagId} · device {latestIotEvent.deviceId} · {new Date(latestIotEvent.timestamp).toLocaleString('vi-VN')} · {latestIotEvent.mappedSku ? `${latestIotEvent.mappedSku.product.name} (${latestIotEvent.mappedSku.code})` : 'chưa đối chiếu tag'}{latestIotEvent.palletCode ? ` · pallet ${latestIotEvent.palletCode}` : ''} · chờ xác nhận</small></span><small>Event {latestIotEvent.eventId}</small></div>}
      {(demoState === 'WAITING_DISPATCH_CONFIRM' || demoState === 'WAITING_RECEIVE_CONFIRM') && <div className="twin-inline-confirm"><span>{demoState === 'WAITING_DISPATCH_CONFIRM' ? 'RFID đã phát hiện pallet. Chỉ xác nhận mới ghi xuất kho.' : 'RFID kho đích đã phát hiện pallet. Chỉ xác nhận mới ghi nhận hàng.'}</span><button type="button" className="primary-button" onClick={demoState === 'WAITING_DISPATCH_CONFIRM' ? visualOnlyTransfer ? () => confirmVisualTransferStep('DISPATCHED') : confirmDispatch : visualOnlyTransfer ? () => confirmVisualTransferStep('RECEIVED') : confirmTransferReceipt} disabled={busy}>{busy ? 'Đang cập nhật…' : `${visualOnlyTransfer ? 'Xác nhận mô phỏng' : 'Xác nhận'} ${demoState === 'WAITING_DISPATCH_CONFIRM' ? 'xuất' : 'nhận'}`}</button></div>}
      {workflow === 'inbound' && demoState === 'WAITING_CONFIRMATION' && <div className="twin-inline-confirm"><span>{latestIotEvent ? `Đã phát hiện thẻ ${latestIotEvent.tagId}. ${visualOnlyInbound ? 'Event được lưu audit; demo không ghi phiếu hoặc tồn.' : 'Xác nhận PO để tạo Goods Receipt và PURCHASE_RECEIPT.'}` : 'Đang chờ event RFID từ backend…'}</span>{visualOnlyInbound ? <button type="button" className="primary-button" onClick={confirmVisualInbound} disabled={!latestIotEvent}>Xác nhận mô phỏng</button> : <button type="button" className="primary-button" onClick={confirmReceipt} disabled={!selectedOrder || busy || !latestIotEvent}>{busy ? 'Đang ghi…' : 'Xác nhận nhận hàng'}</button>}</div>}
      <p className="twin-demo-notice"><span className="twin-tag">* DEMO MODE · SIMULATED IOT</span><span>RFID giả lập được gửi tới Backend và lưu trong iot_events/audit log. Xe và xe nâng là mô phỏng; tồn kho chỉ đổi sau khi xác nhận qua API nghiệp vụ.</span>{eventTime && <b>{eventTime} · {currentStep}</b>}</p>
    </section>
    {demoComplete && demoResult && !resultDismissed && <DemoResultDialog result={demoResult} onClose={() => setResultDismissed(true)} />}
  </main>;
}

