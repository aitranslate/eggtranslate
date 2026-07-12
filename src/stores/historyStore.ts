import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { TranslationHistoryEntry } from '@/types';
import localforage from 'localforage';

interface HistoryState {
  history: TranslationHistoryEntry[];
  addHistory: (entry: Omit<TranslationHistoryEntry, 'timestamp'>) => Promise<void>;
  removeHistory: (taskId: string) => Promise<void>;
  clearHistory: () => Promise<void>;
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      history: [],

      addHistory: async (entry) => {
        const fullEntry: TranslationHistoryEntry = { ...entry, timestamp: Date.now() };
        set({ history: [fullEntry, ...get().history] });
      },

      removeHistory: async (taskId) => {
        set({ history: get().history.filter((e) => e.taskId !== taskId) });
      },

      clearHistory: async () => {
        set({ history: [] });
      },
    }),
    {
      name: 'translation_history',
      storage: createJSONStorage(() => localforage),
      version: 1,
      skipHydration: true,
      // 迁移：旧格式是 TranslationHistoryEntry[]，新格式是 {state: {history: [...]}}
      migrate: (persistedState: unknown, version: number) => {
        if (version === 0 && Array.isArray(persistedState)) {
          return { history: persistedState as TranslationHistoryEntry[] };
        }
        if (persistedState && typeof persistedState === 'object' && 'history' in persistedState) {
          return persistedState as { history: TranslationHistoryEntry[] };
        }
        return { history: [] };
      },
    }
  )
);
