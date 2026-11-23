export interface ThemePalette {
  id: string;
  name: string;
  desc: string;
  mode: 'dark' | 'light';
  windowBgHex: string;
  preview: [string, string, string]; // sidebar, canvas, accent
  vars: Record<string, string>;
}

export interface AccentPreset {
  id: string;
  name: string;
  swatch: string;
  dark: { accent: string; strong: string; soft: string; glow: string; border: string; selected: string; hover: string };
  light: { accent: string; strong: string; soft: string; glow: string; border: string; selected: string; hover: string };
}

export const THEME_PALETTES: ThemePalette[] = [
  {
    id: 'lavender',
    name: 'Lavender Dusk',
    desc: 'Ghostty 다크 + 연보라 포인트',
    mode: 'dark',
    windowBgHex: '#1b1d26',
    preview: ['#151720', '#1b1d26', '#c4b5fd'],
    vars: {
      '--surface-0': '#1b1d26',
      '--surface-1': '#212430',
      '--surface-2': '#282b39',
      '--surface-3': '#363a4d',
      '--surface-sidebar': '#151720',
      '--surface-sidebar-hover': 'rgba(255, 255, 255, 0.055)',
      '--surface-sidebar-selected': 'rgba(196, 181, 253, 0.13)',
      '--bg-hover': 'rgba(196, 181, 253, 0.09)',
      '--border': 'rgba(255, 255, 255, 0.075)',
      '--border-strong': 'rgba(255, 255, 255, 0.13)',
      '--border-accent': 'rgba(196, 181, 253, 0.32)',
      '--text': '#e8e9f2',
      '--text-strong': '#f8f8f2',
      '--text-muted': '#989cb4',
      '--text-faint': '#6c7088',
      '--accent': '#c4b5fd',
      '--accent-strong': '#a78bfa',
      '--accent-soft': 'rgba(196, 181, 253, 0.14)',
      '--accent-glow': 'rgba(189, 147, 249, 0.25)',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight Slate',
    desc: '깊은 네이비 + 스카이 블루',
    mode: 'dark',
    windowBgHex: '#0f172a',
    preview: ['#0b1120', '#0f172a', '#60a5fa'],
    vars: {
      '--surface-0': '#0f172a',
      '--surface-1': '#152038',
      '--surface-2': '#1e293b',
      '--surface-3': '#334155',
      '--surface-sidebar': '#0b1120',
      '--surface-sidebar-hover': 'rgba(255, 255, 255, 0.055)',
      '--surface-sidebar-selected': 'rgba(96, 165, 250, 0.14)',
      '--bg-hover': 'rgba(96, 165, 250, 0.1)',
      '--border': 'rgba(148, 163, 184, 0.13)',
      '--border-strong': 'rgba(148, 163, 184, 0.22)',
      '--border-accent': 'rgba(96, 165, 250, 0.38)',
      '--text': '#e2e8f0',
      '--text-strong': '#f8fafc',
      '--text-muted': '#94a3b8',
      '--text-faint': '#64748b',
      '--accent': '#60a5fa',
      '--accent-strong': '#3b82f6',
      '--accent-soft': 'rgba(96, 165, 250, 0.14)',
      '--accent-glow': 'rgba(59, 130, 246, 0.26)',
    },
  },
  {
    id: 'forest',
    name: 'Forest Moss',
    desc: '차분한 차콜 그린 + 에메랄드',
    mode: 'dark',
    windowBgHex: '#141b18',
    preview: ['#0f1512', '#141b18', '#6ee7b7'],
    vars: {
      '--surface-0': '#141b18',
      '--surface-1': '#1a231f',
      '--surface-2': '#222d28',
      '--surface-3': '#303f38',
      '--surface-sidebar': '#0f1512',
      '--surface-sidebar-hover': 'rgba(255, 255, 255, 0.055)',
      '--surface-sidebar-selected': 'rgba(110, 231, 183, 0.13)',
      '--bg-hover': 'rgba(110, 231, 183, 0.09)',
      '--border': 'rgba(209, 250, 229, 0.085)',
      '--border-strong': 'rgba(209, 250, 229, 0.15)',
      '--border-accent': 'rgba(110, 231, 183, 0.34)',
      '--text': '#e3eee8',
      '--text-strong': '#f4fbf7',
      '--text-muted': '#93aba0',
      '--text-faint': '#647d72',
      '--accent': '#6ee7b7',
      '--accent-strong': '#34d399',
      '--accent-soft': 'rgba(110, 231, 183, 0.14)',
      '--accent-glow': 'rgba(52, 211, 153, 0.24)',
    },
  },
  {
    id: 'amber',
    name: 'Warm Graphite',
    desc: '눈 편한 웜 차콜 + 앰버 골드',
    mode: 'dark',
    windowBgHex: '#1c1917',
    preview: ['#151311', '#1c1917', '#fbbf24'],
    vars: {
      '--surface-0': '#1c1917',
      '--surface-1': '#24201d',
      '--surface-2': '#2d2824',
      '--surface-3': '#3d3732',
      '--surface-sidebar': '#151311',
      '--surface-sidebar-hover': 'rgba(255, 255, 255, 0.055)',
      '--surface-sidebar-selected': 'rgba(251, 191, 36, 0.13)',
      '--bg-hover': 'rgba(251, 191, 36, 0.09)',
      '--border': 'rgba(255, 247, 237, 0.08)',
      '--border-strong': 'rgba(255, 247, 237, 0.14)',
      '--border-accent': 'rgba(251, 191, 36, 0.34)',
      '--text': '#ede7e1',
      '--text-strong': '#faf7f2',
      '--text-muted': '#a89f96',
      '--text-faint': '#78716c',
      '--accent': '#fbbf24',
      '--accent-strong': '#f59e0b',
      '--accent-soft': 'rgba(251, 191, 36, 0.14)',
      '--accent-glow': 'rgba(245, 158, 11, 0.24)',
    },
  },
  {
    id: 'paper',
    name: 'Paper Light',
    desc: '깔끔한 종이 화이트 + 인디고',
    mode: 'light',
    windowBgHex: '#fafaf9',
    preview: ['#f2f2f0', '#fafaf9', '#4f46e5'],
    vars: {
      '--surface-0': '#fafaf9',
      '--surface-1': '#ffffff',
      '--surface-2': '#f3f3f1',
      '--surface-3': '#e4e4e2',
      '--surface-sidebar': '#f2f2f0',
      '--surface-sidebar-hover': 'rgba(15, 23, 42, 0.05)',
      '--surface-sidebar-selected': 'rgba(79, 70, 229, 0.1)',
      '--bg-hover': 'rgba(79, 70, 229, 0.08)',
      '--border': 'rgba(15, 23, 42, 0.09)',
      '--border-strong': 'rgba(15, 23, 42, 0.16)',
      '--border-accent': 'rgba(79, 70, 229, 0.32)',
      '--text': '#27272a',
      '--text-strong': '#09090b',
      '--text-muted': '#52525b',
      '--text-faint': '#71717a',
      '--accent': '#4f46e5',
      '--accent-strong': '#4338ca',
      '--accent-soft': 'rgba(79, 70, 229, 0.1)',
      '--accent-glow': 'rgba(79, 70, 229, 0.18)',
    },
  },
  {
    id: 'sepia',
    name: 'Warm Sepia',
    desc: '독서용 웜 세피아 + 테라코타',
    mode: 'light',
    windowBgHex: '#f6f0e6',
    preview: ['#ede5d8', '#f6f0e6', '#b45309'],
    vars: {
      '--surface-0': '#f6f0e6',
      '--surface-1': '#fbf7f0',
      '--surface-2': '#ece4d7',
      '--surface-3': '#dfd4c3',
      '--surface-sidebar': '#ede5d8',
      '--surface-sidebar-hover': 'rgba(67, 46, 23, 0.06)',
      '--surface-sidebar-selected': 'rgba(180, 83, 9, 0.11)',
      '--bg-hover': 'rgba(180, 83, 9, 0.08)',
      '--border': 'rgba(67, 46, 23, 0.11)',
      '--border-strong': 'rgba(67, 46, 23, 0.2)',
      '--border-accent': 'rgba(180, 83, 9, 0.34)',
      '--text': '#3b2f24',
      '--text-strong': '#1f160e',
      '--text-muted': '#6f5c49',
      '--text-faint': '#8c7864',
      '--accent': '#b45309',
      '--accent-strong': '#92400e',
      '--accent-soft': 'rgba(180, 83, 9, 0.11)',
      '--accent-glow': 'rgba(180, 83, 9, 0.19)',
    },
  },
];

export const ACCENT_PRESETS: AccentPreset[] = [
  {
    id: 'auto',
    name: '테마 기본',
    swatch: 'linear-gradient(135deg, #c4b5fd 0%, #60a5fa 50%, #34d399 100%)',
    dark: { accent: '', strong: '', soft: '', glow: '', border: '', selected: '', hover: '' },
    light: { accent: '', strong: '', soft: '', glow: '', border: '', selected: '', hover: '' },
  },
  {
    id: 'lavender',
    name: 'Lavender',
    swatch: '#a78bfa',
    dark: {
      accent: '#c4b5fd',
      strong: '#a78bfa',
      soft: 'rgba(196, 181, 253, 0.14)',
      glow: 'rgba(189, 147, 249, 0.25)',
      border: 'rgba(196, 181, 253, 0.34)',
      selected: 'rgba(196, 181, 253, 0.14)',
      hover: 'rgba(196, 181, 253, 0.09)',
    },
    light: {
      accent: '#6d28d9',
      strong: '#5b21b6',
      soft: 'rgba(109, 40, 217, 0.1)',
      glow: 'rgba(109, 40, 217, 0.18)',
      border: 'rgba(109, 40, 217, 0.3)',
      selected: 'rgba(109, 40, 217, 0.1)',
      hover: 'rgba(109, 40, 217, 0.07)',
    },
  },
  {
    id: 'blue',
    name: 'Ocean Blue',
    swatch: '#3b82f6',
    dark: {
      accent: '#60a5fa',
      strong: '#3b82f6',
      soft: 'rgba(96, 165, 250, 0.14)',
      glow: 'rgba(59, 130, 246, 0.25)',
      border: 'rgba(96, 165, 250, 0.36)',
      selected: 'rgba(96, 165, 250, 0.14)',
      hover: 'rgba(96, 165, 250, 0.09)',
    },
    light: {
      accent: '#2563eb',
      strong: '#1d4ed8',
      soft: 'rgba(37, 99, 235, 0.1)',
      glow: 'rgba(37, 99, 235, 0.18)',
      border: 'rgba(37, 99, 235, 0.3)',
      selected: 'rgba(37, 99, 235, 0.1)',
      hover: 'rgba(37, 99, 235, 0.07)',
    },
  },
  {
    id: 'emerald',
    name: 'Emerald',
    swatch: '#10b981',
    dark: {
      accent: '#6ee7b7',
      strong: '#34d399',
      soft: 'rgba(110, 231, 183, 0.14)',
      glow: 'rgba(16, 185, 129, 0.24)',
      border: 'rgba(110, 231, 183, 0.34)',
      selected: 'rgba(110, 231, 183, 0.13)',
      hover: 'rgba(110, 231, 183, 0.09)',
    },
    light: {
      accent: '#059669',
      strong: '#047857',
      soft: 'rgba(5, 150, 105, 0.1)',
      glow: 'rgba(5, 150, 105, 0.18)',
      border: 'rgba(5, 150, 105, 0.3)',
      selected: 'rgba(5, 150, 105, 0.1)',
      hover: 'rgba(5, 150, 105, 0.07)',
    },
  },
  {
    id: 'rose',
    name: 'Rose Pink',
    swatch: '#f43f5e',
    dark: {
      accent: '#fda4af',
      strong: '#fb7185',
      soft: 'rgba(251, 113, 133, 0.14)',
      glow: 'rgba(244, 63, 94, 0.24)',
      border: 'rgba(251, 113, 133, 0.34)',
      selected: 'rgba(251, 113, 133, 0.13)',
      hover: 'rgba(251, 113, 133, 0.09)',
    },
    light: {
      accent: '#e11d48',
      strong: '#be123c',
      soft: 'rgba(225, 29, 72, 0.1)',
      glow: 'rgba(225, 29, 72, 0.18)',
      border: 'rgba(225, 29, 72, 0.3)',
      selected: 'rgba(225, 29, 72, 0.1)',
      hover: 'rgba(225, 29, 72, 0.07)',
    },
  },
  {
    id: 'amber',
    name: 'Amber Gold',
    swatch: '#f59e0b',
    dark: {
      accent: '#fcd34d',
      strong: '#fbbf24',
      soft: 'rgba(251, 191, 36, 0.14)',
      glow: 'rgba(245, 158, 11, 0.24)',
      border: 'rgba(251, 191, 36, 0.34)',
      selected: 'rgba(251, 191, 36, 0.13)',
      hover: 'rgba(251, 191, 36, 0.09)',
    },
    light: {
      accent: '#b45309',
      strong: '#92400e',
      soft: 'rgba(180, 83, 9, 0.1)',
      glow: 'rgba(180, 83, 9, 0.18)',
      border: 'rgba(180, 83, 9, 0.3)',
      selected: 'rgba(180, 83, 9, 0.1)',
      hover: 'rgba(180, 83, 9, 0.07)',
    },
  },
];

export function applyThemePalette(themeId: string, accentId: string): ThemePalette {
  const palette = THEME_PALETTES.find((t) => t.id === themeId) ?? THEME_PALETTES[0];
  const root = document.documentElement;
  root.dataset.theme = palette.id;
  root.dataset.themeMode = palette.mode;

  for (const [key, val] of Object.entries(palette.vars)) {
    root.style.setProperty(key, val);
  }

  const accent = ACCENT_PRESETS.find((a) => a.id === accentId);
  if (accent && accent.id !== 'auto') {
    const set = palette.mode === 'light' ? accent.light : accent.dark;
    root.style.setProperty('--accent', set.accent);
    root.style.setProperty('--accent-strong', set.strong);
    root.style.setProperty('--accent-soft', set.soft);
    root.style.setProperty('--accent-glow', set.glow);
    root.style.setProperty('--border-accent', set.border);
    root.style.setProperty('--surface-sidebar-selected', set.selected);
    root.style.setProperty('--bg-hover', set.hover);
  }

  return palette;
}
