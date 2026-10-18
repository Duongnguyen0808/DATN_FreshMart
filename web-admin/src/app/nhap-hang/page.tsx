'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Protected, useAuth } from '../../components/auth-provider';
import { ActionButton } from '../../components/ui/action-button';
import { CurrencyInput } from '../../components/ui/currency-input';
import { Icon } from '../../components/ui/icon';
import { ProductImage } from '../../components/ui/product-image';
import { TablePagination } from '../../components/ui/table-pagination';
import { useToast } from '../../components/ui/toast-provider';
import { errorMessage } from '../../lib/auth-api';
import { getProducts, type Product } from '../../lib/products-api';
import { getWarehouses, type Warehouse } from '../../lib/organization-api';
import { createSupplier, getSuppliers, type Supplier } from '../../lib/suppliers-api';
import * as api from '../../lib/purchase-orders-api';

type SkuOption = { id: string; code: string; barcode: string; name: string; productCode: string; unit: string; imageUrl: string | null; costPrice: number };
type ReceiveLine = { skuId: string; quantity: string; unitCost: string };
const empty: api.GoodsReceiptList = { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 }, summary: { total: 0, totalQuantity: 0, totalAmount: 0 } };
const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(Math.round(value))} đ`;
const dateTime = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const freshLine = (): ReceiveLine => ({ skuId: '', quantity: '1', unitCost: '' });
const supplierCode = () => `SUP-${Date.now().toString().slice(-8)}`;

function SkuPicker({ options, value, excluded, onChange }: { options: SkuOption[]; value: string; excluded: string[]; onChange: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = options.find(item => item.id === value);
  const matches = options.filter(item => (!excluded.includes(item.id) || item.id === value) && `${item.name} ${item.productCode} ${item.code} ${item.barcode}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0, 60);
  return <div className="receive-sku-picker">
    {selected && !open ? <button type="button" className="receive-sku-selected" onClick={() => { setQuery(''); setOpen(true); }}><ProductImage src={selected.imageUrl} name={selected.name}/><span><strong>{selected.name}</strong><small>{selected.productCode} · {selected.unit}</small></span><span className="receive-sku-change">Đổi</span></button> : <>
      <input type="search" autoComplete="off" aria-label="Tìm sản phẩm nhập kho" placeholder="Tìm tên, mã hàng hoặc barcode…" value={query} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true); }}/>
      {open && <div className="receive-sku-options" role="listbox" aria-label="Sản phẩm phù hợp">{matches.length ? matches.map(item => <button type="button" role="option" aria-selected={item.id === value} key={item.id} onMouseDown={event => event.preventDefault()} onClick={() => { onChange(item.id); setQuery(''); setOpen(false); }}><ProductImage src={item.imageUrl} name={item.name}/><span><strong>{item.name}</strong><small>{item.productCode}{item.barcode ? ` · ${item.barcode}` : ''}</small></span></button>) : <p>Không tìm thấy sản phẩm.</p>}<button type="button" className="receive-sku-close" onClick={() => setOpen(false)}>Đóng danh sách</button></div>}
    </>}
  </div>;
}

function GoodsReceiptsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [result, setResult] = useState(empty);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [skus, setSkus] = useState<SkuOption[]>([]);
  const [q, setQ] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [supplierCodeValue, setSupplierCodeValue] = useState(supplierCode());
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<ReceiveLine[]>([freshLine()]);
  const [busy, setBusy] = useState(false);
  const canCreate = Boolean(user?.permissions.includes('purchase_orders.create') && user.permissions.includes('purchase_orders.receive') || user?.permissions.includes('*'));
  const canAddSupplier = Boolean(user?.permissions.includes('suppliers.manage') || user?.permissions.includes('*'));

  const load = async () => {
    setLoading(true); setError('');
    try { setResult(await api.getGoodsReceipts({ q: q.trim() || undefined, supplierId: supplierFilter || undefined, warehouseId: warehouseFilter || undefined, page })); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 200); return () => window.clearTimeout(timer); }, [q, supplierFilter, warehouseFilter, page]);
  useEffect(() => {
    Promise.all([getSuppliers({ active: 'true', page: 1 }), getWarehouses(), getProducts({ active: 'true', page: 1, pageSize: 100 })])
      .then(([supplierRows, warehouseRows, productRows]) => {
        setSuppliers(supplierRows.items);
        setWarehouses(warehouseRows.filter(row => row.active && row.store.active));
        setSkus(productRows.items.flatMap((product: Product) => product.skus.filter(sku => sku.active).map(sku => ({ id: sku.id, code: sku.code, barcode: sku.barcode, name: product.name, productCode: product.code, unit: product.unit, imageUrl: product.imageUrl, costPrice: sku.costPrice }))));
      }).catch(reason => showToast(errorMessage(reason), 'error'));
  }, []);
  useEffect(() => setPage(1), [q, supplierFilter, warehouseFilter]);

  const totalAmount = useMemo(() => lines.reduce((sum, line) => sum + Math.max(0, Number(line.quantity) || 0) * Math.max(0, Number(line.unitCost) || 0), 0), [lines]);
  const updateLine = (index: number, update: Partial<ReceiveLine>) => setLines(current => current.map((line, i) => i === index ? { ...line, ...update } : line));
  const resetForm = () => { setSelectedSupplier(''); setWarehouseId(''); setNote(''); setLines([freshLine()]); };

  const submitReceipt = async (event: FormEvent) => {
    event.preventDefault();
    const validLines = lines.filter(line => line.skuId && Number.isInteger(Number(line.quantity)) && Number(line.quantity) > 0 && Number(line.unitCost) > 0);
    if (!selectedSupplier || !warehouseId || !validLines.length || validLines.length !== lines.length) { showToast('Chọn nhà cung cấp, kho, sản phẩm, số lượng và giá nhập hợp lệ.', 'error'); return; }
    setBusy(true);
    let order: api.PurchaseOrder | null = null;
    try {
      order = await api.createPurchaseOrder({ supplierId: selectedSupplier, warehouseId, note: note.trim() || undefined, items: validLines.map(line => ({ skuId: line.skuId, quantity: Number(line.quantity), unitCost: Number(line.unitCost) })) });
      try {
        await api.receivePurchaseOrder(order.id, { note: note.trim() || undefined, items: order.items.map(item => ({ purchaseOrderItemId: item.id, quantity: item.orderedQuantity })) });
      } catch (reason) {
        showToast(`Đã tạo phiếu mua ${order.code} nhưng chưa nhập kho: ${errorMessage(reason)}`, 'error');
        router.push(`/don-mua-hang/${order.id}`);
        return;
      }
      showToast(`Đã nhập ${validLines.reduce((sum, line) => sum + Number(line.quantity), 0)} sản phẩm vào kho.`);
      setFormOpen(false); resetForm(); await load();
    } catch (reason) { showToast(errorMessage(reason), 'error'); }
    finally { setBusy(false); }
  };

  const submitSupplier = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const created = await createSupplier({ code: String(data.get('code')).trim(), name: String(data.get('name')).trim(), contactName: String(data.get('contactName')).trim(), phone: String(data.get('phone')).trim(), email: String(data.get('email')).trim(), address: String(data.get('address')).trim(), currentDebt: 0 });
      setSuppliers(current => [...current, created].sort((a, b) => a.name.localeCompare(b.name, 'vi')));
      setSelectedSupplier(created.id); setSupplierOpen(false); showToast('Đã thêm nhà cung cấp và chọn cho phiếu nhập.');
    } catch (reason) { showToast(errorMessage(reason), 'error'); }
    finally { setBusy(false); }
  };

  return <div className="suite-page goods-receipts-page">
    <header className="suite-heading"><div><div className="breadcrumb">Nhập hàng &amp; nhà cung cấp <span>›</span> Nhập hàng</div><h1>Nhập hàng</h1><p>Chọn nhà cung cấp, sản phẩm và xác nhận số lượng thực nhận để cập nhật kho.</p></div>{canCreate && <ActionButton tone="approve" onClick={() => { resetForm(); setFormOpen(true); }}><Icon name="add"/> Nhập hàng mới</ActionButton>}</header>
    <section className="suite-panel panel">
      <div className="suite-filters"><label><Icon name="search"/><input value={q} onChange={event => setQ(event.target.value)} placeholder="Tìm phiếu nhập hoặc nhà cung cấp…"/></label><select aria-label="Lọc nhà cung cấp" value={supplierFilter} onChange={event => setSupplierFilter(event.target.value)}><option value="">Tất cả nhà cung cấp</option>{suppliers.map(row => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select><select aria-label="Lọc kho nhập" value={warehouseFilter} onChange={event => setWarehouseFilter(event.target.value)}><option value="">Tất cả kho</option>{warehouses.map(row => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select><button type="button" onClick={() => { setQ(''); setSupplierFilter(''); setWarehouseFilter(''); }}>Xóa lọc</button></div>
      {error && <div className="ui-error" role="alert">{error} <button type="button" onClick={() => void load()}>Thử lại</button></div>}
      <div className="goods-receipt-summary"><strong>{result.pagination.total} phiếu nhập</strong><span>{result.summary.totalQuantity.toLocaleString('vi-VN')} sản phẩm đã nhập</span><b>{money(result.summary.totalAmount)}</b></div>
      <div className="table-scroll"><table><thead><tr><th>Mã nhập hàng</th><th>Thời gian</th><th>Mã NCC</th><th>Nhà cung cấp</th><th>Kho nhận</th><th className="numeric">Số lượng</th><th className="numeric">Giá trị nhập</th><th>Người nhập</th><th>Trạng thái</th></tr></thead><tbody>{loading ? <tr><td colSpan={9}>Đang tải phiếu nhập…</td></tr> : result.items.length ? result.items.map(row => <tr key={row.id} className="clickable-row" tabIndex={0} onClick={() => router.push(`/don-mua-hang/${row.purchaseOrder.id}`)} onKeyDown={event => { if (event.key === 'Enter') router.push(`/don-mua-hang/${row.purchaseOrder.id}`); }}><td><strong>{row.code}</strong><small>PO {row.purchaseOrder.code}</small></td><td>{dateTime(row.receivedAt)}</td><td><code>{row.purchaseOrder.supplier.code}</code></td><td>{row.purchaseOrder.supplier.name}</td><td><strong>{row.purchaseOrder.warehouse.name}</strong><small>{row.purchaseOrder.warehouse.store.name}</small></td><td className="numeric">{row.totalQuantity.toLocaleString('vi-VN')}</td><td className="numeric"><strong>{money(row.totalAmount)}</strong></td><td>{row.receivedBy.name}</td><td><span className="goods-receipt-status">Đã nhập hàng</span></td></tr>) : <tr><td colSpan={9}>Chưa có phiếu nhập hàng phù hợp.</td></tr>}</tbody></table></div>
      <TablePagination page={page} totalPages={result.pagination.totalPages} shown={result.items.length} total={result.pagination.total} noun="phiếu nhập" onChange={setPage}/>
    </section>

    {formOpen && <div className="ui-modal" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setFormOpen(false); }}><form className="ui-modal-card receive-create-modal" onSubmit={submitReceipt}><header><div><h2>Nhập hàng mới</h2><p>Chọn nhà cung cấp và kho, thêm sản phẩm rồi xác nhận nhập.</p></div><button type="button" disabled={busy} onClick={() => setFormOpen(false)}>×</button></header>
      <div className="form-grid"><label>Nhà cung cấp<select required value={selectedSupplier} onChange={event => setSelectedSupplier(event.target.value)}><option value="">Chọn nhà cung cấp</option>{suppliers.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label><div className="receive-add-supplier">{canAddSupplier && <button type="button" onClick={() => { setSupplierCodeValue(supplierCode()); setSupplierOpen(true); }}><Icon name="add" size={15}/> + Thêm nhà cung cấp mới</button>}</div>
        <label className="full">Kho nhận<select required value={warehouseId} onChange={event => setWarehouseId(event.target.value)}><option value="">Chọn kho nhập hàng</option>{warehouses.map(item => <option key={item.id} value={item.id}>{item.store.name} · {item.code} · {item.name}</option>)}</select></label></div>
      <fieldset className="receive-lines"><legend>Sản phẩm nhập</legend><div className="receive-line-list">{lines.map((line, index) => { const selected = skus.find(item => item.id === line.skuId); return <div className="receive-line" key={index}><div className="receive-line-product"><SkuPicker options={skus} value={line.skuId} excluded={lines.map(item => item.skuId).filter(Boolean)} onChange={id => { const sku = skus.find(item => item.id === id); updateLine(index, { skuId: id, unitCost: String(sku?.costPrice ?? '') }); }}/></div><label>Số lượng<input type="number" min="1" step="1" required value={line.quantity} onChange={event => updateLine(index, { quantity: event.target.value })}/></label><label>Giá nhập / {selected?.unit ?? 'đơn vị'}<CurrencyInput min={1} required value={line.unitCost} onChange={value => updateLine(index, { unitCost: value })}/></label><button type="button" className="receive-line-remove" disabled={lines.length === 1} aria-label="Xóa sản phẩm" onClick={() => setLines(current => current.filter((_, i) => i !== index))}>×</button></div>; })}</div><button className="receive-add-line" type="button" onClick={() => setLines(current => [...current, freshLine()])}>+ Thêm sản phẩm</button><div className="receive-total"><span>Tổng tiền nhập</span><strong>{money(totalAmount)}</strong></div></fieldset>
      <label className="receive-note">Ghi chú (không bắt buộc)<textarea maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder="Ví dụ: nhận đủ, thiếu hàng hoặc hàng hư hỏng…"/></label>
      <footer><ActionButton tone="more" type="button" disabled={busy} onClick={() => setFormOpen(false)}>Đóng</ActionButton><ActionButton tone="approve" type="submit" disabled={busy || !skus.length}>{busy ? 'Đang nhập…' : 'Xác nhận nhập kho'}</ActionButton></footer>
    </form></div>}

    {supplierOpen && <div className="ui-modal receive-supplier-modal" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setSupplierOpen(false); }}><form className="ui-modal-card" onSubmit={submitSupplier}><header><div><h2>Thêm nhà cung cấp</h2><p>Sau khi lưu, nhà cung cấp sẽ được chọn cho phiếu nhập này.</p></div><button type="button" disabled={busy} onClick={() => setSupplierOpen(false)}>×</button></header><div className="form-grid"><label>Mã nhà cung cấp<input name="code" required minLength={2} maxLength={30} pattern="[A-Za-z0-9_-]+" value={supplierCodeValue} onChange={event => setSupplierCodeValue(event.target.value)}/></label><label>Tên nhà cung cấp<input name="name" required minLength={2} maxLength={200}/></label><label>Người liên hệ<input name="contactName" required minLength={2} maxLength={120}/></label><label>Số điện thoại<input name="phone" required minLength={8} maxLength={30}/></label><label>Email<input name="email" type="email" required maxLength={254}/></label><label className="full">Địa chỉ<input name="address" required minLength={3} maxLength={300}/></label></div><footer><ActionButton tone="more" type="button" disabled={busy} onClick={() => setSupplierOpen(false)}>Đóng</ActionButton><ActionButton tone="approve" type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu nhà cung cấp'}</ActionButton></footer></form></div>}
  </div>;
}

export default function Page() { return <Protected permission="purchase_orders.read"><GoodsReceiptsPage/></Protected>; }
