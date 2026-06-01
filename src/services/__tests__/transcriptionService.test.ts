import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFilesStore } from '@/stores/filesStore';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { startTranscription } from '../transcriptionService';
import type { SingleTask, SubtitleFileMetadata, SubtitleEntry, PhaseProgress, WorkflowType, FileType } from '@/types';

vi.mock('../transcriptionPipeline', () => ({
  runTranscriptionPipeline: vi.fn(),
}));

vi.mock('@/utils/convertToMP3', () => ({
  convertToMP3: vi.fn(),
}));

vi.mock('localforage', () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

import { runTranscriptionPipeline } from '../transcriptionPipeline';
import { convertToMP3 } from '@/utils/convertToMP3';
import localforage from 'localforage';

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
      splitting: { status: 'upcoming', progress: 0, tokens: 0 },
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
      keytermsEnabled: false,
    });
    vi.clearAllMocks();
  });

  it('returns early when file not found', async () => {
    await startTranscription('non-existent');
    expect(runTranscriptionPipeline).not.toHaveBeenCalled();
    expect(convertToMP3).not.toHaveBeenCalled();
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
    expect(convertToMP3).not.toHaveBeenCalled();
  });

  it('returns early when API key is not configured', async () => {
    useFilesStore.setState({
      tasks: [makeTask(makeFile({ fileRef: new File([''], 'test.mp3', { type: 'audio/mpeg' }) }))],
    });
    useTranscriptionStore.setState({ apiKeys: '' });
    await startTranscription('file_t1');
    expect(runTranscriptionPipeline).not.toHaveBeenCalled();
  });

  it('uses fileRef when available, converts to MP3, runs pipeline, writes entries', async () => {
    const mediaFile = new File([''], 'test.mp3', { type: 'audio/mpeg' });
    useFilesStore.setState({
      tasks: [makeTask(makeFile({ fileRef: mediaFile }))],
    });
    useTranscriptionStore.setState({ apiKeys: 'test-key' });

    const mp3Blob = new Blob(['mp3 data'], { type: 'audio/mpeg' });
    vi.mocked(convertToMP3).mockResolvedValue(mp3Blob);
    vi.mocked(runTranscriptionPipeline).mockResolvedValue({
      entries: [
        {
          id: 1,
          startTime: '00:00:00,000',
          endTime: '00:00:02,000',
          text: 'hello',
          translatedText: '',
          translationStatus: 'pending',
        },
      ],
      language: 'en',
    });

    await startTranscription('file_t1');

    expect(convertToMP3).toHaveBeenCalledWith(mediaFile);
    expect(runTranscriptionPipeline).toHaveBeenCalled();

    const after = useFilesStore.getState().tasks[0];
    expect(after.phases.converting.status).toBe('completed');
    expect(after.phases.transcribing.status).toBe('completed');
    expect(after.phases.transcribing.language).toBe('en');
    expect(after.subtitle_entries).toHaveLength(1);
    const firstEntry: SubtitleEntry = after.subtitle_entries[0];
    expect(firstEntry.text).toBe('hello');
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

    expect(convertToMP3).not.toHaveBeenCalled();
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
    const mediaFile = new File([''], 'test.mp3', { type: 'audio/mpeg' });
    useFilesStore.setState({
      tasks: [makeTask(makeFile({
        fileRef: mediaFile,
        selectedKeytermGroupId: 'group-medical'
      }))],
    });
    useTranscriptionStore.setState({
      apiKeys: 'test-key',
      keytermsEnabled: true,
      keytermGroups: [
        { id: 'group-medical', name: '医学', keyterms: ['Aortic stenosis', 'Echocardiogram'] },
        { id: 'group-legal', name: '法律', keyterms: ['Voir dire', 'Habeas corpus'] },
      ],
    });

    const mp3Blob = new Blob(['mp3 data'], { type: 'audio/mpeg' });
    vi.mocked(convertToMP3).mockResolvedValue(mp3Blob);
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
    const mediaFile = new File([''], 'test.mp3', { type: 'audio/mpeg' });
    useFilesStore.setState({
      tasks: [makeTask(makeFile({
        fileRef: mediaFile,
        selectedKeytermGroupId: null
      }))],
    });
    useTranscriptionStore.setState({
      apiKeys: 'test-key',
      keytermsEnabled: true,
      keytermGroups: [{ id: 'g1', name: 'G1', keyterms: ['term1'] }],
    });

    vi.mocked(convertToMP3).mockResolvedValue(new Blob());
    vi.mocked(runTranscriptionPipeline).mockResolvedValue({
      entries: [],
      language: 'en',
    });

    await startTranscription('file_t1');

    expect(runTranscriptionPipeline).toHaveBeenCalled();
    const callArgs = vi.mocked(runTranscriptionPipeline).mock.calls[0];
    expect(callArgs[1]).toEqual([]);
  });

  it('sends no keyterms when keytermsEnabled is false (master switch off)', async () => {
    const mediaFile = new File([''], 'test.mp3', { type: 'audio/mpeg' });
    useFilesStore.setState({
      tasks: [makeTask(makeFile({
        fileRef: mediaFile,
        selectedKeytermGroupId: 'g1'
      }))],
    });
    useTranscriptionStore.setState({
      apiKeys: 'test-key',
      keytermsEnabled: false,
      keytermGroups: [{ id: 'g1', name: 'G1', keyterms: ['term1'] }],
    });

    vi.mocked(convertToMP3).mockResolvedValue(new Blob());
    vi.mocked(runTranscriptionPipeline).mockResolvedValue({
      entries: [],
      language: 'en',
    });

    await startTranscription('file_t1');

    expect(runTranscriptionPipeline).toHaveBeenCalled();
    const callArgs = vi.mocked(runTranscriptionPipeline).mock.calls[0];
    expect(callArgs[1]).toEqual([]);
  });

  it('sends empty array when selectedKeytermGroupId points to non-existent group', async () => {
    const mediaFile = new File([''], 'test.mp3', { type: 'audio/mpeg' });
    useFilesStore.setState({
      tasks: [makeTask(makeFile({
        fileRef: mediaFile,
        selectedKeytermGroupId: 'non-existent-id'
      }))],
    });
    useTranscriptionStore.setState({
      apiKeys: 'test-key',
      keytermsEnabled: true,
      keytermGroups: [{ id: 'g1', name: 'G1', keyterms: ['term1'] }],
    });

    vi.mocked(convertToMP3).mockResolvedValue(new Blob());
    vi.mocked(runTranscriptionPipeline).mockResolvedValue({
      entries: [],
      language: 'en',
    });

    await startTranscription('file_t1');

    expect(runTranscriptionPipeline).toHaveBeenCalled();
    const callArgs = vi.mocked(runTranscriptionPipeline).mock.calls[0];
    expect(callArgs[1]).toEqual([]);
  });
});
