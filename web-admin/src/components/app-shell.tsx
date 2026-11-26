'use client';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { User } from '../lib/auth-api';
import { Icon } from './ui/icon';

export const demoBranches = ['CN Ba Đình (Hà Nội)', 'CN Quận 1 (TP.HCM)', 'CN Cầu Giấy (Hà Nội)', 'CN Hải Châu (Đà Nẵng)', 'CN Thảo Điền (TP.HCM)'];
const Context = createContext({ branch: 'all', showDetail: (_title: string, _text: string) => {} });
export const useShell = () => useContext(Context);
type NavItem = readonly [name: string, icon: string, href?: string, permission?: string];
type NavGroup = { name: string; icon: string; items: readonly NavItem[] };

const groups: readonly NavGroup[] = [
  { name: 'Bán hàng', icon: 'receipt', items: [['Hóa đơn bán hàng', 'receipt', '/hoa-don', 'invoices.read'], ['Ca làm việc', 'clock', '/ca-lam-viec', 'shifts.read']] },
  { name: 'Hàng hóa & Kho', icon: 'box', items: [['Sản phẩm', 'box', '/san-pham', 'products.read'], ['Tồn kho', 'store', '/ton-kho', 'inventory.read'], ['Lô và hạn sử dụng', 'box', '/lo-han-dung', 'inventory.read'], ['Kiểm đếm kho', 'check', '/kiem-kho', 'stocktakes.read'], ['Vận hành Mobile', 'check', '/van-hanh-mobile', 'inventory.read'], ['Chuyển hàng', 'transfer', '/dieu-chuyen', 'transfers.read']] },
  { name: 'Nhập hàng & NCC', icon: 'bag', items: [['Nhà cung cấp', 'truck', '/nha-cung-cap', 'suppliers.read'], ['Đề nghị mua hàng', 'receipt', '/de-nghi-mua', 'purchase_requests.read'], ['Đơn mua hàng', 'bag', '/don-mua-hang', 'purchase_orders.read'], ['Nhập hàng', 'receipt', '/nhap-hang', 'purchase_orders.read'], ['Trả hàng nhà cung cấp', 'transfer', '/tra-hang-ncc', 'purchase_orders.read']] },
  { name: 'Công nợ', icon: 'wallet', items: [['Công nợ nhà cung cấp', 'wallet', '/cong-no', 'payables.read'], ['Đối soát công nợ', 'check', '/doi-soat-cong-no', 'reports.read']] },
  { name: 'Thống kê', icon: 'chart', items: [['Doanh thu', 'chart', '/bao-cao-doanh-thu', 'reports.read'], ['Tồn kho', 'store', '/bao-cao-ton-kho', 'reports.read'], ['Kết quả sản phẩm', 'box', '/bao-cao-san-pham', 'reports.read'], ['So sánh chi nhánh', 'chart', '/so-sanh-chi-nhanh', 'reports.read'], ['Công nợ', 'wallet', '/bao-cao-cong-no', 'reports.read']] },
  { name: 'Dự báo hàng', icon: 'bulb', items: [['Dự báo hàng', 'chart', '/du-bao-nhu-cau', 'reports.read']] },
  { name: 'Thiết lập', icon: 'settings', items: [['Chi nhánh', 'store', '/chi-nhanh', 'stores.read'], ['Kho hàng', 'box', '/kho', 'warehouses.read'], ['Nhân viên', 'users', '/users', 'users.read'], ['Vai trò & phân quyền', 'shield', '/roles', 'roles.read']] },
] as const;

