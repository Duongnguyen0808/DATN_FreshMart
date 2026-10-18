'use client';

import { useState } from 'react';
import { ActionButton } from '../ui/action-button';
import { CurrencyInput } from '../ui/currency-input';
import { errorMessage } from '../../lib/auth-api';
import type { Store } from '../../lib/organization-api';
import { openShift, type Shift, type ShiftStaff } from '../../lib/shifts-api';

export function ShiftOpenDialog({ stores, staff, currentUserId, canApprove, onClose, onCreated }: { stores: Store[]; staff: ShiftStaff[]; currentUserId: string; canApprove: boolean; onClose: () => void; onCreated: (shift: Shift) => void }) {
  const [storeId, setStoreId] = useState('');
  const [cashierId, setCashierId] = useState(currentUserId);
  const [posCode, setPosCode] = useState('POS01');
  const [name, setName] = useState('Ca làm việc');
  const [openingCash, setOpeningCash] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const availableStaff = staff.filter(person => person.id === currentUserId || person.stores.some(item => item.store.id === storeId));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try { onCreated(await openShift({ storeId, cashierId, posCode: posCode.trim().toUpperCase(), name: name.trim(), openingCash: Number(openingCash) })); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  return <div className="ui-modal" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><form className="ui-modal-card" onSubmit={submit}><header><div><h2>Mở ca làm việc</h2><p>Thu ngân và máy POS chỉ được có một ca đang mở.</p></div><button type="button" disabled={busy} aria-label="Đóng" onClick={onClose}>×</button></header><div className="form-grid"><label>Chi nhánh<select required value={storeId} onChange={event => { setStoreId(event.target.value); setCashierId(currentUserId); }}><option value="">Chọn chi nhánh</option>{stores.filter(store => store.active).map(store => <option key={store.id} value={store.id}>{store.code} · {store.name}</option>)}</select></label><label>Thu ngân<select required value={cashierId} onChange={event => setCashierId(event.target.value)} disabled={!canApprove}><option value="">Chọn thu ngân</option>{availableStaff.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label>Mã máy POS<input required pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,29}" maxLength={30} value={posCode} onChange={event => setPosCode(event.target.value)}/></label><label>Tên ca<input required maxLength={50} value={name} onChange={event => setName(event.target.value)}/></label><label className="full">Tiền đầu ca<CurrencyInput required min={0} value={openingCash} onChange={setOpeningCash} /></label></div>{error && <div className="ui-error" role="alert">{error}</div>}<footer><ActionButton tone="more" onClick={onClose} disabled={busy}>Đóng</ActionButton><ActionButton tone="approve" type="submit" disabled={busy || !storeId || !cashierId}>{busy ? 'Đang mở…' : 'Mở ca'}</ActionButton></footer></form></div>;
}
