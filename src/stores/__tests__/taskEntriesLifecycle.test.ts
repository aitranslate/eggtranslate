import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import localforage from 'localforage';
import {
  clearEntriesLifecycle,
  flushDirtyTaskEntries,
  forcePersistTaskEntriesFromTasks,
  getEntriesLifecycleSnapshotForTests,
  isEntriesHydrated,
  loadTaskEntries,
  markEntriesHydrated,
  saveTaskEntries,
  stripSubtitleWords,
} from '../taskEntriesStorage';
import {
  flushFilesStorePersist,
  useFilesStore,
  ensureTaskEntriesLoaded,
  reconcilePersistedTaskCounts,
  recoverInterruptedPhases,
} from '../filesStore';
import { generateStableFileId } from '@/utils/taskIdGenerator';
import type { SingleTask, SubtitleEntry } from '@/types';

const makeEntry = (id: number, overrides: Partial<SubtitleEntry> = {}): SubtitleEntry => ({
  id,
  startTime: '00:00:00,000',
  endTime: '00:00:01,000',
  text: `text-${id}`,
  translatedText: '',
  translationStatus: 'pending',
  ...overrides,
});

const makeTask = (overrides: Partial<SingleTask> = {}): SingleTask => {
  const entries = overrides.subtitle_entries ?? [makeEntry(1), makeEntry(2)];
  return {
    taskId: 't1',
    subtitle_filename: 'test.srt',
    subtitle_entries: entries,
    phases: {
      workflow: 'translate',
      converting: { status: 'completed', progress: 100, tokens: 0 },
      transcribing: { status: 'completed', progress: 100, tokens: 0 },
      translating: { status: 'upcoming', progress: 0, tokens: 0 },
    },
    index: 0,
    fileType: 'srt',
    fileSize: 100,
    selectedKeytermGroupId: null,
    entryCount: entries.length,
    translatedCount: 0,
    ...overrides,
  };
};

describe('stripSubtitleWords', () => {
  it('removes words from entries', () => {
    const withWords = makeEntry(1, {
      words: [{ text: 'hi', start: 0, end: 0.2 }],
    });
    const out = stripSubtitleWords([withWords]);
    expect(out[0].words).toBeUndefined();
    expect(out[0].text).toBe('text-1');
  });
});

