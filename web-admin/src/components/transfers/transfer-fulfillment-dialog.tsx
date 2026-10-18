'use client';
import { ProductIdentity } from '../../components/ui/product-image';

import { useState, type FormEvent } from 'react';
import { ActionButton } from '../ui/action-button';
import { errorMessage } from '../../lib/auth-api';
import { dispatchTransfer, receiveTransfer, type Transfer } from '../../lib/transfers-api';
import { normalizeIntegerInput } from '../../lib/number-input';

type Props = {
  transfer: Transfer;
  mode: 'dispatch' | 'receive';
  onClose: () => void;
  onDone: (updated: Transfer) => void;
};

export function TransferFulfillmentDialog({ transfer, mode, onClose, onDone }: Props) {
  const [note, setNote] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(transfer.items.map(item => [item.skuId, String(item.dispatchedQuantity || '')])));
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const receiving = mode === 'receive';

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (receiving) {
      const invalid = transfer.items.find(item => {
        const quantity = Number(quantities[item.skuId]);
        return quantities[item.skuId] === '' || !Number.isInteger(quantity) || quantity < 0 || quantity > 100_000_000 ||
          (quantity !== item.dispatchedQuantity && !reasons[item.skuId]?.trim());
      });
      if (invalid) { setError('Kiểm tra số thực nhận và nhập lý do cho mọi sản phẩm nhận thiếu hoặc thừa.'); return; }
    }
    setBusy(true);
    try {
      const updated = receiving
        ? await receiveTransfer(transfer.id, { note: note.trim(), items: transfer.items.map(item => ({ skuId: item.skuId, quantity: Number(quantities[item.skuId]), discrepancyReason: Number(quantities[item.skuId]) === item.dispatchedQuantity ? null : reasons[item.skuId]!.trim() })) })
        : await dispatchTransfer(transfer.id, note.trim());
      onDone(updated);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };

  return <div className="ui-modal" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="ui-modal-card transfer-fulfillment-dialog" onSubmit={submit}>
      <header><div><h2>{receiving ? 'Xác nhận nhận hàng' : 'Xác nhận xuất kho'}</h2><p>{transfer.code} · {receiving ? transfer.destinationWarehouse.name : transfer.sourceWarehouse.name}</p></div><button type="button" aria-label="Đóng" disabled={busy} onClick={onClose}>×</button></header>
      <p className="transfer-fulfillment-hint">{receiving ? 'Nhập số thực nhận cho toàn bộ sản phẩm. Hàng nhận thiếu hoặc thừa cần ghi lý do; kho đích tăng theo đúng số thực nhận.' : 'Tồn kho nguồn sẽ giảm theo số đã duyệt và hàng chuyển sang trạng thái đang vận chuyển.'}</p>
      <div className="transfer-fulfillment-lines">
        {transfer.items.map(item => {
          const shipped = item.dispatchedQuantity ?? 0;
          const mismatch = receiving && quantities[item.skuId] !== '' && Number(quantities[item.skuId]) !== shipped;
          return <div className="transfer-fulfillment-line" key={item.id}>
            <div><ProductIdentity name={item.sku.product.name} code={item.sku.product.code} imageUrl={item.sku.product.imageUrl}/></div>
            <span>{receiving ? `Đã xuất: ${shipped}` : `Đã duyệt: ${item.approvedQuantity ?? 0}`}</span>
            {receiving && <label>Thực nhận<input required type="number" min={0} max={100000000} step={1} value={quantities[item.skuId]} onChange={event => setQuantities(current => ({ ...current, [item.skuId]: normalizeIntegerInput(event.target.value) }))}/></label>}
            {mismatch && <label className="transfer-fulfillment-reason">Lý do chênh lệch<input required maxLength={500} value={reasons[item.skuId] ?? ''} onChange={event => setReasons(current => ({ ...current, [item.skuId]: event.target.value }))} placeholder="Ghi rõ nguyên nhân nhận thiếu hoặc thừa"/></label>}
          </div>;
        })}
      </div>
      <label className="transfer-fulfillment-note">Ghi chú {receiving ? 'nhận hàng' : 'xuất kho'}<textarea maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder="Ghi chú thêm nếu có"/></label>
      {error && <div className="ui-error" role="alert">{error}</div>}
      <footer><ActionButton tone="more" disabled={busy} onClick={onClose}>Đóng</ActionButton><ActionButton tone="approve" type="submit" disabled={busy}>{busy ? 'Đang xử lý…' : receiving ? 'Xác nhận nhận hàng' : 'Xác nhận xuất kho'}</ActionButton></footer>
    </form>
  </div>;
}
