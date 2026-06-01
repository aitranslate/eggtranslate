import { create } from 'zustand';
import { TranslationHistoryEntry } from '@/types';
import localforage from 'localforage';

interface HistoryState {
  history: TranslationHistoryEntry[];
  loadHistory: () => Promise<void>;
  addHistory: (entry: Omit<TranslationHistoryEntry, 'timestamp'>) => Promise<void>;
  removeHistory: (taskId: string) => Promise<void>;
  clearHistory: () => Promise<void>;
}

const STORAGE_KEY = 'translation_history';

export const useHistoryStore = create<HistoryState>((set, get) => ({
  history: [],

  loadHistory: async () => {
    const history = await localforage.getItem<TranslationHistoryEntry[]>(STORAGE_KEY) || [];
    set({ history });
  },

  addHistory: async (entry) => {
    const fullEntry: TranslationHistoryEntry = { ...entry, timestamp: Date.now() };
    const newHistory = [fullEntry, ...get().history];
    set({ history: newHistory });
    await localforage.setItem(STORAGE_KEY, newHistory);
  },

  removeHistory: async (taskId) => {
    const newHistory = get().history.filter((e) => e.taskId !== taskId);
    if (newHistory.length === get().history.length) return;
    set({ history: newHistory });
    await localforage.setItem(STORAGE_KEY, newHistory);
  },

  clearHistory: async () => {
    set({ history: [] });
    await localforage.setItem(STORAGE_KEY, []);
  },
}));
