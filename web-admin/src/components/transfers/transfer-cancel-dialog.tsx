'use client';

import { useState, type FormEvent } from 'react';
import { ActionButton } from '../ui/action-button';
import { errorMessage } from '../../lib/auth-api';
import { cancelTransfer, type Transfer } from '../../lib/transfers-api';

export function TransferCancelDialog({ transfer, onClose, onDone }: { transfer: Transfer; onClose: () => void; onDone: (updated: Transfer) => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true); setError('');
    try { onDone(await cancelTransfer(transfer.id, reason.trim())); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };

  return <div className="ui-modal" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="ui-modal-card" onSubmit={submit}>
      <header><div><h2>Hủy phiếu điều chuyển</h2><p>{transfer.code}</p></div><button type="button" aria-label="Đóng" disabled={busy} onClick={onClose}>×</button></header>
      <p>Phiếu chưa xuất kho nên hủy phiếu sẽ không thay đổi số lượng tồn.</p>
      <label>Lý do hủy<textarea required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Nêu lý do hủy phiếu"/></label>
      {error && <div className="ui-error" role="alert">{error}</div>}
      <footer><ActionButton tone="more" disabled={busy} onClick={onClose}>Đóng</ActionButton><ActionButton tone="danger" type="submit" disabled={busy}>{busy ? 'Đang hủy…' : 'Xác nhận hủy phiếu'}</ActionButton></footer>
    </form>
  </div>;
}
