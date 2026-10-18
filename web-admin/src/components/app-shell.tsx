'use client';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { User } from '../lib/auth-api';
import { Icon } from './ui/icon';
import { NotificationMenu } from './notification-menu';

export const demoBranches = ['CN Ba Đình (Hà Nội)', 'CN Quận 1 (TP.HCM)', 'CN Cầu Giấy (Hà Nội)', 'CN Hải Châu (Đà Nẵng)', 'CN Thảo Điền (TP.HCM)'];
const Context = createContext({ branch: 'all', showDetail: (_title: string, _text: string) => {} });
export const useShell = () => useContext(Context);
type NavItem = readonly [name: string, icon: string, href?: string, permission?: string];
type NavGroup = { name: string; icon: string; items: readonly NavItem[] };
const dashboardItem: NavItem = ['Tổng quan', 'grid', '/', 'dashboard.read'];
const groups: readonly NavGroup[] = [
  { name: 'B\u00e1n h\u00e0ng', icon: 'receipt', items: [['H\u00f3a \u0111\u01a1n b\u00e1n h\u00e0ng', 'receipt', '/hoa-don', 'invoices.read']] },
  { name: 'H\u00e0ng h\u00f3a & Kho', icon: 'box', items: [['S\u1ea3n ph\u1ea9m', 'box', '/san-pham', 'products.read'], ['T\u1ed3n kho', 'store', '/ton-kho', 'inventory.read'], ['Ki\u1ec3m \u0111\u1ebfm kho', 'check', '/kiem-kho', 'stocktakes.read'], ['Chuy\u1ec3n h\u00e0ng', 'transfer', '/dieu-chuyen', 'transfers.read']] },
  { name: 'Nh\u1eadp h\u00e0ng & NCC', icon: 'bag', items: [['Nh\u00e0 cung c\u1ea5p', 'truck', '/nha-cung-cap', 'suppliers.read'], ['\u0110\u01a1n mua h\u00e0ng', 'bag', '/don-mua-hang', 'purchase_orders.read'], ['Nh\u1eadp h\u00e0ng', 'receipt', '/nhap-hang', 'purchase_orders.read'], ['Tr\u1ea3 h\u00e0ng nh\u00e0 cung c\u1ea5p', 'transfer', '/tra-hang-ncc', 'purchase_orders.read']] },
  { name: 'C\u00f4ng n\u1ee3', icon: 'wallet', items: [['C\u00f4ng n\u1ee3 nh\u00e0 cung c\u1ea5p', 'wallet', '/cong-no', 'payables.read'], ['C\u00f4ng n\u1ee3 kh\u00e1ch h\u00e0ng', 'card', '/cong-no-phai-thu', 'receivables.read'], ['\u0110\u1ed1i so\u00e1t c\u00f4ng n\u1ee3', 'check', '/doi-soat-cong-no', 'reports.read']] },
  { name: 'B\u00e1o c\u00e1o', icon: 'chart', items: [['Doanh thu', 'chart', '/bao-cao-doanh-thu', 'reports.read'], ['T\u1ed3n kho', 'store', '/bao-cao-ton-kho', 'reports.read'], ['K\u1ebft qu\u1ea3 s\u1ea3n ph\u1ea9m', 'box', '/bao-cao-san-pham', 'reports.read'], ['So s\u00e1nh chi nh\u00e1nh', 'chart', '/so-sanh-chi-nhanh', 'reports.read'], ['C\u00f4ng n\u1ee3', 'wallet', '/bao-cao-cong-no', 'reports.read']] },
  { name: 'D\u1ef1 b\u00e1o h\u00e0ng', icon: 'bulb', items: [['D\u1ef1 b\u00e1o h\u00e0ng', 'chart', '/du-bao-nhu-cau', 'reports.read']] },
  { name: 'Thi\u1ebft l\u1eadp', icon: 'settings', items: [['Chi nh\u00e1nh', 'store', '/chi-nhanh', 'stores.read'], ['Kho h\u00e0ng', 'box', '/kho', 'warehouses.read'], ['Nh\u00e2n vi\u00ean', 'users', '/users', 'users.read'], ['Vai tr\u00f2 & ph\u00e2n quy\u1ec1n', 'shield', '/roles', 'roles.read']] },
] as const;
type TopModule = { name: string; icon: string; href: string; permission: string; sections: NavGroup[] };
const topModules: TopModule[] = [
  { name: 'T\u1ed5ng quan', icon: 'grid', href: '/', permission: 'dashboard.read', sections: [] },
  { name: 'H\u00e0ng h\u00f3a', icon: 'box', href: '/san-pham', permission: 'products.read', sections: [groups[1]] },
  { name: 'Mua h\u00e0ng', icon: 'bag', href: '/don-mua-hang', permission: 'purchase_orders.read', sections: [groups[2]] },
  { name: '\u0110\u01a1n h\u00e0ng', icon: 'receipt', href: '/hoa-don', permission: 'invoices.read', sections: [groups[0], { name: 'Tr\u1ea3 h\u00e0ng', icon: 'transfer', items: [['Tr\u1ea3 h\u00e0ng theo h\u00f3a \u0111\u01a1n', 'transfer', '/tra-hang', 'returns.read']] }] },
  { name: 'Kh\u00e1ch h\u00e0ng', icon: 'users', href: '/khach-hang', permission: 'customers.read', sections: [] },
  { name: 'Nh\u00e2n vi\u00ean', icon: 'users', href: '/users', permission: 'users.read', sections: [{ name: 'Nh\u00e2n s\u1ef1 & thi\u1ebft l\u1eadp', icon: 'users', items: [...groups[6].items.filter(item => item[3] === 'users.read'), ...groups[6].items.filter(item => item[3] === 'roles.read')] }] },
  { name: 'T\u00e0i ch\u00ednh', icon: 'wallet', href: '/giao-dich', permission: 'invoices.read', sections: [groups[3]] },
  { name: 'D\u1ef1 b\u00e1o h\u00e0ng', icon: 'bulb', href: '/du-bao-nhu-cau', permission: 'reports.read', sections: [] },
  { name: 'B\u00e1o c\u00e1o', icon: 'chart', href: '/bao-cao-doanh-thu', permission: 'reports.read', sections: [groups[4]] },
  { name: 'Thi\u1ebft l\u1eadp', icon: 'settings', href: '/chi-nhanh', permission: 'stores.read', sections: [{ ...groups[6], items: groups[6].items.filter(item => item[3] !== 'users.read' && item[3] !== 'roles.read') }, { name: 'Ph\u00e2n quy\u1ec1n', icon: 'shield', items: [['Danh s\u00e1ch quy\u1ec1n', 'check', '/permissions', 'permissions.read']] }] },
];
const groupRouteAliases: Record<string, readonly string[]> = {
  'B\u00e1n h\u00e0ng': ['/tra-h\u00e0ng'],
  'T\u00e0i ch\u00ednh': ['/giao-d\u1ecbch'],
  'B\u00e1o c\u00e1o': [],
  'D\u1ef1 b\u00e1o h\u00e0ng': [],
  'Thi\u1ebft l\u1eadp': ['/permissions'],
};
const sidebarPositions = new Map<string, number>();
export function AppShell({ children, user, onLogout, preview = false }: { children: React.ReactNode; user?: User | null; onLogout?: () => Promise<void>; preview?: boolean }) {
  const path = usePathname();
  const navigation = useRef<HTMLElement>(null);
  const scrollKey = preview ? 'preview' : user?.id ?? 'anonymous';
  const positionKey = `smartchain-sidebar-${scrollKey}`;
  const rememberSidebar = () => {
    const top = navigation.current?.scrollTop ?? 0;
    sidebarPositions.set(scrollKey, top);
    try { sessionStorage.setItem(positionKey, String(top)); } catch {}
  };
  useLayoutEffect(() => {
    const element = navigation.current;
    if (!element) return;
    let saved = sidebarPositions.get(scrollKey);
    if (saved === undefined) {
      try { const stored = sessionStorage.getItem(positionKey); saved = stored === null ? 0 : Number(stored); } catch { saved = 0; }
    }
    element.scrollTop = Number.isFinite(saved) ? saved! : 0;
    return rememberSidebar;
  }, [scrollKey, positionKey]);
  const [branch, setBranch] = useState('all');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [topMenuOpen, setTopMenuOpen] = useState('');
  const [detail, setDetail] = useState<{ title: string; text: string } | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const activeGroup = groups.find(group => group.items.some(item => item[2] && (path === item[2] || path.startsWith(`${item[2]}/`))) || (groupRouteAliases[group.name] ?? []).some(href => path === href || path.startsWith(`${href}/`)))?.name ?? '';
  const [openGroup, setOpenGroup] = useState(activeGroup);
  const dialog = useRef<HTMLDialogElement>(null);
  const dashboard = path === '/' || preview;
  const showDetail = (title: string, text: string) => setDetail({ title, text });
  useEffect(() => { if (detail) dialog.current?.showModal(); else dialog.current?.close(); }, [detail]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMobileOpen(false); setAccountOpen(false); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  const hasPermission = (permission?: string) => !permission || !user || user.permissions.includes('*') || user.permissions.includes(permission);
  useEffect(() => { if (activeGroup) setOpenGroup(activeGroup); }, [activeGroup]);
  const unavailable = (title: string) => { showDetail(title, 'Màn hình này đang được chuẩn bị. Bạn đang xem bản thiết kế giao diện; chưa phát sinh thay đổi dữ liệu nghiệp vụ.'); setMobileOpen(false); };
  return <Context.Provider value={{ branch, showDetail }}><div className="app-shell">
    <div className="workspace"><header className="topbar">
      <div className="topbar-left"><button className="icon-button mobile-toggle" aria-label="Mở menu" onClick={() => setMobileOpen(true)}><Icon name="menu" /></button>
        {preview ? <label className="branch-select"><Icon name="store" size={16} /><select aria-label="Chi nhánh minh họa" value={branch} onChange={event => setBranch(event.target.value)}><option value="all">Tất cả chi nhánh</option>{demoBranches.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label> : <span className="scope-label" aria-label="FreshMart"><img src="/logo.png" alt="Logo FreshMart" /></span>}
      </div>
      <div className="topbar-right"><button className="icon-button" aria-label="Trợ giúp" onClick={() => showDetail('Chào mừng đến FreshMart', 'Sử dụng menu bên trái để chuyển chức năng. Dashboard hiển thị dữ liệu vận hành theo quyền và chi nhánh của tài khoản. Dùng chuông thông báo để xem việc đang chờ xử lý.')}><Icon name="help" /></button><NotificationMenu preview={preview} /><span className="top-divider" />
        <div className="account-menu"><button className="account-button" aria-expanded={accountOpen} onClick={() => setAccountOpen(!accountOpen)}><span className="account-copy"><strong>{user?.name ?? 'Quản trị viên'}</strong><small>{user?.email ?? 'Bản xem trước giao diện'}</small></span><span className="avatar"><Icon name="user" size={17} /></span></button>
          {accountOpen && <div className="account-popover"><strong>{user?.name ?? 'Xem trước FreshMart'}</strong><p>{user?.roles.map(r => r.name).join(', ') ?? 'Dữ liệu minh họa'}</p>{preview ? <Link href="/login">Đăng nhập hệ thống <Icon name="chevron" size={14} /></Link> : <button disabled={loggingOut} onClick={async () => { setLoggingOut(true); try { await onLogout?.(); } catch { showDetail('Chưa đăng xuất được', 'Vui lòng kiểm tra kết nối và thử lại.'); } finally { setLoggingOut(false); } }}><Icon name="logout" size={16} />{loggingOut ? 'Đang đăng xuất…' : 'Đăng xuất'}</button>}</div>}
        </div>
      </div>
    </header><nav className="top-module-nav" aria-label="\u0110i\u1ec1u h\u01b0\u1edbng khu v\u1ef1c ch\u00ednh" onMouseLeave={() => setTopMenuOpen('')}>
      {topModules.filter(module => hasPermission(module.permission) || module.sections.some(section => section.items.some(item => hasPermission(item[3])))).map(module => {
        const routeActive = module.href === '/' ? dashboard : path === module.href || path.startsWith(`${module.href}/`) || module.sections.some(section => section.items.some(item => item[2] && (path === item[2] || path.startsWith(`${item[2]}/`))));
        const sections = module.sections.map(section => ({ ...section, items: section.items.filter(item => item[2] !== module.href && hasPermission(item[3])) })).filter(section => section.items.length);
        return <div className={`top-module-item ${routeActive ? 'active' : ''}`} key={module.name} onMouseEnter={() => sections.length && setTopMenuOpen(module.name)} onFocus={() => sections.length && setTopMenuOpen(module.name)}>
          <div className="top-module-tab"><Link href={preview && module.href === '/' ? '/preview' : module.href} className={routeActive ? 'active' : ''}><Icon name={module.icon} size={16}/><span>{module.name}</span></Link>{sections.length > 0 && <button type="button" aria-label={`M\u1edf menu ${module.name}`} aria-expanded={topMenuOpen === module.name} onClick={() => setTopMenuOpen(topMenuOpen === module.name ? '' : module.name)}><Icon name="down" size={13}/></button>}</div>
          {sections.length > 0 && topMenuOpen === module.name && <div className="top-module-dropdown">{sections.map(section => <section key={section.name}><strong>{section.name}</strong>{section.items.map(([label, icon, href]) => href ? <Link key={`${label}-${href}`} href={href} onClick={() => setTopMenuOpen('')}><Icon name={icon} size={15}/><span>{label}</span></Link> : null)}</section>)}</div>}
        </div>;
      })}
      <Link className="top-nav-sale" href="/hoa-don/tao"><Icon name="receipt" size={16}/><span>{'Bán hàng'}</span></Link>
    </nav><main className="main-content">{children}</main></div>
    <dialog ref={dialog} className="detail-dialog" onCancel={() => setDetail(null)} onClick={e => { if (e.target === e.currentTarget) setDetail(null); }}><div className="dialog-heading"><h2>{detail?.title}</h2><button className="icon-button" aria-label="Đóng chi tiết" onClick={() => setDetail(null)}><Icon name="close" /></button></div><p>{detail?.text}</p><button className="primary-button" onClick={() => setDetail(null)}>Đã hiểu</button></dialog>
  </div></Context.Provider>;
}

