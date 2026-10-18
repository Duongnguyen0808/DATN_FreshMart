'use client';

import { useState } from 'react';
import { ActionButton } from '../ui/action-button';
import { CurrencyInput } from '../ui/currency-input';
import { errorMessage } from '../../lib/auth-api';
import { closeShift, type Shift } from '../../lib/shifts-api';

const denominations = [500000, 200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000] as const;
const money = (value: number) => new Intl.NumberFormat('vi-VN').format(value) + ' đ';

export function ShiftCloseDialog({ shift, onClose, onClosed }: { shift: Shift; onClose: () => void; onClosed: (shift: Shift) => void }) {
  const [closingCash, setClosingCash] = useState('');
  const [cashExpenses, setCashExpenses] = useState('');
  const [reason, setReason] = useState('');
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const expected = shift.openingCash + shift.cashRevenue - Number(cashExpenses || 0);
  const difference = closingCash === '' ? null : Number(closingCash) - expected;
  const counted = denominations.reduce((sum, value) => sum + value * Number(counts[value] || 0), 0);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (difference !== 0 && !reason.trim()) { setError('Cần nhập lý do khi tiền thực tế chênh lệch.'); return; }
    setBusy(true);
    setError('');
    try { onClosed(await closeShift(shift.id, { closingCash: Number(closingCash), cashExpenses: Number(cashExpenses), discrepancyReason: reason.trim() || undefined, denominations: denominations.filter(value => Number(counts[value] || 0) > 0).map(value => ({ value, count: Number(counts[value]) })) })); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  return <div className="ui-modal" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><form className="ui-modal-card shift-close-modal" onSubmit={submit}><header><div><h2>Chốt ca {shift.code}</h2><p>{shift.store.name} · {shift.posCode}</p></div><button type="button" disabled={busy} aria-label="Đóng" onClick={onClose}>×</button></header><div className="shift-cash-summary"><span>Tiền đầu ca: <strong>{money(shift.openingCash)}</strong></span><span>Doanh thu tiền mặt: <strong>{money(shift.cashRevenue)}</strong></span><span>Tiền dự kiến: <strong>{money(expected)}</strong></span></div><div className="form-grid"><label>Chi tiền mặt trong ca<CurrencyInput min={0} value={cashExpenses} onChange={setCashExpenses} /></label><label>Tiền thực tế khi chốt<CurrencyInput required min={0} value={closingCash} onChange={setClosingCash} /></label></div><fieldset><legend>Kiểm đếm mệnh giá (tùy chọn)</legend><div className="shift-denominations">{denominations.map(value => <label key={value}><span>{money(value)}</span><input type="number" min={0} max={100000} step={1} value={counts[value] ?? ''} onChange={event => { const raw = event.target.value.replace(/^0+(?=\d)/, ''); setCounts(old => ({ ...old, [value]: raw })); }}/></label>)}</div><button type="button" className="shift-use-counted" onClick={() => setClosingCash(String(counted))}>Dùng tổng đã đếm: {money(counted)}</button></fieldset><div className={`shift-difference ${difference !== null && difference < 0 ? 'negative' : difference !== null && difference > 0 ? 'positive' : ''}`}>Chênh lệch: <strong>{difference === null ? '—' : money(difference)}</strong>{difference !== null && difference !== 0 && <small>Ca sẽ chuyển sang chờ quản lý duyệt.</small>}</div><label>Lý do chênh lệch<textarea value={reason} maxLength={500} required={difference !== null && difference !== 0} onChange={event => setReason(event.target.value)} placeholder="Bắt buộc nếu số thực tế khác dự kiến"/></label>{error && <div className="ui-error" role="alert">{error}</div>}<footer><ActionButton tone="more" onClick={onClose} disabled={busy}>Đóng</ActionButton><ActionButton tone="approve" type="submit" disabled={busy || closingCash === ''}>{busy ? 'Đang chốt…' : 'Xác nhận chốt ca'}</ActionButton></footer></form></div>;
}
