import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../queueService', () => ({
  enqueueTask: vi.fn(),
  enqueueAllUncompleted: vi.fn(),
}));

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
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useFilesStore } from '@/stores/filesStore';
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
    useOnboardingStore.setState({
      setupGuardKind: null,
      dismissed: false,
      completedTips: [],
      hasExported: false,
      forceShowChecklist: false,
      activeTip: null,
    });
    useTranslationConfigStore.setState({ isConfigured: false });
    useTranscriptionStore.setState({ apiKeys: '' });
    useFilesStore.setState({ tasks: [], selectedFileId: null });
  });

  it('startTranslateTask opens translation guard when unconfigured', () => {
    const ok = startTranslateTask('file_1');
    expect(ok).toBe(false);
    expect(useOnboardingStore.getState().setupGuardKind).toBe('translation');
    expect(enqueueTask).not.toHaveBeenCalled();
  });

  it('startTranslateTask enqueues when configured', () => {
    useTranslationConfigStore.setState({ isConfigured: true });
    const ok = startTranslateTask('file_1');
    expect(ok).toBe(true);
    expect(useOnboardingStore.getState().setupGuardKind).toBeNull();
    expect(enqueueTask).toHaveBeenCalledWith('file_1');
  });

  it('startTranscribeTask opens transcription guard when no AssemblyAI key', () => {
    const ok = startTranscribeTask('file_av');
    expect(ok).toBe(false);
    expect(useOnboardingStore.getState().setupGuardKind).toBe('transcription');
    expect(enqueueTask).not.toHaveBeenCalled();
  });

  it('startTranscribeTask enqueues when keys present', () => {
    useTranscriptionStore.setState({ apiKeys: 'sk-test' });
    const ok = startTranscribeTask('file_av');
    expect(ok).toBe(true);
    expect(enqueueTask).toHaveBeenCalledWith('file_av');
  });

  it('startFullTask prioritizes transcription guard over translation', () => {
    useTranslationConfigStore.setState({ isConfigured: false });
    useTranscriptionStore.setState({ apiKeys: '' });
    expect(startFullTask('file_av')).toBe(false);
    expect(useOnboardingStore.getState().setupGuardKind).toBe('transcription');

    useTranscriptionStore.setState({ apiKeys: 'sk' });
    useOnboardingStore.getState().closeSetupGuard();
    expect(startFullTask('file_av')).toBe(false);
    expect(useOnboardingStore.getState().setupGuardKind).toBe('translation');

    useTranslationConfigStore.setState({ isConfigured: true });
    useOnboardingStore.getState().closeSetupGuard();
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

    // getAllFiles maps tasks — ensure it works
    const files = useFilesStore.getState().getAllFiles();
    expect(files.some((f) => f.fileType === 'video')).toBe(true);

    expect(startAllUncompleted()).toBe(false);
    expect(useOnboardingStore.getState().setupGuardKind).toBe('transcription');
    expect(enqueueAllUncompleted).not.toHaveBeenCalled();
  });

  it('startAllUncompleted guards translation for SRT-only queue when unconfigured', () => {
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
    expect(useOnboardingStore.getState().setupGuardKind).toBe('translation');
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
