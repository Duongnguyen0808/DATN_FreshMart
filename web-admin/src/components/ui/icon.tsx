import type { CSSProperties } from 'react';
const paths: Record<string, string> = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  store: 'M3 10v11h18V10 M2 10l2-7h16l2 7 M2 10c0 4 5 4 5 0 0 4 5 4 5 0 0 4 5 4 5 0 0 4 5 4 5 0 M9 21v-7h6v7',
  box: 'M3 7l9-5 9 5v10l-9 5-9-5z M3 7l9 5 9-5 M12 12v10 M7 4l10 6',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-4 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  receipt: 'M5 3l2 1 2-1 3 1 3-1 2 1 2-1v18l-2-1-2 1-3-1-3 1-2-1-2 1z M8 8h8 M8 12h8 M8 16h5',
  clock: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M12 6v6l4 2',
  check: 'M9 11l3 3L22 4 M20 12v8H3V3h13',
  transfer: 'M3 7h17l-4-4 M21 17H4l4 4',
  bag: 'M4 7h16l1 14H3z M8 8V6a4 4 0 0 1 8 0v2',
  truck: 'M1 3h14v14H1z M15 8h4l4 5v4h-8 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M21 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  wallet: 'M20 7V3H4a2 2 0 0 0 0 4h17v14H3V7 M21 11h-6v6h6 M17 14h1',
  card: 'M3 5h18v14H3z M3 9h18 M7 15h3',
  chart: 'M3 3v18h18 M6 16l5-6 4 3 6-8',
  warning: 'M12 3L1 21h22z M12 9v5 M12 17v1',
  bulb: 'M9 18h6 M9 21h6 M9 15a7 7 0 1 1 6 0v3H9z',
  shield: 'M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6z M8 11l3 3 5-6',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  search: 'M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
  help: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M9 8a3 3 0 1 1 4 3l-1 2 M12 17v1',
  calendar: 'M3 5h18v16H3z M3 10h18 M7 2v6 M17 2v6',
  download: 'M12 3v12 M8 11l4 4 4-4 M4 16v5h16v-5',
  chevron: 'M8 5l7 7-7 7', down: 'M6 9l6 6 6-6', close: 'M6 6l12 12 M18 6L6 18',
  menu: 'M3 6h18 M3 12h18 M3 18h18', logout: 'M9 4H3v16h6 M9 12h12 M17 8l4 4-4 4',
  user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2',
};
export function Icon({ name, size = 18, style }: { name: string; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name] ?? paths.box} /></svg>;
}
