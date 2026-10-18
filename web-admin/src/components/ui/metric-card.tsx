import type { ReactNode } from 'react';

export type MetricTone = 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'cyan';
export const metricTones: MetricTone[] = ['blue', 'green', 'amber', 'red'];

export function MetricGrid({ children, className = '', label }: { children: ReactNode; className?: string; label?: string }) {
  return <section className={`metric-grid ${className}`.trim()} aria-label={label}>{children}</section>;
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
  const content = <><div className="metric-card-label"><span>{label}</span>{icon}</div><strong key={valueKey} className="metric-card-value metric-value-enter">{value}</strong>{caption && <div className="metric-card-caption">{caption}</div>}</>;
  const classes = `metric-card metric-tone-${tone} ${className}`.trim();
  return onClick ? <button type="button" className={classes} onClick={onClick}>{content}</button> : <article className={classes}>{content}</article>;
}
