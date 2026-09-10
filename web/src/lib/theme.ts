/**
 * Theme choice: `system` follows `prefers-color-scheme` (tokens.css has the media
 * copy), `paper` and `slate` pin it. Persisted in localStorage under `cca.theme`.
 */
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeChoice = 'system' | 'paper' | 'slate';
export type ResolvedTheme = 'paper' | 'slate';

export const THEME_STORAGE_KEY = 'cca.theme';
export const THEME_ORDER: ThemeChoice[] = ['system', 'paper', 'slate'];

export const THEME_LABELS: Record<ThemeChoice, string> = {
  system: 'System theme',
  paper: 'Paper (light)',
  slate: 'Slate (dark)',
};

function isThemeChoice(value: string | null): value is ThemeChoice {
  return value === 'system' || value === 'paper' || value === 'slate';
}

export function readStoredTheme(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function prefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'system') return prefersDark() ? 'slate' : 'paper';
  return choice;
}

/** Writes `data-theme` on <html>. Call once before the first paint (main.tsx). */
export function applyTheme(choice: ThemeChoice): void {
  document.documentElement.dataset['theme'] = choice;
}

interface ThemeContextValue {
  theme: ThemeChoice;
  resolved: ResolvedTheme;
  setTheme: (choice: ThemeChoice) => void;
  /** system → paper → slate → system */
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): ReactNode {
  const [theme, setThemeState] = useState<ThemeChoice>(() => readStoredTheme());
  const [systemDark, setSystemDark] = useState<boolean>(() => prefersDark());

  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* private mode: the theme simply does not persist */
    }
  }, [theme]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback((choice: ThemeChoice) => setThemeState(choice), []);
  const cycleTheme = useCallback(() => {
    setThemeState((current) => THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length] ?? 'system');
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolved: theme === 'system' ? (systemDark ? 'slate' : 'paper') : theme,
      setTheme,
      cycleTheme,
    }),
    [theme, systemDark, setTheme, cycleTheme],
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>');
  return value;
}
