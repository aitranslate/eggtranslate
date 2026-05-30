import { create } from 'zustand';
import { TranslationHistoryEntry } from '@/types';
import localforage from 'localforage';

interface HistoryState {
  history: TranslationHistoryEntry[];
  loadHistory: () => Promise<void>;
  addHistory: (entry: TranslationHistoryEntry) => Promise<void>;
  clearHistory: () => Promise<void>;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  history: [],
  loadHistory: async () => {
    const history = await localforage.getItem<TranslationHistoryEntry[]>('translation_history') || [];
    set({ history });
  },
  addHistory: async (entry) => {
    const newHistory = [entry, ...get().history];
    set({ history: newHistory });
    await localforage.setItem('translation_history', newHistory);
  },
  clearHistory: async () => {
    set({ history: [] });
    await localforage.setItem('translation_history', []);
  },
}));