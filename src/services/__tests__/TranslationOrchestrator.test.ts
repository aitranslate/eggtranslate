import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useFilesStore } from '@/stores/filesStore';
import {
  createTranslationBatches,
  calculateActualProgress,
  saveTranslationHistory,
} from '../TranslationOrchestrator';
import type {
  SubtitleEntry,
  SingleTask,
  Term,
  TranslationHistoryEntry,
  TranslationStatus,
} from '@/types';

// ---------- helpers ----------

const makeEntry = (
  id: number,
  overrides: Partial<SubtitleEntry> = {}
): SubtitleEntry => ({
  id,
  startTime: '00:00:00,000',
  endTime: '00:00:01,000',
  text: `text-${id}`,
  translatedText: '',
  translationStatus: 'pending',
  ...overrides,
});

const makeConfig = (overrides: Partial<{
  batchSize: number;
  contextBefore: number;
  contextAfter: number;
  threadCount: number;
}> = {}) => ({
  batchSize: 5,
  contextBefore: 0,
  contextAfter: 0,
  threadCount: 1,
  ...overrides,
});

const makeCallbacks = (overrides: Partial<{
  getRelevantTerms: (b: string, before: string, after: string) => Term[];
  formatTermsForPrompt: (terms: Term[]) => string;
}> = {}) => ({
  translateBatch: vi.fn(),
  updateEntry: vi.fn(),
  updateProgress: vi.fn(),
  getRelevantTerms: vi.fn(() => [] as Term[]),
  formatTermsForPrompt: vi.fn((terms: Term[]) => terms.map(t => t.original).join(',')),
  ...overrides,
});

const makeTask = (overrides: Partial<SingleTask> = {}): SingleTask => ({
  taskId: 't1',
  subtitle_filename: 'test.srt',
  subtitle_entries: [],
  phases: {
    workflow: 'translate',
    converting: { status: 'completed', progress: 100, tokens: 0 },
    transcribing: { status: 'completed', progress: 100, tokens: 0 },
    translating: { status: 'completed', progress: 100, tokens: 100 },
    splitting: { status: 'upcoming', progress: 0, tokens: 0 },
  },
  index: 0,
  fileType: 'srt',
  fileSize: 100,
  selectedKeytermGroupId: null,
  entryCount: 0,
  translatedCount: 0,
  ...overrides,
});

// ---------- createTranslationBatches ----------