type TopModule = { name: string; icon: string; href: string; permission: string; sections: NavGroup[] };
const baseModules: TopModule[] = [
  { name: 'Tổng quan', icon: 'home', href: '/', permission: 'dashboard.read', sections: [] },
  { name: 'Hàng hóa', icon: 'box', href: '/san-pham', permission: 'products.read', sections: [groups[1]] },
  { name: 'Mua hàng', icon: 'bag', href: '/don-mua-hang', permission: 'purchase_orders.read', sections: [groups[2]] },
  { name: 'Đơn hàng', icon: 'receipt', href: '/hoa-don', permission: 'invoices.read', sections: [groups[0], { name: 'Trả hàng', icon: 'transfer', items: [['Trả hàng theo hóa đơn', 'transfer', '/tra-hang', 'returns.read']] }] },
  { name: 'Nhân viên', icon: 'users', href: '/users', permission: 'users.read', sections: [{ name: 'Nhân sự & thiết lập', icon: 'users', items: [...groups[6].items.filter(item => item[3] === 'users.read'), ...groups[6].items.filter(item => item[3] === 'roles.read')] }] },
  { name: 'Tài chính', icon: 'wallet', href: '/giao-dich', permission: 'invoices.read', sections: [groups[3]] },
  { name: 'Dự báo hàng', icon: 'bulb', href: '/du-bao-nhu-cau', permission: 'reports.read', sections: [] },
  { name: 'Thống kê', icon: 'chart', href: '/bao-cao-doanh-thu', permission: 'reports.read', sections: [groups[4]] },
  { name: 'Thiết lập', icon: 'settings', href: '/chi-nhanh', permission: 'stores.read', sections: [{ ...groups[6], items: groups[6].items.filter(item => item[3] !== 'users.read' && item[3] !== 'roles.read') }, { name: 'Phân quyền', icon: 'shield', items: [['Danh sách quyền', 'check', '/permissions', 'permissions.read']] }] },
];

const warehouseSection: NavGroup = {
  name: 'Quản lý kho',
  icon: 'store',
  items: [
    ['Mô hình kho 3D', 'box', '/kho/mo-hinh-3d', 'inventory.read'],
    ['Tồn kho', 'store', '/ton-kho', 'inventory.read'],
    ['Lịch sử tồn kho', 'receipt', '/lich-su-ton-kho', 'inventory.read'],
    ['Thống kê tồn kho', 'chart', '/bao-cao-ton-kho', 'reports.read'],
    ['Lô và hạn sử dụng', 'box', '/lo-han-dung', 'inventory.read'],
    ['Kiểm đếm kho', 'check', '/kiem-kho', 'stocktakes.read'],
    ['Chuyển hàng', 'transfer', '/dieu-chuyen', 'transfers.read'],
    ['Nhập hàng', 'receipt', '/nhap-hang', 'purchase_orders.read'],
    ['Danh sách kho', 'store', '/kho', 'warehouses.read'],
  ],
};

const warehouseRoutes = new Set(warehouseSection.items.map(item => item[2]));
const topModules: TopModule[] = baseModules.flatMap(module => {
  const cleaned = {
    ...module,
    sections: module.sections
      .map(section => ({ ...section, items: section.items.filter(item => !warehouseRoutes.has(item[2])) }))
      .filter(section => section.items.length),
  };
  return module.href === '/san-pham'
    ? [
        { ...cleaned, sections: [] },
        { name: 'Quản lý kho', icon: 'store', href: '/ton-kho', permission: 'inventory.read', sections: [warehouseSection] },
      ]
    : [cleaned];
});

const sidebarPositions = new Map<string, number>();

