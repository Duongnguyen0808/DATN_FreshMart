'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '../../../components/auth-provider';
import { ActionButton } from '../../../components/ui/action-button';
import { MetricCard, MetricGrid } from '../../../components/ui/metric-card';
import { StatusBadge, type StatusTone } from '../../../components/ui/status-badge';
import { TablePagination } from '../../../components/ui/table-pagination';
import { useToast } from '../../../components/ui/toast-provider';
import { errorMessage } from '../../../lib/auth-api';
import { normalizeIntegerInput } from '../../../lib/number-input';
import * as api from '../../../lib/inventory-api';
const number = (value: number) => new Intl.NumberFormat('vi-VN').format(value); const dateTime = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const statusTone: Record<api.InventoryStatus, StatusTone> = { AVAILABLE: 'green', LOW: 'amber', OUT: 'red' };
const typeName: Record<api.InventoryTransaction['type'], string> = { OPENING: 'Số dư đầu kỳ', SALE: 'Bán hàng', SALE_CANCEL: 'Hoàn do hủy hóa đơn', STOCKTAKE: 'Điều chỉnh kiểm kho', TRANSFER_OUT: 'Xuất điều chuyển', TRANSFER_IN: 'Nhập điều chuyển' };
typeName.PURCHASE_RECEIPT = 'Nhập hàng mua';
typeName.SALE_RETURN = 'Nhập lại do trả hàng';
typeName.STOCK_ADJUSTMENT = 'Điều chỉnh tồn';
export default function InventoryDetailPage() {
  const { user } = useAuth(); const { showToast } = useToast();
  const canManage = Boolean(user?.permissions.includes('warehouses.manage') || user?.permissions.includes('*'));
  const canAdjust = Boolean(user?.permissions.includes('stocktakes.approve') || user?.permissions.includes('*'));
  const { id } = useParams<{ id: string }>(); const [item, setItem] = useState<api.Inventory | null>(null); const [history, setHistory] = useState<api.TransactionList>({ items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } }); const [page, setPage] = useState(1); const [type, setType] = useState<'all' | api.InventoryTransaction['type']>('all'); const [error, setError] = useState('');
  const [editingSafety, setEditingSafety] = useState(false); const [safetyValue, setSafetyValue] = useState('0'); const [savingSafety, setSavingSafety] = useState(false);
  const [adjusting, setAdjusting] = useState(false); const [actualValue, setActualValue] = useState('0'); const [adjustReason, setAdjustReason] = useState(''); const [savingAdjustment, setSavingAdjustment] = useState(false);
  const saveAdjustment = async (event: React.FormEvent) => {
    event.preventDefault();
    const actualQuantity = Number(actualValue);
    if (!item || !Number.isInteger(actualQuantity) || actualQuantity < item.reserved || actualQuantity === item.onHand) {
      showToast('Số tồn mới phải khác tồn hiện tại và không thấp hơn số đã giữ chỗ.', 'error');
      return;
    }
    setSavingAdjustment(true);
    try {
      const updated = await api.adjustStock(id, actualQuantity, adjustReason.trim());
      setItem(updated); setAdjusting(false); setAdjustReason(''); setPage(1);
      const rows = await api.getInventoryTransactions(id, 1, type);
      setHistory(rows);
      showToast('Đã điều chỉnh tồn kho và ghi lịch sử biến động.');
    } catch (reason) { showToast(errorMessage(reason), 'error'); }
    finally { setSavingAdjustment(false); }
  };
  const saveSafety = async (event: React.FormEvent) => { event.preventDefault(); setSavingSafety(true); try { const updated = await api.setSafetyStock(id, Number(safetyValue)); setItem(updated); setEditingSafety(false); showToast('Đã cập nhật mức tồn an toàn.'); } catch (reason) { showToast(errorMessage(reason), 'error'); } finally { setSavingSafety(false); } };
  const load = async () => { try { setError(''); const [stock, rows] = await Promise.all([api.getInventoryItem(id), api.getInventoryTransactions(id, page, type)]); setItem(stock); setHistory(rows); } catch (reason) { setError(errorMessage(reason)); } };
  useEffect(() => { load(); }, [id, page, type]); useEffect(() => setPage(1), [type]);
  if (error) return <div className="ui-error" role="alert">{error} <button onClick={load}>Thử lại</button></div>; if (!item) return <p role="status">Đang tải tồn kho…</p>;
  return <div className="suite-page inventory-detail-page"><div className="detail-back"><Link href="/ton-kho">‹ Quay lại danh sách tồn kho</Link></div><header className="detail-heading"><div><div className="breadcrumb">Hàng hóa <span>›</span> Tồn kho <span>›</span> {item.sku.product.code}</div><h1>{item.sku.product.name}</h1><p>{item.warehouse.store.name} · {item.warehouse.code} · {item.warehouse.name}</p></div><div className="inventory-detail-actions"><StatusBadge tone={statusTone[item.status]}>{item.status === 'AVAILABLE' ? 'Đủ hàng' : item.status === 'LOW' ? 'Dưới an toàn' : 'Hết hàng'}</StatusBadge>{canManage&&<ActionButton tone="edit" onClick={()=>{setSafetyValue(String(item.safetyStock));setEditingSafety(true)}}>Chỉnh mức an toàn</ActionButton>}</div></header>
    {canAdjust && <div className="inventory-adjust-action"><ActionButton tone="edit" onClick={() => { setActualValue(String(item.onHand)); setAdjustReason(''); setAdjusting(true); }}>Điều chỉnh số tồn</ActionButton></div>}
    <MetricGrid className="suite-kpis" label="Số lượng tồn"><MetricCard tone="blue" label="TỒN HIỆN TẠI" value={number(item.onHand)} caption={item.sku.product.unit}/><MetricCard tone="green" label="TỒN KHẢ DỤNG" value={number(item.available)} caption={`Đã giữ chỗ: ${number(item.reserved)}`}/><MetricCard tone="amber" label="ĐANG CHUYỂN / ĐANG VỀ" value={`${number(item.inTransfer)} / ${number(item.incoming)}`}/><MetricCard tone="red" label="MỨC AN TOÀN" value={number(item.safetyStock)}/></MetricGrid>
    <section className="detail-table"><header><div><h2>Lịch sử biến động</h2><p>Mỗi thay đổi đều có số trước, số sau, nguyên nhân và chứng từ tham chiếu.</p></div><select value={type} onChange={event => setType(event.target.value as typeof type)}><option value="all">Tất cả nghiệp vụ</option><option value="SALE">Bán hàng</option><option value="SALE_CANCEL">Hoàn do hủy hóa đơn</option><option value="STOCK_ADJUSTMENT">{typeName.STOCK_ADJUSTMENT}</option><option value="OPENING">Số dư đầu kỳ</option></select></header><div className="table-scroll"><table><thead><tr><th>Thời gian</th><th>Nghiệp vụ</th><th>Chứng từ</th><th>Nguyên nhân</th><th>Người thực hiện</th><th className="numeric">Trước</th><th className="numeric">Thay đổi</th><th className="numeric">Sau</th></tr></thead><tbody>{history.items.length === 0 ? <tr><td colSpan={8}>Chưa có biến động tồn kho.</td></tr> : history.items.map(row => <tr key={row.id}><td>{dateTime(row.occurredAt)}</td><td><span className={`transaction-type transaction-type-${row.type.toLowerCase()}`}>{typeName[row.type]}</span></td><td><code>{row.referenceId}</code></td><td>{row.reason}</td><td>{row.actor?.name ?? 'Hệ thống'}</td><td className="numeric">{number(row.beforeQuantity)}</td><td className={`numeric ${row.quantity > 0 ? 'positive' : 'negative'}`}><strong>{row.quantity > 0 ? '+' : ''}{number(row.quantity)}</strong></td><td className="numeric"><strong>{number(row.afterQuantity)}</strong></td></tr>)}</tbody></table></div><TablePagination page={page} totalPages={history.pagination.totalPages} shown={history.items.length} total={history.pagination.total} noun="biến động" onChange={setPage}/></section>
    {editingSafety && <div className="ui-modal" onMouseDown={event => { if (event.target === event.currentTarget && !savingSafety) setEditingSafety(false); }}><form className="ui-modal-card" onSubmit={saveSafety}><header><div><h2>Chỉnh mức tồn an toàn</h2><p>{item.sku.product.name} · {item.warehouse.name}</p></div><button type="button" aria-label="Đóng" disabled={savingSafety} onClick={() => setEditingSafety(false)}>×</button></header><label>Mức tồn an toàn<input autoFocus required type="number" min={0} max={100000000} step={1} value={safetyValue} onChange={event => setSafetyValue(normalizeIntegerInput(event.target.value))}/></label><p className="inventory-safety-help">Ngưỡng này dùng để xác định sản phẩm sắp thiếu tại kho; không thay đổi số lượng tồn.</p><footer><ActionButton tone="more" onClick={() => setEditingSafety(false)} disabled={savingSafety}>Đóng</ActionButton><ActionButton tone="approve" type="submit" disabled={savingSafety}>{savingSafety ? 'Đang lưu…' : 'Lưu mức an toàn'}</ActionButton></footer></form></div>}

    {adjusting && <div className="ui-modal" onMouseDown={event => { if (event.target === event.currentTarget && !savingAdjustment) setAdjusting(false); }}><form className="ui-modal-card" onSubmit={saveAdjustment}><header><div><h2>Điều chỉnh số tồn</h2><p>{item.sku.product.name} · {item.warehouse.name}</p></div><button type="button" aria-label="Đóng" disabled={savingAdjustment} onClick={() => setAdjusting(false)}>×</button></header><p className="inventory-safety-help">Tồn hiện tại: <strong>{number(item.onHand)}</strong> · Đã giữ chỗ: <strong>{number(item.reserved)}</strong>. Thay đổi sẽ được ghi ngay vào lịch sử.</p><label>Số tồn thực tế<input autoFocus required type="number" min={item.reserved} max={100000000} step={1} value={actualValue} onChange={event => setActualValue(normalizeIntegerInput(event.target.value))}/></label><label>Lý do điều chỉnh<textarea required minLength={5} maxLength={500} value={adjustReason} onChange={event => setAdjustReason(event.target.value)} placeholder="Ví dụ: Hàng hư hỏng đã lập biên bản..."/></label><footer><ActionButton tone="more" onClick={() => setAdjusting(false)} disabled={savingAdjustment}>Đóng</ActionButton><ActionButton tone="approve" type="submit" disabled={savingAdjustment}>{savingAdjustment ? 'Đang lưu…' : 'Xác nhận điều chỉnh'}</ActionButton></footer></form></div>}
  </div>;
}
