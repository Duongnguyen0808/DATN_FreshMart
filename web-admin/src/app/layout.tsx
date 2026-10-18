import type { Metadata } from 'next';
import './globals.css';
import './auth-loading.css';
import './interaction-overrides.css';
import { AuthProvider } from '../components/auth-provider';
import { ToastProvider } from '../components/ui/toast-provider';

export const metadata: Metadata = { title: 'FreshMart | Tổng quan vận hành', description: 'FreshMart retail operations management', icons: { icon: '/logo.png', shortcut: '/logo.png', apple: '/logo.png' } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      </head>
      <body>
        <ToastProvider><AuthProvider>{children}</AuthProvider></ToastProvider>
      </body>
    </html>
  );
}
