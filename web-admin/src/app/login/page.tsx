'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../components/auth-provider';
import { login, errorMessage } from '../../lib/auth-api';

export default function LoginPage() {
  const { user, ready, setUser } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [remember, setRemember] = useState(false);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (ready && user) router.replace('/'); }, [ready, user, router]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('smartchain-login-email');
      if (saved) { setEmail(saved); setRemember(true); }
    } catch { /* The form still works when browser storage is unavailable. */ }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy || user) return;
    setError(''); setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      const account = await login(email.trim(), String(data.get('password')));
      try {
        if (remember) localStorage.setItem('smartchain-login-email', email.trim());
        else localStorage.removeItem('smartchain-login-email');
      } catch { /* Authentication must not depend on local storage. */ }
      setUser(account);
      router.replace('/');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }

  return <main className="fm-login">
    <div className="fm-login-backdrop" aria-hidden="true" />
    <div className="fm-login-frame">
      <section className="fm-login-access" aria-labelledby="fm-login-title">
        <div className="fm-login-brand"><span><img src="/logo.png" alt="" width="44" height="44" /></span><strong>FreshMart</strong></div>
        <div className="fm-login-access-inner">
          <h1 id="fm-login-title">Chào mừng trở lại</h1>
          <p className="fm-login-intro">Đăng nhập để bắt đầu công việc hôm nay.</p>
          <form className="fm-login-form" onSubmit={submit}>
            <label htmlFor="login-email">Email tài khoản</label>
            <input id="login-email" name="email" type="email" autoComplete="username" inputMode="email" placeholder="ten@freshmart.vn" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />
            <label htmlFor="login-password">Mật khẩu</label>
            <div className="fm-login-password"><input id="login-password" name="password" type={visible ? 'text' : 'password'} autoComplete="current-password" placeholder="Nhập mật khẩu" required maxLength={128} disabled={busy} /><button type="button" aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} aria-pressed={visible} onClick={() => setVisible(!visible)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>{visible && <path d="m3 3 18 18"/>}</svg></button></div>
            <label className="fm-login-remember"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />Ghi nhớ email</label>
            {error && <p className="fm-login-error" role="alert">{error}</p>}
            <button className="fm-login-submit" disabled={busy || !ready || !!user} aria-busy={busy}>{busy && <span className="fm-login-spinner" aria-hidden="true" />}{busy ? 'Đang đăng nhập…' : !ready ? 'Đang kiểm tra phiên…' : user ? 'Đang chuyển trang…' : 'Đăng nhập'}{!busy && <span className="fm-login-submit-arrow" aria-hidden="true">→</span>}</button>
          </form>
          <p className="fm-login-help">Cần hỗ trợ đăng nhập? Liên hệ quản trị viên cửa hàng.</p>
        </div>
        <span className="fm-login-access-footer">© {new Date().getFullYear()} FreshMart</span>
      </section>
    </div>
  </main>;
}
