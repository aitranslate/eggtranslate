import { describe, it, expect, beforeEach } from 'vitest';
import { rehydrateAppStores } from '../bootstrap';
import { useFilesStore } from '../filesStore';
import { useTermsStore } from '../termsStore';
import { useHistoryStore } from '../historyStore';

/**
 * Bootstrap design tests.
 * Note: vitest default env is node — stores that default to localStorage may
 * not attach `api.persist` (zustand returns early if storage unavailable).
 * IDB-backed stores (localforage) always attach persist in this project.
 */

describe('rehydrateAppStores bootstrap', () => {
  beforeEach(() => {
    useFilesStore.setState({ tasks: [], selectedFileId: null });
  });

  it('IDB-backed stores use skipHydration (no mount-time auto load)', () => {
    for (const store of [useFilesStore, useTermsStore, useHistoryStore]) {
      expect(store.persist).toBeDefined();
      expect(store.persist.getOptions().skipHydration).toBe(true);
    }
  });

  it('rehydrateAppStores resolves and hydrates files/terms/history', async () => {
    await rehydrateAppStores();
    expect(useFilesStore.persist.hasHydrated()).toBe(true);
    expect(useTermsStore.persist.hasHydrated()).toBe(true);
    expect(useHistoryStore.persist.hasHydrated()).toBe(true);
  });

  it('after bootstrap rehydrate, a second rehydrateAppStores does not wipe in-memory tasks', async () => {
    await rehydrateAppStores();
    useFilesStore.getState().addTask({
      taskId: 'bootstrap-t1',
      subtitle_filename: 'a.srt',
      subtitle_entries: [],
      phases: {
        workflow: 'translate',
        converting: { status: 'completed', progress: 100, tokens: 0 },
        transcribing: { status: 'completed', progress: 100, tokens: 0 },
        translating: { status: 'upcoming', progress: 0, tokens: 0 },
      },
      index: 0,
      fileType: 'srt',
      fileSize: 1,
      selectedKeytermGroupId: null,
      entryCount: 0,
      translatedCount: 0,
    });
    await rehydrateAppStores();
    expect(useFilesStore.getState().tasks.some((t) => t.taskId === 'bootstrap-t1')).toBe(true);
  });
});
