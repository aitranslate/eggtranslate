/**
 * 转录 Service
 * 编排音视频 → MP3 → AssemblyAI 转录 → 字幕条目
 */

import { useFilesStore } from '@/stores/filesStore';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { runTranscriptionPipeline } from './transcriptionPipeline';
import { convertToMP3 } from '@/utils/convertToMP3';
import { toAppError } from '@/utils/errors';
import toast from 'react-hot-toast';
import localforage from 'localforage';

export async function startTranscription(fileId: string): Promise<void> {
  const file = useFilesStore.getState().getFile(fileId);
  if (!file || file.fileType === 'srt') return;

  if (file.phases.transcribing.status === 'completed') {
    console.log('[transcriptionService] 转录已完成，跳过');
    return;
  }

  try {
    let mediaFile: File | undefined = file.fileRef;

    if (!mediaFile) {
      const savedMp3 = await localforage.getItem<Blob>(`mp3_data:${file.taskId}`);
      if (savedMp3) {
        mediaFile = new File([savedMp3], 'audio.mp3', { type: 'audio/mpeg' });
        console.log('[transcriptionService] 从 IndexedDB 恢复 MP3 用于转录');
      }
    }

    if (!mediaFile) {
      toast.error('文件引用丢失，请重新上传');
      return;
    }

    const { apiKeys } = useTranscriptionStore.getState();
    if (!apiKeys.trim()) {
      toast.error('请先在设置中配置 AssemblyAI API Key');
      return;
    }

    const { keytermGroups, keytermsEnabled } = useTranscriptionStore.getState();
    const allKeyterms = keytermsEnabled ? keytermGroups.flatMap((g) => g.keyterms) : [];

    useFilesStore.getState().setWorkflow(fileId, 'transcribe');

    let mp3Blob: Blob;

    if (file.phases.converting.status === 'completed') {
      console.log('[transcriptionService] 转码已完成，使用已保存的 MP3');
      mp3Blob = await localforage.getItem<Blob>(`mp3_data:${file.taskId}`);
      if (!mp3Blob) {
        toast.error('MP3 数据丢失，请重新上传');
        return;
      }
    } else {
      useFilesStore.getState().updatePhase(fileId, 'converting', { status: 'active', progress: -1, tokens: 0 });
      try {
        mp3Blob = await convertToMP3(mediaFile);
      } catch (error) {
        const appError = toAppError(error, '音频转码失败');
        console.error('[transcriptionService]', appError.message, appError);
        toast.error(`转码失败: ${appError.message}`);
        useFilesStore.getState().updatePhase(fileId, 'converting', { status: 'failed', progress: 0 });
        return;
      }
      await localforage.setItem(`mp3_data:${file.taskId}`, mp3Blob);
    }

    const mp3File = new File([mp3Blob], 'audio.mp3', { type: 'audio/mpeg' });

    const result = await runTranscriptionPipeline(
      mp3File,
      allKeyterms,
      {
        onConverting: () => {
          const phases = useFilesStore.getState().getFile(fileId)?.phases;
          if (phases?.converting.status !== 'completed') {
            useFilesStore.getState().updatePhase(fileId, 'converting', { status: 'active', progress: -1 });
          }
        },
        onUploading: () => {
          const phases = useFilesStore.getState().getFile(fileId)?.phases;
          if (phases?.converting.status !== 'completed') {
            useFilesStore.getState().updatePhase(fileId, 'converting', { status: 'active', progress: -1 });
          }
        },
        onTranscribing: () => {
          const phases = useFilesStore.getState().getFile(fileId)?.phases;
          if (phases?.converting.status !== 'completed') {
            useFilesStore.getState().updatePhase(fileId, 'converting', { status: 'completed', progress: 100 });
          }
          useFilesStore.getState().updatePhase(fileId, 'transcribing', { status: 'active', progress: -1, tokens: 0 });
        },
        onProgress: (percent) => {
          useFilesStore.getState().updatePhase(fileId, 'transcribing', { progress: percent });
        },
        onCompleted: () => {},
        onError: () => {
          const phases = useFilesStore.getState().getFile(fileId)?.phases;
          if (phases?.converting.status === 'active') {
            useFilesStore.getState().updatePhase(fileId, 'converting', { status: 'failed', progress: 0 });
          }
          if (phases?.transcribing.status === 'active') {
            useFilesStore.getState().updatePhase(fileId, 'transcribing', { status: 'failed', progress: 0 });
          }
        }
      }
    );

    useFilesStore.setState((state) => ({
      tasks: state.tasks.map((t) =>
        t.taskId === file.taskId
          ? {
              ...t,
              subtitle_entries: result.entries,
              phases: {
                ...t.phases,
                converting: { status: 'completed', progress: 100, tokens: 0 },
                transcribing: {
                  status: 'completed',
                  progress: 100,
                  tokens: 0,
                  language: result.language,
                  entryCount: result.entries.length,
                  totalEntries: result.entries.length,
                },
              },
            }
          : t
      ),
    }));

    toast.success(`转录完成！生成 ${result.entries.length} 条字幕`);
  } catch (error) {
    const appError = toAppError(error, '转录失败');
    console.error('[transcriptionService]', appError.message, appError);
    toast.error(`转录失败: ${appError.message}`);

    const phases = useFilesStore.getState().getFile(fileId)?.phases;
    if (phases?.converting.status === 'active') {
      useFilesStore.getState().updatePhase(fileId, 'converting', { status: 'failed', progress: 0 });
    }
    if (phases?.transcribing.status === 'active') {
      useFilesStore.getState().updatePhase(fileId, 'transcribing', { status: 'failed', progress: 0 });
    }
  }
}
