import type { ReactNode } from 'react';
import { Icon } from './icon';

export type Crumb = string | { label: ReactNode; href?: string };

export function PageHeader({
  breadcrumbs,
  title,
  description,
  actions,
  className = '',
  variant = 'suite',
}: {
  breadcrumbs?: Crumb[];
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  variant?: 'suite' | 'detail';
}) {
  const baseClass = variant === 'detail' ? 'detail-heading' : 'suite-heading';
  return (
    <header className={`${baseClass} ${className}`.trim()}>
      <div>
        {breadcrumbs && breadcrumbs.length > 0 && (
          <div className="breadcrumb">
            {breadcrumbs.map((crumb, index) => (
              <span key={index}>
                {index > 0 && <span> › </span>}
                {typeof crumb === 'string' ? crumb : crumb.label}
              </span>
            ))}
          </div>
        )}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </header>
  );
}

export function PanelCard({
  title,
  meta,
  actions,
  children,
  className = '',
  as = 'section',
}: {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  as?: 'section' | 'article' | 'div';
}) {
  const Tag = as;
  return (
    <Tag className={`suite-panel panel ${className}`.trim()}>
      {(title || meta || actions) && (
        <div className="panel-heading">
          <div>
            {title && <h2>{title}</h2>}
            {meta && <span className="panel-meta">{meta}</span>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </Tag>
  );
}

export function FilterToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Tìm kiếm...',
  onClear,
  clearLabel = 'Xóa lọc',
  children,
  className = '',
}: {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  onClear?: () => void;
  clearLabel?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`suite-filters ${className}`.trim()}>
      <label className="ui-search-input">
        <Icon name="search" size={16} />
        <input
          value={searchValue}
          onChange={event => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
        />
      </label>
      {children}
      {onClear && (
        <button type="button" className="ui-filter-clear" onClick={onClear}>
          {clearLabel}
        </button>
      )}
    </div>
  );
}

