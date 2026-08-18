import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFilesStore } from '@/stores/filesStore';
import { useTranslationConfigStore } from '@/stores/translationConfigStore';
import { startTranslation } from '../translationService';
import type { SingleTask, SubtitleEntry } from '@/types';
import { generateStableFileId } from '@/utils/taskIdGenerator';

vi.mock('localforage', () => {
  const api = {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(undefined),
    removeItem: () => Promise.resolve(undefined),
  };
  return {
    default: {
      ...api,
      createInstance: () => api,
    },
  };
});

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const executeTranslation = vi.fn();

vi.mock('../TranslationOrchestrator', () => ({
  executeTranslation: (...args: unknown[]) => executeTranslation(...args),
}));

const entry = (id: number): SubtitleEntry => ({
  id,
  startTime: '00:00:00,000',
  endTime: '00:00:01,000',
  text: `t${id}`,
  translatedText: '',
  translationStatus: 'pending',
});

const makeFile = (
  taskId: string,
  translating: 'completed' | 'upcoming' | 'active' = 'upcoming',
  overrides: Partial<SingleTask> = {}
): SingleTask => ({
  taskId,
  subtitle_filename: `${taskId}.srt`,
  fileType: 'srt',
  fileSize: 100,
  subtitle_entries: [entry(1), entry(2)],
  index: 0,
  selectedKeytermGroupId: null,
  entryCount: 2,
  translatedCount: 0,
  phases: {
    workflow: 'translate',
    converting: { status: 'completed', progress: 100, tokens: 0 },
    transcribing: { status: 'completed', progress: 100, tokens: 0 },
    translating: {
      status: translating,
      progress: translating === 'completed' ? 100 : 0,
      tokens: 0,
    },
  },
  ...overrides,
});

function configuredState() {
  useTranslationConfigStore.setState({
    isConfigured: true,
    isTranslating: false,
    config: {
      profiles: [
        {
          id: 'custom',
          name: '自定义',
          baseURL: 'https://x',
          apiKey: 'k',
          model: 'm',
          presetId: 'custom',
        },
      ],
      activeProfileId: 'custom',
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      batchSize: 20,
      contextBefore: 5,
      contextAfter: 3,
      threadCount: 4,
    },
  });
}

