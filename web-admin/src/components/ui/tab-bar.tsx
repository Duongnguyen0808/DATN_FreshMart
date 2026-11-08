import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Icon } from './icon';

export type TabTone = 'blue' | 'cyan' | 'green' | 'amber' | 'violet' | 'red' | 'orange' | 'rose';
export type TabItem<T extends string> = { value: T; label: ReactNode; count?: number; tone?: TabTone; style?: CSSProperties; className?: string };
const iconByTone: Record<TabTone, string> = { blue:'receipt', cyan:'chart', green:'check', amber:'clock', violet:'truck', red:'warning', orange:'bag', rose:'bag' };
const rotatingTones: TabTone[] = ['cyan','blue','amber','violet','green','orange','rose'];

function tabTone(value: string, index: number): TabTone {
  const key = value.toLowerCase();
  if (['all', 'tất cả'].includes(key)) return 'cyan';
  if (/(complete|approved|active|paid|available|success|done)/.test(key)) return 'green';
  if (/(cancel|reject|inactive|out|overdue|fail)/.test(key)) return 'red';
  if (/(pending|wait|low|draft|counting|process)/.test(key)) return 'amber';
  return rotatingTones[index % rotatingTones.length];
}

export function TabBar<T extends string>({ items, value, onChange, label = 'Chuyển nội dung', className = '' }: {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
  className?: string;
}) {
  const navRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const update = () => {
      const active = [...nav.querySelectorAll<HTMLButtonElement>(':scope > .ui-tab')].find(tab => tab.getAttribute('aria-pressed') === 'true');
      if (!active) return;
      nav.style.setProperty('--tab-indicator-x', `${active.offsetLeft}px`);
      nav.style.setProperty('--tab-indicator-width', `${active.offsetWidth}px`);
      nav.dataset.indicatorReady = 'true';
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    [...nav.querySelectorAll(':scope > .ui-tab')].forEach(tab => observer.observe(tab));
    return () => observer.disconnect();
  }, [value, items.length]);
  return <nav ref={navRef} className={`ui-tabbar ${className}`.trim()} aria-label={label}>
    {items.map((item, index) => {
      const tone = item.tone ?? tabTone(item.value, index);
      return <button key={item.value} type="button" style={item.style} className={`ui-tab ui-tab-${tone} ${item.className ?? ''}`} aria-pressed={value === item.value} onClick={() => onChange(item.value)}>
        <span>{item.className?.includes('category-filter') ? null : <Icon name={iconByTone[tone]} size={15}/>} {item.label}</span>{item.count !== undefined && <b>{item.count}</b>}
      </button>;
    })}
  </nav>;
}