describe('entries lifecycle: no wipe of unloaded tasks', () => {
  const idb = new Map<string, unknown>();

  beforeEach(async () => {
    idb.clear();
    clearEntriesLifecycle();
    useFilesStore.setState({ tasks: [], selectedFileId: null });
    vi.spyOn(localforage, 'setItem').mockImplementation(async (name, value) => {
      idb.set(String(name), value);
      return value as never;
    });
    vi.spyOn(localforage, 'getItem').mockImplementation(async (name) => {
      return (idb.get(String(name)) ?? null) as never;
    });
    vi.spyOn(localforage, 'removeItem').mockImplementation(async (name) => {
      idb.delete(String(name));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearEntriesLifecycle();
  });

  it('flush does not overwrite IDB of non-hydrated tasks with empty memory', async () => {
    // B 在 IDB 有 500 条；内存为空壳（模拟 rehydrate 后未打开）
    const bEntries = Array.from({ length: 5 }, (_, i) => makeEntry(i + 1, { text: `B-${i}` }));
    await saveTaskEntries('task-b', bEntries);

    const taskA = makeTask({
      taskId: 'task-a',
      subtitle_entries: [makeEntry(1, { text: 'A-only' })],
      entryCount: 1,
    });
    const taskB = makeTask({
      taskId: 'task-b',
      subtitle_entries: [],
      entryCount: 5,
    });

    useFilesStore.setState({ tasks: [taskA, taskB], selectedFileId: null });
    // 仅 A 被打开过
    markEntriesHydrated('task-a', { dirty: true });
    // B 故意不 hydrate

    await flushDirtyTaskEntries(useFilesStore.getState().tasks);

    const bLoaded = await loadTaskEntries('task-b');
    expect(bLoaded).toHaveLength(5);
    expect(bLoaded?.[0].text).toBe('B-0');

    const aLoaded = await loadTaskEntries('task-a');
    expect(aLoaded?.[0].text).toBe('A-only');
  });

  it('ensureTaskEntriesLoaded hydrates without marking dirty', async () => {
    const entries = [makeEntry(1, { text: 'from-idb' })];
    await saveTaskEntries('task-load', entries);
    useFilesStore.setState({
      tasks: [
        makeTask({
          taskId: 'task-load',
          subtitle_entries: [],
          entryCount: 1,
        }),
      ],
    });

    await ensureTaskEntriesLoaded('task-load');
    expect(isEntriesHydrated('task-load')).toBe(true);
    expect(useFilesStore.getState().tasks[0].subtitle_entries[0]?.text).toBe('from-idb');
    const snap = getEntriesLifecycleSnapshotForTests();
    expect(snap.dirty).not.toContain('task-load');
  });

  it('ensureTaskEntriesLoaded syncs translatedCount from completed entries', async () => {
    await saveTaskEntries('task-counts', [
      makeEntry(1, { translatedText: '一', translationStatus: 'completed' }),
      makeEntry(2),
      makeEntry(3, { translatedText: '三', translationStatus: 'completed' }),
    ]);
    useFilesStore.setState({
      tasks: [
        makeTask({
          taskId: 'task-counts',
          subtitle_entries: [],
          entryCount: 3,
          translatedCount: 0,
        }),
      ],
    });

    await ensureTaskEntriesLoaded('task-counts');
    expect(useFilesStore.getState().tasks[0].translatedCount).toBe(2);
    expect(useFilesStore.getState().tasks[0].entryCount).toBe(3);
  });

  it('reconcilePersistedTaskCounts fixes stale list counts without hydrating', async () => {
    await saveTaskEntries('task-stale', [
      makeEntry(1, { translatedText: '一', translationStatus: 'completed' }),
      makeEntry(2, { translatedText: '二', translationStatus: 'completed' }),
    ]);
    useFilesStore.setState({
      tasks: [
        makeTask({
          taskId: 'task-stale',
          subtitle_entries: [],
          entryCount: 2,
          translatedCount: 0,
        }),
      ],
    });

    await reconcilePersistedTaskCounts();
    const task = useFilesStore.getState().tasks[0];
    expect(task.translatedCount).toBe(2);
    expect(task.subtitle_entries).toEqual([]);
    expect(isEntriesHydrated('task-stale')).toBe(false);
  });

  it('saveTaskEntries strips words at the persistence boundary', async () => {
    await saveTaskEntries('w1', [
      makeEntry(1, { words: [{ text: 'x', start: 0, end: 1 }] }),
    ]);
    const loaded = await loadTaskEntries('w1');
    expect(loaded?.[0].words).toBeUndefined();
  });

  it('replaceTaskEntries marks dirty and persists without words', async () => {
    useFilesStore.setState({
      tasks: [makeTask({ taskId: 'rep', subtitle_entries: [], entryCount: 0 })],
    });
    markEntriesHydrated('rep', { dirty: false });

    useFilesStore.getState().replaceTaskEntries('rep', [
      makeEntry(1, {
        text: 'hello',
        words: [{ text: 'hello', start: 0, end: 0.3 }],
      }),
    ]);
    await flushFilesStorePersist();

    const loaded = await loadTaskEntries('rep');
    expect(loaded).toHaveLength(1);
    expect(loaded?.[0].text).toBe('hello');
    expect(loaded?.[0].words).toBeUndefined();
    expect(useFilesStore.getState().tasks[0].subtitle_entries[0]?.words).toBeUndefined();
  });

  it('merge clears lifecycle so unloaded tasks stay non-hydrated', () => {
    markEntriesHydrated('old', { dirty: true });
    const merge = useFilesStore.persist.getOptions().merge!;
    const current = useFilesStore.getInitialState();
    const merged = merge(
      {
        tasks: [
          makeTask({
            taskId: 'stuck',
            subtitle_entries: [],
            entryCount: 10,
            phases: {
              workflow: 'full',
              converting: { status: 'completed', progress: 100, tokens: 0 },
              transcribing: { status: 'active', progress: 55, tokens: 0 },
              translating: { status: 'upcoming', progress: 0, tokens: 0 },
            },
          }),
        ],
        selectedFileId: null,
      },
      current
    ) as { tasks: SingleTask[] };

    expect(isEntriesHydrated('stuck')).toBe(false);
    expect(isEntriesHydrated('old')).toBe(false);
    expect(merged.tasks[0].phases.transcribing.status).toBe('failed');
    // entryCount 0 会 hydrate
    const mergedEmpty = merge(
      {
        tasks: [makeTask({ taskId: 'empty-media', subtitle_entries: [], entryCount: 0 })],
        selectedFileId: null,
      },
      current
    ) as { tasks: SingleTask[] };
    expect(mergedEmpty.tasks[0].entryCount).toBe(0);
    expect(isEntriesHydrated('empty-media')).toBe(true);
  });

  it('forcePersist still used for one-shot migration of inline entries', async () => {
    await forcePersistTaskEntriesFromTasks([
      makeTask({
        taskId: 'mig',
        subtitle_entries: [makeEntry(1, { text: 'legacy' })],
      }),
    ]);
    const loaded = await loadTaskEntries('mig');
    expect(loaded?.[0].text).toBe('legacy');
  });
});

describe('recoverInterruptedPhases still pure', () => {
  it('marks active → failed', () => {
    const recovered = recoverInterruptedPhases(
      makeTask({
        phases: {
          workflow: 'full',
          converting: { status: 'completed', progress: 100, tokens: 0 },
          transcribing: { status: 'active', progress: 40, tokens: 0 },
          translating: { status: 'upcoming', progress: 0, tokens: 0 },
        },
      })
    );
    expect(recovered.phases.transcribing.status).toBe('failed');
  });

  it('marks active segmenting → failed', () => {
    const recovered = recoverInterruptedPhases(
      makeTask({
        entryCount: 0,
        subtitle_entries: [],
        phases: {
          workflow: 'full',
          converting: { status: 'completed', progress: 100, tokens: 0 },
          transcribing: { status: 'completed', progress: 100, tokens: 0 },
          segmenting: { status: 'active', progress: 80, tokens: 9 },
          translating: { status: 'upcoming', progress: 0, tokens: 0 },
        },
      })
    );
    expect(recovered.phases.segmenting?.status).toBe('failed');
    expect(recovered.phases.segmenting?.tokens).toBe(9);
    expect(recovered.phases.transcribing.status).toBe('failed');
  });

  it('keeps transcribing completed when asrReady even if no entries', () => {
    const recovered = recoverInterruptedPhases(
      makeTask({
        entryCount: 0,
        subtitle_entries: [],
        phases: {
          workflow: 'full',
          converting: { status: 'completed', progress: 100, tokens: 0 },
          transcribing: {
            status: 'completed',
            progress: 100,
            tokens: 0,
            asrReady: true,
            transcriptId: 'tid',
          },
          segmenting: { status: 'active', progress: 80, tokens: 9 },
          translating: { status: 'upcoming', progress: 0, tokens: 0 },
        },
      })
    );
    expect(recovered.phases.segmenting?.status).toBe('failed');
    expect(recovered.phases.transcribing.status).toBe('completed');
    expect(recovered.phases.transcribing.transcriptId).toBe('tid');
  });
});

describe('fileId helper sanity', () => {
  it('stable id', () => {
    expect(generateStableFileId('t1')).toBeTruthy();
  });
});
