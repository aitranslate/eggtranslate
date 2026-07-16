import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../queueService', () => ({
  enqueueTask: vi.fn(),
  enqueueAllUncompleted: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

import toast from 'react-hot-toast';
import { enqueueTask, enqueueAllUncompleted } from '../queueService';
import {
  startAllUncompleted,
  startFullTask,
  startPrimaryForFile,
  startTranscribeTask,
  startTranslateTask,
} from '../startTask';
import { useTranslationConfigStore } from '@/stores/translationConfigStore';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { useFilesStore } from '@/stores/filesStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { SubtitleFileMetadata } from '@/types';

function meta(partial: Partial<SubtitleFileMetadata> & { id: string }): SubtitleFileMetadata {
  return {
    id: partial.id,
    taskId: partial.taskId ?? partial.id,
    name: partial.name ?? 'a.srt',
    fileType: partial.fileType ?? 'srt',
    fileSize: 1,
    entryCount: 1,
    translatedCount: 0,
    selectedKeytermGroupId: null,
    phases: partial.phases ?? {
      workflow: 'translate',
      converting: { status: 'completed', progress: 100, tokens: 0 },
      transcribing: { status: 'upcoming', progress: 0, tokens: 0 },
      translating: { status: 'upcoming', progress: 0, tokens: 0 },
    },
    ...partial,
  } as SubtitleFileMetadata;
}

describe('startTask guards', () => {
  beforeEach(() => {
    vi.mocked(enqueueTask).mockClear();
    vi.mocked(enqueueAllUncompleted).mockClear();
    vi.mocked(toast.error).mockClear();
    useTranslationConfigStore.setState({ isConfigured: false });
    useTranscriptionStore.setState({ apiKeys: '' });
    useFilesStore.setState({ tasks: [], selectedFileId: null });
    useWorkspaceStore.setState({ settingsOpen: false, settingsFocus: null });
  });

  it('startTranslateTask toasts and opens settings when unconfigured', () => {
    const ok = startTranslateTask('file_1');
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalled();
    expect(useWorkspaceStore.getState().settingsOpen).toBe(true);
    expect(enqueueTask).not.toHaveBeenCalled();
  });

  it('startTranslateTask enqueues when configured', () => {
    useTranslationConfigStore.setState({ isConfigured: true });
    const ok = startTranslateTask('file_1');
    expect(ok).toBe(true);
    expect(enqueueTask).toHaveBeenCalledWith('file_1');
  });

  it('startTranscribeTask guards when no AssemblyAI key', () => {
    const ok = startTranscribeTask('file_av');
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalled();
    expect(useWorkspaceStore.getState().settingsFocus).toBe('transcription');
    expect(enqueueTask).not.toHaveBeenCalled();
  });

  it('startTranscribeTask enqueues when keys present', () => {
    useTranscriptionStore.setState({ apiKeys: 'sk-test' });
    const ok = startTranscribeTask('file_av');
    expect(ok).toBe(true);
    expect(enqueueTask).toHaveBeenCalledWith('file_av');
  });

  it('startFullTask prioritizes transcription then translation', () => {
    useTranslationConfigStore.setState({ isConfigured: false });
    useTranscriptionStore.setState({ apiKeys: '' });
    expect(startFullTask('file_av')).toBe(false);
    expect(useWorkspaceStore.getState().settingsFocus).toBe('transcription');

    useTranscriptionStore.setState({ apiKeys: 'sk' });
    useWorkspaceStore.setState({ settingsOpen: false, settingsFocus: null });
    expect(startFullTask('file_av')).toBe(false);
    expect(useWorkspaceStore.getState().settingsFocus).toBe('translation');

    useTranslationConfigStore.setState({ isConfigured: true });
    expect(startFullTask('file_av')).toBe(true);
    expect(enqueueTask).toHaveBeenCalled();
  });

  it('startAllUncompleted guards transcription when AV pending', () => {
    useFilesStore.setState({
      tasks: [
        {
          taskId: 't1',
          subtitle_filename: 'v.mp4',
          subtitle_entries: [],
          fileType: 'video',
          fileSize: 1,
          selectedKeytermGroupId: null,
          entryCount: 0,
          translatedCount: 0,
          index: 0,
          phases: {
            workflow: 'full',
            converting: { status: 'upcoming', progress: 0, tokens: 0 },
            transcribing: { status: 'upcoming', progress: 0, tokens: 0 },
            translating: { status: 'upcoming', progress: 0, tokens: 0 },
          },
        },
      ],
    } as never);

    expect(startAllUncompleted()).toBe(false);
    expect(toast.error).toHaveBeenCalled();
    expect(enqueueAllUncompleted).not.toHaveBeenCalled();
  });

  it('startAllUncompleted guards translation for SRT when unconfigured', () => {
    useFilesStore.setState({
      tasks: [
        {
          taskId: 's1',
          subtitle_filename: 'a.srt',
          subtitle_entries: [],
          fileType: 'srt',
          fileSize: 1,
          selectedKeytermGroupId: null,
          entryCount: 1,
          translatedCount: 0,
          index: 0,
          phases: {
            workflow: 'translate',
            converting: { status: 'completed', progress: 100, tokens: 0 },
            transcribing: { status: 'completed', progress: 100, tokens: 0 },
            translating: { status: 'upcoming', progress: 0, tokens: 0 },
          },
        },
      ],
    } as never);
    useTranscriptionStore.setState({ apiKeys: '' });
    useTranslationConfigStore.setState({ isConfigured: false });

    expect(startAllUncompleted()).toBe(false);
    expect(toast.error).toHaveBeenCalled();
    expect(enqueueAllUncompleted).not.toHaveBeenCalled();
  });

  it('startPrimaryForFile uses full for untranscribed AV and translate for SRT', () => {
    useTranslationConfigStore.setState({ isConfigured: true });
    useTranscriptionStore.setState({ apiKeys: 'sk' });

    const av = meta({
      id: 'av1',
      taskId: 'av1',
      fileType: 'video',
      phases: {
        workflow: 'full',
        converting: { status: 'upcoming', progress: 0, tokens: 0 },
        transcribing: { status: 'upcoming', progress: 0, tokens: 0 },
        translating: { status: 'upcoming', progress: 0, tokens: 0 },
      },
    });
    expect(startPrimaryForFile(av)).toBe(true);
    expect(enqueueTask).toHaveBeenCalledWith('av1');

    vi.mocked(enqueueTask).mockClear();
    const srt = meta({ id: 's1', taskId: 's1', fileType: 'srt' });
    expect(startPrimaryForFile(srt)).toBe(true);
    expect(enqueueTask).toHaveBeenCalledWith('s1');
  });
});
