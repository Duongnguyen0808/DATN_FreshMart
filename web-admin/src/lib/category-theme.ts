import type { CSSProperties } from 'react';

type CategoryKey = { id?: string; code?: string; name?: string };
const themes = {
  all: { ink: '#087f78', fill: '#e8f8f5', border: '#a7ded7', selected: '#cbefea', icon: 'grid' },
  peach: { ink: '#96451d', fill: '#fff0e5', border: '#f0c6a6', selected: '#ffdfc8', icon: 'cookie' },
  lavender: { ink: '#7041a0', fill: '#f4edfc', border: '#d8c4ed', selected: '#e7d7f6', icon: 'sparkles' },
  sky: { ink: '#1b6394', fill: '#eaf6ff', border: '#b4d9f1', selected: '#d0eaff', icon: 'bottle' },
  indigo: { ink: '#484b9c', fill: '#eeeefe', border: '#c7c8ee', selected: '#ddddfa', icon: 'home' },
  amber: { ink: '#835a0a', fill: '#fff7de', border: '#e9d392', selected: '#fcebb5', icon: 'leaf' },
  coral: { ink: '#a34436', fill: '#fff0ec', border: '#efbdb2', selected: '#ffdad0', icon: 'bowl' },
  ice: { ink: '#176779', fill: '#e9f8fc', border: '#abdce7', selected: '#ccedf5', icon: 'snowflake' },
  caramel: { ink: '#795039', fill: '#f7eee6', border: '#ddc5b1', selected: '#edd8c7', icon: 'coffee' },
} as const;
const known: Record<string, keyof typeof themes> = {
  BANH_KEO_DO_KHO: 'peach', CHAM_SOC_CA_NHAN: 'lavender', DO_UONG_SUA: 'sky',
  GIA_DUNG: 'indigo', GIA_VI_THUC_PHAM: 'amber', MI_AN_LIEN: 'coral',
  THUC_PHAM_DONG_LANH: 'ice', TRA_CA_PHE: 'caramel',
};
const fallback = ['peach', 'lavender', 'sky', 'indigo', 'amber', 'coral', 'ice', 'caramel'] as const;

/** Category codes are stable across list, inventory and POS API responses. */
export function categoryTheme(category?: CategoryKey) {
  const key = category?.code || category?.id || '';
  const hash = [...key].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
  const tone = !key ? 'all' : known[key] ?? fallback[hash % fallback.length];
  const theme = themes[tone];
  return { tone, icon: theme.icon, style: {
    '--category-ink': theme.ink, '--category-fill': theme.fill,
    '--category-border': theme.border, '--category-selected': theme.selected,
  } as CSSProperties };
}
