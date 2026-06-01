import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFilesStore } from '@/stores/filesStore';
import { useQueueStore } from '@/stores/queueStore';
import { enqueueTask, dequeueTask, enqueueAllUncompleted, processNext } from '../queueService';

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
  startTranslation: vi.fn().mockResolvedValue({ tokens: 0, entries: [], phases: {} as any }),
}));

vi.mock('@/services/TranslationOrchestrator', () => ({
  saveTranslationHistory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/stores/historyStore', () => ({
  useHistoryStore: {
    getState: () => ({ addHistory: vi.fn() }),
  },
}));

const makeFile = (taskId: string, translated: boolean = false) => ({
  taskId,
  subtitle_filename: `${taskId}.srt`,
  fileType: 'srt' as const,
  fileSize: 100,
  subtitle_entries: [],
  index: 0,
  phases: {
    workflow: 'translate' as const,
    converting: { status: 'completed' as const, progress: 100, tokens: 0 },
    transcribing: { status: 'completed' as const, progress: 100, tokens: 0 },
    translating: translated
      ? { status: 'completed' as const, progress: 100, tokens: 0 }
      : { status: 'upcoming' as const, progress: 0, tokens: 0 },
    splitting: translated
      ? { status: 'completed' as const, progress: 100, tokens: 0 }
      : { status: 'upcoming' as const, progress: 0, tokens: 0 },
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
    useFilesStore.setState({ tasks: [makeFile('t1')] as any });
    enqueueTask(fid('t1'));
    expect(useQueueStore.getState().taskQueue).toEqual([fid('t1')]);
  });

  it('enqueueTask skips already queued file', () => {
    useFilesStore.setState({ tasks: [makeFile('t1')] as any });
    enqueueTask(fid('t1'));
    enqueueTask(fid('t1'));
    expect(useQueueStore.getState().taskQueue).toEqual([fid('t1')]);
  });

  it('enqueueTask skips completed tasks', () => {
    useFilesStore.setState({ tasks: [makeFile('t1', true)] as any });
    enqueueTask(fid('t1'));
    expect(useQueueStore.getState().taskQueue).toEqual([]);
  });

  it('dequeueTask removes from queue', () => {
    useFilesStore.setState({ tasks: [makeFile('t1')] as any });
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
      ] as any,
    });
    enqueueAllUncompleted();
    expect(useQueueStore.getState().taskQueue).toEqual([fid('t1'), fid('t3')]);
  });

  it('processNext calls translationService for SRT file', async () => {
    const { startTranslation } = await import('../translationService');
    useFilesStore.setState({ tasks: [makeFile('t1')] as any });
    useQueueStore.setState({ taskQueue: [fid('t1')], activeTaskId: null });

    await processNext();

    expect(startTranslation).toHaveBeenCalledWith(fid('t1'));
  });

  it('processNext sets activeTaskId to null after completion', async () => {
    useFilesStore.setState({ tasks: [makeFile('t1')] as any });
    useQueueStore.setState({ taskQueue: [fid('t1')], activeTaskId: null });

    await processNext();

    expect(useQueueStore.getState().activeTaskId).toBeNull();
  });
});
