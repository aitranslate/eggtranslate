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

  // 立即把 phase 标为 active，让 UI（badge、stepper 节点）即时反映。
  // 任何失败路径都会在 catch / early-return 之前把状态标为 failed，
  // 避免出现"按钮 处理中 但 phase 还是 未开始"的不一致状态。
  useFilesStore.getState().updatePhase(fileId, 'transcribing', { status: 'active', progress: -1, tokens: 0 });

  try {
    // MP3 必须在 addFile 阶段就转好并持久化。
    // 找不到说明状态不一致（不该出现），直接报错让用户重传。
    const mp3Blob = await localforage.getItem<Blob>(`mp3_data:${file.taskId}`);
    if (!mp3Blob) {
      useFilesStore.getState().updatePhase(fileId, 'transcribing', { status: 'failed', progress: 0 });
      toast.error('MP3 缓存丢失，请重新上传文件');
      return;
    }

    const { apiKeys } = useTranscriptionStore.getState();
    if (!apiKeys.trim()) {
      useFilesStore.getState().updatePhase(fileId, 'transcribing', { status: 'failed', progress: 0 });
      toast.error('请先在设置中配置 AssemblyAI API Key');
      return;
    }

    const { keytermGroups } = useTranscriptionStore.getState();
    const task = useFilesStore.getState().tasks.find((t) => t.taskId === file.taskId);
    const groupId = task?.selectedKeytermGroupId;
    // 任务级热词选择优先级最高：只要任务卡片选了热词组，就用，
    // 不受全局 keytermsEnabled 开关影响（开关只控制 UI 是否显示下拉）
    const selectedKeytermGroup = groupId
      ? keytermGroups.find((g) => g.id === groupId)
      : null;
    const allKeyterms = selectedKeytermGroup?.keyterms ?? [];

    useFilesStore.getState().setWorkflow(fileId, 'transcribe');
    // 记录该次转录使用的热词组名，UI 卡片可展示
    if (selectedKeytermGroup) {
      useFilesStore.getState().updatePhase(fileId, 'transcribing', {
        keytermGroupName: selectedKeytermGroup.name,
      });
    }

    const mp3File = new File([mp3Blob], 'audio.mp3', { type: 'audio/mpeg' });

    const result = await runTranscriptionPipeline(
      mp3File,
      allKeyterms,
      {
        onConverting: () => {},
        onUploading: () => {},
        onTranscribing: () => {
          useFilesStore.getState().updatePhase(fileId, 'transcribing', {
            status: 'active',
            progress: -1,
            tokens: 0,
          });
        },
        onProgress: (percent) => {
          useFilesStore.getState().updatePhase(fileId, 'transcribing', { progress: percent });
        },
        onCompleted: () => {},
        onError: () => {
          // 状态由 catch 块统一处理
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
