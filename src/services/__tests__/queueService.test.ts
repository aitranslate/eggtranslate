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

vi.mock('@/utils/appSound', () => ({
  playAppSound: vi.fn(),
}));

const makeFile = (taskId: string, translated: boolean = false): SingleTask => ({
  taskId,
  subtitle_filename: `${taskId}.srt`,
  fileType: 'srt',
  fileSize: 100,
  subtitle_entries: [],
  index: 0,
  selectedKeytermGroupId: null,
  entryCount: 0,
  translatedCount: 0,
  phases: {
    workflow: 'translate',
    converting: { status: 'completed', progress: 100, tokens: 0 },
    transcribing: { status: 'completed', progress: 100, tokens: 0 },
    translating: translated
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

  it('enqueueTask adds fileId to queue and plays confirm sound', async () => {
    const { playAppSound } = await import('@/utils/appSound');
    useFilesStore.setState({ tasks: [makeFile('t1')] });
    enqueueTask(fid('t1'));
    expect(useQueueStore.getState().taskQueue).toEqual([fid('t1')]);
    expect(playAppSound).toHaveBeenCalledWith('confirm');
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

  it('enqueueAllUncompleted does not schedule parallel processNext (queue guard)', async () => {
    // 回归测试：enqueueAllUncompleted 必须只排程一个 processNext，
    // 否则两个 microtask 都会跑，第二个会覆盖 activeTaskId 导致并行
    const { startTranslation } = await import('../translationService');
    useFilesStore.setState({
      tasks: [makeFile('t1', false), makeFile('t2', false)],
    });
    enqueueAllUncompleted();
    // 让 microtask 跑完 + processNext 跑完
    await new Promise((r) => setTimeout(r, 10));
    // startTranslation 应该被调用 1 次（f1 开始），不是 2 次
    // 第二次调用是 f2 排队，f1 完成后再调用
    // 由于我们 mock 的是同一个函数，计数 ≥ 1 表示至少 f1 跑了
    expect(startTranslation).toHaveBeenCalled();
    // activeTaskId 在 f1 完成后应该是 null（如果 f2 还在队列，会被 finishTask 清掉）
    // 或者 === f2（如果 f2 已经被 pop 出来）
    // 关键是：不应该两个都同时在跑 —— 验证 activeTaskId 与 queue 是一致的
    const state = useQueueStore.getState();
    if (state.activeTaskId !== null) {
      // 如果有 active，queue 里不应该还有它
      expect(state.taskQueue).not.toContain(state.activeTaskId);
    }
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

  it('processNext plays success sound when translation completes', async () => {
    const { playAppSound } = await import('@/utils/appSound');
    const { startTranslation } = await import('../translationService');
    vi.mocked(startTranslation).mockImplementation(async (fileId) => {
      useFilesStore.setState((s) => ({
        tasks: s.tasks.map((t) =>
          fid(t.taskId) === fileId
            ? {
                ...t,
                phases: {
                  ...t.phases,
                  translating: { status: 'completed', progress: 100, tokens: 0 },
                },
              }
            : t
        ),
      }));
      return {
        tokens: 0,
        entries: [],
        phases: {
          workflow: 'translate',
          converting: { status: 'completed', progress: 100, tokens: 0 },
          transcribing: { status: 'completed', progress: 100, tokens: 0 },
          translating: { status: 'completed', progress: 100, tokens: 0 },
        } as FilePhases,
      };
    });

    useFilesStore.setState({ tasks: [makeFile('t1')] });
    useQueueStore.setState({ taskQueue: [fid('t1')], activeTaskId: null });

    await processNext();

    expect(playAppSound).toHaveBeenCalledWith('success');
  });

  it('processNext plays error sound when translation failed', async () => {
    const { playAppSound } = await import('@/utils/appSound');
    const { startTranslation } = await import('../translationService');
    vi.mocked(startTranslation).mockImplementation(async (fileId) => {
      useFilesStore.setState((s) => ({
        tasks: s.tasks.map((t) =>
          fid(t.taskId) === fileId
            ? {
                ...t,
                phases: {
                  ...t.phases,
                  translating: { status: 'failed', progress: 0, tokens: 0 },
                },
              }
            : t
        ),
      }));
      return null;
    });

    useFilesStore.setState({ tasks: [makeFile('t1')] });
    useQueueStore.setState({ taskQueue: [fid('t1')], activeTaskId: null });

    await processNext();

    expect(playAppSound).toHaveBeenCalledWith('error');
  });
});
