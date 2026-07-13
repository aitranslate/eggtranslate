/**
 * 浅色 / 深色主题（工作台客户端感）
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark';

interface ThemeState {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

function applyThemeToDom(theme: ThemeMode) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      setTheme: (theme) => {
        applyThemeToDom(theme);
        set({ theme });
      },
      toggleTheme: () => {
        const next = get().theme === 'light' ? 'dark' : 'light';
        applyThemeToDom(next);
        set({ theme: next });
      },
    }),
    {
      name: 'egg-theme',
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        if (state?.theme) applyThemeToDom(state.theme);
      },
    }
  )
);

function isThemeMode(v: unknown): v is ThemeMode {
  return v === 'light' || v === 'dark';
}

/** 启动时同步 DOM（persist 异步 rehydrate 前也可根据 storage 预读） */
export function initThemeFromStorage() {
  try {
    const raw = localStorage.getItem('egg-theme');
    if (!raw) return;
    const parsed = JSON.parse(raw) as { state?: { theme?: unknown } };
    if (isThemeMode(parsed?.state?.theme)) {
      applyThemeToDom(parsed.state.theme);
    }
  } catch {
    /* ignore */
  }
}
