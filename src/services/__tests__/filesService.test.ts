import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFilesStore } from '@/stores/filesStore';
import { useQueueStore } from '@/stores/queueStore';
import { addFile, removeFile, selectFile, clearAll } from '../filesService';
import { loadFromFile, removeMp3Data } from '@/services/SubtitleFileManager';

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

describe('filesService', () => {
  beforeEach(() => {
    useFilesStore.setState({ tasks: [], selectedFileId: null });
    useQueueStore.setState({ taskQueue: [], activeTaskId: null });
    vi.clearAllMocks();
  });

  it('addFile calls SubtitleFileManager and adds task', async () => {
    const mockTask = { taskId: 't1', subtitle_filename: 'test.srt', subtitle_entries: [] };
    vi.mocked(loadFromFile).mockResolvedValue({
      metadata: { id: 'file-1', taskId: 't1', name: 'test.srt' } as any,
      task: mockTask as any,
    });

    const fakeFile = new File(['test'], 'test.srt', { type: 'text/plain' });
    const id = await addFile(fakeFile);

    expect(id).toBe('file-1');
    expect(useFilesStore.getState().tasks).toHaveLength(1);
    expect(useFilesStore.getState().tasks[0].taskId).toBe('t1');
  });

  it('removeFile cleans MP3 data and removes task', async () => {
    useFilesStore.setState({
      tasks: [{
        taskId: 't1',
        subtitle_filename: 'a.srt',
        subtitle_entries: [],
        fileType: 'srt',
        fileSize: 100,
        duration: undefined,
      }] as any,
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
    useFilesStore.setState({ tasks: [{ taskId: 't1' }] as any });
    useQueueStore.setState({ taskQueue: ['f1'], activeTaskId: 'f1' });

    await clearAll();

    expect(useFilesStore.getState().tasks).toHaveLength(0);
    expect(useQueueStore.getState().taskQueue).toHaveLength(0);
    expect(useQueueStore.getState().activeTaskId).toBeNull();
  });
});
