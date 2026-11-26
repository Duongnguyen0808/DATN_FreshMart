import type { Metadata } from 'next';
import './globals.css';
import './auth-loading.css';
import './interaction-overrides.css';
import './retail-ui.css';
import './workspaces.css';
import './records.css';
import './polish.css';
import './visual-emphasis.css';
import './analytics-studio.css';
import './turquoise-theme.css';
import './enterprise-ui.css';
import './table-align-clean.css';
import './warehouse-pos-theme.css';
import './login.css';
import { AuthProvider } from '../components/auth-provider';
import { ToastProvider } from '../components/ui/toast-provider';

export const metadata: Metadata = { title: 'FreshMart | Tổng quan vận hành', description: 'FreshMart retail operations management', icons: { icon: '/logo.png', shortcut: '/logo.png', apple: '/logo.png' } };

const EXTENSION_CLEANUP_SCRIPT = `(function(){var A=['bis_skin_checked','bis_register','bis_size','data-bis-config'];function c(r){if(!r)return;if(r.removeAttribute){for(var k=0;k<A.length;k++)r.removeAttribute(A[k]);}if(!r.querySelectorAll)return;var n=r.querySelectorAll(A.map(function(a){return '['+a+']';}).join(','));for(var i=0;i<n.length;i++){for(var j=0;j<A.length;j++)n[i].removeAttribute(A[j]);}}c(document.documentElement);if(typeof MutationObserver!=='undefined'){new MutationObserver(function(m){for(var i=0;i<m.length;i++){var x=m[i];if(x.type==='attributes'&&x.target&&x.target.removeAttribute){x.target.removeAttribute(x.attributeName);}else if(x.type==='childList'){for(var j=0;j<x.addedNodes.length;j++)c(x.addedNodes[j]);}}}).observe(document.documentElement,{attributes:true,childList:true,subtree:true,attributeFilter:A});}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: EXTENSION_CLEANUP_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="retail-ui" suppressHydrationWarning>
        <ToastProvider><AuthProvider>{children}</AuthProvider></ToastProvider>
      </body>
    </html>
  );
}
