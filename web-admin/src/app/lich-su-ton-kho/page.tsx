'use client';
import { ProductIdentity } from '../../components/ui/product-image';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../components/auth-provider';
import { ActionLink } from '../../components/ui/action-button';
import { Icon } from '../../components/ui/icon';
import { StatusBadge, type StatusTone } from '../../components/ui/status-badge';
import { TablePagination } from '../../components/ui/table-pagination';
import { errorMessage } from '../../lib/auth-api';
import { getInventoryLedger, type InventoryTransactionType, type TransactionList } from '../../lib/inventory-api';
import { getWarehouses, type Warehouse } from '../../lib/organization-api';

type Filter = 'all' | InventoryTransactionType;
const types: { value: Filter; label: string; tone: StatusTone }[] = [
  { value: 'all', label: 'Tất cả nghiệp vụ', tone: 'blue' },
  { value: 'OPENING', label: 'Số dư đầu kỳ', tone: 'blue' },
  { value: 'SALE', label: 'Bán hàng', tone: 'red' },
  { value: 'SALE_CANCEL', label: 'Hoàn do hủy hóa đơn', tone: 'green' },
  { value: 'SALE_RETURN', label: 'Trả hàng', tone: 'green' },
  { value: 'STOCKTAKE', label: 'Kiểm kho', tone: 'amber' },
  { value: 'STOCK_ADJUSTMENT', label: 'Điều chỉnh tồn', tone: 'amber' },
  { value: 'TRANSFER_OUT', label: 'Xuất điều chuyển', tone: 'violet' },
  { value: 'TRANSFER_IN', label: 'Nhập điều chuyển', tone: 'violet' },
  { value: 'PURCHASE_RECEIPT', label: 'Nhập hàng mua', tone: 'cyan' },
];
const byType = Object.fromEntries(types.map(type => [type.value, type])) as Record<Filter, (typeof types)[number]>;
const number = (value: number) => new Intl.NumberFormat('vi-VN').format(value);
const dateTime = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const empty: TransactionList = { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } };

export default function InventoryLedgerPage() {
  const { user } = useAuth();
  const requestId = useRef(0);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [result, setResult] = useState<TransactionList>(empty);
  const [query, setQuery] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [type, setType] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    const current = ++requestId.current;
    setLoading(true); setError('');
    try {
      const data = await getInventoryLedger({ q: query.trim() || undefined, warehouseId: warehouseId || undefined, type, page });
      if (current === requestId.current) setResult(data);
    } catch (cause) { if (current === requestId.current) setError(errorMessage(cause)); }
    finally { if (current === requestId.current) setLoading(false); }
  };

  useEffect(() => {
    getWarehouses().then(rows => setWarehouses(rows.filter(row => user?.globalAccess || user?.stores.some(store => store.id === row.storeId))))
      .catch(cause => setError(errorMessage(cause)));
  }, [user]);
  useEffect(() => { const timer = window.setTimeout(load, 250); return () => { window.clearTimeout(timer); requestId.current++; }; }, [query, warehouseId, type, page]);
  useEffect(() => setPage(1), [query, warehouseId, type]);

  return <div className="suite-page inventory-ledger-page">
    <header className="suite-heading"><div><div className="breadcrumb"><Link href="/ton-kho">Hàng hóa</Link><span>›</span> Lịch sử tồn kho</div><h1>Lịch sử biến động tồn kho</h1><p>Tra cứu số trước, số sau, nguyên nhân và người thực hiện của từng giao dịch kho.</p></div><ActionLink tone="view" href="/ton-kho">Về danh sách tồn kho</ActionLink></header>
    <section className="suite-panel panel">
      <div className="suite-filters inventory-ledger-filters">
        <label><Icon name="search"/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm sản phẩm, barcode, sản phẩm, chứng từ hoặc lý do..."/></label>
        <select aria-label="Kho" value={warehouseId} onChange={event => setWarehouseId(event.target.value)}><option value="">Tất cả kho</option>{warehouses.map(row => <option key={row.id} value={row.id}>{row.store.name} · {row.name}</option>)}</select>
        <select aria-label="Nghiệp vụ" value={type} onChange={event => setType(event.target.value as Filter)}>{types.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        <button type="button" onClick={() => { setQuery(''); setWarehouseId(''); setType('all'); }}>Xóa lọc</button>
      </div>
      {error && <div className="ui-error" role="alert">{error} <button type="button" onClick={load}>Thử lại</button></div>}
      <div className="table-scroll"><table><thead><tr><th>Thời gian</th><th>Sản phẩm / Mã sản phẩm</th><th>Chi nhánh / Kho</th><th>Nghiệp vụ</th><th>Chứng từ</th><th>Nguyên nhân</th><th>Người thực hiện</th><th className="numeric">Trước</th><th className="numeric">Thay đổi</th><th className="numeric">Sau</th><th>Thao tác</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={11}>Đang tải lịch sử tồn kho…</td></tr> : result.items.length === 0 ? <tr><td colSpan={11}>Không có biến động phù hợp bộ lọc.</td></tr> : result.items.map(row => <tr key={row.id}>
          <td>{dateTime(row.occurredAt)}</td><td><ProductIdentity name={row.sku.product.name} code={row.sku.product.code} imageUrl={row.sku.product.imageUrl}/></td><td><strong>{row.warehouse.store.name}</strong><small>{row.warehouse.code} · {row.warehouse.name}</small></td>
          <td><StatusBadge tone={byType[row.type as Filter]?.tone ?? 'blue'}>{byType[row.type as Filter]?.label ?? row.type}</StatusBadge></td><td><code>{row.referenceId}</code></td><td className="inventory-ledger-reason">{row.reason}</td><td>{row.actor?.name ?? 'Hệ thống'}</td>
          <td className="numeric">{number(row.beforeQuantity)}</td><td className={`numeric ${row.quantity > 0 ? 'positive' : 'negative'}`}><strong>{row.quantity > 0 ? '+' : ''}{number(row.quantity)}</strong></td><td className="numeric"><strong>{number(row.afterQuantity)}</strong></td>
          <td><ActionLink tone="view" href={`/ton-kho/${row.inventoryId}`}>Xem tồn kho</ActionLink></td>
        </tr>)}
      </tbody></table></div>
      <TablePagination page={page} totalPages={result.pagination.totalPages} shown={result.items.length} total={result.pagination.total} noun="giao dịch kho" onChange={setPage}/>
    </section>
  </div>;
}
