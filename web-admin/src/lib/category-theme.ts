import type { CSSProperties } from 'react';

type CategoryKey = { id?: string; code?: string; name?: string };
const themes = {
  all: { ink: '#0d9488', fill: '#ffffff', border: '#dce4e0', selected: '#0d9488', icon: 'grid' },
  peach: { ink: '#ea580c', fill: '#ffffff', border: '#dce4e0', selected: '#0d9488', icon: 'candy' },
  lavender: { ink: '#9333ea', fill: '#ffffff', border: '#dce4e0', selected: '#0d9488', icon: 'sparkles' },
  sky: { ink: '#0284c7', fill: '#ffffff', border: '#dce4e0', selected: '#0d9488', icon: 'bottle' },
  indigo: { ink: '#4f46e5', fill: '#ffffff', border: '#dce4e0', selected: '#0d9488', icon: 'home' },
  amber: { ink: '#16a34a', fill: '#ffffff', border: '#dce4e0', selected: '#0d9488', icon: 'leaf' },
  coral: { ink: '#e11d48', fill: '#ffffff', border: '#dce4e0', selected: '#0d9488', icon: 'bowl' },
  ice: { ink: '#0891b2', fill: '#ffffff', border: '#dce4e0', selected: '#0d9488', icon: 'snowflake' },
  caramel: { ink: '#854d0e', fill: '#ffffff', border: '#dce4e0', selected: '#0d9488', icon: 'coffee' },
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
