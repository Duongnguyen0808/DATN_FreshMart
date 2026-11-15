'use client';
import { ProductIdentity } from '../../components/ui/product-image';

import { useState } from 'react';
import Link from 'next/link';
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
  const isLotTracked = (item: Stocktake['items'][number]) => (item.inventory._count?.lots ?? 0) > 0;
  const lotMismatch = stocktake.items.some(item => isLotTracked(item) && counts[item.id] !== undefined && counts[item.id] !== '' && Number(counts[item.id]) !== item.systemQuantity);
  const counted = stocktake.items.filter(item => counts[item.id] !== undefined && counts[item.id] !== '' && Number.isInteger(Number(counts[item.id])) && Number(counts[item.id]) >= 0).length;
  const remaining = stocktake.items.length - counted;
  const complete = !lotMismatch && stocktake.items.every(item => counts[item.id] !== undefined && counts[item.id] !== '' && Number.isInteger(Number(counts[item.id])) && Number(counts[item.id]) >= 0 && (Number(counts[item.id]) === item.systemQuantity || Boolean(reasons[item.id]?.trim())));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (lotMismatch) { setError('Sản phẩm quản lý theo lô FEFO không cho phép điều chỉnh chênh lệch ở phiếu kiểm kho. Hãy kiểm đếm và điều chỉnh tại Lô & hạn dùng.'); return; }
    if (!complete) { setError('Nhập số thực tế cho mọi sản phẩm và nêu nguyên nhân nếu có chênh lệch.'); return; }
    setBusy(true);
    setError('');
    try {
      const updated = await submitStocktake(stocktake.id, stocktake.items.map(item => ({ itemId: item.id, actualQuantity: Number(counts[item.id]), reason: reasons[item.id]?.trim() || undefined })));
      onSubmitted(updated);
      showToast(`Đã hoàn tất phiếu ${updated.code} và cập nhật tồn kho.`);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };

  return <form className="detail-table stocktake-count-form" onSubmit={submit}><header><div><h2>Nhập kết quả kiểm đếm</h2><p>Ghi số lượng thực tế của tất cả sản phẩm. Nếu khác số hệ thống, cần nhập nguyên nhân.</p></div></header><section className="counting-progress" aria-label="Tiến độ kiểm đếm"><div><strong>{counted} / {stocktake.items.length} mặt hàng đã đếm</strong><span>{lotMismatch ? 'Có mặt hàng quản lý lô FEFO đang lệch số hệ thống — vui lòng kiểm đếm tại Lô & hạn dùng' : remaining ? `Còn ${remaining} mặt hàng cần nhập số thực tế` : complete ? 'Đủ thông tin để hoàn thành kiểm kho' : 'Bổ sung nguyên nhân cho các dòng chênh lệch'}</span></div><progress value={counted} max={Math.max(1, stocktake.items.length)} aria-label="Số mặt hàng đã kiểm đếm"/></section><div className="table-scroll"><table><thead><tr><th>Sản phẩm / Mã SP</th><th className="numeric">Số hệ thống</th><th>Số thực tế</th><th>Chênh lệch</th><th>Nguyên nhân</th></tr></thead><tbody>{stocktake.items.map(item => {
    const actual = counts[item.id];
    const lotTracked = isLotTracked(item);
    const difference = actual === undefined || actual === '' ? null : Number(actual) - item.systemQuantity;
    return <tr key={item.id}><td><ProductIdentity name={item.sku.product.name} code={item.sku.product.code} imageUrl={item.sku.product.imageUrl}/>{lotTracked && <small style={{ color: '#0e7490', display: 'block', marginTop: 4 }}>Quản lý lô FEFO · điều chỉnh chênh lệch tại <Link href="/lo-han-dung">Lô & hạn dùng</Link></small>}</td><td className="numeric">{item.systemQuantity}</td><td><input aria-label={`Số thực tế ${item.sku.product.code}`} type="number" min={lotTracked ? item.systemQuantity : 0} max={lotTracked ? item.systemQuantity : 100000000} step={1} required value={actual ?? ''} onChange={event => setCounts(old => ({ ...old, [item.id]: normalizeIntegerInput(event.target.value) }))}/></td><td className={difference === null ? '' : difference < 0 ? 'negative' : difference > 0 ? 'positive' : ''}>{difference === null ? '—' : `${difference > 0 ? '+' : ''}${difference}`}</td><td><input aria-label={`Nguyên nhân ${item.sku.product.code}`} maxLength={500} required={difference !== null && difference !== 0} value={reasons[item.id] ?? ''} onChange={event => setReasons(old => ({ ...old, [item.id]: event.target.value }))} placeholder={lotTracked && difference ? 'Cần điều chỉnh trực tiếp theo từng lô tại /lo-han-dung' : difference === null ? 'Nhập sau khi kiểm đếm' : difference ? 'Bắt buộc khi có chênh lệch' : 'Không có chênh lệch'}/></td></tr>;
  })}</tbody></table></div>{error && <div className="ui-error" role="alert">{error}</div>}<footer><span>Hoàn thành sẽ cập nhật tồn kho theo số thực tế đã nhập.</span><ActionButton tone="approve" type="submit" disabled={busy || !complete}>{busy ? 'Đang cập nhật…' : 'Hoàn thành kiểm kho'}</ActionButton></footer></form>;
}
