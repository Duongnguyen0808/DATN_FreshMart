'use client';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { User } from '../lib/auth-api';
import { Icon } from './ui/icon';
import { scoreViMatch } from '../lib/vn-search';

export const demoBranches = ['CN Ba Đình (Hà Nội)', 'CN Quận 1 (TP.HCM)', 'CN Cầu Giấy (Hà Nội)', 'CN Hải Châu (Đà Nẵng)', 'CN Thảo Điền (TP.HCM)'];
const Context = createContext({ branch: 'all', showDetail: (_title: string, _text: string) => {} });
export const useShell = () => useContext(Context);

type MenuLink = {
  label: string;
  href: string;
  icon: string;
  permission?: string;
  badge?: string;
};

type MenuCol = {
  title: string;
  icon: string;
  links: MenuLink[];
};

type TopNavItem = {
  id: string;
  label: string;
  icon: string;
  href?: string;
  permission?: string;
  alignEnd?: boolean;
  columns?: MenuCol[];
};

const NAV_CONFIG: TopNavItem[] = [
  {
    id: 'dashboard',
    label: 'Tổng quan',
    icon: 'grid',
    href: '/',
    permission: 'dashboard.read',
  },
  {
    id: 'inventory',
    label: 'Hàng hóa & Tồn kho',
    icon: 'layers',
    columns: [
      {
        title: 'Danh mục hàng hóa',
        icon: 'box',
        links: [
          { label: 'Tất cả sản phẩm', href: '/san-pham', icon: 'box', permission: 'products.read' },
          { label: 'Lô & Hạn sử dụng', href: '/lo-han-dung', icon: 'clock', permission: 'inventory.read' },
          { label: 'Lịch sử tồn kho', href: '/lich-su-ton-kho', icon: 'receipt', permission: 'inventory.read' },
        ],
      },
      {
        title: 'Điều phối tồn kho',
        icon: 'store',
        links: [
          { label: 'Tồn kho toàn hệ thống', href: '/ton-kho', icon: 'store', permission: 'inventory.read' },
          { label: 'Chuyển hàng nội bộ', href: '/dieu-chuyen', icon: 'transfer', permission: 'transfers.read' },
          { label: 'Kiểm đếm kho', href: '/kiem-kho', icon: 'check', permission: 'stocktakes.read' },
          { label: 'Vận hành Mobile', href: '/van-hanh-mobile', icon: 'scan', permission: 'inventory.read' },
        ],
      },
    ],
  },
  {
    id: 'warehouse-3d',
    label: 'Kho 3D & IoT',
    icon: 'store',
    columns: [
      {
        title: 'Kho thông minh & Phần cứng',
        icon: 'scan',
        links: [
          { label: 'Mô hình kho 3D & QR', href: '/kho/mo-hinh-3d', icon: 'layers', permission: 'inventory.read', badge: '3D' },
          { label: 'Danh sách kho hàng', href: '/kho', icon: 'box', permission: 'warehouses.read' },
        ],
      },
    ],
  },
  {
    id: 'purchasing',
    label: 'Mua hàng & NCC',
    icon: 'truck',
    columns: [
      {
        title: 'Nhập hàng & Đối tác',
        icon: 'bag',
        links: [
          { label: 'Nhà cung cấp', href: '/nha-cung-cap', icon: 'truck', permission: 'suppliers.read' },
          { label: 'Đề nghị mua hàng', href: '/de-nghi-mua', icon: 'receipt', permission: 'purchase_requests.read' },
          { label: 'Đơn mua hàng (PO)', href: '/don-mua-hang', icon: 'bag', permission: 'purchase_orders.read' },
          { label: 'Nhập hàng vào kho', href: '/nhap-hang', icon: 'check', permission: 'purchase_orders.read' },
          { label: 'Trả hàng nhà cung cấp', href: '/tra-hang-ncc', icon: 'transfer', permission: 'purchase_orders.read' },
        ],
      },
    ],
  },
  {
    id: 'sales',
    label: 'Bán hàng & POS',
    icon: 'receipt',
    columns: [
      {
        title: 'Quầy thu ngân & Đơn bán',
        icon: 'receipt',
        links: [
          { label: 'Tạo đơn tại quầy (POS)', href: '/hoa-don/tao', icon: 'add', permission: 'invoices.read', badge: 'POS' },
          { label: 'Hóa đơn bán hàng', href: '/hoa-don', icon: 'receipt', permission: 'invoices.read' },
          { label: 'Trả hàng theo hóa đơn', href: '/tra-hang', icon: 'transfer', permission: 'returns.read' },
          { label: 'Ca làm việc thu ngân', href: '/ca-lam-viec', icon: 'clock', permission: 'shifts.read' },
          { label: 'Khách hàng thành viên', href: '/khach-hang', icon: 'users', permission: 'invoices.read' },
        ],
      },
    ],
  },
  {
    id: 'finance',
    label: 'Tài chính',
    icon: 'wallet',
    columns: [
      {
        title: 'Dòng tiền & Công nợ',
        icon: 'wallet',
        links: [
          { label: 'Sổ giao dịch thu chi', href: '/giao-dich', icon: 'card', permission: 'invoices.read' },
          { label: 'Công nợ nhà cung cấp', href: '/cong-no', icon: 'wallet', permission: 'payables.read' },
          { label: 'Công nợ phải thu KH', href: '/cong-no-phai-thu', icon: 'receipt', permission: 'invoices.read' },
          { label: 'Đối soát công nợ', href: '/doi-soat-cong-no', icon: 'check', permission: 'reports.read' },
        ],
      },
    ],
  },
  {
    id: 'analytics',
    label: 'Dự báo AI & Thống kê',
    icon: 'chart',
    columns: [
      {
        title: 'Dự báo nhu cầu AI',
        icon: 'sparkles',
        links: [
          { label: 'Dự báo hàng AI', href: '/du-bao-nhu-cau', icon: 'bulb', permission: 'reports.read', badge: 'AI' },
          { label: 'Cảnh báo thiếu hàng', href: '/canh-bao-thieu-hang', icon: 'warning', permission: 'reports.read' },
        ],
      },
      {
        title: 'Thống kê vận hành',
        icon: 'chart',
        links: [
          { label: 'Thống kê doanh thu', href: '/bao-cao-doanh-thu', icon: 'chart', permission: 'reports.read' },
          { label: 'Thống kê tồn kho', href: '/bao-cao-ton-kho', icon: 'store', permission: 'reports.read' },
          { label: 'Kết quả sản phẩm', href: '/bao-cao-san-pham', icon: 'box', permission: 'reports.read' },
          { label: 'So sánh chi nhánh', href: '/so-sanh-chi-nhanh', icon: 'globe', permission: 'reports.read' },
          { label: 'Thống kê công nợ', href: '/bao-cao-cong-no', icon: 'wallet', permission: 'reports.read' },
        ],
      },
    ],
  },
  {
    id: 'settings',
    label: 'Thiết lập',
    icon: 'settings',
    alignEnd: true,
    columns: [
      {
        title: 'Hệ thống & Phân quyền',
        icon: 'settings',
        links: [
          { label: 'Chi nhánh cửa hàng', href: '/chi-nhanh', icon: 'store', permission: 'stores.read' },
          { label: 'Danh mục kho hàng', href: '/kho', icon: 'box', permission: 'warehouses.read' },
          { label: 'Tài khoản nhân viên', href: '/users', icon: 'users', permission: 'users.read' },
          { label: 'Vai trò & Phân quyền', href: '/roles', icon: 'shield', permission: 'roles.read' },
          { label: 'Danh sách quyền hạn', href: '/permissions', icon: 'check', permission: 'permissions.read' },
        ],
      },
    ],
  },
];