describe('createTranslationBatches', () => {
  it('返回空数组当 entries 为空', () => {
    const batches = createTranslationBatches([], makeConfig(), makeCallbacks());
    expect(batches).toEqual([]);
  });

  it('entries.length <= batchSize 时返回单批', () => {
    const entries = [makeEntry(1), makeEntry(2), makeEntry(3)];
    const batches = createTranslationBatches(
      entries,
      makeConfig({ batchSize: 10 }),
      makeCallbacks()
    );
    expect(batches).toHaveLength(1);
    expect(batches[0].untranslatedEntries).toHaveLength(3);
    expect(batches[0].textsToTranslate).toEqual(['text-1', 'text-2', 'text-3']);
    expect(batches[0].batchIndex).toBe(0);
  });

  it('entries.length 等于 batchSize 时也返回单批', () => {
    const entries = [makeEntry(1), makeEntry(2), makeEntry(3)];
    const batches = createTranslationBatches(
      entries,
      makeConfig({ batchSize: 3 }),
      makeCallbacks()
    );
    expect(batches).toHaveLength(1);
    expect(batches[0].untranslatedEntries).toHaveLength(3);
  });

  it('entries.length > batchSize 时按 batchSize 拆分', () => {
    const entries = Array.from({ length: 10 }, (_, i) => makeEntry(i + 1));
    const batches = createTranslationBatches(
      entries,
      makeConfig({ batchSize: 3 }),
      makeCallbacks()
    );
    // 10 / 3 = 4 批：[3, 3, 3, 1]
    expect(batches).toHaveLength(4);
    expect(batches[0].untranslatedEntries).toHaveLength(3);
    expect(batches[1].untranslatedEntries).toHaveLength(3);
    expect(batches[2].untranslatedEntries).toHaveLength(3);
    expect(batches[3].untranslatedEntries).toHaveLength(1);
    expect(batches[0].batchIndex).toBe(0);
    expect(batches[3].batchIndex).toBe(3);
  });

  it('batchSize = 1 时拆为 N 个单元素批', () => {
    const entries = [makeEntry(1), makeEntry(2), makeEntry(3)];
    const batches = createTranslationBatches(
      entries,
      makeConfig({ batchSize: 1 }),
      makeCallbacks()
    );
    expect(batches).toHaveLength(3);
    expect(batches[0].untranslatedEntries).toEqual([entries[0]]);
    expect(batches[1].untranslatedEntries).toEqual([entries[1]]);
    expect(batches[2].untranslatedEntries).toEqual([entries[2]]);
  });

  it('batchSize = 0 且 entries 为空时返回空数组（不会无限循环）', () => {
    // Math.ceil(0/0) === NaN，循环条件 0 < NaN 为 false，安全
    const batches = createTranslationBatches([], makeConfig({ batchSize: 0 }), makeCallbacks());
    expect(batches).toEqual([]);
  });

  it('已完成条目被跳过，整批已完成时不出现在结果中', () => {
    const entries = [
      makeEntry(1, { translationStatus: 'completed', translatedText: 'done' }),
      makeEntry(2, { translationStatus: 'completed', translatedText: 'done' }),
      makeEntry(3),
    ];
    const batches = createTranslationBatches(
      entries,
      makeConfig({ batchSize: 2 }),
      makeCallbacks()
    );
    // 第一批两条均 completed → 跳过；第二批仅条目 3
    expect(batches).toHaveLength(1);
    expect(batches[0].batchIndex).toBe(1);
    expect(batches[0].untranslatedEntries).toEqual([entries[2]]);
  });

  it('正确提取前后文上下文', () => {
    const entries = Array.from({ length: 6 }, (_, i) => makeEntry(i + 1));
    const batches = createTranslationBatches(
      entries,
      makeConfig({ batchSize: 2, contextBefore: 2, contextAfter: 1 }),
      makeCallbacks()
    );
    // 批 0: entries[0..1] —— before 为空，after 为 entries[2]
    expect(batches[0].contextBeforeTexts).toBe('');
    expect(batches[0].contextAfterTexts).toBe('text-3');
    // 批 1: entries[2..3] —— before 为 entries[0..1]，after 为 entries[4]
    expect(batches[1].contextBeforeTexts).toBe('text-1\ntext-2');
    expect(batches[1].contextAfterTexts).toBe('text-5');
  });

  it('将 getRelevantTerms 的结果放入 batch.relevantTerms', () => {
    const terms: Term[] = [{ original: 'foo', translation: 'bar' }];
    const callbacks = makeCallbacks({
      getRelevantTerms: vi.fn(() => terms),
    });
    const batches = createTranslationBatches(
      [makeEntry(1)],
      makeConfig(),
      callbacks
    );
    expect(callbacks.getRelevantTerms).toHaveBeenCalledTimes(1);
    expect(batches[0].relevantTerms).toBe(terms);
  });
});

// ---------- calculateActualProgress ----------

describe('calculateActualProgress', () => {
  it('空 entries 返回 0/0', () => {
    expect(calculateActualProgress([])).toEqual({ completed: 0, total: 0 });
  });

  it('全部已翻译时返回 N/N', () => {
    const entries = [
      makeEntry(1, { translationStatus: 'completed', translatedText: 'a' }),
      makeEntry(2, { translationStatus: 'completed', translatedText: 'b' }),
      makeEntry(3, { translationStatus: 'completed', translatedText: 'c' }),
    ];
    expect(calculateActualProgress(entries)).toEqual({ completed: 3, total: 3 });
  });

  it('一半已翻译时按 translationStatus 计数', () => {
    const entries = [
      makeEntry(1, { translationStatus: 'completed', translatedText: 'a' }),
      makeEntry(2, { translationStatus: 'completed', translatedText: 'b' }),
      makeEntry(3),
      makeEntry(4),
    ];
    expect(calculateActualProgress(entries)).toEqual({ completed: 2, total: 4 });
  });

  it('translationStatus = "completed" 但 translatedText 为空时仍计为已完成（按 status 判断）', () => {
    // 函数按 translationStatus 字段判断，与 translatedText 内容无关
    const entries = [
      makeEntry(1, { translationStatus: 'completed', translatedText: '' }),
      makeEntry(2),
    ];
    expect(calculateActualProgress(entries)).toEqual({ completed: 1, total: 2 });
  });

  it('translationStatus 缺失时不抛错且不计为已完成', () => {
    // 故意构造缺失 translationStatus 字段的对象，测试鲁棒性
    const entries = [
      { id: 1, startTime: '0', endTime: '1', text: 't1', translatedText: '' } as unknown as SubtitleEntry,
      makeEntry(2, { translationStatus: 'completed', translatedText: 'done' }),
    ];
    expect(() => calculateActualProgress(entries)).not.toThrow();
    expect(calculateActualProgress(entries)).toEqual({ completed: 1, total: 2 });
  });
});

