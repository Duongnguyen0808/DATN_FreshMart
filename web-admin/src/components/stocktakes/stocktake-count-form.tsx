'use client';
import { ProductIdentity } from '../../components/ui/product-image';

import { useState } from 'react';
import { ActionButton } from '../ui/action-button';
import { useToast } from '../ui/toast-provider';
import { errorMessage } from '../../lib/auth-api';
import { submitStocktake, type Stocktake } from '../../lib/stocktakes-api';
import { normalizeIntegerInput } from '../../lib/number-input';

export function StocktakeCountForm({ stocktake, onSubmitted }: { stocktake: Stocktake; onSubmitted: (row: Stocktake) => void }) {
  const { showToast } = useToast();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const complete = stocktake.items.every(item => counts[item.id] !== undefined && counts[item.id] !== '' && Number.isInteger(Number(counts[item.id])) && Number(counts[item.id]) >= 0 && (Number(counts[item.id]) === item.systemQuantity || Boolean(reasons[item.id]?.trim())));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!complete) { setError('Nhập số thực tế cho mọi sản phẩm và nêu nguyên nhân nếu có chênh lệch.'); return; }
    setBusy(true);
    setError('');
    try {
      const updated = await submitStocktake(stocktake.id, stocktake.items.map(item => ({ itemId: item.id, actualQuantity: Number(counts[item.id]), reason: reasons[item.id]?.trim() || undefined })));
      onSubmitted(updated);
      showToast(`Đã gửi phiếu ${updated.code} chờ phê duyệt. Tồn kho chưa thay đổi.`);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };

  return <form className="detail-table stocktake-count-form" onSubmit={submit}><header><div><h2>Nhập kết quả kiểm đếm</h2><p>Ghi số lượng thực tế của tất cả sản phẩm. Nếu khác số hệ thống, cần nhập nguyên nhân.</p></div></header><div className="table-scroll"><table><thead><tr><th>Sản phẩm / Mã SP</th><th className="numeric">Số hệ thống</th><th>Số thực tế</th><th>Chênh lệch</th><th>Nguyên nhân</th></tr></thead><tbody>{stocktake.items.map(item => {
    const actual = counts[item.id];
    const difference = actual === undefined || actual === '' ? null : Number(actual) - item.systemQuantity;
    return <tr key={item.id}><td><ProductIdentity name={item.sku.product.name} code={item.sku.product.code} imageUrl={item.sku.product.imageUrl}/></td><td className="numeric">{item.systemQuantity}</td><td><input aria-label={`Số thực tế ${item.sku.product.code}`} type="number" min={0} max={100000000} step={1} required value={actual ?? ''} onChange={event => setCounts(old => ({ ...old, [item.id]: normalizeIntegerInput(event.target.value) }))}/></td><td className={difference === null ? '' : difference < 0 ? 'negative' : difference > 0 ? 'positive' : ''}>{difference === null ? '—' : `${difference > 0 ? '+' : ''}${difference}`}</td><td><input aria-label={`Nguyên nhân ${item.sku.product.code}`} maxLength={500} required={difference !== null && difference !== 0} value={reasons[item.id] ?? ''} onChange={event => setReasons(old => ({ ...old, [item.id]: event.target.value }))} placeholder={difference ? 'Bắt buộc khi có chênh lệch' : 'Không có chênh lệch'}/></td></tr>;
  })}</tbody></table></div>{error && <div className="ui-error" role="alert">{error}</div>}<footer><span>Hoàn thành sẽ cập nhật tồn kho theo số thực tế đã nhập.</span><ActionButton tone="approve" type="submit" disabled={busy || !complete}>{busy ? 'Đang cập nhật…' : 'Hoàn thành kiểm kho'}</ActionButton></footer></form>;
}
