import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import localforage from 'localforage';
import {
  useFilesStore,
  useFileCount,
  flushFilesStorePersist,
  getFilesPersistWriteCount,
  resetFilesPersistWriteCount,
  FILES_PERSIST_DEBOUNCE_MS,
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
  const entries = overrides.subtitle_entries ?? [makeEntry(1), makeEntry(2), makeEntry(3)];
  return {
    taskId: 't1',
    subtitle_filename: 'test.srt',
    subtitle_entries: entries,
    phases: {
      workflow: 'translate',
      converting: { status: 'completed', progress: 100, tokens: 0 },
      transcribing: { status: 'completed', progress: 100, tokens: 0 },
      translating: { status: 'active', progress: 0, tokens: 0 },
    },
    index: 0,
    fileType: 'srt',
    fileSize: 100,
    selectedKeytermGroupId: null,
    entryCount: entries.length,
    translatedCount: entries.filter((e) => e.translatedText).length,
    ...overrides,
  };
};

describe('filesStore batchUpdateEntries', () => {
  beforeEach(() => {
    useFilesStore.setState({ tasks: [], selectedFileId: null });
  });

  it('applies multi-entry batch in one store mutation with status + translatedCount', () => {
    const task = makeTask();
    useFilesStore.setState({ tasks: [task] });
    const fileId = generateStableFileId('t1');

    let mutationCount = 0;
    const unsub = useFilesStore.subscribe(() => {
      mutationCount += 1;
    });

    useFilesStore.getState().batchUpdateEntries(fileId, [
      { id: 1, text: 'text-1', translatedText: '译1', status: 'completed' },
      { id: 2, text: 'text-2', translatedText: '译2', status: 'completed' },
      { id: 3, text: 'text-3', translatedText: '', status: 'completed' },
    ]);

    unsub();

    expect(mutationCount).toBe(1);

    const updated = useFilesStore.getState().tasks[0];
    expect(updated.subtitle_entries[0].translatedText).toBe('译1');
    expect(updated.subtitle_entries[0].translationStatus).toBe('completed');
    expect(updated.subtitle_entries[1].translatedText).toBe('译2');
    expect(updated.subtitle_entries[1].translationStatus).toBe('completed');
    expect(updated.subtitle_entries[2].translatedText).toBe('');
    expect(updated.subtitle_entries[2].translationStatus).toBe('completed');
    // completed 计入已译（含合并策略空译文）；streaming 不计入
    expect(updated.translatedCount).toBe(3);
  });

  it('streaming partial text does not inflate translatedCount', () => {
    const task = makeTask();
    useFilesStore.setState({ tasks: [task] });
    const fileId = generateStableFileId('t1');

    useFilesStore.getState().batchUpdateEntries(fileId, [
      { id: 1, text: 'text-1', translatedText: '部', status: 'streaming' },
      { id: 2, text: 'text-2', translatedText: '分', status: 'streaming' },
    ]);

    expect(useFilesStore.getState().tasks[0].translatedCount).toBe(0);
    expect(useFilesStore.getState().tasks[0].subtitle_entries[0].translatedText).toBe('部');

    useFilesStore.getState().batchUpdateEntries(fileId, [
      { id: 1, text: 'text-1', translatedText: '完整1', status: 'completed' },
      { id: 2, text: 'text-2', translatedText: '完整2', status: 'completed' },
    ]);
    expect(useFilesStore.getState().tasks[0].translatedCount).toBe(2);
  });

  it('manual edit: non-empty translation + completed bumps count; clear resets', () => {
    const fileId = generateStableFileId('t1');
    useFilesStore.setState({
      tasks: [
        makeTask({
          subtitle_entries: [makeEntry(1)],
          entryCount: 1,
          translatedCount: 0,
        }),
      ],
    });

    // 模拟编辑器保存：有译文 → completed
    useFilesStore.getState().updateEntry(fileId, 1, 'text-1', '手动译文', 'completed');
    expect(useFilesStore.getState().tasks[0].translatedCount).toBe(1);
    expect(useFilesStore.getState().tasks[0].subtitle_entries[0].translationStatus).toBe(
      'completed'
    );

    // 清空译文 → pending，计数回落
    useFilesStore.getState().updateEntry(fileId, 1, 'text-1', '', 'pending');
    expect(useFilesStore.getState().tasks[0].translatedCount).toBe(0);
    expect(useFilesStore.getState().tasks[0].subtitle_entries[0].translationStatus).toBe(
      'pending'
    );
  });

  it('matches single updateEntry semantics for one line (status + count)', () => {
    const fileId = generateStableFileId('t1');

    useFilesStore.setState({
      tasks: [
        makeTask({
          subtitle_entries: [makeEntry(1)],
          entryCount: 1,
          translatedCount: 0,
        }),
      ],
    });

    useFilesStore.getState().batchUpdateEntries(fileId, [
      { id: 1, text: 'text-1', translatedText: 'done', status: 'completed' },
    ]);
    const afterBatch = useFilesStore.getState().tasks[0];

    useFilesStore.setState({
      tasks: [
        makeTask({
          subtitle_entries: [makeEntry(1)],
          entryCount: 1,
          translatedCount: 0,
        }),
      ],
    });

    useFilesStore.getState().updateEntry(fileId, 1, 'text-1', 'done', 'completed');
    const afterSingle = useFilesStore.getState().tasks[0];

    expect(afterBatch.subtitle_entries[0].translatedText).toBe(
      afterSingle.subtitle_entries[0].translatedText
    );
    expect(afterBatch.subtitle_entries[0].translationStatus).toBe(
      afterSingle.subtitle_entries[0].translationStatus
    );
    expect(afterBatch.translatedCount).toBe(afterSingle.translatedCount);
  });

  it('N-line batch is one mutation not N', () => {
    const entries = Array.from({ length: 20 }, (_, i) => makeEntry(i + 1));
    useFilesStore.setState({
      tasks: [makeTask({ subtitle_entries: entries, entryCount: 20, translatedCount: 0 })],
    });
    const fileId = generateStableFileId('t1');

    let mutationCount = 0;
    const unsub = useFilesStore.subscribe(() => {
      mutationCount += 1;
    });

    const updates = entries.map((e) => ({
      id: e.id,
      text: e.text,
      translatedText: `tr-${e.id}`,
      status: 'completed' as const,
    }));
    useFilesStore.getState().batchUpdateEntries(fileId, updates);
    unsub();

    expect(mutationCount).toBe(1);
    expect(useFilesStore.getState().tasks[0].translatedCount).toBe(20);
  });
});

