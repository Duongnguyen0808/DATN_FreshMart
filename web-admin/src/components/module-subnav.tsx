'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const reportItems = [
  ['Doanh thu', '/bao-cao-doanh-thu'],
  ['Tồn kho', '/bao-cao-ton-kho'],
  ['Công nợ', '/bao-cao-cong-no'],
  ['Sản phẩm', '/bao-cao-san-pham'],
  ['Chi nhánh', '/so-sanh-chi-nhanh'],
] as const;
const aiItems = [
  ['Dự báo hàng', '/du-bao-nhu-cau'],
] as const;

export function ModuleSubnav({ kind }: { kind: 'reports' | 'ai' }) {
  const path = usePathname();
  const items = kind === 'reports' ? reportItems : aiItems;
  return <nav className="module-subnav" aria-label={kind === 'reports' ? 'Các báo cáo' : 'Phân tích và AI'}>
    <span>{kind === 'reports' ? 'Báo cáo' : 'Dự báo hàng'}</span>
    <div>{items.map(([label, href]) => <Link key={href} href={href} aria-current={path === href || path.startsWith(`${href}/`) ? 'page' : undefined}>{label}</Link>)}</div>
  </nav>;
}