// ---------- saveTranslationHistory ----------

describe('saveTranslationHistory', () => {
  beforeEach(() => {
    useFilesStore.setState({ tasks: [], selectedFileId: null });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const completedEntry = (id: number): SubtitleEntry =>
    makeEntry(id, {
      translationStatus: 'completed' as TranslationStatus,
      translatedText: `tr-${id}`,
    });

  it('正常调用时 addHistory 被调一次且参数正确', async () => {
    const entries = [completedEntry(1), completedEntry(2)];
    const task = makeTask({
      taskId: 't1',
      subtitle_filename: 'a.srt',
      subtitle_entries: entries,
    });
    useFilesStore.setState({ tasks: [task] });

    const addHistory = vi.fn().mockResolvedValue(undefined);
    const promise = saveTranslationHistory('t1', 'a.srt', 42, addHistory);
    // 跳过内置的 setTimeout(500)
    await vi.runAllTimersAsync();
    await promise;

    expect(addHistory).toHaveBeenCalledTimes(1);
    const arg = addHistory.mock.calls[0][0] as Omit<TranslationHistoryEntry, 'timestamp'>;
    expect(arg.taskId).toBe('t1');
    expect(arg.filename).toBe('a.srt');
    expect(arg.completedCount).toBe(2);
    // finalTokens 优先取 phases.translating.tokens (=100)，参数 42 是回退
    expect(arg.totalTokens).toBe(100);
    expect(arg.subtitle_entries).toBe(entries);
    expect(arg.phases).toBe(task.phases);
  });

  it('当 phases.translating.tokens = 0 时回退到 tokensUsed 参数', async () => {
    const entries = [completedEntry(1)];
    const task = makeTask({
      taskId: 't1',
      subtitle_filename: 'a.srt',
      subtitle_entries: entries,
      phases: {
        workflow: 'translate',
        converting: { status: 'completed', progress: 100, tokens: 0 },
        transcribing: { status: 'completed', progress: 100, tokens: 0 },
        translating: { status: 'completed', progress: 100, tokens: 0 },
        splitting: { status: 'upcoming', progress: 0, tokens: 0 },
      },
    });
    useFilesStore.setState({ tasks: [task] });

    const addHistory = vi.fn().mockResolvedValue(undefined);
    const promise = saveTranslationHistory('t1', 'a.srt', 77, addHistory);
    await vi.runAllTimersAsync();
    await promise;

    expect(addHistory).toHaveBeenCalledTimes(1);
    expect((addHistory.mock.calls[0][0] as Omit<TranslationHistoryEntry, 'timestamp'>).totalTokens).toBe(77);
  });

  it('当 actualCompleted = 0 时不调用 addHistory', async () => {
    const entries = [makeEntry(1), makeEntry(2)]; // 全 pending
    const task = makeTask({ taskId: 't1', subtitle_entries: entries });
    useFilesStore.setState({ tasks: [task] });

    const addHistory = vi.fn().mockResolvedValue(undefined);
    const promise = saveTranslationHistory('t1', 'a.srt', 10, addHistory);
    await vi.runAllTimersAsync();
    await promise;

    expect(addHistory).not.toHaveBeenCalled();
  });

  it('当 taskId 找不到任务时不调用 addHistory', async () => {
    useFilesStore.setState({ tasks: [] });
    const addHistory = vi.fn().mockResolvedValue(undefined);
    const promise = saveTranslationHistory('missing', 'x.srt', 10, addHistory);
    await vi.runAllTimersAsync();
    await promise;

    expect(addHistory).not.toHaveBeenCalled();
  });

  it('addHistory 抛错时 saveTranslationHistory 不抛错（内部 catch + log）', async () => {
    const entries = [completedEntry(1)];
    const task = makeTask({ taskId: 't1', subtitle_entries: entries });
    useFilesStore.setState({ tasks: [task] });

    const addHistory = vi.fn().mockRejectedValue(new Error('boom'));
    // 屏蔽预期内的 error 日志
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const promise = saveTranslationHistory('t1', 'a.srt', 5, addHistory);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();

    expect(addHistory).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
