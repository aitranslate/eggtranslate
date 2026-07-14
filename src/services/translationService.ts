/**
 * 翻译 Service
 * 编排翻译流程
 *
 * 从原 subtitleStore.startTranslation 提取（463 行 → service 层）
 * - 通过 useFilesStore.getState() 访问状态
 * - 不再持有业务编排逻辑在 store 内
 *
 * 注：断句（DP 断句）统一在转录阶段完成：音视频走 segmentWords，
 * 直接上传 SRT 不再二次断句。本服务只负责翻译，不含 AI 断句对齐。
 */

import { useFilesStore, flushFilesStorePersist } from '@/stores/filesStore';
import { useTranslationConfigStore } from '@/stores/translationConfigStore';
import { useTermsStore } from '@/stores/termsStore';
import { useStreamingOverlayStore } from '@/stores/streamingOverlayStore';
import { executeTranslation } from './TranslationOrchestrator';
import { toAppError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import {
  getRelevantTerms as getRelevantTermsUtil,
  formatTermsForPrompt as formatTermsForPromptUtil
} from '@/utils/termsHelpers';
import type { SubtitleEntry, Term, FilePhases } from '@/types';
import toast from 'react-hot-toast';

export async function startTranslation(
  fileId: string
): Promise<{ tokens: number; entries: SubtitleEntry[]; phases: FilePhases } | null> {
  const file = useFilesStore.getState().getFile(fileId);
  if (!file) return null;

  // 如果翻译已完成，跳过
  if (file.phases.translating.status === 'completed') {
    logger.info('翻译已完成，跳过');
    return null;
  }

  const translationConfigStore = useTranslationConfigStore.getState();
  const config = translationConfigStore.config;
  if (!translationConfigStore.isConfigured) {
    toast.error('请先配置翻译 API');
    return null;
  }

  try {
    const controller = await translationConfigStore.startTranslation(file.taskId);

    // 从 tasks 获取 entries（内存读取）
    const task = useFilesStore.getState().tasks.find(t => t.taskId === file.taskId);
    const entries = task?.subtitle_entries || [];

    // 恢复翻译进度（断点续跑时保持已有进度）
    const restoredProgress = file.phases.translating.progress > 0 ? file.phases.translating.progress : 0;
    const restoredTokens = file.phases.translating.tokens || 0;

    // 只有未完成才设置 active 状态，但保留已有进度和 tokens
    const translatingStatus = useFilesStore.getState().getFile(fileId)?.phases.translating.status;
    if (translatingStatus !== 'completed') {
      useFilesStore.getState().updatePhase(fileId, 'translating', { status: 'active', progress: restoredProgress, tokens: restoredTokens });
    }

    await executeTranslation(
      {
        entries,
        filename: file.name,
        config: {
          batchSize: config.batchSize,
          contextBefore: config.contextBefore,
          contextAfter: config.contextAfter,
          threadCount: config.threadCount
        },
        controller,
        taskId: file.taskId
      },
      {
        translateBatch: translationConfigStore.translateBatch,
        batchUpdateEntries: (updates) => {
          useFilesStore.getState().batchUpdateEntries(fileId, updates);
        },
        // 流式只打内存 overlay，不碰 filesStore / persist
        applyStreamingPartials: (updates) => {
          useStreamingOverlayStore.getState().applyPartials(fileId, updates);
        },
        clearStreamingIds: (ids) => {
          useStreamingOverlayStore.getState().clearIds(fileId, ids);
        },
        updateProgress: async (current: number, total: number, phase: 'direct' | 'completed', status: string, taskId: string, newTokens?: number) => {
          await translationConfigStore.updateProgress(current, total, phase, status, taskId);

          // 进度与 token 解耦：即使流式未返回 usage，phase 进度也要推进
          const progress = total > 0 ? Math.round((current / total) * 100) : 0;
          if (newTokens !== undefined && newTokens > 0) {
            const prevTokens = useFilesStore.getState().getFile(fileId)?.tokensUsed || 0;
            useFilesStore.getState().updatePhase(fileId, 'translating', {
              progress,
              tokens: prevTokens + newTokens,
            });
          } else {
            useFilesStore.getState().updatePhase(fileId, 'translating', { progress });
          }
        },
        getRelevantTerms: (batchText: string, before: string, after: string): Term[] => {
          const allTerms = useTermsStore.getState().terms;
          return getRelevantTermsUtil(allTerms, batchText, before, after);
        },
        formatTermsForPrompt: (terms: Term[]): string => formatTermsForPromptUtil(terms)
      }
    );

    if (controller.signal.aborted) {
      logger.info('翻译已中止（文件已删除）');
      useStreamingOverlayStore.getState().clearFile(fileId);
      return null;
    }

    // 完成翻译 — 更新 tasks（内存操作）；updatePhase(completed) 会 flush persist
    useStreamingOverlayStore.getState().clearFile(fileId);
    const finalTokens = useFilesStore.getState().getFile(fileId)?.tokensUsed || 0;
    useFilesStore.getState().updatePhase(fileId, 'translating', { status: 'completed', progress: 100, tokens: finalTokens });
    await flushFilesStorePersist();

    const finalTask = useFilesStore.getState().tasks.find(t => t.taskId === file.taskId);
    const lastEntries = finalTask?.subtitle_entries || entries;
    const finalPhases = useFilesStore.getState().getFile(fileId)?.phases;
    toast.success(`${file.name} 翻译完成`);
    logger.info(`任务完成，总消耗 ${finalTokens} tokens`);
    return { tokens: finalTokens, entries: lastEntries, phases: finalPhases! };
  } catch (error) {
    useStreamingOverlayStore.getState().clearFile(fileId);
    const appError = toAppError(error, '翻译失败');
    logger.error(appError.message, appError);
    toast.error(`翻译失败: ${appError.message}`);

    const phases = useFilesStore.getState().getFile(fileId)?.phases;
    if (phases?.translating.status === 'active') {
      useFilesStore.getState().updatePhase(fileId, 'translating', {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      await flushFilesStorePersist();
    }
  } finally {
    useTranslationConfigStore.getState().stopTranslation();
  }
  return null;
}
