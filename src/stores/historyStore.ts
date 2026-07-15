import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { TranslationHistoryEntry } from '@/types';
import localforage from 'localforage';
import { capHistoryEntries, HISTORY_MAX_ENTRIES } from '@/utils/historyHelpers';

interface HistoryState {
  history: TranslationHistoryEntry[];
  addHistory: (entry: Omit<TranslationHistoryEntry, 'timestamp'>) => Promise<void>;
  removeHistory: (taskId: string) => Promise<void>;
  clearHistory: () => Promise<void>;
}

export { HISTORY_MAX_ENTRIES };

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      history: [],

      addHistory: async (entry) => {
        const fullEntry: TranslationHistoryEntry = { ...entry, timestamp: Date.now() };
        // 新在前；超出 HISTORY_MAX_ENTRIES 丢弃最旧
        set({
          history: capHistoryEntries([fullEntry, ...get().history], HISTORY_MAX_ENTRIES),
        });
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
          return {
            history: capHistoryEntries(
              persistedState as TranslationHistoryEntry[],
              HISTORY_MAX_ENTRIES
            ),
          };
        }
        if (persistedState && typeof persistedState === 'object' && 'history' in persistedState) {
          const state = persistedState as { history: TranslationHistoryEntry[] };
          return {
            history: capHistoryEntries(state.history ?? [], HISTORY_MAX_ENTRIES),
          };
        }
        return { history: [] };
      },
      merge: (persistedState, currentState) => {
        const p = (persistedState ?? {}) as Partial<{ history: TranslationHistoryEntry[] }>;
        return {
          ...currentState,
          ...p,
          history: capHistoryEntries(p.history ?? currentState.history ?? [], HISTORY_MAX_ENTRIES),
        };
      },
    }
  )
);
