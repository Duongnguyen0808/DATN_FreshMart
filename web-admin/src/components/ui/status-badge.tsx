import type { ReactNode } from 'react';
export type StatusTone = 'blue' | 'cyan' | 'green' | 'amber' | 'red' | 'violet' | 'neutral';
export function StatusBadge({ tone = 'neutral', children }: { tone?: StatusTone; children: ReactNode }) {
  return <span className={`ui-status-badge ui-status-${tone}`}>{children}</span>;
}
export function StockReceiptLabel({ at, quantity, unit }: { at?: string | null; quantity?: number | null; unit?: string }) {
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  const age = Date.now() - Date.parse(at);
  const recent = age >= 0 && age < 24 * 60 * 60 * 1000;
  return <div style={{ marginTop: 5 }}>
    {recent && <StatusBadge tone="green">Mới nhập</StatusBadge>}
    <small>Nhập gần nhất{quantity != null ? `: +${quantity} ${unit ?? ''}` : ''} · {new Date(at).toLocaleString('vi-VN')}</small>
  </div>;
}
