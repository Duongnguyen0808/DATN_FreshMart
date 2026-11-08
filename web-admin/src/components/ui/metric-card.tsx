import type { ReactNode } from 'react';
import { Icon } from './icon';

export type MetricTone = 'teal' | 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'cyan' | 'indigo' | 'orange';
const toneIcons: Record<MetricTone, string> = { teal:'wallet', blue:'receipt', green:'chart', amber:'warning', red:'warning', violet:'users', cyan:'card', indigo:'store', orange:'wallet' };
export const metricTones: MetricTone[] = ['blue', 'green', 'amber', 'red'];

export function MetricGrid({ children, className = '', label }: { children: ReactNode; className?: string; label?: string }) {
  return <section className={`metric-grid record-summary ${className}`.trim()} aria-label={label}>{children}</section>;
}

export function MetricCard({
  label, value, caption, tone = 'blue', icon, className = '', onClick,
}: {
  label: ReactNode;
  value: ReactNode;
  caption?: ReactNode;
  tone?: MetricTone;
  icon?: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const valueKey = typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
  const displayLabel = typeof label === 'string' && label === label.toLocaleUpperCase('vi-VN')
    ? label.charAt(0) + label.slice(1).toLocaleLowerCase('vi-VN') : label;
  const content = <><div className="metric-card-label"><span>{displayLabel}</span>{icon ?? <Icon name={toneIcons[tone]} size={18}/>}</div><strong key={valueKey} className="metric-card-value">{value}</strong>{caption && <div className="metric-card-caption">{caption}</div>}</>;
  const classes = `metric-card metric-tone-${tone} ${className}`.trim();
  return onClick ? <button type="button" className={classes} onClick={onClick}>{content}</button> : <article className={classes}>{content}</article>;
}
