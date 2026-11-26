/**
 * FreshMart Mobile Design System
 * Đồng bộ 100% mã màu HEX/RGB từ Web Admin (web-admin/src/app/turquoise-theme.css)
 */

export const Colors = {
  // Brand & Primary (turquoise-theme.css: --primary, --brand, --brand-hover)
  primary: '#0d7a73',
  primaryDark: '#0a655f',
  primaryLight: '#14b8a6',
  primarySoft: '#e5f7f5',
  primaryWash: '#f1f9f7',

  // Neutrals & Surface (turquoise-theme.css: --bg, --surface, --surface-soft)
  background: '#f6f9f8',
  surface: '#ffffff',
  surfaceSoft: '#f3faf8',
  card: '#ffffff',

  // Text & Ink (turquoise-theme.css: --ink, --muted, nav-group)
  text: '#0f2928',
  textSecondary: '#3c5553',
  muted: '#566e6c',
  textLight: '#7b9290',

  // Borders & Lines (turquoise-theme.css: --border, --area-line)
  border: '#e2ece9',
  borderSoft: '#eaf3f1',
  borderFocus: '#14b8a6',

  // Semantic Status Colors
  success: '#059669',
  successBg: '#ecfdf5',
  successBorder: '#a7f3d0',

  warning: '#d97706',
  warningBg: '#fffbeb',
  warningBorder: '#fde68a',

  danger: '#dc2626',
  dangerBg: '#fef2f2',
  dangerBorder: '#fecaca',

  info: '#0d7a73',
  infoBg: '#e5f7f5',
  infoBorder: '#bce5de',

  // Overlay
  backdrop: 'rgba(15, 41, 40, 0.42)',
  scannerReticle: '#14b8a6',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const Radius = {
  card: 14,
  control: 10,
  badge: 8,
  sheet: 22,
  pill: 999,
  sm: 6,
  md: 10,
  lg: 16,
};

export const Typography = {
  sizes: {
    micro: 10,
    caption: 11,
    sm: 12,
    body: 14,
    md: 15,
    title: 16,
    lg: 18,
    xl: 22,
    headline: 24,
  },
  weights: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
};

export const Shadows = {
  card: {
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  cardHover: {
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  button: {
    shadowColor: '#08736c',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 4,
    elevation: 2,
  },
};
