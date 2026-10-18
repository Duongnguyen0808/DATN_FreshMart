'use client';
import { ProductIdentity } from '../../components/ui/product-image';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionButton } from '../ui/action-button';
import { useToast } from '../ui/toast-provider';
import { errorMessage } from '../../lib/auth-api';
import { getInventory, type Inventory } from '../../lib/inventory-api';
import type { Warehouse } from '../../lib/organization-api';
import { createStocktake, type StocktakeType } from '../../lib/stocktakes-api';

export function StocktakeCreateDialog({ warehouses, onClose }: { warehouses: Warehouse[]; onClose: () => void }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [warehouseId, setWarehouseId] = useState('');
  const [type, setType] = useState<StocktakeType>('PERIODIC');
  const [area, setArea] = useState('');
  const [note, setNote] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Inventory[]>([]);
  const [selected, setSelected] = useState<Inventory[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!warehouseId) { setItems([]); setTotal(0); return; }
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const result = await getInventory({ warehouseId, q: query.trim() || undefined, page, pageSize: 50 });
        if (active) { setItems(result.items); setTotal(result.pagination.total); }
      } catch (reason) { if (active) setError(errorMessage(reason)); }
      finally { if (active) setLoading(false); }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [warehouseId, query, page]);

  const toggle = (item: Inventory) => {
    setSelected(rows => rows.some(row => row.skuId === item.skuId) ? rows.filter(row => row.skuId !== item.skuId) : rows.length >= 500 ? rows : [...rows, item]);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected.length) { setError('Chọn ít nhất một sản phẩm cần kiểm đếm.'); return; }
    setBusy(true);
    setError('');
    try {
      const created = await createStocktake({ warehouseId, type, area: area.trim(), note: note.trim(), skuIds: selected.map(item => item.skuId) });
      showToast(`Đã tạo phiếu ${created.code}. Nhập số thực tế để gửi duyệt.`);
      router.push(`/kiem-kho/${created.id}`);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };

  return <div className="ui-modal" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><form className="ui-modal-card stocktake-create-modal" onSubmit={submit}>
    <header><div><h2>Tạo phiếu kiểm kho</h2><p>Chọn kho và các sản phẩm cần kiểm; tồn kho chưa thay đổi ở bước này.</p></div><button type="button" aria-label="Đóng" disabled={busy} onClick={onClose}>×</button></header>
    <div className="form-grid"><label>Kho kiểm đếm<select required value={warehouseId} onChange={event => { setWarehouseId(event.target.value); setSelected([]); setQuery(''); setPage(1); }}><option value="">Chọn kho</option>{warehouses.filter(row => row.active && row.store.active).map(row => <option key={row.id} value={row.id}>{row.store.name} · {row.name}</option>)}</select></label><label>Loại kiểm kho<select value={type} onChange={event => setType(event.target.value as StocktakeType)}><option value="PERIODIC">Định kỳ</option><option value="SPOT">Đột xuất</option><option value="SHELF">Theo kệ</option></select></label><label>Khu vực<input value={area} maxLength={150} onChange={event => setArea(event.target.value)} placeholder="Toàn kho hoặc tên khu vực"/></label><label>Ghi chú<input value={note} maxLength={500} onChange={event => setNote(event.target.value)} placeholder="Mục đích kiểm kho"/></label></div>
    {warehouseId && <div className="stocktake-sku-picker"><div className="stocktake-picker-heading"><strong>Chọn sản phẩm ({selected.length}/500)</strong><input aria-label="Tìm sản phẩm" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Tìm sản phẩm, barcode, sản phẩm…"/></div><div className="stocktake-picker-list">{loading ? <p>Đang tải sản phẩm…</p> : items.length ? items.map(item => <label key={item.id}><input type="checkbox" checked={selected.some(row => row.skuId === item.skuId)} onChange={() => toggle(item)}/><span><ProductIdentity name={item.sku.product.name} code={item.sku.product.code} imageUrl={item.sku.product.imageUrl}/></span></label>) : <p>Kho này chưa có sản phẩm phù hợp.</p>}</div><div className="stocktake-picker-footer"><span>{total} sản phẩm trong kết quả tìm kiếm</span><div><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>‹ Trước</button><span>Trang {page}/{Math.max(1, Math.ceil(total / 50))}</span><button type="button" disabled={page * 50 >= total} onClick={() => setPage(value => value + 1)}>Sau ›</button></div></div>{selected.length > 0 && <p className="stocktake-selected">Đã chọn: {selected.map(item => item.sku.product.code).join(', ')}</p>}</div>}
    {error && <div className="ui-error" role="alert">{error}</div>}
    <footer><ActionButton tone="more" onClick={onClose} disabled={busy}>Đóng</ActionButton><ActionButton tone="approve" type="submit" disabled={busy || !warehouseId || selected.length === 0}>{busy ? 'Đang tạo…' : 'Tạo phiếu kiểm kho'}</ActionButton></footer>
  </form></div>;
}
