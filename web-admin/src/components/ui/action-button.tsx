import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

export type ActionTone = 'view' | 'edit' | 'approve' | 'danger' | 'print' | 'more';

type Common = { tone: ActionTone; children: ReactNode; className?: string };

export function ActionButton({ tone, children, className = '', type = 'button', ...props }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={`ui-action-button action-${tone} ${className}`.trim()} {...props}>{children}</button>;
}

export function ActionLink({ tone, children, className = '', href, ...props }: Common & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <Link href={href} className={`ui-action-button action-${tone} ${className}`.trim()} {...props}>{children}</Link>;
}
