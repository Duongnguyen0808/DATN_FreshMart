import type { ReactNode } from 'react';

export type TabTone = 'blue' | 'cyan' | 'green' | 'amber' | 'violet' | 'red';
export type TabItem<T extends string> = { value: T; label: ReactNode; count?: number; tone?: TabTone };

export function TabBar<T extends string>({ items, value, onChange, label = 'Chuyển nội dung', className = '' }: {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
  className?: string;
}) {
  return <nav className={`ui-tabbar ${className}`.trim()} aria-label={label}>
    {items.map(item => <button key={item.value} type="button" className={`ui-tab ui-tab-${item.tone ?? 'blue'}`} aria-pressed={value === item.value} onClick={() => onChange(item.value)}>
      <span>{item.label}</span>{item.count !== undefined && <b>{item.count}</b>}
    </button>)}
  </nav>;
}
