'use client';
import { ProductIdentity } from '../../components/ui/product-image';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth-provider';
import { ActionButton } from '../ui/action-button';
import { StatusBadge, type StatusTone } from '../ui/status-badge';
import { useToast } from '../ui/toast-provider';
import { errorMessage } from '../../lib/auth-api';
import * as api from '../../lib/purchase-requests-api';

const labels: Record<api.PurchaseRequestStatus, string> = { PENDING_APPROVAL: 'Chờ duyệt', APPROVED: 'Đã duyệt', REJECTED: 'Từ chối', CONVERTED_TO_PO: 'Đã tạo PO' };
const tones: Record<api.PurchaseRequestStatus, StatusTone> = { PENDING_APPROVAL: 'amber', APPROVED: 'green', REJECTED: 'red', CONVERTED_TO_PO: 'violet' };
const dt = (v: string | null) => v ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v)) : '—';

export function PurchaseRequestDetailDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth(); const { showToast } = useToast();
  const [row, setRow] = useState<api.PurchaseRequest | null>(null); const [error, setError] = useState('');
  const [action, setAction] = useState<'approve' | 'reject' | null>(null); const [note, setNote] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({}); const [busy, setBusy] = useState(false);
  const canApprove = Boolean(user?.permissions.includes('purchase_requests.approve') || user?.permissions.includes('*'));
  useEffect(() => { let active = true; api.getPurchaseRequest(id).then(value => { if (active) { setRow(value); setQty(Object.fromEntries(value.items.map(item => [item.skuId, item.requestedQuantity]))); } }).catch(reason => { if (active) setError(errorMessage(reason)); }); return () => { active = false; }; }, [id]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!row || !action) return; setBusy(true);
    try { const updated = action === 'approve' ? await api.approvePurchaseRequest(id, { note, items: row.items.map(item => ({ skuId: item.skuId, quantity: qty[item.skuId] })) }) : await api.rejectPurchaseRequest(id, note); setRow(updated); setAction(null); setNote(''); showToast(action === 'approve' ? 'Đã duyệt đề nghị mua hàng.' : 'Đã từ chối đề nghị mua hàng.'); onChanged(); }
    catch (reason) { showToast(errorMessage(reason), 'error'); } finally { setBusy(false); }
  };
  return <div className="ui-modal" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="ui-modal-card purchase-request-detail-modal">
    <header><div><h2>{row?.code ?? 'Chi tiết đề nghị mua'}</h2>{row && <p>{row.store.code} · {row.store.name}</p>}</div><button type="button" aria-label="Đóng" disabled={busy} onClick={onClose}>×</button></header>
    {error ? <div className="ui-error" role="alert">{error}</div> : !row ? <p>Đang tải đề nghị…</p> : <>
      <div className="purchase-request-detail-top"><StatusBadge tone={tones[row.status]}>{labels[row.status]}</StatusBadge><span>{dt(row.createdAt)}</span></div>
      <section className="purchase-request-detail-info"><article><h3>Thông tin đề nghị</h3><dl><div><dt>Chi nhánh</dt><dd>{row.store.name}</dd></div><div><dt>Người tạo</dt><dd>{row.createdBy.name}</dd></div><div><dt>Lý do</dt><dd>{row.reason}</dd></div><div><dt>Ghi chú xử lý</dt><dd>{row.decisionNote || '—'}</dd></div></dl></article><article><h3>Phê duyệt</h3><dl><div><dt>Người xử lý</dt><dd>{row.approvedBy?.name ?? '—'}</dd></div><div><dt>Thời gian</dt><dd>{dt(row.approvedAt)}</dd></div><div><dt>Tổng yêu cầu</dt><dd>{row.totalRequested}</dd></div><div><dt>Tổng được duyệt</dt><dd>{row.totalApproved || '—'}</dd></div></dl></article></section>
      <h3 className="purchase-request-detail-items-title">Sản phẩm đề nghị mua</h3><div className="table-scroll"><table><thead><tr><th>Sản phẩm / Mã SP</th><th>ĐVT</th><th className="numeric">Yêu cầu</th><th className="numeric">Được duyệt</th></tr></thead><tbody>{row.items.map(item => <tr key={item.id}><td><ProductIdentity name={item.sku.product.name} code={item.sku.product.code} imageUrl={item.sku.product.imageUrl}/></td><td>{item.sku.product.unit}</td><td className="numeric">{item.requestedQuantity}</td><td className="numeric">{item.approvedQuantity ?? '—'}</td></tr>)}</tbody></table></div>
      <footer>{canApprove && row.status === 'PENDING_APPROVAL' && <><ActionButton tone="danger" onClick={() => setAction('reject')}>Từ chối</ActionButton><ActionButton tone="approve" onClick={() => setAction('approve')}>Duyệt đề nghị</ActionButton></>}<ActionButton tone="more" onClick={onClose}>Đóng</ActionButton></footer>
    </>}
    {action && row && <div className="ui-modal purchase-request-decision-layer"><form className="ui-modal-card" onSubmit={submit}><header><div><h2>{action === 'approve' ? 'Duyệt và điều chỉnh số lượng' : 'Từ chối đề nghị'}</h2><p>{row.code}</p></div><button type="button" onClick={() => setAction(null)}>×</button></header>{action === 'approve' && <fieldset><legend>Số lượng duyệt</legend><div className="approval-lines">{row.items.map(item => <label key={item.id}><span>{item.sku.product.code} · {item.sku.product.name}<small>Yêu cầu: {item.requestedQuantity} {item.sku.product.unit}</small></span><input required type="number" min={1} max={item.requestedQuantity} value={qty[item.skuId]} onChange={event => setQty(old => ({ ...old, [item.skuId]: Number(event.target.value) }))}/></label>)}</div></fieldset>}<label>Ghi chú<textarea required minLength={3} value={note} onChange={event => setNote(event.target.value)}/></label><footer><ActionButton tone="more" onClick={() => setAction(null)}>Đóng</ActionButton><ActionButton tone={action === 'approve' ? 'approve' : 'danger'} type="submit" disabled={busy}>{busy ? 'Đang xử lý…' : 'Xác nhận'}</ActionButton></footer></form></div>}
  </section></div>;
}
