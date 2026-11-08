'use client';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { User } from '../lib/auth-api';
import { Icon } from './ui/icon';


export const demoBranches = ['CN Ba Đình (Hà Nội)', 'CN Quận 1 (TP.HCM)', 'CN Cầu Giấy (Hà Nội)', 'CN Hải Châu (Đà Nẵng)', 'CN Thảo Điền (TP.HCM)'];
const Context = createContext({ branch: 'all', showDetail: (_title: string, _text: string) => {} });
export const useShell = () => useContext(Context);
type NavItem = readonly [name: string, icon: string, href?: string, permission?: string];
type NavGroup = { name: string; icon: string; items: readonly NavItem[] };
const dashboardItem: NavItem = ['Tổng quan', 'grid', '/', 'dashboard.read'];
const groups: readonly NavGroup[] = [
  { name: 'B\u00e1n h\u00e0ng', icon: 'receipt', items: [['H\u00f3a \u0111\u01a1n b\u00e1n h\u00e0ng', 'receipt', '/hoa-don', 'invoices.read']] },
  { name: 'H\u00e0ng h\u00f3a & Kho', icon: 'box', items: [['S\u1ea3n ph\u1ea9m', 'box', '/san-pham', 'products.read'], ['T\u1ed3n kho', 'store', '/ton-kho', 'inventory.read'], ['L\u00f4 & h\u1ea1n d\u00f9ng', 'box', '/lo-han-dung', 'inventory.read'], ['Ki\u1ec3m \u0111\u1ebfm kho', 'check', '/kiem-kho', 'stocktakes.read'], ['Chuy\u1ec3n h\u00e0ng', 'transfer', '/dieu-chuyen', 'transfers.read']] },
  { name: 'Nh\u1eadp h\u00e0ng & NCC', icon: 'bag', items: [['Nh\u00e0 cung c\u1ea5p', 'truck', '/nha-cung-cap', 'suppliers.read'], ['\u0110\u01a1n mua h\u00e0ng', 'bag', '/don-mua-hang', 'purchase_orders.read'], ['Nh\u1eadp h\u00e0ng', 'receipt', '/nhap-hang', 'purchase_orders.read'], ['Tr\u1ea3 h\u00e0ng nh\u00e0 cung c\u1ea5p', 'transfer', '/tra-hang-ncc', 'purchase_orders.read']] },
  { name: 'C\u00f4ng n\u1ee3', icon: 'wallet', items: [['C\u00f4ng n\u1ee3 nh\u00e0 cung c\u1ea5p', 'wallet', '/cong-no', 'payables.read'], ['C\u00f4ng n\u1ee3 kh\u00e1ch h\u00e0ng', 'card', '/cong-no-phai-thu', 'receivables.read'], ['\u0110\u1ed1i so\u00e1t c\u00f4ng n\u1ee3', 'check', '/doi-soat-cong-no', 'reports.read']] },
  { name: 'B\u00e1o c\u00e1o', icon: 'chart', items: [['Doanh thu', 'chart', '/bao-cao-doanh-thu', 'reports.read'], ['T\u1ed3n kho', 'store', '/bao-cao-ton-kho', 'reports.read'], ['K\u1ebft qu\u1ea3 s\u1ea3n ph\u1ea9m', 'box', '/bao-cao-san-pham', 'reports.read'], ['So s\u00e1nh chi nh\u00e1nh', 'chart', '/so-sanh-chi-nhanh', 'reports.read'], ['C\u00f4ng n\u1ee3', 'wallet', '/bao-cao-cong-no', 'reports.read']] },
  { name: 'D\u1ef1 b\u00e1o h\u00e0ng', icon: 'bulb', items: [['D\u1ef1 b\u00e1o h\u00e0ng', 'chart', '/du-bao-nhu-cau', 'reports.read']] },
  { name: 'Thi\u1ebft l\u1eadp', icon: 'settings', items: [['Chi nh\u00e1nh', 'store', '/chi-nhanh', 'stores.read'], ['Kho h\u00e0ng', 'box', '/kho', 'warehouses.read'], ['Nh\u00e2n vi\u00ean', 'users', '/users', 'users.read'], ['Vai tr\u00f2 & ph\u00e2n quy\u1ec1n', 'shield', '/roles', 'roles.read']] },
] as const;
type TopModule = { name: string; icon: string; href: string; permission: string; sections: NavGroup[] };
const baseModules: TopModule[] = [
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
const warehouseSection: NavGroup = { name: 'Quản lý kho', icon: 'store', items: [
  ['Mô hình kho 3D', 'box', '/kho/mo-hinh-3d', 'inventory.read'],
  ['Tồn kho', 'store', '/ton-kho', 'inventory.read'],
  ['Lịch sử tồn kho', 'receipt', '/lich-su-ton-kho', 'inventory.read'],
  ['Báo cáo tồn kho', 'chart', '/bao-cao-ton-kho', 'reports.read'],
  ['Lô & hạn sử dụng', 'box', '/lo-han-dung', 'inventory.read'],
  ['Kiểm đếm kho', 'check', '/kiem-kho', 'stocktakes.read'],
  ['Chuyển hàng', 'transfer', '/dieu-chuyen', 'transfers.read'],
  ['Nhập hàng', 'receipt', '/nhap-hang', 'purchase_orders.read'],
  ['Kiện hàng & tem QR', 'box', '/kho/mo-hinh-3d/camera', 'purchase_orders.receive'],
  ['Danh sách kho', 'store', '/kho', 'warehouses.read'],
] };
const warehouseRoutes = new Set(warehouseSection.items.map(item => item[2]));
const topModules: TopModule[] = baseModules.flatMap(module => {
  const cleaned = { ...module, sections: module.sections.map(section => ({ ...section, items: section.items.filter(item => !warehouseRoutes.has(item[2])) })).filter(section => section.items.length) };
  return module.href === '/san-pham' ? [
    { ...cleaned, sections: [] },
    { name: 'Quản lý kho', icon: 'store', href: '/ton-kho', permission: 'inventory.read', sections: [warehouseSection] },
  ] : [cleaned];
});
const sidebarPositions = new Map<string, number>();
export function AppShell({ children, user, onLogout, preview = false }: { children: React.ReactNode; user?: User | null; onLogout?: () => Promise<void>; preview?: boolean }) {
  const path = usePathname();
  const area = /^\/(hoa-don|tra-hang)(\/|$)/.test(path) ? 'sales'
    : /^\/(don-mua-hang|nhap-hang|nha-cung-cap|tra-hang-ncc|de-nghi-mua)/.test(path) ? 'purchasing'
    : /^\/(san-pham|ton-kho|kho|kiem-kho|dieu-chuyen|lo-han-dung|lich-su-ton-kho)/.test(path) ? 'inventory'
    : /^\/(khach-hang|users|roles|permissions)/.test(path) ? 'people'
    : /^\/(bao-cao|du-bao|so-sanh)/.test(path) ? 'insights'
    : /^\/(cong-no|giao-dich|doi-soat)/.test(path) ? 'finance' : 'overview';
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => { try { setSidebarCollapsed(localStorage.getItem('freshmart-sidebar-collapsed') === '1'); } catch {} }, []);
  const [navExpanded, setNavExpanded] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState<{ title: string; text: string } | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const dashboard = path === '/' || preview;
  const currentPageLabel = dashboard ? 'Tổng quan' : path.startsWith('/thanh-toan') ? 'Thanh toán QR' : path.startsWith('/hoa-don/tao') ? 'Bán hàng tại quầy' : topModules.flatMap(module => [
    { href: module.href, label: module.name },
    ...module.sections.flatMap(section => section.items.filter(item => item[2]).map(item => ({ href: item[2]!, label: item[0] }))),
  ]).filter(item => item.href !== '/' && (path === item.href || path.startsWith(`${item.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.label ?? 'Tổng quan';
  const showDetail = (title: string, text: string) => setDetail({ title, text });
  useEffect(() => { if (detail) dialog.current?.showModal(); else dialog.current?.close(); }, [detail]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMobileOpen(false); setAccountOpen(false); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  const hasPermission = (permission?: string) => !permission || !user || user.permissions.includes('*') || user.permissions.includes(permission);
  return <Context.Provider value={{ branch, showDetail }}><div data-area={area} className={`app-shell commerce-shell${mobileOpen ? ' navigation-open' : ''}${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
    {mobileOpen && <button className="commerce-nav-backdrop" aria-label="Đóng menu" onClick={() => setMobileOpen(false)} />}
    <aside id="freshmart-sidebar" className="commerce-sidebar" aria-label="Menu chính">
      <Link className="commerce-brand" href={preview ? '/preview' : '/'}><img src="/logo.png" alt=""/><span>FreshMart<small>Quản lý bán lẻ</small></span></Link>
      <Link className="commerce-sale" href="/hoa-don/tao" title="Tạo đơn bán hàng" onClick={() => setMobileOpen(false)}><Icon name="add" size={18}/><span>Tạo đơn bán hàng</span></Link>
      <nav ref={navigation} onScroll={rememberSidebar}>
        <p>Quản lý cửa hàng</p>
        {topModules.filter(module => hasPermission(module.permission) || module.sections.some(section => section.items.some(item => hasPermission(item[3])))).map(module => {
          const active = module.href === '/' ? dashboard : path === module.href || path.startsWith(`${module.href}/`) || module.sections.some(section => section.items.some(item => item[2] && (path === item[2] || path.startsWith(`${item[2]}/`))));
          const entries = module.sections.flatMap(section => section.items).filter(item => (module.name === warehouseSection.name || item[2] !== module.href) && hasPermission(item[3]));
          const expanded = navExpanded[`${path}:${module.href}`] ?? active;
          const submenuId = `nav-${module.href.replaceAll('/', '-') || 'home'}`;
          return <div className="commerce-nav-group" key={module.name}>
            <Link className={active ? 'selected' : ''} aria-current={active ? 'page' : undefined} title={module.name} href={preview && module.href === '/' ? '/preview' : module.href} onClick={() => setMobileOpen(false)}><Icon name={module.icon} size={18}/><span>{module.name}</span></Link>
            {entries.length > 0 && <><button className="commerce-nav-expand" type="button" aria-label={`${expanded ? 'Thu gọn' : 'Mở rộng'} ${module.name}`} aria-expanded={expanded} aria-controls={submenuId} onClick={() => setNavExpanded(current => ({ ...current, [`${path}:${module.href}`]: !expanded }))}><Icon name="chevron" size={14}/></button><div id={submenuId} className={`commerce-subnav-wrap${expanded ? ' is-expanded' : ''}`} inert={!expanded}><div><div className="commerce-subnav">{entries.map(([label, , href]) => href && <Link key={href} className={path === href ? 'selected' : ''} href={href} onClick={() => setMobileOpen(false)}>{label}</Link>)}</div></div></div></>}
          </div>;
        })}
      </nav>
      <div className="commerce-sidebar-foot"><Icon name="store" size={18}/><span>FreshMart<small>Quản lý vận hành bán lẻ</small></span></div>
    </aside>
    <div className="workspace"><header className="topbar">
      <div className="topbar-left"><button className="icon-button mobile-toggle" aria-label="Mở menu" onClick={() => setMobileOpen(true)}><Icon name="menu" /></button><button type="button" className="icon-button desktop-sidebar-toggle" aria-label={sidebarCollapsed ? 'Mở rộng sidebar' : 'Thu gọn sidebar'} aria-expanded={!sidebarCollapsed} aria-controls="freshmart-sidebar" onClick={() => setSidebarCollapsed(current => { try { localStorage.setItem('freshmart-sidebar-collapsed', current ? '0' : '1'); } catch {} return !current; })}><Icon name="menu" size={18}/></button>
        {preview ? <label className="branch-select"><Icon name="store" size={16} /><select aria-label="Chi nhánh minh họa" value={branch} onChange={event => setBranch(event.target.value)}><option value="all">Tất cả chi nhánh</option>{demoBranches.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label> : <span className="scope-label" aria-label={`FreshMart · ${currentPageLabel}`}><span className="scope-brand-name">FreshMart</span><span className="scope-separator" aria-hidden="true">/</span><strong className="scope-page-name">{currentPageLabel}</strong></span>}
      </div>
      <div className="topbar-right" style={{ marginLeft: 'auto' }}>
        <div className="account-menu"><button className="account-button" aria-expanded={accountOpen} onClick={() => setAccountOpen(!accountOpen)}><span className="account-copy"><strong>{user?.name ?? 'Quản trị viên'}</strong><small>{user?.email ?? 'Bản xem trước giao diện'}</small></span><span className="avatar"><Icon name="user" size={17} /></span></button>
          {accountOpen && <div className="account-popover"><strong>{user?.name ?? 'Xem trước FreshMart'}</strong><p>{user?.roles.map(r => r.name).join(', ') ?? 'Dữ liệu minh họa'}</p>{preview ? <Link href="/login">Đăng nhập hệ thống <Icon name="chevron" size={14} /></Link> : <button disabled={loggingOut} onClick={async () => { setLoggingOut(true); try { await onLogout?.(); } catch { showDetail('Chưa đăng xuất được', 'Vui lòng kiểm tra kết nối và thử lại.'); } finally { setLoggingOut(false); } }}><Icon name="logout" size={16} />{loggingOut ? 'Đang đăng xuất…' : 'Đăng xuất'}</button>}</div>}
        </div>
      </div>
    </header><main className="main-content">{children}</main></div>
    <dialog ref={dialog} className="detail-dialog" onCancel={() => setDetail(null)} onClick={e => { if (e.target === e.currentTarget) setDetail(null); }}><div className="dialog-heading"><h2>{detail?.title}</h2><button className="icon-button" aria-label="Đóng chi tiết" onClick={() => setDetail(null)}><Icon name="close" /></button></div><p>{detail?.text}</p><button className="primary-button" onClick={() => setDetail(null)}>Đã hiểu</button></dialog>
  </div></Context.Provider>;
}

