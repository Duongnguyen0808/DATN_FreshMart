'use client';
import { TableState } from '../../components/ui/table-state';
import { ProductIdentity } from '../../components/ui/product-image';
import { CurrencyInput } from '../../components/ui/currency-input';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../components/auth-provider';
import { ActionButton, ActionLink } from '../../components/ui/action-button';
import { Icon } from '../../components/ui/icon';
import { MetricCard, MetricGrid } from '../../components/ui/metric-card';
import { FilterToolbar, PageHeader, PanelCard } from '../../components/ui/page-kit';
import { StatusBadge, type StatusTone } from '../../components/ui/status-badge';
import { TabBar, type TabItem } from '../../components/ui/tab-bar';
import { TablePagination } from '../../components/ui/table-pagination';
import { useToast } from '../../components/ui/toast-provider';
import { errorMessage } from '../../lib/auth-api';
import { getWarehouses, type Warehouse } from '../../lib/organization-api';
import { getSuppliers, type Supplier } from '../../lib/suppliers-api';
import { getPurchaseRequests, type PurchaseRequest } from '../../lib/purchase-requests-api';
import { getProducts, type Product } from '../../lib/products-api';
import * as api from '../../lib/purchase-orders-api';

type Filter = 'all' | api.PurchaseOrderStatus;
type PriceLine = { skuId: string; quantity: number; unitCost: number };
const empty: api.PurchaseOrderList = { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 }, summary: { total: 0, open: 0, completed: 0, totalAmount: 0 } };
const labels: Record<api.PurchaseOrderStatus, string> = { OPEN: 'Chờ nhận', COMPLETED: 'Hoàn thành' };
const tones: Record<api.PurchaseOrderStatus, StatusTone> = { OPEN: 'amber', COMPLETED: 'green' };
const tabs: TabItem<Filter>[] = [{ value: 'all', label: 'Tất cả', tone: 'violet' }, { value: 'OPEN', label: 'Chờ nhận', tone: 'amber' }, { value: 'COMPLETED', label: 'Hoàn thành', tone: 'green' }];
const money = (value: number) => new Intl.NumberFormat('vi-VN').format(value) + ' đ';
const date = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' }).format(new Date(value));

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const { user } = useAuth(); const { showToast } = useToast();
  const [result, setResult] = useState(empty); const [requests, setRequests] = useState<PurchaseRequest[]>([]); const [products, setProducts] = useState<Product[]>([]); const [suppliers, setSuppliers] = useState<Supplier[]>([]); const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [q, setQ] = useState(''); const [status, setStatus] = useState<Filter>('all'); const [supplierId, setSupplierId] = useState(''); const [warehouseId, setWarehouseId] = useState(''); const [page, setPage] = useState(1); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [open, setOpen] = useState(false); const [requestId, setRequestId] = useState(''); const [createSupplier, setCreateSupplier] = useState(''); const [createWarehouse, setCreateWarehouse] = useState(''); const [note, setNote] = useState(''); const [lines, setLines] = useState<PriceLine[]>([]); const [busy, setBusy] = useState(false);
  const canCreate = Boolean(user?.permissions.includes('purchase_orders.create') || user?.permissions.includes('*'));
  const load = async () => { setLoading(true); setError(''); try { setResult(await api.getPurchaseOrders({ q: q.trim() || undefined, status, supplierId: supplierId || undefined, warehouseId: warehouseId || undefined, page })); } catch (reason) { setError(errorMessage(reason)); } finally { setLoading(false); } };
  useEffect(() => { Promise.all([getPurchaseRequests({ status: 'READY' }), getSuppliers({ active: 'true' }), getWarehouses(), getProducts({ active: 'true', pageSize: 100 })]).then(([purchaseRequests, supplierResult, warehouseResult, productResult]) => { setRequests(purchaseRequests.items); setSuppliers(supplierResult.items); setWarehouses(warehouseResult.filter(item => item.active)); setProducts(productResult.items); }).catch(reason => setError(errorMessage(reason))); }, []);
  useEffect(() => { const timer = setTimeout(load, 250); return () => clearTimeout(timer); }, [q, status, supplierId, warehouseId, page]);
  useEffect(() => setPage(1), [q, status, supplierId, warehouseId]);
  const selectedRequest = useMemo(() => requests.find(item => item.id === requestId), [requests, requestId]);
  const availableWarehouses = selectedRequest ? warehouses.filter(item => item.storeId === selectedRequest.store.id) : warehouses;
  const chooseRequest = (id: string) => { setRequestId(id); const selected = requests.find(item => item.id === id); setCreateWarehouse(''); setLines(selected?.items.map(item => ({ skuId: item.skuId, quantity: item.approvedQuantity ?? 0, unitCost: Number((item.sku as unknown as { costPrice?: number }).costPrice ?? 0) })) ?? []); };
  const total = lines.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
  const reset = () => { setRequestId(''); setCreateSupplier(''); setCreateWarehouse(''); setNote(''); setLines([]); };
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); try { const created = await api.createPurchaseOrder({ purchaseRequestId: requestId || undefined, supplierId: createSupplier, warehouseId: createWarehouse, note: note || undefined, items: lines }); showToast(`Đã tạo đơn mua hàng ${created.code}.`); setOpen(false); reset(); if (requestId) { const approved = await getPurchaseRequests({ status: 'READY' }); setRequests(approved.items); } await load(); } catch (reason) { showToast(errorMessage(reason), 'error'); } finally { setBusy(false); } };
  const tabCount = (value: Filter) => value === 'all' ? result.summary.total : value === 'OPEN' ? result.summary.open : result.summary.completed;
  return <div className="suite-page purchase-order-page">
    <PageHeader
      breadcrumbs={['Mua hàng', 'Đơn mua hàng']}
      title="Đơn mua hàng"
      description="Theo dõi đơn đặt nhà cung cấp và tiến độ nhận hàng."
      actions={canCreate ? <ActionButton tone="approve" onClick={() => setOpen(true)}><Icon name="add" /> Tạo đơn mua hàng</ActionButton> : undefined}
    />
    <MetricGrid className="suite-kpis"><MetricCard tone="blue" label="TỔNG ĐƠN MUA HÀNG" value={result.summary.total} /><MetricCard tone="amber" label="CHỜ NHẬN" value={result.summary.open} /><MetricCard tone="green" label="HOÀN THÀNH" value={result.summary.completed} /><MetricCard tone="blue" label="TỔNG GIÁ TRỊ" value={money(result.summary.totalAmount)} /></MetricGrid>
    <PanelCard>
      <TabBar value={status} onChange={setStatus} items={tabs.map(item => ({ ...item, count: tabCount(item.value) }))} />
      <FilterToolbar searchValue={q} onSearchChange={setQ} searchPlaceholder="Tìm mã đơn mua hàng, đề nghị, nhà cung cấp hoặc kho..." onClear={() => { setQ(''); setStatus('all'); setSupplierId(''); setWarehouseId(''); }}>
        <select value={supplierId} onChange={event => setSupplierId(event.target.value)}><option value="">Tất cả nhà cung cấp</option>{suppliers.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select>
        <select value={warehouseId} onChange={event => setWarehouseId(event.target.value)}><option value="">Tất cả kho</option>{warehouses.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select>
      </FilterToolbar>
      {error && <div className="ui-error">{error} <button onClick={load}>Thử lại</button></div>}<div className="table-scroll"><table><thead><tr><th>Mã đơn mua hàng</th><th>Nhà cung cấp</th><th>Kho nhận</th><th className="numeric">Giá trị</th><th>Tiến độ nhận</th><th>Trạng thái</th></tr></thead><tbody>{loading ? <tr><td colSpan={6}><TableState message="Đang tải đơn mua hàng…" loading/></td></tr> : !result.items.length ? <tr><td colSpan={6}><TableState message="Chưa có đơn mua hàng phù hợp."/></td></tr> : result.items.map(order => <tr key={order.id} className="clickable-row" tabIndex={0} onClick={() => router.push(`/don-mua-hang/${order.id}`)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); router.push(`/don-mua-hang/${order.id}`); } }}><td><strong className="document-code">{order.code}</strong><small>Từ {order.purchaseRequest?.code ?? 'Mua tr&#7921;c ti&#7871;p'}</small></td><td><strong>{order.supplier.name}</strong><small>{order.supplier.code}</small></td><td><strong>{order.warehouse.name}</strong><small>{order.warehouse.store.name}</small></td><td className="numeric"><strong>{money(order.totalAmount)}</strong></td><td><div className="po-progress"><span style={{ width: `${order.progressPercent}%` }} /></div><small>{order.totalReceived}/{order.totalOrdered} · còn {order.totalRemaining}</small></td><td><StatusBadge tone={tones[order.status]}>{labels[order.status]}</StatusBadge></td></tr>)}</tbody></table></div><TablePagination page={page} totalPages={result.pagination.totalPages} shown={result.items.length} total={result.pagination.total} noun="đơn mua hàng" onChange={setPage} /></PanelCard>
    {open && <div className="ui-modal"><form className="ui-modal-card po-create-modal" onSubmit={submit}><header><div><h2>Tạo đơn mua hàng</h2><p>Chọn đề nghị sẵn sàng; số lượng đặt phải đúng số lượng đề nghị.</p></div><button type="button" onClick={() => setOpen(false)}>×</button></header><div className="form-grid record-form-grid"><h3 className="record-form-title">Thông tin đặt hàng</h3><label className="full">Đề nghị mua<select required value={requestId} onChange={event => chooseRequest(event.target.value)}><option value="">Chọn đề nghị sẵn sàng</option>{requests.map(item => <option key={item.id} value={item.id}>{item.code} · {item.store.name} · {item.totalApproved} sản phẩm</option>)}</select></label><label>Nhà cung cấp<select required value={createSupplier} onChange={event => setCreateSupplier(event.target.value)}><option value="">Chọn nhà cung cấp</option>{suppliers.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label><label>Kho nhận<select required value={createWarehouse} onChange={event => setCreateWarehouse(event.target.value)}><option value="">Chọn kho của chi nhánh</option>{availableWarehouses.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label><label className="full">Ghi chú (không bắt buộc)<textarea maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></label></div>{selectedRequest && <fieldset><legend>Sản phẩm sẵn sàng</legend><div className="po-form-lines">{selectedRequest.items.map((item, index) => <div key={item.id}><span><ProductIdentity name={item.sku.product.name} code={item.sku.product.code} imageUrl={item.sku.product.imageUrl}/></span><label>Giá nhập<CurrencyInput required min={1} value={String(lines[index]?.unitCost ?? 0)} onChange={value => setLines(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, unitCost: Number(value) } : line))} /></label></div>)}</div><div className="po-form-total"><span>Tổng giá trị đơn mua hàng</span><strong>{money(total)}</strong></div></fieldset>}<footer><ActionButton tone="more" onClick={() => setOpen(false)}>Đóng</ActionButton><ActionButton tone="approve" type="submit" disabled={busy || !lines.length}>{busy ? 'Đang tạo…' : 'Tạo đơn mua hàng'}</ActionButton></footer></form></div>}
  </div>;
}
