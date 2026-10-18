'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { AppShell } from './app-shell';
import * as authApi from '../lib/auth-api';

export const DEMO_USER: authApi.User = {
  id: 'usr-admin-demo',
  email: 'admin@smartchain.vn',
  name: 'Vũ Minh Quân',
  active: true,
  globalAccess: true,
  roles: [{ id: 'role-admin', code: 'ADMIN', name: 'Quản trị viên' }],
  permissions: ['*'],
  stores: [
    { id: 'str-1', code: 'STR-HN-01', name: 'CN Ba Đình (Hà Nội)', active: true },
    { id: 'str-2', code: 'STR-HN-02', name: 'CN Cầu Giấy (Hà Nội)', active: true },
    { id: 'str-3', code: 'STR-HCM-01', name: 'CN Quận 1 (TP.HCM)', active: true },
  ],
};

const AuthContext = createContext<{ user: authApi.User | null; ready: boolean; setUser: (user: authApi.User | null) => void }>({
  user: DEMO_USER,
  ready: true,
  setUser: () => {},
});
const ProtectedShellContext = createContext(false);

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<authApi.User | null>(null);
  const [ready, setReady] = useState(false);
  const isPreview = pathname === '/preview';

  useEffect(() => {
    if (isPreview) {
      setUser(DEMO_USER);
      setReady(true);
      return;
    }
    let active = true;
    setReady(false);
    authApi
      .refreshSession()
      .then((value) => {
        if (active) {
          setUser(value);
          setReady(true);
        }
      })
      .catch((reason) => {
        if (!active) return;
        if (reason instanceof authApi.ApiError && reason.status === 401) {
          setUser(null);
          setReady(true);
        } else { setUser(null); setReady(true); }
      });
    return () => {
      active = false;
    };
  }, [isPreview]);

  useEffect(() => {
    const expired = () => setUser(null);
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, []);

  return <AuthContext.Provider value={{ user, ready, setUser }}>{children}</AuthContext.Provider>;
}

export function Protected({ permission, children }: { permission?: string; children: React.ReactNode }) {
  const { user, ready, setUser } = useAuth();
  const shellActive = useContext(ProtectedShellContext);
  const router = useRouter();

  useEffect(() => {
    if (ready && !user) router.replace('/login');
  }, [ready, user, router]);

  if (!ready || !user) return (
    <main className="session-loading" role="status" aria-label="Đang tải phiên đăng nhập">
      <span className="session-loading-mark">
        <span className="session-loading-spinner" aria-hidden="true" />
        <img src="/logo.png" alt="FreshMart" />
      </span>
      <span className="sr-only">Đang tải phiên đăng nhập…</span>
    </main>
  );

  const content = permission && !user.permissions.includes(permission) && !user.permissions.includes('*') ? (
    <article className="empty-state">
      <h1>Không có quyền truy cập</h1>
      <p>Liên hệ chủ doanh nghiệp nếu bạn cần được cấp quyền.</p>
    </article>
  ) : children;
  if (shellActive) return <>{content}</>;

  return (
    <ProtectedShellContext.Provider value={true}><AppShell
      user={user}
      onLogout={async () => {
        try {
          await authApi.logout();
        } catch {
          // ignore
        }
        setUser(null);
        router.replace('/login');
      }}
    >
      {content}
    </AppShell></ProtectedShellContext.Provider>
  );
}
