import type { ReactNode } from 'react';
export type StatusTone = 'blue' | 'cyan' | 'green' | 'amber' | 'red' | 'violet' | 'neutral';
export function StatusBadge({ tone = 'neutral', children }: { tone?: StatusTone; children: ReactNode }) {
  return <span className={`ui-status-badge ui-status-${tone}`}>{children}</span>;
}
