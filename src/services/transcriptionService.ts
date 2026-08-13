/**
 * 转录 Service
 * 取 IndexedDB 中 addFile 已就绪的 ASR 音频（MP3 / AAC 抽轨 / 原音频）
 * → AssemblyAI → 写字幕。不再在转录阶段转码。
 */

import { useFilesStore } from '@/stores/filesStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { runTranscriptionPipeline } from './transcriptionPipeline';
import { saveTranslationHistory } from './TranslationOrchestrator';
import { toAppError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { loadAsrAudioFile } from '@/utils/asrAudioStorage';
import toast from 'react-hot-toast';

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

  let segmentingActive = false;

  try {
    // 音频必须在 addFile 阶段准备好（小 MP3 / 抽轨 AAC / 原音频）。
    const asrFile = await loadAsrAudioFile(file.taskId);
    if (!asrFile) {
      useFilesStore.getState().updatePhase(fileId, 'transcribing', { status: 'failed', progress: 0 });
      toast.error('音频缓存丢失，请重新上传文件');
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

    // workflow 由调用方（按钮）在 enqueueTask 前设置：
    //   - 仅转录 → 'transcribe'（音视频默认）
    //   - 一键转译 → 'full'
    //   - 仅翻译 → 'translate'（SRT 默认）
    // 这里不再强制覆盖，否则会抹掉"一键转译"的意图。
    // 记录该次转录使用的热词组名，UI 卡片可展示
    if (selectedKeytermGroup) {
      useFilesStore.getState().updatePhase(fileId, 'transcribing', {
        keytermGroupName: selectedKeytermGroup.name,
      });
    }

    logger.info(
      `[transcription] 上传 ${asrFile.name} ${(asrFile.size / 1024 / 1024).toFixed(2)}MB (${asrFile.type})`
    );

    // 任务级 AI 断句开关（创建任务时从全局设置快照，之后改设置不影响本任务）
    const aiEnabled = file.aiSegmentationEnabled === true;

    const result = await runTranscriptionPipeline(
      asrFile,
      allKeyterms,
      {
        onTranscribing: () => {
          useFilesStore.getState().updatePhase(fileId, 'transcribing', {
            status: 'active',
            progress: -1,
            tokens: 0,
          });
        },
        onProgress: (percent) => {
          useFilesStore.getState().updatePhase(
            fileId,
            segmentingActive ? 'segmenting' : 'transcribing',
            { progress: percent }
          );
        },
        // ASR 返回、断句开始：识别完成 → AI 断句阶段激活
        onSegmenting: () => {
          if (!aiEnabled || segmentingActive) return;
          segmentingActive = true;
          useFilesStore.getState().updatePhase(fileId, 'transcribing', {
            status: 'completed',
            progress: 100,
          });
          useFilesStore.getState().updatePhase(fileId, 'segmenting', {
            status: 'active',
            progress: -1,
            tokens: 0,
          });
        },
        // AI 断句兜底进度：写入 entryCount/totalEntries，UI 显示「AI断句 n/m」
        onAiProgress: (resolved, total) => {
          useFilesStore.getState().updatePhase(fileId, 'segmenting', {
            entryCount: resolved,
            totalEntries: total,
          });
        },
        // 与翻译相同：每次真实 LLM 调用立刻 tokensDelta，状态栏右下角即时累加
        onAiTokens: (delta) => {
          if (delta <= 0) return;
          useFilesStore.getState().updatePhase(fileId, 'segmenting', {
            tokensDelta: delta,
          });
        },
      },
      { useAiSegmentation: aiEnabled }
    );

    // 先写 phase 元数据，再 replaceTaskEntries（权威 hydrate + dirty flush）
    useFilesStore.setState((state) => ({
      tasks: state.tasks.map((t) =>
        t.taskId === file.taskId
          ? {
              ...t,
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
                  keytermGroupName: selectedKeytermGroup?.name,
                },
                // AI 断句阶段的 LLM 消耗统一记录在此（历史/状态栏同源）
                ...(aiEnabled
                  ? {
                      segmenting: {
                        status: 'completed' as const,
                        progress: 100,
                        tokens: result.tokensUsed ?? 0,
                        entryCount: result.entries.length,
                        totalEntries: result.entries.length,
                      },
                    }
                  : {}),
              },
            }
          : t
      ),
    }));
    useFilesStore.getState().replaceTaskEntries(file.taskId, result.entries);

    toast.success(`转录完成！生成 ${result.entries.length} 条字幕`);

    // 转录完成即入库：仅原文也可从历史导出；之后翻译完成会按 taskId 覆盖同一条
    if (result.entries.length > 0) {
      void saveTranslationHistory(
        file.taskId,
        file.name,
        result.tokensUsed ?? 0,
        (entry) => useHistoryStore.getState().addHistory(entry)
      );
    }
  } catch (error) {
    const appError = toAppError(error, '转录失败');
    logger.error(appError.message, appError);
    toast.error(`转录失败: ${appError.message}`);

    // pipeline 抛错时无条件标 transcribing 失败（不论之前是 upcoming 还是 active）
    // converting 由 addFile 阶段负责，这里不动
    useFilesStore.getState().updatePhase(fileId, 'transcribing', { status: 'failed', progress: 0 });
    if (segmentingActive) {
      useFilesStore.getState().updatePhase(fileId, 'segmenting', { status: 'failed', progress: 0 });
    }
  }
}
