/**
 * 转录 Service
 * 编排音视频 → MP3 → AssemblyAI 转录 → 字幕条目
 *
 * 注意：转码（MP3）已在 addFile 阶段完成并持久化到 IndexedDB。
 * 这里只做"取 MP3 → 调 API → 写字幕"。
 */

import { useFilesStore } from '@/stores/filesStore';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { runTranscriptionPipeline } from './transcriptionPipeline';
import { convertToMP3 } from '@/utils/convertToMP3';
import { toAppError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import toast from 'react-hot-toast';
import localforage from 'localforage';

export async function startTranscription(fileId: string): Promise<void> {
  const file = useFilesStore.getState().getFile(fileId);
  if (!file || file.fileType === 'srt') return;

  if (file.phases.transcribing.status === 'completed') {
    logger.info('转录已完成，跳过');
    return;
  }

  try {
    // MP3 已在 addFile 阶段持久化；这里取出来用
    let mp3Blob = await localforage.getItem<Blob>(`mp3_data:${file.taskId}`);
    if (!mp3Blob && file.fileRef) {
      // 兜底：MP3 缓存缺失（极少见，比如老数据）→ 现场转一次
      logger.warn('[startTranscription] MP3 缓存缺失，临时转码');
      mp3Blob = await convertToMP3(file.fileRef);
      await localforage.setItem(`mp3_data:${file.taskId}`, mp3Blob);
      useFilesStore.getState().updatePhase(fileId, 'converting', {
        status: 'completed',
        progress: 100,
        tokens: 0,
      });
    }
    if (!mp3Blob) {
      toast.error('文件引用丢失，请重新上传');
      return;
    }

    const { apiKeys } = useTranscriptionStore.getState();
    if (!apiKeys.trim()) {
      toast.error('请先在设置中配置 AssemblyAI API Key');
      return;
    }

    const { keytermGroups, keytermsEnabled } = useTranscriptionStore.getState();
    const task = useFilesStore.getState().tasks.find((t) => t.taskId === file.taskId);
    const groupId = task?.selectedKeytermGroupId;
    const allKeyterms = (() => {
      if (!keytermsEnabled) return [];
      if (!groupId) return [];
      const group = keytermGroups.find((g) => g.id === groupId);
      return group?.keyterms ?? [];
    })();

    useFilesStore.getState().setWorkflow(fileId, 'transcribe');

    const mp3File = new File([mp3Blob], 'audio.mp3', { type: 'audio/mpeg' });

    const result = await runTranscriptionPipeline(
      mp3File,
      allKeyterms,
      {
        onConverting: () => {},
        onUploading: () => {
          useFilesStore.getState().updatePhase(fileId, 'transcribing', { status: 'active', progress: -1, tokens: 0 });
        },
        onTranscribing: () => {
          useFilesStore.getState().updatePhase(fileId, 'transcribing', { status: 'active', progress: -1, tokens: 0 });
        },
        onProgress: (percent) => {
          useFilesStore.getState().updatePhase(fileId, 'transcribing', { progress: percent });
        },
        onCompleted: () => {},
        onError: () => {
          const phases = useFilesStore.getState().getFile(fileId)?.phases;
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
    logger.error(appError.message, appError);
    toast.error(`转录失败: ${appError.message}`);

    // pipeline 抛错时无条件标 transcribing 失败（不论之前是 upcoming 还是 active）
    // converting 由 addFile 阶段负责，这里不动
    useFilesStore.getState().updatePhase(fileId, 'transcribing', { status: 'failed', progress: 0 });
  }
}
