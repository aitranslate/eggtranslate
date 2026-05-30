import { create } from 'zustand';
import { Term } from '@/types';
import localforage from 'localforage';

interface TermsState {
  terms: Term[];
  loadTerms: () => Promise<void>;
  addTerm: (term: Term) => Promise<void>;
  updateTerm: (index: number, term: Term) => Promise<void>;
  deleteTerm: (index: number) => Promise<void>;
  saveTerms: (terms: Term[]) => Promise<void>;
  clearTerms: () => Promise<void>;
}

export const useTermsStore = create<TermsState>((set, get) => ({
  terms: [],
  loadTerms: async () => {
    const terms = await localforage.getItem<Term[]>('terms_list') || [];
    set({ terms });
  },
  addTerm: async (term) => {
    const newTerms = [...get().terms, term];
    set({ terms: newTerms });
    await localforage.setItem('terms_list', newTerms);
  },
  updateTerm: async (index, term) => {
    const newTerms = [...get().terms];
    newTerms[index] = term;
    set({ terms: newTerms });
    await localforage.setItem('terms_list', newTerms);
  },
  deleteTerm: async (index) => {
    const newTerms = get().terms.filter((_, i) => i !== index);
    set({ terms: newTerms });
    await localforage.setItem('terms_list', newTerms);
  },
  saveTerms: async (terms) => {
    set({ terms });
    await localforage.setItem('terms_list', terms);
  },
  clearTerms: async () => {
    set({ terms: [] });
    await localforage.setItem('terms_list', []);
  },
}));