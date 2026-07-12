/**
 * App store bootstrap
 *
 * Design invariant:
 *   React UI must only mount after all persisted stores have finished rehydration.
 *   There is no "interactive default empty state racing with IndexedDB".
 *
 * Stores use `skipHydration: true` so nothing auto-loads mid-session.
 * Call `rehydrateAppStores()` once from main.tsx before createRoot().render.
 */

import { useFilesStore } from './filesStore';
import { useTermsStore } from './termsStore';
import { useHistoryStore } from './historyStore';
import { useTranscriptionStore } from './transcriptionStore';
import { useTranslationConfigStore } from './translationConfigStore';

type PersistApi = {
  rehydrate: () => Promise<void> | void;
  hasHydrated: () => boolean;
};

function asPersist(store: { persist?: PersistApi }): PersistApi | null {
  return store.persist ?? null;
}

/**
 * Rehydrate every durable store. Safe to call once at startup.
 * After resolve, in-memory state is the sole source of truth for the session.
 */
export async function rehydrateAppStores(): Promise<void> {
  const apis = [
    asPersist(useFilesStore),
    asPersist(useTermsStore),
    asPersist(useHistoryStore),
    asPersist(useTranscriptionStore),
    asPersist(useTranslationConfigStore),
  ].filter((p): p is PersistApi => p != null && typeof p.rehydrate === 'function');

  await Promise.all(
    apis.map(async (api) => {
      // Already finished a previous rehydrate (e.g. HMR / double init) — do not re-run hydrate()
      // which would re-merge storage and can wipe in-session mutations.
      if (typeof api.hasHydrated === 'function' && api.hasHydrated()) return;
      await Promise.resolve(api.rehydrate());
    })
  );
}
