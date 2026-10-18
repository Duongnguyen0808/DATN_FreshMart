'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, errorMessage } from '../lib/auth-api';
import { Icon } from './ui/icon';

type Notice = { id: string; kind: 'stocktake' | 'transfer' | 'purchase_request' | 'shift'; title: string; description: string; href: string; createdAt: string };
type NoticeResponse = { total: number; items: Notice[] };

export function NotificationMenu({ preview = false }: { preview?: boolean }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NoticeResponse | null>(null);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    if (preview) return;
    try {
      const result = await api<NoticeResponse>('notifications');
      setData(result);
      setError('');
    } catch (cause) { setError(errorMessage(cause)); }
  }, [preview]);

  useEffect(() => {
    if (preview) return;
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [load, preview]);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return <div className="notification-menu" ref={root}>
    <button className="icon-button notification-button" aria-label={`Việc cần xử lý${data?.total ? `: ${data.total}` : ''}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => { setOpen(value => !value); if (!preview) void load(); }}>
      <Icon name="bell" />{!preview && !!data?.total && <span className="notification-count">{data.total > 99 ? '99+' : data.total}</span>}
    </button>
    {open && <div className="notification-popover" role="dialog" aria-label="Việc cần xử lý">
      <div className="notification-heading"><strong>Việc cần xử lý</strong><button type="button" onClick={() => void load()} disabled={preview}>Làm mới</button></div>
      {!preview && !error && <p className="notification-scope">{'Huy hiệu hiển thị tổng số phiếu đang chờ theo quyền và chi nhánh được phân công.'}</p>}
      {preview ? <p className="notification-empty">Đăng nhập để xem dữ liệu vận hành.</p> : error ? <p className="notification-error">{error}</p> : !data ? <p className="notification-empty">Đang tải…</p> : data.total === 0 ? <p className="notification-empty">Không có việc nào đang chờ duyệt.</p> : <>
        <div className="notification-list">{data.items.map(item => <Link key={item.id} href={item.href} onClick={() => setOpen(false)} className={`notification-item notification-${item.kind}`}><span className="notification-item-icon"><Icon name={item.kind === 'stocktake' ? 'check' : item.kind === 'transfer' ? 'transfer' : item.kind === 'shift' ? 'clock' : 'bag'} size={16} /></span><span><strong>{item.title}</strong><small>{item.description}</small><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('vi-VN')}</time></span></Link>)}</div>
        {data.total > data.items.length && <p className="notification-more">Còn {data.total - data.items.length} việc đang chờ trong các mục nghiệp vụ.</p>}
      </>}
    </div>}
  </div>;
}