export function AppShell({ children, user, onLogout, preview = false }: { children: React.ReactNode; user?: User | null; onLogout?: () => Promise<void>; preview?: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const area = /^\/(hoa-don|tra-hang|ca-lam-viec)(\/|$)/.test(path) ? 'sales'
    : /^\/(don-mua-hang|nhap-hang|nha-cung-cap|tra-hang-ncc|de-nghi-mua)/.test(path) ? 'purchasing'
    : /^\/(san-pham|ton-kho|kho|kiem-kho|dieu-chuyen|lo-han-dung|lich-su-ton-kho)/.test(path) ? 'inventory'
    : /^\/(khach-hang|users|roles|permissions)/.test(path) ? 'people'
    : /^\/(bao-cao|du-bao|so-sanh|canh-bao)/.test(path) ? 'insights'
    : /^\/(cong-no|giao-dich|doi-soat)/.test(path) ? 'finance' : 'overview';

  const [branch, setBranch] = useState('all');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [quickQuery, setQuickQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [detail, setDetail] = useState<{ title: string; text: string } | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  const headerRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const dashboard = path === '/' || preview;

  const hasPermission = (permission?: string) =>
    !permission || !user || user.permissions.includes('*') || user.permissions.includes(permission);

  const visibleNav = useMemo(() => {
    return NAV_CONFIG.map(item => {
      if (item.href) {
        return hasPermission(item.permission) ? item : null;
      }
      const cols = (item.columns ?? [])
        .map(col => ({ ...col, links: col.links.filter(l => hasPermission(l.permission)) }))
        .filter(col => col.links.length > 0);
      return cols.length > 0 ? { ...item, columns: cols } : null;
    }).filter((x): x is TopNavItem => x !== null);
  }, [user]);

  const flatSearchItems = useMemo(() => {
    const out: { label: string; group: string; href: string; icon: string }[] = [];
    const seen = new Set<string>();
    for (const item of visibleNav) {
      if (item.href) {
        const href = preview && item.href === '/' ? '/preview' : item.href;
        if (!seen.has(href)) {
          seen.add(href);
          out.push({ label: item.label, group: 'Trang chính', href, icon: item.icon });
        }
      }
      for (const col of item.columns ?? []) {
        for (const link of col.links) {
          if (!seen.has(link.href)) {
            seen.add(link.href);
            out.push({ label: link.label, group: col.title, href: link.href, icon: link.icon });
          }
        }
      }
    }
    return out;
  }, [visibleNav, preview]);

  const filteredSearch = useMemo(() => {
    const q = quickQuery.trim();
    if (!q) return flatSearchItems.slice(0, 7);
    return flatSearchItems
      .map(item => ({ item, score: scoreViMatch(q, item.label, [item.group, item.href]) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(entry => entry.item);
  }, [quickQuery, flatSearchItems]);

  const isLinkActive = (href: string) => {
    if (href === '/') return dashboard;
    if (href === '/kho') return path === '/kho';
    if (href === '/kho/mo-hinh-3d') {
      return path === '/kho/mo-hinh-3d' || path.startsWith('/kho/mo-hinh-3d/') || path.startsWith('/kho/giam-sat-cua');
    }
    if (href === '/hoa-don') {
      return path === '/hoa-don' || (path.startsWith('/hoa-don/') && !path.startsWith('/hoa-don/tao'));
    }
    return path === href || path.startsWith(`${href}/`);
  };

  const isTopActive = (item: TopNavItem) => {
    if (item.href) return isLinkActive(item.href);
    return (item.columns ?? []).some(col => col.links.some(l => isLinkActive(l.href)));
  };

  const showDetail = (title: string, text: string) => setDetail({ title, text });
  useEffect(() => { if (detail) dialog.current?.showModal(); else dialog.current?.close(); }, [detail]);

  useEffect(() => {
    setOpenMenuId(null);
    setMobileOpen(false);
    setSearchOpen(false);
    setAccountOpen(false);
  }, [path]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (window.scrollY > 12) {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        searchInputRef.current?.focus();
        setSearchOpen(true);
      } else if (event.key === 'Escape') {
        setOpenMenuId(null);
        setMobileOpen(false);
        setAccountOpen(false);
        setSearchOpen(false);
      }
    };
    const onClickOutside = (event: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
        setAccountOpen(false);
        setSearchOpen(false);
      }
    };
    const onScroll = () => {
      const passed = window.scrollY > 52;
      setIsScrolled(prev => (prev === passed ? prev : passed));
      if (passed) {
        setSearchOpen(false);
        setAccountOpen(false);
      }
    };
    onScroll();
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClickOutside);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  const handleMouseEnterItem = (id: string) => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) return;
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpenMenuId(id);
  };

  const handleMouseLeaveItem = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) return;
    closeTimerRef.current = window.setTimeout(() => setOpenMenuId(null), 130);
  };

  return (
    <Context.Provider value={{ branch, showDetail }}>
      <div data-area={area} className={`app-shell commerce-shell wm-horizontal${mobileOpen ? ' wm-drawer-open' : ''}`}>
        {mobileOpen && (
          <button
            type="button"
            className="wm-backdrop"
            aria-label="Đóng menu"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* FreshMart 2-Row Header (Row 1 scrolls away naturally, Row 2 slim 46px menu stays pinned) */}
        <header ref={headerRef} id="hmHeader" className={`hm${isScrolled ? ' is-scrolled' : ''}`}>
          {/* Row 1: Brand, Active Hub Pill, Command Search, Quick Tools & Account */}
          <div className="hm-bar">
            <div className="hm-in">
              <button
                type="button"
                className="hm-burger"
                aria-label="Mở menu điều hướng"
                aria-expanded={mobileOpen}
                onClick={() => setMobileOpen(v => !v)}
              >
                <Icon name="menu" size={20} />
              </button>

              <Link href={preview ? '/preview' : '/'} className="hm-brand" aria-label="FreshMart Warehouse POS">
                <span className="hm-brand-logo">
                  <img src="/logo.png" alt="FreshMart" />
                </span>
                <span className="hm-brand-text">
                  <strong>FreshMart</strong>
                  <em>POS</em>
                </span>
              </Link>

              {preview ? (
                <label className="hm-loc">
                  <Icon name="store" size={17} />
                  <span className="hm-loc-t">
                    <small>Chi nhánh xem trước</small>
                    <select aria-label="Chi nhánh minh họa" value={branch} onChange={event => setBranch(event.target.value)}>
                      <option value="all">Tất cả chi nhánh</option>
                      {demoBranches.map((name, index) => <option key={name} value={index}>{name}</option>)}
                    </select>
                  </span>
                </label>
              ) : (
                <div className="hm-loc">
                  <Icon name="store" size={17} />
                  <span className="hm-loc-t">
                    <small>Trung tâm điều phối</small>
                    <b>Kho &amp; Chuỗi Cửa Hàng</b>
                  </span>
                  <span className="hm-loc-tag"><i />LIVE</span>
                </div>
              )}

              <div className="hm-search-wrap">
                <form
                  className="hm-search"
                  onSubmit={event => {
                    event.preventDefault();
                    if (filteredSearch[0]) {
                      router.push(filteredSearch[0].href);
                      setSearchOpen(false);
                      setQuickQuery('');
                    }
                  }}
                >
                  <Icon name="search" size={16} />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={quickQuery}
                    onFocus={() => setSearchOpen(true)}
                    onChange={event => { setQuickQuery(event.target.value); setSearchOpen(true); }}
                    placeholder="Tìm nhanh phân hệ, kho 3D, hóa đơn..."
                    aria-label="Tìm nhanh phân hệ"
                  />
                  <kbd>Ctrl K</kbd>
                </form>

                {searchOpen && filteredSearch.length > 0 && (
                  <div className="hm-search-pop" role="listbox">
                    {filteredSearch.map(item => (
                      <button
                        type="button"
                        key={item.href}
                        className="hm-search-item"
                        onClick={() => {
                          router.push(item.href);
                          setSearchOpen(false);
                          setQuickQuery('');
                        }}
                      >
                        <span className="hm-ico"><Icon name={item.icon} size={15} /></span>
                        <span className="hm-search-copy">
                          <b>{item.label}</b>
                          <small>{item.group}</small>
                        </span>
                        <Icon name="arrowUpRight" size={14} />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="hm-tools">
                <Link href="/hoa-don/tao" className="wm-top-pos-btn" title="Tạo đơn bán hàng tại quầy">
                  <Icon name="add" size={15} />
                  <span>Bán hàng POS</span>
                </Link>

                <Link href="/kho/mo-hinh-3d" className="hm-icon-btn" title="Mô hình kho 3D & RFID">
                  <Icon name="scan" size={18} />
                </Link>

                <Link href="/lo-han-dung" className="hm-icon-btn hm-bell-btn" title="Cảnh báo lô & hạn sử dụng">
                  <Icon name="bell" size={18} />
                  <i className="hm-bell-dot" aria-hidden="true" />
                </Link>

                <span className="hm-sep" aria-hidden="true" />

                <div className="account-menu">
                  <button
                    type="button"
                    className="account-button hm-user-btn"
                    aria-expanded={accountOpen}
                    onClick={() => setAccountOpen(v => !v)}
                  >
                    <span className="hm-avatar"><Icon name="user" size={16} /></span>
                    <span className="hm-user-copy">
                      <strong>{user?.name ?? 'Quản trị viên'}</strong>
                      <small>{user?.roles?.[0]?.name ?? 'Điều hành hệ thống'}</small>
                    </span>
                    <Icon name="down" size={13} />
                  </button>

                  {accountOpen && (
                    <div className="account-popover hm-user-pop">
                      <div className="hm-user-pop-head">
                        <strong>{user?.name ?? 'Xem trước FreshMart'}</strong>
                        <p>{user?.email ?? 'Dữ liệu minh họa'}</p>
                      </div>
                      {preview ? (
                        <Link href="/login">Đăng nhập hệ thống <Icon name="chevron" size={14} /></Link>
                      ) : (
                        <button
                          type="button"
                          className="hm-logout-btn"
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
            </div>
          </div>

          {/* Row 2: Horizontal Mega-Menu Bar (Desktop) & Slide-out Drawer (Mobile) */}
          <div className="hm-menu">
            <div className="hm-in">
              <nav id="hmenu" className="hm-nav" aria-label="Menu chính">
                <div className="hm-nav-head">
                  <Link href={preview ? '/preview' : '/'} className="hm-brand" onClick={() => setMobileOpen(false)}>
                    <span className="hm-brand-logo"><img src="/logo.png" alt="FreshMart" /></span>
                    <span className="hm-brand-text"><strong>FreshMart</strong><em>POS</em></span>
                  </Link>
                  <button type="button" className="hm-burger hm-close-drawer" aria-label="Đóng menu" onClick={() => setMobileOpen(false)}>
                    <Icon name="close" size={18} />
                  </button>
                </div>

                <ul className="hm-list">
                  {visibleNav.map(item => {
                    const active = isTopActive(item);
                    const isOpen = openMenuId === item.id;
                    const isMega = (item.columns?.length ?? 0) > 1;

                    if (item.href) {
                      const targetHref = preview && item.href === '/' ? '/preview' : item.href;
                      return (
                        <li key={item.id} className="hm-item">
                          <Link
                            href={targetHref}
                            className={`hm-top${active ? ' has-active' : ''}`}
                            aria-current={active ? 'page' : undefined}
                            onClick={() => setMobileOpen(false)}
                          >
                            <span className="hm-top-ico"><Icon name={item.icon} size={16} /></span>
                            <span>{item.label}</span>
                          </Link>
                        </li>
                      );
                    }

                    return (
                      <li
                        key={item.id}
                        className={`hm-item${isOpen ? ' is-open' : ''}${item.alignEnd ? ' align-end' : ''}`}
                        onMouseEnter={() => handleMouseEnterItem(item.id)}
                        onMouseLeave={handleMouseLeaveItem}
                      >
                        <button
                          type="button"
                          className={`hm-top${active ? ' has-active' : ''}`}
                          aria-expanded={isOpen}
                          onClick={() => setOpenMenuId(cur => (cur === item.id ? null : item.id))}
                        >
                          <span className="hm-top-ico"><Icon name={item.icon} size={16} /></span>
                          <span>{item.label}</span>
                          <span className="hm-chev"><Icon name="down" size={12} /></span>
                        </button>

                        <div className={`hm-panel${isMega ? ' is-mega' : ''}`}>
                          <div className="hm-cols" style={{ gridTemplateColumns: `repeat(${item.columns?.length ?? 1}, minmax(215px, 1fr))` }}>
                            {(item.columns ?? []).map(col => (
                              <div className="hm-col" key={col.title}>
                                <p className="hm-col-t">
                                  <Icon name={col.icon} size={14} />
                                  <span>{col.title}</span>
                                </p>
                                <ul className="hm-links">
                                  {col.links.map(link => {
                                    const linkActive = isLinkActive(link.href);
                                    return (
                                      <li key={link.href}>
                                        <Link
                                          href={link.href}
                                          className={`hm-link${linkActive ? ' is-active' : ''}`}
                                          onClick={() => {
                                            setOpenMenuId(null);
                                            setMobileOpen(false);
                                          }}
                                        >
                                          <span className="hm-ico"><Icon name={link.icon} size={15} /></span>
                                          <span className="hm-label">{link.label}</span>
                                          {link.badge && <span className="hm-badge">{link.badge}</span>}
                                        </Link>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            ))}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </nav>

              <div className="hm-cap">
                <div className="hm-ring" aria-hidden="true"><span>24/7</span></div>
                <div className="hm-cap-t">
                  <b>Đồng bộ Cloud</b>
                  <small>Web · Kho 3D · iPhone</small>
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="workspace">
          <main className="main-content">{children}</main>
          <footer className="wm-footer">
            <p>© 2026 <strong>FreshMart WareHouse POS</strong> · Hệ thống quản trị kho vận, bán lẻ &amp; dự báo nhu cầu thông minh.</p>
          </footer>
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
