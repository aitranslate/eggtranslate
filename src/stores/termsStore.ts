import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Term } from '@/types';
import localforage from 'localforage';

interface TermsState {
  terms: Term[];
  addTerm: (term: Term) => Promise<void>;
  updateTerm: (index: number, term: Term) => Promise<void>;
  deleteTerm: (index: number) => Promise<void>;
  saveTerms: (terms: Term[]) => Promise<void>;
  clearTerms: () => Promise<void>;
}

export const useTermsStore = create<TermsState>()(
  persist(
    (set, get) => ({
      terms: [],

      addTerm: async (term) => {
        set({ terms: [...get().terms, term] });
      },

      updateTerm: async (index, term) => {
        const newTerms = [...get().terms];
        newTerms[index] = term;
        set({ terms: newTerms });
      },

      deleteTerm: async (index) => {
        set({ terms: get().terms.filter((_, i) => i !== index) });
      },

      saveTerms: async (terms) => {
        set({ terms });
      },

      clearTerms: async () => {
        set({ terms: [] });
      },
    }),
    {
      name: 'terms_list',
      storage: createJSONStorage(() => localforage),
      version: 1,
      // 迁移：旧格式是 Term[] 直接存储，新格式是 {state: {terms: Term[]}}
      migrate: (persistedState: unknown, version: number) => {
        if (version === 0 && Array.isArray(persistedState)) {
          return { terms: persistedState as Term[] };
        }
        if (persistedState && typeof persistedState === 'object' && 'terms' in persistedState) {
          return persistedState as { terms: Term[] };
        }
        return { terms: [] };
      },
    }
  )
);
