import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFilesStore } from '@/stores/filesStore';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { startTranscription } from '../transcriptionService';
import type { SingleTask, SubtitleFileMetadata, PhaseProgress, WorkflowType, FileType } from '@/types';

vi.mock('../transcriptionPipeline', () => ({
  runTranscriptionPipeline: vi.fn(),
}));

vi.mock('localforage', () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

import { runTranscriptionPipeline } from '../transcriptionPipeline';
import { saveTranslationHistory } from '../TranslationOrchestrator';
import localforage from 'localforage';

vi.mock('../TranslationOrchestrator', () => ({
  saveTranslationHistory: vi.fn().mockResolvedValue(undefined),
}));

const makeFile = (overrides: {
  id?: string;
  taskId?: string;
  fileType?: FileType;
  fileRef?: File | undefined;
  transcribingStatus?: PhaseProgress['status'];
  convertingStatus?: PhaseProgress['status'];
  workflow?: WorkflowType;
  selectedKeytermGroupId?: string | null;
} = {}): SubtitleFileMetadata => {
  const taskId = overrides.taskId ?? 't1';
  const id = overrides.id ?? `file_${taskId}`;
  return {
    id,
    taskId,
    name: `${id}.mp3`,
    fileType: overrides.fileType ?? 'audio',
    fileSize: 100,
    lastModified: 0,
    entryCount: 0,
    translatedCount: 0,
    tokensUsed: 0,
    entriesVersion: 0,
    fileRef: overrides.fileRef,
    duration: undefined,
    selectedKeytermGroupId: overrides.selectedKeytermGroupId ?? null,
    phases: {
      workflow: overrides.workflow ?? 'transcribe',
      converting: { status: overrides.convertingStatus ?? 'upcoming', progress: 0, tokens: 0 },
      transcribing: { status: overrides.transcribingStatus ?? 'upcoming', progress: 0, tokens: 0 },
      translating: { status: 'upcoming', progress: 0, tokens: 0 },
    },
  };
};

const makeTask = (file: SubtitleFileMetadata): SingleTask => ({
  taskId: file.taskId,
  subtitle_filename: file.name,
  subtitle_entries: [],
  phases: file.phases,
  fileType: file.fileType,
  fileSize: file.fileSize,
  fileRef: file.fileRef,
  selectedKeytermGroupId: file.selectedKeytermGroupId ?? null,
  index: 0,
  entryCount: 0,
  translatedCount: 0,
});

describe('transcriptionService.startTranscription', () => {
  beforeEach(() => {
    useFilesStore.setState({ tasks: [] });
    useTranscriptionStore.setState({
      apiKeys: 'test-key',
      keytermGroups: [],
    });
    vi.clearAllMocks();
    vi.mocked(saveTranslationHistory).mockResolvedValue(undefined);
  });

  it('returns early when file not found', async () => {
    await startTranscription('non-existent');
    expect(runTranscriptionPipeline).not.toHaveBeenCalled();
  });

  it('returns early for SRT file', async () => {
    useFilesStore.setState({
      tasks: [makeTask(makeFile({ fileType: 'srt' }))],
    });
    await startTranscription('file_t1');
    expect(runTranscriptionPipeline).not.toHaveBeenCalled();
  });

  it('returns early when transcribing already completed', async () => {
    useFilesStore.setState({
      tasks: [makeTask(makeFile({ transcribingStatus: 'completed' }))],
    });
    await startTranscription('file_t1');
    expect(runTranscriptionPipeline).not.toHaveBeenCalled();
  });

  it('does not skip when transcribing completed but asrReady and no entries', async () => {
    const file = makeFile({
      convertingStatus: 'completed',
      transcribingStatus: 'completed',
    });
    file.phases.transcribing.asrReady = true;
    file.phases.transcribing.transcriptId = 'tid-keep';
    useFilesStore.setState({ tasks: [makeTask(file)] });
    useTranscriptionStore.setState({ apiKeys: 'test-key' });
    vi.mocked(localforage.getItem).mockResolvedValue(new Blob(['mp3']));
    vi.mocked(runTranscriptionPipeline).mockResolvedValue({
      entries: [],
      language: 'en',
    });

    await startTranscription('file_t1');
    expect(runTranscriptionPipeline).toHaveBeenCalled();
  });

  it('returns early when API key is not configured', async () => {
    useFilesStore.setState({
      tasks: [makeTask(makeFile({ fileRef: new File([''], 'test.mp3', { type: 'audio/mpeg' }) }))],
    });
    useTranscriptionStore.setState({ apiKeys: '' });
    await startTranscription('file_t1');
    expect(runTranscriptionPipeline).not.toHaveBeenCalled();
  });

  it('uses existing MP3 from IndexedDB when converting already completed', async () => {
    const mp3Blob = new Blob(['cached mp3'], { type: 'audio/mpeg' });
    useFilesStore.setState({
      tasks: [makeTask(makeFile({ convertingStatus: 'completed' }))],
    });
    useTranscriptionStore.setState({ apiKeys: 'test-key' });

    vi.mocked(localforage.getItem).mockResolvedValue(mp3Blob);

    vi.mocked(runTranscriptionPipeline).mockResolvedValue({
      entries: [],
      language: 'zh',
    });

    await startTranscription('file_t1');

    expect(runTranscriptionPipeline).toHaveBeenCalled();

    const after = useFilesStore.getState().tasks[0];
    expect(after.phases.transcribing.status).toBe('completed');
  });

  it('marks transcribing as failed when pipeline throws', async () => {
    useFilesStore.setState({
      tasks: [makeTask(makeFile({
        convertingStatus: 'completed',
        fileRef: new File([''], 'test.mp3', { type: 'audio/mpeg' }),
      }))],
    });
    useTranscriptionStore.setState({ apiKeys: 'test-key' });

    // 预填 MP3 缓存（用 setup.ts 里 mock 的 localforage）
    const localforageMock = (await import('localforage')).default;
    vi.mocked(localforageMock.setItem).mockResolvedValueOnce(undefined);
    vi.mocked(localforageMock.getItem).mockResolvedValueOnce(new Blob(['fake-mp3-data']) as Blob);

    const { runTranscriptionPipeline } = await import('../transcriptionPipeline');
    vi.mocked(runTranscriptionPipeline).mockRejectedValue(new Error('pipeline failed'));

    await startTranscription('file_t1');

    const after = useFilesStore.getState().tasks[0];
    // 转录失败时只标 transcribing；converting 保持 completed（转码在 addFile 已成功）
    expect(after.phases.transcribing.status).toBe('failed');
    expect(after.phases.converting.status).toBe('completed');
  });

  it('sends keyterms from the selected group only (not all groups)', async () => {
    useFilesStore.setState({
      tasks: [makeTask(makeFile({
        convertingStatus: 'completed',
        selectedKeytermGroupId: 'group-medical'
      }))],
    });
    useTranscriptionStore.setState({
      apiKeys: 'test-key',
      keytermGroups: [
        { id: 'group-medical', name: '医学', keyterms: ['Aortic stenosis', 'Echocardiogram'] },
        { id: 'group-legal', name: '法律', keyterms: ['Voir dire', 'Habeas corpus'] },
      ],
    });

    vi.mocked(localforage.getItem).mockResolvedValue(new Blob(['mp3 data']));
    vi.mocked(runTranscriptionPipeline).mockResolvedValue({
      entries: [],
      language: 'en',
    });

    await startTranscription('file_t1');

    expect(runTranscriptionPipeline).toHaveBeenCalled();
    const callArgs = vi.mocked(runTranscriptionPipeline).mock.calls[0];
    expect(callArgs[1]).toEqual(['Aortic stenosis', 'Echocardiogram']);
  });

  it('sends no keyterms when selectedKeytermGroupId is null', async () => {
    useFilesStore.setState({
      tasks: [makeTask(makeFile({
        convertingStatus: 'completed',
        selectedKeytermGroupId: null
      }))],
    });
    useTranscriptionStore.setState({
      apiKeys: 'test-key',
      keytermGroups: [{ id: 'g1', name: 'G1', keyterms: ['term1'] }],
    });

    vi.mocked(localforage.getItem).mockResolvedValue(new Blob(['mp3']));
    vi.mocked(runTranscriptionPipeline).mockResolvedValue({
      entries: [],
      language: 'en',
    });

    await startTranscription('file_t1');

    expect(runTranscriptionPipeline).toHaveBeenCalled();
    const callArgs = vi.mocked(runTranscriptionPipeline).mock.calls[0];
    expect(callArgs[1]).toEqual([]);
  });

  it('per-task keyterm selection wins regardless of any global state', async () => {
    // 新设计：无全局 keytermsEnabled 开关。只要任务卡片选了组，就用。
    useFilesStore.setState({
      tasks: [makeTask(makeFile({
        convertingStatus: 'completed',
        selectedKeytermGroupId: 'g1'
      }))],
    });
    useTranscriptionStore.setState({
      apiKeys: 'test-key',
      keytermGroups: [{ id: 'g1', name: 'G1', keyterms: ['term1'] }],
    });

    vi.mocked(localforage.getItem).mockResolvedValue(new Blob(['mp3']));
    vi.mocked(runTranscriptionPipeline).mockResolvedValue({
      entries: [],
      language: 'en',
    });

    await startTranscription('file_t1');

    expect(runTranscriptionPipeline).toHaveBeenCalled();
    const callArgs = vi.mocked(runTranscriptionPipeline).mock.calls[0];
    expect(callArgs[1]).toEqual(['term1']);
  });

  it('sends empty array when selectedKeytermGroupId points to non-existent group', async () => {
    useFilesStore.setState({
      tasks: [makeTask(makeFile({
        convertingStatus: 'completed',
        selectedKeytermGroupId: 'non-existent-id'
      }))],
    });
    useTranscriptionStore.setState({
      apiKeys: 'test-key',
      keytermGroups: [{ id: 'g1', name: 'G1', keyterms: ['term1'] }],
    });

    vi.mocked(localforage.getItem).mockResolvedValue(new Blob(['mp3']));
    vi.mocked(runTranscriptionPipeline).mockResolvedValue({
      entries: [],
      language: 'en',
    });

    await startTranscription('file_t1');

    expect(runTranscriptionPipeline).toHaveBeenCalled();
    const callArgs = vi.mocked(runTranscriptionPipeline).mock.calls[0];
    expect(callArgs[1]).toEqual([]);
  });

  it('preserves keytermGroupName on the transcribing phase after completion', async () => {
    useFilesStore.setState({
      tasks: [makeTask(makeFile({
        convertingStatus: 'completed',
        selectedKeytermGroupId: 'g1',
      }))],
    });
    useTranscriptionStore.setState({
      apiKeys: 'test-key',
      keytermGroups: [{ id: 'g1', name: '医学', keyterms: ['Aortic stenosis'] }],
    });

    vi.mocked(localforage.getItem).mockResolvedValue(new Blob(['mp3']));
    vi.mocked(runTranscriptionPipeline).mockResolvedValue({
      entries: [],
      language: 'en',
    });

    await startTranscription('file_t1');

    const after = useFilesStore.getState().tasks[0];
    expect(after.phases.transcribing.status).toBe('completed');
    expect(after.phases.transcribing.keytermGroupName).toBe('医学');
  });

  it('leaves keytermGroupName undefined when no keyterm group is selected', async () => {
    useFilesStore.setState({
      tasks: [makeTask(makeFile({
        convertingStatus: 'completed',
        selectedKeytermGroupId: null,
      }))],
    });
    useTranscriptionStore.setState({
      apiKeys: 'test-key',
      keytermGroups: [{ id: 'g1', name: 'G1', keyterms: ['term1'] }],
    });

    vi.mocked(localforage.getItem).mockResolvedValue(new Blob(['mp3']));
    vi.mocked(runTranscriptionPipeline).mockResolvedValue({
      entries: [],
      language: 'en',
    });

    await startTranscription('file_t1');

    const after = useFilesStore.getState().tasks[0];
    expect(after.phases.transcribing.status).toBe('completed');
    expect(after.phases.transcribing.keytermGroupName).toBeUndefined();
  });


  it('转录生成字幕后写入历史（未译也可入库）', async () => {
    useFilesStore.setState({
      tasks: [makeTask(makeFile({ convertingStatus: 'completed' }))],
    });
    useTranscriptionStore.setState({ apiKeys: 'test-key' });
    vi.mocked(localforage.getItem).mockResolvedValue(new Blob(['mp3']));

    const entries = [
      {
        id: 1,
        startTime: '00:00:00,000',
        endTime: '00:00:01,000',
        text: 'hello',
        translatedText: '',
        translationStatus: 'pending' as const,
      },
    ];
    vi.mocked(runTranscriptionPipeline).mockResolvedValue({
      entries,
      language: 'en',
    });

    await startTranscription('file_t1');

    expect(saveTranslationHistory).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveTranslationHistory).mock.calls[0][0]).toBe('t1');
    expect(vi.mocked(saveTranslationHistory).mock.calls[0][1]).toBe('file_t1.mp3');
  });

  it('转录结果为空条目时不写历史', async () => {
    useFilesStore.setState({
      tasks: [makeTask(makeFile({ convertingStatus: 'completed' }))],
    });
    useTranscriptionStore.setState({ apiKeys: 'test-key' });
    vi.mocked(localforage.getItem).mockResolvedValue(new Blob(['mp3']));
    vi.mocked(runTranscriptionPipeline).mockResolvedValue({
      entries: [],
      language: 'en',
    });

    await startTranscription('file_t1');
    expect(saveTranslationHistory).not.toHaveBeenCalled();
  });


});
