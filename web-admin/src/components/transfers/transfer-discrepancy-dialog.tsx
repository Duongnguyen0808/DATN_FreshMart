'use client';

import { useState, type FormEvent } from 'react';
import { ActionButton } from '../ui/action-button';
import { errorMessage } from '../../lib/auth-api';
import { resolveTransferDiscrepancy, type Transfer } from '../../lib/transfers-api';

export function TransferDiscrepancyDialog({ transfer, onClose, onDone }: { transfer: Transfer; onClose: () => void; onDone: (updated: Transfer) => void }) {
  const mismatches = transfer.items.filter(item => item.discrepancy !== null && item.discrepancy !== 0);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true); setError('');
    try { onDone(await resolveTransferDiscrepancy(transfer.id, mismatches.map(item => ({ skuId: item.skuId, resolution: notes[item.skuId]?.trim() ?? '' })))); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };

  return <div className="ui-modal" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="ui-modal-card transfer-decision" onSubmit={submit}>
      <header><div><h2>Xử lý chênh lệch điều chuyển</h2><p>{transfer.code}</p></div><button type="button" aria-label="Đóng" disabled={busy} onClick={onClose}>×</button></header>
      <p>Ghi rõ kết quả kiểm tra và cách xử lý từng sản phẩm. Tồn kho đã được ghi theo số thực nhận; xác nhận này không tự điều chỉnh tồn.</p>
      {mismatches.map(item => <label key={item.id}>{item.sku.product.name} · {item.sku.product.code} ({item.discrepancy! > 0 ? `thừa ${item.discrepancy}` : `thiếu ${Math.abs(item.discrepancy!)}`} {item.sku.product.unit})<textarea required minLength={3} maxLength={500} value={notes[item.skuId] ?? ''} onChange={event => setNotes(previous => ({ ...previous, [item.skuId]: event.target.value }))} placeholder="Kết quả kiểm tra và cách xử lý chênh lệch"/></label>)}
      {error && <div className="ui-error" role="alert">{error}</div>}
      <footer><ActionButton tone="more" disabled={busy} onClick={onClose}>Đóng</ActionButton><ActionButton tone="approve" type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Xác nhận đã xử lý'}</ActionButton></footer>
    </form>
  </div>;
}
