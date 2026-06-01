import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFilesStore } from '@/stores/filesStore';
import { useQueueStore } from '@/stores/queueStore';
import { enqueueTask, dequeueTask, enqueueAllUncompleted, processNext } from '../queueService';
import type { SingleTask, FilePhases } from '@/types';

vi.mock('localforage', () => ({
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(undefined),
    removeItem: () => Promise.resolve(undefined),
  },
}));

vi.mock('../transcriptionService', () => ({
  startTranscription: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../translationService', () => ({
  startTranslation: vi.fn().mockResolvedValue({
    tokens: 0,
    entries: [],
    phases: {
      workflow: 'translate',
      converting: { status: 'completed', progress: 100, tokens: 0 },
      transcribing: { status: 'completed', progress: 100, tokens: 0 },
      translating: { status: 'completed', progress: 100, tokens: 0 },
      splitting: { status: 'completed', progress: 100, tokens: 0 },
    } as FilePhases,
  }),
}));

vi.mock('@/services/TranslationOrchestrator', () => ({
  saveTranslationHistory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/stores/historyStore', () => ({
  useHistoryStore: {
    getState: () => ({ addHistory: vi.fn() }),
  },
}));

const makeFile = (taskId: string, translated: boolean = false): SingleTask => ({
  taskId,
  subtitle_filename: `${taskId}.srt`,
  fileType: 'srt',
  fileSize: 100,
  subtitle_entries: [],
  index: 0,
  selectedKeytermGroupId: null,
  phases: {
    workflow: 'translate',
    converting: { status: 'completed', progress: 100, tokens: 0 },
    transcribing: { status: 'completed', progress: 100, tokens: 0 },
    translating: translated
      ? { status: 'completed', progress: 100, tokens: 0 }
      : { status: 'upcoming', progress: 0, tokens: 0 },
    splitting: translated
      ? { status: 'completed', progress: 100, tokens: 0 }
      : { status: 'upcoming', progress: 0, tokens: 0 },
  },
});

// fileId format is `file_<taskId>` (from generateStableFileId)
const fid = (taskId: string) => `file_${taskId}`;

describe('queueService', () => {
  beforeEach(() => {
    useFilesStore.setState({ tasks: [] });
    useQueueStore.setState({ taskQueue: [], activeTaskId: null });
    vi.clearAllMocks();
  });

  it('enqueueTask adds fileId to queue', () => {
    useFilesStore.setState({ tasks: [makeFile('t1')] });
    enqueueTask(fid('t1'));
    expect(useQueueStore.getState().taskQueue).toEqual([fid('t1')]);
  });

  it('enqueueTask skips already queued file', () => {
    useFilesStore.setState({ tasks: [makeFile('t1')] });
    enqueueTask(fid('t1'));
    enqueueTask(fid('t1'));
    expect(useQueueStore.getState().taskQueue).toEqual([fid('t1')]);
  });

  it('enqueueTask skips completed tasks', () => {
    useFilesStore.setState({ tasks: [makeFile('t1', true)] });
    enqueueTask(fid('t1'));
    expect(useQueueStore.getState().taskQueue).toEqual([]);
  });

  it('dequeueTask removes from queue', () => {
    useFilesStore.setState({ tasks: [makeFile('t1')] });
    enqueueTask(fid('t1'));
    dequeueTask(fid('t1'));
    expect(useQueueStore.getState().taskQueue).toEqual([]);
  });

  it('enqueueAllUncompleted adds all incomplete files', () => {
    useFilesStore.setState({
      tasks: [
        makeFile('t1', false),
        makeFile('t2', true),
        makeFile('t3', false),
      ],
    });
    enqueueAllUncompleted();
    expect(useQueueStore.getState().taskQueue).toEqual([fid('t1'), fid('t3')]);
  });

  it('processNext calls translationService for SRT file', async () => {
    const { startTranslation } = await import('../translationService');
    useFilesStore.setState({ tasks: [makeFile('t1')] });
    useQueueStore.setState({ taskQueue: [fid('t1')], activeTaskId: null });

    await processNext();

    expect(startTranslation).toHaveBeenCalledWith(fid('t1'));
  });

  it('processNext sets activeTaskId to null after completion', async () => {
    useFilesStore.setState({ tasks: [makeFile('t1')] });
    useQueueStore.setState({ taskQueue: [fid('t1')], activeTaskId: null });

    await processNext();

    expect(useQueueStore.getState().activeTaskId).toBeNull();
  });
});
