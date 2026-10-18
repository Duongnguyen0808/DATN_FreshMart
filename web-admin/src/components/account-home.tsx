'use client';
import { useEffect, useState } from 'react';
import { useAuth, Protected } from './auth-provider';
import { api, errorMessage, type Store } from '../lib/auth-api';

function Account() {
  const { user } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (user?.permissions.includes('stores.read')) api<Store[]>('stores').then(setStores).catch(reason => setError(errorMessage(reason))).finally(() => setLoading(false));
    else setLoading(false);
  }, [user]);
  return <><p className="eyebrow">TÀI KHOẢN CỦA BẠN</p><h1>Xin chào, {user?.name}</h1>
    <p className="intro">{user?.roles.map(role => role.name).join(' · ')}</p>
    <article><h2>Phạm vi truy cập</h2><p>{user?.globalAccess ? 'Toàn hệ thống' : 'Các chi nhánh được phân công'}</p>
      {loading ? <p>Đang tải…</p> : <ul>{stores.map(store => <li key={store.id}>{store.code} — {store.name}</li>)}</ul>}
      {!loading && !error && stores.length === 0 && <p>Chưa có chi nhánh được phép truy cập.</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </article></>;
}
export default function AccountHome() { return <Protected><Account /></Protected>; }