describe('filesStore persist coalescing', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    resetFilesPersistWriteCount();
    useFilesStore.setState({ tasks: [], selectedFileId: null });
    await flushFilesStorePersist();
    resetFilesPersistWriteCount();
    vi.spyOn(localforage, 'setItem').mockImplementation(async () => undefined as never);
  });

  afterEach(async () => {
    await flushFilesStorePersist();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('coalesces rapid mutations so underlying writes << mutation count', async () => {
    const fileId = generateStableFileId('t1');
    const entries = Array.from({ length: 5 }, (_, i) => makeEntry(i + 1));
    useFilesStore.setState({
      tasks: [makeTask({ subtitle_entries: entries, entryCount: 5, translatedCount: 0 })],
    });
    // setState also schedules persist — flush baseline
    await flushFilesStorePersist();
    resetFilesPersistWriteCount();

    for (let i = 0; i < 10; i++) {
      useFilesStore.getState().batchUpdateEntries(fileId, [
        {
          id: 1,
          text: 'text-1',
          translatedText: `v${i}`,
          status: 'completed',
        },
      ]);
    }

    // debounce not fired yet
    expect(getFilesPersistWriteCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(FILES_PERSIST_DEBOUNCE_MS + 50);
    // allow pending promise
    await Promise.resolve();
    await flushFilesStorePersist();

    const writes = getFilesPersistWriteCount();
    expect(writes).toBeLessThan(10);
    expect(writes).toBeGreaterThanOrEqual(1);
  });

  it('flush after settle includes latest entry content', async () => {
    const fileId = generateStableFileId('t1');
    const captured: string[] = [];
    vi.mocked(localforage.setItem).mockImplementation(async (_name, value) => {
      captured.push(String(value));
      return value as never;
    });

    useFilesStore.setState({
      tasks: [makeTask({ subtitle_entries: [makeEntry(1)], entryCount: 1, translatedCount: 0 })],
    });
    await flushFilesStorePersist();
    captured.length = 0;
    resetFilesPersistWriteCount();

    useFilesStore.getState().batchUpdateEntries(fileId, [
      { id: 1, text: 'text-1', translatedText: '最终译文', status: 'completed' },
    ]);

    await vi.advanceTimersByTimeAsync(FILES_PERSIST_DEBOUNCE_MS + 50);
    await Promise.resolve();
    await flushFilesStorePersist();

    expect(captured.some((v) => v.includes('最终译文'))).toBe(true);
  });
});

describe('useFileCount selector', () => {
  beforeEach(() => {
    useFilesStore.setState({ tasks: [], selectedFileId: null });
  });

  it('task length stays 1 across content-only updates (MainApp length-only path)', () => {
    useFilesStore.setState({
      tasks: [makeTask()],
    });

    const lengths: number[] = [];
    // simulate useFileCount selector: only tasks.length
    const unsub = useFilesStore.subscribe((state, prev) => {
      if (state.tasks.length !== prev.tasks.length) {
        lengths.push(state.tasks.length);
      }
    });

    const fileId = generateStableFileId('t1');
    useFilesStore.getState().batchUpdateEntries(fileId, [
      { id: 1, text: 'text-1', translatedText: 'x', status: 'completed' },
    ]);
    // progress-only phase update without terminal status
    useFilesStore.getState().updatePhase(fileId, 'translating', { progress: 50 });

    unsub();

    // length-only consumers should not fire when length unchanged
    expect(lengths).toEqual([]);
    expect(useFilesStore.getState().tasks.length).toBe(1);
    expect(typeof useFileCount).toBe('function');
  });
});

describe('phase recovery on every rehydrate (merge, not migrate-only)', () => {
  it('recoverInterruptedPhases marks active → failed', () => {
    const active = makeTask({
      taskId: 'old',
      phases: {
        workflow: 'full',
        converting: { status: 'completed', progress: 100, tokens: 0 },
        transcribing: { status: 'active', progress: 40, tokens: 0 },
        translating: { status: 'upcoming', progress: 0, tokens: 0 },
      },
    });
    const recovered = recoverInterruptedPhases(active);
    expect(recovered.phases.transcribing.status).toBe('failed');
    expect(recovered.phases.transcribing.progress).toBe(40);
    expect(recovered.taskId).toBe('old');
  });

  it('persist merge recovers active tasks (simulates refresh mid-transcription)', () => {
    const merge = useFilesStore.persist.getOptions().merge!;
    const current = useFilesStore.getInitialState();
    const persisted = {
      tasks: [
        makeTask({
          taskId: 'stuck',
          phases: {
            workflow: 'full',
            converting: { status: 'completed', progress: 100, tokens: 0 },
            transcribing: { status: 'active', progress: 55, tokens: 0 },
            translating: { status: 'upcoming', progress: 0, tokens: 0 },
          },
        }),
      ],
      selectedFileId: null,
    };
    const merged = merge(persisted, current) as { tasks: SingleTask[] };
    expect(merged.tasks).toHaveLength(1);
    expect(merged.tasks[0].phases.transcribing.status).toBe('failed');
    expect(merged.tasks[0].phases.transcribing.progress).toBe(55);
  });

  it('filesStore uses skipHydration so auto-rehydrate cannot race the UI', () => {
    expect(useFilesStore.persist).toBeDefined();
    expect(useFilesStore.persist.getOptions().skipHydration).toBe(true);
  });
});


