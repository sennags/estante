import { useSyncExternalStore } from 'react';

/*
 * Appearance, kept per device in localStorage. public/tema.js applies the
 * same keys before the app loads, so the page never flashes the light theme.
 */

export type Theme = 'claro' | 'meio' | 'escuro';
/** 'auto' follows the theme: white, yellowed or black. */
export type SheetColor = 'auto' | 'branca' | 'amarelada' | 'preta';

export const THEME_LABEL: Record<Theme, string> = { claro: 'Claro', meio: 'Meio-termo', escuro: 'Escuro' };
export const SHEET_LABEL: Record<SheetColor, string> = { auto: 'Igual ao tema', branca: 'Branca', amarelada: 'Amarelada', preta: 'Preta' };

/** The sheet color 'auto' stands for in each theme. */
export const AUTO_SHEET: Record<Theme, Exclude<SheetColor, 'auto'>> = { claro: 'branca', meio: 'amarelada', escuro: 'preta' };

/** The browser bar color for each theme (same as --ground). */
const THEME_COLOR: Record<Theme, string> = { claro: '#F3EFE6', meio: '#2F2C28', escuro: '#161513' };

const THEME_KEY = 'lirismo:tema';
const SHEET_KEY = 'lirismo:folha';

export type Settings = { theme: Theme; sheet: SheetColor };

function read(): Settings {
  let theme: string | null = null;
  let sheet: string | null = null;
  try {
    theme = localStorage.getItem(THEME_KEY);
    sheet = localStorage.getItem(SHEET_KEY);
  } catch {
    // Storage blocked: the defaults.
  }
  return {
    theme: theme && theme in THEME_LABEL ? (theme as Theme) : 'claro',
    sheet: sheet && sheet in SHEET_LABEL ? (sheet as SheetColor) : 'auto',
  };
}

let current = read();
const subscribers = new Set<() => void>();

function apply({ theme, sheet }: Settings) {
  const root = document.documentElement;
  if (theme === 'claro') delete root.dataset.tema;
  else root.dataset.tema = theme;
  if (sheet === 'auto') delete root.dataset.folha;
  else root.dataset.folha = sheet;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

export function setSettings(changes: Partial<Settings>) {
  current = { ...current, ...changes };
  try {
    localStorage.setItem(THEME_KEY, current.theme);
    localStorage.setItem(SHEET_KEY, current.sheet);
  } catch {
    // Kept for this visit only.
  }
  apply(current);
  subscribers.forEach((fn) => fn());
}

// Another tab changed it.
window.addEventListener('storage', (e) => {
  if (e.key !== THEME_KEY && e.key !== SHEET_KEY) return;
  current = read();
  apply(current);
  subscribers.forEach((fn) => fn());
});

apply(current);

export const useSettings = () =>
  useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => current,
  );
