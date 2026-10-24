import { useEffect, useState } from 'react';

export type Theme = 'system' | 'light' | 'dark';
export const themeLabels: Record<Theme, string> = { system: '跟随系统', light: '浅色', dark: '深色' };
const key = 'roundtable.theme';

/** Follow the system / light / dark: applied at once on the document and remembered on this computer. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try { const saved = localStorage.getItem(key); return saved === 'dark' || saved === 'light' ? saved : 'system'; }
    catch { return 'system'; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(key, theme); } catch { /* Appearance still applies for this window. */ }
  }, [theme]);
  return [theme, setTheme] as const;
}

/** The window's usable width, in CSS pixels after zoom; the layout folds at 1280 and 1024 (README「响应式折叠规则」). */
export type Layout = 'wide' | 'medium' | 'narrow';
export const layoutFor = (width: number): Layout => width >= 1280 ? 'wide' : width >= 1024 ? 'medium' : 'narrow';
export function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>(() => layoutFor(window.innerWidth));
  useEffect(() => {
    const update = () => setLayout(layoutFor(window.innerWidth));
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return layout;
}