export function AppShell({ children, user, onLogout, preview = false }: { children: React.ReactNode; user?: User | null; onLogout?: () => Promise<void>; preview?: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const area = /^\/(hoa-don|tra-hang|ca-lam-viec)(\/|$)/.test(path) ? 'sales'
    : /^\/(don-mua-hang|nhap-hang|nha-cung-cap|tra-hang-ncc|de-nghi-mua)/.test(path) ? 'purchasing'
    : /^\/(san-pham|ton-kho|kho|kiem-kho|dieu-chuyen|lo-han-dung|lich-su-ton-kho)/.test(path) ? 'inventory'
    : /^\/(khach-hang|users|roles|permissions)/.test(path) ? 'people'
    : /^\/(bao-cao|du-bao|so-sanh)/.test(path) ? 'insights'
    : /^\/(cong-no|giao-dich|doi-soat)/.test(path) ? 'finance' : 'overview';

  const navigation = useRef<HTMLElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
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
  const [quickQuery, setQuickQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  useEffect(() => {
    try { setSidebarCollapsed(localStorage.getItem('freshmart-sidebar-collapsed') === '1'); } catch {}
  }, []);

  const [navExpanded, setNavExpanded] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState<{ title: string; text: string } | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const dashboard = path === '/' || preview;

  const hasPermission = (permission?: string) =>
    !permission || !user || user.permissions.includes('*') || user.permissions.includes(permission);

  const quickRoutes = useMemo(() => {
    const list: { label: string; group: string; href: string; icon: string }[] = [
      { label: 'Bán hàng tại quầy (POS)', group: 'Bán hàng nhanh', href: '/hoa-don/tao', icon: 'add' },
    ];
    const seen = new Set<string>(['/hoa-don/tao']);
    for (const mod of topModules) {
      if (hasPermission(mod.permission) && !seen.has(mod.href)) {
        seen.add(mod.href);
        list.push({ label: mod.name, group: 'Phân hệ chính', href: preview && mod.href === '/' ? '/preview' : mod.href, icon: mod.icon });
      }
      for (const sec of mod.sections) {
        for (const [label, icon, href, perm] of sec.items) {
          if (href && hasPermission(perm) && !seen.has(href)) {
            seen.add(href);
            list.push({ label, group: mod.name, href, icon });
          }
        }
      }
    }
    return list;
  }, [user, preview]);

  const filteredQuickRoutes = useMemo(() => {
    const q = quickQuery.trim().toLowerCase();
    if (!q) return quickRoutes.slice(0, 7);
    return quickRoutes.filter(item => item.label.toLowerCase().includes(q) || item.group.toLowerCase().includes(q)).slice(0, 8);
  }, [quickQuery, quickRoutes]);

  const currentPageLabel = dashboard ? 'Tổng quan' : path.startsWith('/thanh-toan') ? 'Thanh toán QR' : path.startsWith('/hoa-don/tao') ? 'Bán hàng tại quầy' : topModules.flatMap(module => [
    { href: module.href, label: module.name },
    ...module.sections.flatMap(section => section.items.filter(item => item[2]).map(item => ({ href: item[2]!, label: item[0] }))),
  ]).filter(item => item.href !== '/' && (path === item.href || path.startsWith(`${item.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.label ?? 'Tổng quan';

  const showDetail = (title: string, text: string) => setDetail({ title, text });
  useEffect(() => { if (detail) dialog.current?.showModal(); else dialog.current?.close(); }, [detail]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileOpen(false);
        setAccountOpen(false);
        setSearchFocused(false);
      }
    };
    const clickOutside = (event: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(event.target as Node)) {
        setSearchFocused(false);
      }
    };
    window.addEventListener('keydown', key);
    window.addEventListener('mousedown', clickOutside);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('mousedown', clickOutside);
    };
  }, []);

  const visibleModules = topModules.filter(
    module => hasPermission(module.permission) || module.sections.some(section => section.items.some(item => hasPermission(item[3])))
  );
  const primaryModules = visibleModules.slice(0, 2);
  const groupModules = visibleModules.slice(2);

  const renderModuleRow = (module: TopModule, withTintBadge: boolean) => {
    const active = module.href === '/' ? dashboard : path === module.href || path.startsWith(`${module.href}/`) || module.sections.some(section => section.items.some(item => item[2] && (path === item[2] || path.startsWith(`${item[2]}/`))));
    const entries = module.sections.flatMap(section => section.items).filter(item => hasPermission(item[3]));
    const expanded = navExpanded[`${path}:${module.href}`] ?? active;
    const submenuId = `nav-${module.href.replaceAll('/', '-') || 'home'}`;
    return (
      <div className={`commerce-nav-group${withTintBadge ? ' is-category-module' : ''}`} key={module.name}>
        <Link
          className={active ? 'selected' : ''}
          aria-current={active ? 'page' : undefined}
          title={module.name}
          href={preview && module.href === '/' ? '/preview' : module.href}
          onClick={() => setMobileOpen(false)}
        >
          <span className="offio-nav-icon"><Icon name={module.icon} size={17} /></span>
          <span>{module.name}</span>
        </Link>
        {entries.length > 0 && (
          <>
            <button
              className="commerce-nav-expand"
              type="button"
              aria-label={`${expanded ? 'Thu gọn' : 'Mở rộng'} ${module.name}`}
              aria-expanded={expanded}
              aria-controls={submenuId}
              onClick={() => setNavExpanded(current => ({ ...current, [`${path}:${module.href}`]: !expanded }))}
            >
              <Icon name="chevron" size={14} />
            </button>
            <div id={submenuId} className={`commerce-subnav-wrap${expanded ? ' is-expanded' : ''}`} inert={!expanded}>
              <div>
                <div className="commerce-subnav">
                  {entries.map(([label, , href]) => href && (
                    <Link key={href} className={path === href ? 'selected' : ''} href={href} onClick={() => setMobileOpen(false)}>
                      {label}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <Context.Provider value={{ branch, showDetail }}>
      <div data-area={area} className={`app-shell commerce-shell offio-shell${mobileOpen ? ' navigation-open' : ''}${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
        {mobileOpen && <button className="commerce-nav-backdrop" aria-label="Đóng menu" onClick={() => setMobileOpen(false)} />}

        <header className="topbar offio-topbar">
          <div className="topbar-left offio-brand-cluster">
            <button className="icon-button mobile-toggle offio-glass-icon" aria-label="Mở menu" onClick={() => setMobileOpen(true)}>
              <Icon name="menu" size={19} />
            </button>
            <Link className="commerce-brand offio-header-brand" href={preview ? '/preview' : '/'}>
              <span className="offio-logo-badge"><img src="/logo.png" alt="FreshMart" /></span>
              <span className="offio-brand-copy">
                <strong>FRESHMART</strong>
                <small>Hệ thống quản trị bán lẻ &amp; kho thông minh</small>
              </span>
            </Link>
          </div>

          <div className="offio-search-center" ref={searchBoxRef}>
            <form
              className="offio-search-pill"
              onSubmit={event => {
                event.preventDefault();
                if (filteredQuickRoutes[0]) {
                  router.push(filteredQuickRoutes[0].href);
                  setSearchFocused(false);
                  setQuickQuery('');
                }
              }}
            >
              <Icon name="search" size={17} />
              <input
                type="text"
                value={quickQuery}
                onFocus={() => setSearchFocused(true)}
                onChange={event => { setQuickQuery(event.target.value); setSearchFocused(true); }}
                placeholder="Tìm công cụ: bán hàng POS, tồn kho, mô hình 3D, thống kê..."
                aria-label="Tìm nhanh phân hệ và công cụ"
              />
              <Link href="/kho/mo-hinh-3d" className="offio-search-scan" title="Mô hình kho 3D & Quét QR">
                <Icon name="scan" size={17} />
              </Link>
            </form>
            {searchFocused && filteredQuickRoutes.length > 0 && (
              <div className="offio-search-dropdown" role="listbox">
                {filteredQuickRoutes.map(item => (
                  <button
                    type="button"
                    key={item.href}
                    className="offio-search-option"
                    onClick={() => {
                      router.push(item.href);
                      setSearchFocused(false);
                      setQuickQuery('');
                    }}
                  >
                    <span className="offio-search-opt-icon"><Icon name={item.icon} size={15} /></span>
                    <span className="offio-search-opt-copy">
                      <strong>{item.label}</strong>
                      <small>{item.group}</small>
                    </span>
                    <Icon name="chevron" size={13} />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="topbar-right offio-topbar-right">
            {preview ? (
              <label className="branch-select offio-glass-pill">
                <Icon name="store" size={15} />
                <select aria-label="Chi nhánh minh họa" value={branch} onChange={event => setBranch(event.target.value)}>
                  <option value="all">Tất cả chi nhánh</option>
                  {demoBranches.map((name, index) => <option key={name} value={index}>{name}</option>)}
                </select>
              </label>
            ) : (
              <span className="scope-label offio-glass-pill" aria-label={`FreshMart · ${currentPageLabel}`}>
                <span className="scope-brand-name">Phân hệ</span>
                <span className="scope-separator" aria-hidden="true">·</span>
                <strong className="scope-page-name">{currentPageLabel}</strong>
              </span>
            )}

            <Link href="/lo-han-dung" className="offio-glass-icon" title="Theo dõi lô & cận hạn">
              <Icon name="bell" size={17} />
            </Link>

            <div className="account-menu">
              <button className="account-button offio-account-pill" aria-expanded={accountOpen} onClick={() => setAccountOpen(!accountOpen)}>
                <span className="avatar"><Icon name="user" size={16} /></span>
                <span className="account-copy">
                  <strong>{user?.name ?? 'Quản trị viên'}</strong>
                </span>
              </button>
              {accountOpen && (
                <div className="account-popover">
                  <strong>{user?.name ?? 'Xem trước FreshMart'}</strong>
                  <p>{user?.roles.map(r => r.name).join(', ') ?? user?.email ?? 'Dữ liệu minh họa'}</p>
                  {preview ? (
                    <Link href="/login">Đăng nhập hệ thống <Icon name="chevron" size={14} /></Link>
                  ) : (
                    <button
                      disabled={loggingOut}
                      onClick={async () => {
                        setLoggingOut(true);
                        try { await onLogout?.(); } catch { showDetail('Chưa đăng xuất được', 'Vui lòng kiểm tra kết nối và thử lại.'); } finally { setLoggingOut(false); }
                      }}
                    >
                      <Icon name="logout" size={16} />
                      {loggingOut ? 'Đang đăng xuất…' : 'Đăng xuất'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        <aside id="freshmart-sidebar" className="commerce-sidebar offio-sidebar" aria-label="Menu chính">
          <div className="offio-sidebar-collapse-row">
            <button
              type="button"
              className="desktop-sidebar-toggle offio-collapse-btn"
              aria-label={sidebarCollapsed ? 'Mở rộng sidebar' : 'Thu gọn sidebar'}
              aria-expanded={!sidebarCollapsed}
              aria-controls="freshmart-sidebar"
              onClick={() => setSidebarCollapsed(current => {
                try { localStorage.setItem('freshmart-sidebar-collapsed', current ? '0' : '1'); } catch {}
                return !current;
              })}
            >
              <span className="offio-collapse-label">Thu gọn menu</span>
              <Icon name="chevron" size={14} style={{ transform: sidebarCollapsed ? 'rotate(0deg)' : 'rotate(180deg)' }} />
            </button>
          </div>

          <nav ref={navigation} onScroll={rememberSidebar}>
            <div className="offio-nav-primary">
              {primaryModules.map(mod => renderModuleRow(mod, false))}
              <div className="commerce-nav-group">
                <Link
                  className={path.startsWith('/hoa-don/tao') ? 'selected' : 'offio-pos-shortcut'}
                  href="/hoa-don/tao"
                  title="Tạo đơn bán hàng"
                  onClick={() => setMobileOpen(false)}
                >
                  <span className="offio-nav-icon"><Icon name="add" size={17} /></span>
                  <span>Tạo đơn bán hàng</span>
                </Link>
              </div>
            </div>

            <p className="offio-nav-section-title">NHÓM NGHIỆP VỤ</p>
            {groupModules.map(mod => renderModuleRow(mod, true))}
          </nav>

          <div className="commerce-sidebar-foot">
            <Icon name="store" size={17} />
            <span>FreshMart<small>Vận hành bán lẻ 24/7</small></span>
          </div>
        </aside>

        <div className="workspace">
          <main className="main-content">{children}</main>
        </div>

        <dialog ref={dialog} className="detail-dialog" onCancel={() => setDetail(null)} onClick={e => { if (e.target === e.currentTarget) setDetail(null); }}>
          <div className="dialog-heading">
            <h2>{detail?.title}</h2>
            <button className="icon-button" aria-label="Đóng chi tiết" onClick={() => setDetail(null)}><Icon name="close" /></button>
          </div>
          <p>{detail?.text}</p>
          <button className="primary-button" onClick={() => setDetail(null)}>Đã hiểu</button>
        </dialog>
      </div>
    </Context.Provider>
  );
}
