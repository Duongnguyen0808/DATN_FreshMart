'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export type ToastTone = 'success' | 'error' | 'info';
type Toast = { id: number; message: string; tone: ToastTone };
type ConfirmationOptions = { title?: string; imageUrl?: string | null; imageFallback?: string; details?: string[] };
type ToastContextValue = { showToast: (message: string, tone?: ToastTone) => void; confirmAction: (message: string, options?: ConfirmationOptions) => Promise<boolean> };

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const [confirmation, setConfirmation] = useState<{ message: string; title: string; imageUrl?: string | null; imageFallback?: string; details: string[] } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmationResolver = useRef<((accepted: boolean) => void) | null>(null);

  const showToast = useCallback((message: string, tone: ToastTone = 'success') => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ id: Date.now(), message, tone });
    timerRef.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const confirmAction = useCallback((message: string, options: ConfirmationOptions = {}) => new Promise<boolean>(resolve => {
    confirmationResolver.current?.(false);
    confirmationResolver.current = resolve;
    setConfirmation({ message, title: options.title ?? 'Xác nhận thao tác', imageUrl: options.imageUrl, imageFallback: options.imageFallback, details: options.details ?? [] });
  }), []);

  const finishConfirmation = (accepted: boolean) => {
    confirmationResolver.current?.(accepted);
    confirmationResolver.current = null;
    setConfirmation(null);
  };

  const value = useMemo(() => ({ showToast, confirmAction }), [showToast, confirmAction]);
  return <ToastContext.Provider value={value}>
    {children}
    <div className="toast-region" aria-live="polite" aria-atomic="true">
      {toast && <div key={toast.id} className={`app-toast app-toast-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
        <span className="app-toast-icon" aria-hidden="true">{toast.tone === 'success' ? '✓' : toast.tone === 'error' ? '!' : 'i'}</span>
        <span className="app-toast-message">{toast.message}</span>
        <button type="button" aria-label="Đóng thông báo" onClick={() => setToast(null)}>×</button>
      </div>}
    </div>
    {confirmation && <div className="confirm-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) finishConfirmation(false); }}>
      <section className={`confirm-modal${confirmation.imageUrl || confirmation.details.length ? ' confirm-modal-product' : ''}`} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
        {confirmation.imageUrl ? <img className="confirm-product-image" src={confirmation.imageUrl} alt="" /> : confirmation.details.length ? <span className="confirm-product-placeholder" aria-hidden="true">{confirmation.imageFallback ?? 'SP'}</span> : <span className="confirm-modal-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3.5 22 20.5H2L12 3.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M12 9v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg></span>}
        <div className="confirm-modal-copy"><h2 id="confirm-title">{confirmation.title}</h2><p id="confirm-message">{confirmation.message}</p>{confirmation.details.length > 0 && <div className="confirm-product-details">{confirmation.details.map((detail, index) => <span key={`${index}-${detail}`}>{detail}</span>)}</div>}</div>
        <footer><button type="button" className="outline-button" onClick={() => finishConfirmation(false)}>Hủy</button><button type="button" className="primary-button" onClick={() => finishConfirmation(true)}>Xác nhận</button></footer>
      </section>
    </div>}
  </ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast phải được sử dụng bên trong ToastProvider.');
  return context;
}