describe('translationService', () => {
  beforeEach(() => {
    executeTranslation.mockReset();
    useFilesStore.setState({ tasks: [], selectedFileId: null });
    useTranslationConfigStore.setState({
      isConfigured: false,
      isTranslating: false,
      config: {
        profiles: [
          {
            id: 'custom',
            name: '自定义',
            baseURL: '',
            apiKey: '',
            model: '',
            presetId: 'custom',
          },
        ],
        activeProfileId: 'custom',
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        batchSize: 20,
        contextBefore: 5,
        contextAfter: 3,
        threadCount: 4,
      },
    });
  });

  it('returns null when file not found', async () => {
    const result = await startTranslation('non-existent');
    expect(result).toBeNull();
  });

  it('returns null when translation not configured', async () => {
    useFilesStore.setState({ tasks: [makeFile('t1')] });
    const result = await startTranslation(generateStableFileId('t1'));
    expect(result).toBeNull();
  });

  it('returns null when translation already completed', async () => {
    useFilesStore.setState({
      tasks: [makeFile('t1', 'completed')],
    });
    configuredState();

    const result = await startTranslation(generateStableFileId('t1'));
    expect(result).toBeNull();
    expect(executeTranslation).not.toHaveBeenCalled();
  });

  it('calls executeTranslation on the batch path', async () => {
    useFilesStore.setState({ tasks: [makeFile('t-batch')] });
    configuredState();
    executeTranslation.mockImplementation(async () => {
      useFilesStore.setState((s) => ({
        tasks: s.tasks.map((t) =>
          t.taskId === 't-batch'
            ? {
                ...t,
                subtitle_entries: t.subtitle_entries.map((e) => ({
                  ...e,
                  translationStatus: 'completed' as const,
                  translatedText: 'ok',
                })),
              }
            : t
        ),
      }));
    });

    const fileId = generateStableFileId('t-batch');
    const result = await startTranslation(fileId);

    expect(executeTranslation).toHaveBeenCalled();
    expect(result).not.toBeNull();
    const task = useFilesStore.getState().tasks.find((t) => t.taskId === 't-batch');
    expect(task?.phases.translating.status).toBe('completed');
  });

  it('prefers task source/target languages over global config', async () => {
    useFilesStore.setState({
      tasks: [
        makeFile('t-lang', 'upcoming', {
          sourceLanguage: 'Japanese',
          targetLanguage: 'Korean',
        }),
      ],
    });
    configuredState();
    executeTranslation.mockImplementation(async (_opts, callbacks) => {
      expect(callbacks).toBeTruthy();
      useFilesStore.setState((s) => ({
        tasks: s.tasks.map((t) =>
          t.taskId === 't-lang'
            ? {
                ...t,
                subtitle_entries: t.subtitle_entries.map((e) => ({
                  ...e,
                  translationStatus: 'completed' as const,
                  translatedText: 'ok',
                })),
              }
            : t
        ),
      }));
    });

    await startTranslation(generateStableFileId('t-lang'));
    expect(executeTranslation).toHaveBeenCalled();
    const arg0 = executeTranslation.mock.calls[0][0] as { filename: string };
    expect(arg0.filename).toBe('t-lang.srt');
  });

  it('marks translating failed when executeTranslation throws', async () => {
    useFilesStore.setState({
      tasks: [makeFile('t-fail', 'upcoming')],
    });
    configuredState();
    executeTranslation.mockRejectedValue(new Error('boom'));

    const fileId = generateStableFileId('t-fail');
    const result = await startTranslation(fileId);

    expect(result).toBeNull();
    const task = useFilesStore.getState().tasks.find((t) => t.taskId === 't-fail');
    expect(task?.phases.translating.status).toBe('failed');
    expect(task?.phases.translating.errorMessage).toMatch(/boom/);
  });

  it('does not mark completed when some lines are still missing', async () => {
    useFilesStore.setState({
      tasks: [
        makeFile('t-partial', 'upcoming', {
          subtitle_entries: [
            { ...entry(1), translationStatus: 'completed', translatedText: '已译' },
            entry(2),
          ],
          translatedCount: 1,
        }),
      ],
    });
    configuredState();
    executeTranslation.mockResolvedValue(undefined);

    const result = await startTranslation(generateStableFileId('t-partial'));
    const task = useFilesStore.getState().tasks.find((t) => t.taskId === 't-partial');
    expect(task?.phases.translating.status).toBe('failed');
    expect(task?.phases.translating.errorMessage).toMatch(/部分翻译/);
    expect(result).not.toBeNull();
  });

  it('flushes persist after each finalized batch', async () => {
    useFilesStore.setState({ tasks: [makeFile('t-flush')] });
    configuredState();
    const flushPersist = vi.fn().mockResolvedValue(undefined);
    const batchUpdateEntries = vi.fn();
    executeTranslation.mockImplementation(async (_opts, callbacks) => {
      await callbacks.batchUpdateEntries([
        { id: 1, text: 't1', translatedText: '译1', status: 'completed' },
      ]);
    });

    await startTranslation(generateStableFileId('t-flush'), {
      flushPersist,
      batchUpdateEntries,
    });

    expect(batchUpdateEntries).toHaveBeenCalledTimes(1);
    expect(flushPersist).toHaveBeenCalled();
  });

  it('AbortError does not mark failed', async () => {
    useFilesStore.setState({
      tasks: [makeFile('t-abort', 'upcoming')],
    });
    configuredState();
    const err = new Error('翻译已取消');
    err.name = 'AbortError';
    executeTranslation.mockRejectedValue(err);

    const fileId = generateStableFileId('t-abort');
    const result = await startTranslation(fileId);

    expect(result).toBeNull();
    const task = useFilesStore.getState().tasks.find((t) => t.taskId === 't-abort');
    expect(task?.phases.translating.status).not.toBe('failed');
  });
});
