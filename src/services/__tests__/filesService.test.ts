import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFilesStore } from '@/stores/filesStore';
import { useQueueStore } from '@/stores/queueStore';
import { addFile, removeFile, selectFile, clearAll } from '../filesService';
import { loadFromFile, removeMp3Data } from '@/services/SubtitleFileManager';
import type { SingleTask, SubtitleFileMetadata } from '@/types';

vi.mock('@/services/SubtitleFileManager', async () => {
  const actual = await vi.importActual<typeof import('@/services/SubtitleFileManager')>(
    '@/services/SubtitleFileManager'
  );
  return {
    ...actual,
    loadFromFile: vi.fn(),
    removeMp3Data: vi.fn(),
  };
});

vi.mock('@/stores/translationConfigStore', () => ({
  useTranslationConfigStore: {
    getState: () => ({
      isTranslating: false,
      currentTaskId: '',
      stopTranslation: vi.fn(),
    }),
  },
}));

const makeSingleTask = (overrides: Partial<SingleTask> = {}): SingleTask => ({
  taskId: 't1',
  subtitle_filename: 'test.srt',
  subtitle_entries: [],
  phases: {
    workflow: 'translate',
    converting: { status: 'completed', progress: 100, tokens: 0 },
    transcribing: { status: 'completed', progress: 100, tokens: 0 },
    translating: { status: 'upcoming', progress: 0, tokens: 0 },
    splitting: { status: 'upcoming', progress: 0, tokens: 0 },
  },
  index: 0,
  fileType: 'srt',
  fileSize: 100,
  ...overrides,
});

describe('filesService', () => {
  beforeEach(() => {
    useFilesStore.setState({ tasks: [], selectedFileId: null });
    useQueueStore.setState({ taskQueue: [], activeTaskId: null });
    vi.clearAllMocks();
  });

  it('addFile calls SubtitleFileManager and adds task', async () => {
    const mockTask = makeSingleTask({ taskId: 't1' });
    vi.mocked(loadFromFile).mockResolvedValue({
      metadata: { id: 'file-1', taskId: 't1', name: 'test.srt' } as unknown as SubtitleFileMetadata & { fileRef?: File },
      task: mockTask,
    });

    const fakeFile = new File(['test'], 'test.srt', { type: 'text/plain' });
    const id = await addFile(fakeFile);

    expect(id).toBe('file-1');
    expect(useFilesStore.getState().tasks).toHaveLength(1);
    expect(useFilesStore.getState().tasks[0].taskId).toBe('t1');
  });

  it('removeFile cleans MP3 data and removes task', async () => {
    useFilesStore.setState({
      tasks: [makeSingleTask({
        taskId: 't1',
        subtitle_filename: 'a.srt',
        fileType: 'srt',
        fileSize: 100,
        duration: undefined,
      })],
    });

    const fakeFile = new File(['test'], 'a.srt', { type: 'text/plain' });
    await removeFile('file_t1', fakeFile);

    expect(removeMp3Data).toHaveBeenCalledWith('t1');
    expect(useFilesStore.getState().tasks).toHaveLength(0);
  });

  it('selectFile updates selectedFileId', () => {
    selectFile('file-1');
    expect(useFilesStore.getState().selectedFileId).toBe('file-1');
  });

  it('clearAll empties tasks and queue', async () => {
    useFilesStore.setState({ tasks: [makeSingleTask({ taskId: 't1' })] });
    useQueueStore.setState({ taskQueue: ['f1'], activeTaskId: 'f1' });

    await clearAll();

    expect(useFilesStore.getState().tasks).toHaveLength(0);
    expect(useQueueStore.getState().taskQueue).toHaveLength(0);
    expect(useQueueStore.getState().activeTaskId).toBeNull();
  });
});
