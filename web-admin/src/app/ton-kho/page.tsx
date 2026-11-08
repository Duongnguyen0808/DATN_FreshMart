'use client';
import { TableState } from '../../components/ui/table-state';
import { useStockReceiptRefresh } from '../../lib/use-stock-receipt-refresh';
import { ForecastAlertBadge, ForecastShortageBanner, useForecastShortages } from '../../components/forecast-shortage-alert';
import { ProductIdentity } from '../../components/ui/product-image';
import { useEffect, useState } from 'react';
import { ActionLink } from '../../components/ui/action-button';
import { MetricCard, MetricGrid } from '../../components/ui/metric-card';
import { FilterToolbar, PageHeader, PanelCard } from '../../components/ui/page-kit';
import { StatusBadge, StockReceiptLabel, type StatusTone } from '../../components/ui/status-badge';
import { TabBar, type TabItem } from '../../components/ui/tab-bar';
import { TablePagination } from '../../components/ui/table-pagination';
import { errorMessage } from '../../lib/auth-api';
import { getCategories, type Category } from '../../lib/products-api';
import { getStores, getWarehouses, type Store, type Warehouse } from '../../lib/organization-api';
import * as inventoryApi from '../../lib/inventory-api';
type Filter = 'all' | inventoryApi.InventoryStatus;
const number = (value: number) => new Intl.NumberFormat('vi-VN').format(value); const money = (value: number) => number(value) + ' đ';
const tabs: TabItem<Filter>[] = [{ value: 'all', label: 'Tất cả', tone: 'blue' }, { value: 'AVAILABLE', label: 'Khả dụng', tone: 'green' }, { value: 'LOW', label: 'Dưới an toàn', tone: 'amber' }, { value: 'OUT', label: 'Hết hàng', tone: 'red' }];
const statusName: Record<inventoryApi.InventoryStatus, string> = { AVAILABLE: 'Đủ hàng', LOW: 'Dưới an toàn', OUT: 'Hết hàng' };
const statusTone: Record<inventoryApi.InventoryStatus, StatusTone> = { AVAILABLE: 'green', LOW: 'amber', OUT: 'red' };
export default function InventoryPage() {
  const [result, setResult] = useState<inventoryApi.InventoryList>({ items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 }, summary: { totalSku: 0, available: 0, low: 0, out: 0, stockValue: 0 } });
  const [stores, setStores] = useState<Store[]>([]); const [warehouses, setWarehouses] = useState<Warehouse[]>([]); const [categories, setCategories] = useState<Category[]>([]);
  const [query, setQuery] = useState(''); const [status, setStatus] = useState<Filter>('all'); const [storeId, setStoreId] = useState(''); const [warehouseId, setWarehouseId] = useState(''); const [categoryId, setCategoryId] = useState(''); const [page, setPage] = useState(1); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const selectedStore = storeId || warehouses.find(item => item.id === warehouseId)?.storeId || '';
  const forecastAlerts = useForecastShortages(selectedStore);
  const [forecastOnly, setForecastOnly] = useState(false);
  const forecastKey = forecastAlerts.items.map(item => `${item.storeId}:${item.skuId}`).sort().join(',');
  const load = async () => { setLoading(true); setError(''); try {
    const filters = { q: query.trim() || undefined, status, storeId: storeId || undefined, warehouseId: warehouseId || undefined, categoryId: categoryId || undefined };
    if (!forecastOnly) setResult(await inventoryApi.getInventory({ ...filters, page }));
    else {
      const first = await inventoryApi.getInventory({ ...filters, page: 1, pageSize: 100 });
      const rest = await Promise.all(Array.from({ length: first.pagination.totalPages - 1 }, (_, index) => inventoryApi.getInventory({ ...filters, page: index + 2, pageSize: 100 })));
      const keys = new Set(forecastKey.split(',').filter(Boolean));
      const rows = [first, ...rest].flatMap(result => result.items).filter(item => keys.has(`${item.warehouse.store.id}:${item.skuId}`));
      setResult({ ...first, items: rows.slice((page - 1) * 20, page * 20), pagination: { page, pageSize: 20, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / 20)) } });
    }
  } catch (reason) { setError(errorMessage(reason)); } finally { setLoading(false); } };
  useStockReceiptRefresh(() => { if (page !== 1) setPage(1); else void load(); });
  useEffect(() => { Promise.all([getStores(), getWarehouses(), getCategories('all')]).then(([a,b,c]) => { setStores(a); setWarehouses(b); setCategories(c); }).catch(reason => setError(errorMessage(reason))); }, []);
  useEffect(() => { const timer = window.setTimeout(load, 250); return () => window.clearTimeout(timer); }, [query, status, storeId, warehouseId, categoryId, page, forecastOnly, forecastKey]); useEffect(() => setPage(1), [query, status, storeId, warehouseId, categoryId]);
  const clear = () => { setQuery(''); setStatus('all'); setStoreId(''); setWarehouseId(''); setCategoryId(''); };
  return <div className="suite-page inventory-connected-page">
    <PageHeader
      breadcrumbs={['Hàng hóa', 'Tồn kho']}
      title="Tồn kho toàn chuỗi"
      description="Theo dõi tồn hiện tại, khả dụng, đang chuyển, đang về và truy vết từng biến động."
      actions={<ActionLink tone="view" href="/lich-su-ton-kho">{'L\u1ecbch s\u1eed bi\u1ebfn \u0111\u1ed9ng'}</ActionLink>}
    />
    <ForecastShortageBanner {...forecastAlerts} scopeNote={warehouseId ? 'Dự báo theo chi nhánh, chưa phân bổ riêng cho từng kho' : undefined} filtered={forecastOnly} onFilter={() => { setPage(1); setForecastOnly(value => !value); }}/>
    <MetricGrid className="suite-kpis" label="Chỉ số tồn kho"><MetricCard tone="blue" label="sản phẩm THEO KHO" value={number(result.summary.totalSku)} caption="Mỗi sản phẩm được quản lý riêng tại từng kho"/><MetricCard tone="indigo" label="GIÁ TRỊ TỒN" value={money(result.summary.stockValue)} caption="Theo giá vốn hiện tại"/><MetricCard tone="amber" label="DƯỚI MỨC AN TOÀN" value={number(result.summary.low)} caption="Còn hàng nhưng cần theo dõi"/><MetricCard tone="red" label="HẾT HÀNG" value={number(result.summary.out)} caption="Tồn khả dụng bằng 0"/></MetricGrid>
    <PanelCard>
      <TabBar value={status} onChange={setStatus} label="Lọc trạng thái tồn" items={tabs.map(tab => ({ ...tab, count: tab.value === 'all' ? result.summary.totalSku : tab.value === 'AVAILABLE' ? result.summary.available : tab.value === 'LOW' ? result.summary.low : result.summary.out }))}/>
      <FilterToolbar searchValue={query} onSearchChange={setQuery} searchPlaceholder="Tìm tên, mã sản phẩm, barcode hoặc kho..." onClear={clear}>
        <select value={storeId} onChange={event => { setStoreId(event.target.value); setWarehouseId(''); }}><option value="">Tất cả chi nhánh</option>{stores.map(store => <option key={store.id} value={store.id}>{store.code} · {store.name}</option>)}</select>
        <select value={warehouseId} onChange={event => setWarehouseId(event.target.value)}><option value="">Tất cả kho</option>{warehouses.filter(row => !storeId || row.storeId === storeId).map(row => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select>
        <select value={categoryId} onChange={event => setCategoryId(event.target.value)}><option value="">Tất cả danh mục</option>{categories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
      </FilterToolbar>
      {error && <div className="ui-error" role="alert">{error} <button onClick={load}>Thử lại</button></div>}
      <div className="table-scroll"><table><thead><tr><th>Sản phẩm / Mã sản phẩm</th><th>Chi nhánh / Kho</th><th className="numeric">Tồn hiện tại</th><th className="numeric">Khả dụng</th><th className="numeric">Đang chuyển</th><th className="numeric">Đang về</th><th className="numeric">An toàn</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{loading ? <tr><td colSpan={9}><TableState message="Đang tải tồn kho…" loading/></td></tr> : result.items.length === 0 ? <tr><td colSpan={9}><TableState message="Chưa có tồn kho phù hợp."/></td></tr> : result.items.map(item => <tr key={item.id}><td><ProductIdentity name={item.sku.product.name} code={item.sku.product.code} imageUrl={item.sku.product.imageUrl}/><StockReceiptLabel at={item.lastReceivedAt} quantity={item.lastReceivedQuantity} unit={item.sku.product.unit}/></td><td><strong>{item.warehouse.store.name}</strong><small>{item.warehouse.code} · {item.warehouse.name}</small></td><td className="numeric"><strong>{number(item.onHand)}</strong></td><td className="numeric"><strong>{number(item.available)}</strong></td><td className="numeric">{number(item.inTransfer)}</td><td className="numeric">{number(item.incoming)}</td><td className="numeric">{number(item.safetyStock)}</td><td><StatusBadge tone={statusTone[item.status]}>{statusName[item.status]}</StatusBadge>{forecastAlerts.items.filter(alert => alert.storeId === item.warehouse.store.id && alert.skuId === item.skuId).map(alert => <ForecastAlertBadge key={alert.skuId} item={alert}/>)}</td><td><ActionLink tone="view" href={`/ton-kho/${item.id}`}>Lịch sử</ActionLink></td></tr>)}</tbody></table></div><TablePagination page={page} totalPages={result.pagination.totalPages} shown={result.items.length} total={result.pagination.total} noun="dòng tồn" onChange={setPage}/>
    </PanelCard></div>;
}
