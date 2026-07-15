/**
 * 翻译 Service
 * 编排单文件翻译流程：会话态 → Orchestrator → phase / 历史
 *
 * - 默认通过 store getState 接线（App 运行时）
 * - 可通过 deps 注入依赖（单测 / 将来非 React 宿主）
 *
 * 注：断句（DP 断句）统一在转录阶段完成：音视频走 segmentWords，
 * 直接上传 SRT 不再二次断句。本服务只负责翻译，不含 AI 断句对齐。
 */

import { useFilesStore, flushFilesStorePersist } from '@/stores/filesStore';
import { useTranslationConfigStore } from '@/stores/translationConfigStore';
import { useTermsStore } from '@/stores/termsStore';
import { useStreamingOverlayStore } from '@/stores/streamingOverlayStore';
import { executeTranslation } from './TranslationOrchestrator';
import { translateBatch as llmTranslateBatch } from './llmTranslationService';
import { toAppError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import {
  getRelevantTerms as getRelevantTermsUtil,
  formatTermsForPrompt as formatTermsForPromptUtil
} from '@/utils/termsHelpers';
import type {
  SubtitleEntry,
  Term,
  FilePhases,
  SubtitleFileMetadata,
  TranslationConfig,
  TranslationStatus,
} from '@/types';
import toast from 'react-hot-toast';

/** 可注入依赖：单测时 mock，默认走全局 store */
export type TranslationServiceDeps = {
  getFile: (fileId: string) => SubtitleFileMetadata | undefined;
  getTaskEntries: (taskId: string) => SubtitleEntry[];
  getConfig: () => TranslationConfig;
  isConfigured: () => boolean;
  beginSession: (taskId: string) => Promise<AbortController>;
  endSession: () => void;
  updateUiProgress: (
    current: number,
    total: number,
    phase: 'direct' | 'completed',
    status: string,
    taskId?: string
  ) => Promise<void>;
  updatePhase: (
    fileId: string,
    phase: 'translating',
    update: Partial<FilePhases['translating']> & { tokensDelta?: number }
  ) => void;
  batchUpdateEntries: (
    fileId: string,
    updates: Array<{
      id: number;
      text: string;
      translatedText: string;
      status?: TranslationStatus;
    }>
  ) => void;
  applyStreamingPartials: (fileId: string, updates: Array<{ id: number; text: string }>) => void;
  clearStreamingIds: (fileId: string, ids: number[]) => void;
  clearStreamingFile: (fileId: string) => void;
  getTokensUsed: (fileId: string) => number;
  getAllTerms: () => Term[];
  flushPersist: () => Promise<void>;
  translateBatch: typeof llmTranslateBatch;
  notifySuccess: (message: string) => void;
  notifyError: (message: string) => void;
};

function createDefaultDeps(): TranslationServiceDeps {
  return {
    getFile: (fileId) => useFilesStore.getState().getFile(fileId),
    getTaskEntries: (taskId) => {
      const task = useFilesStore.getState().tasks.find((t) => t.taskId === taskId);
      return task?.subtitle_entries || [];
    },
    getConfig: () => useTranslationConfigStore.getState().config,
    isConfigured: () => useTranslationConfigStore.getState().isConfigured,
    beginSession: (taskId) => useTranslationConfigStore.getState().startTranslation(taskId),
    endSession: () => useTranslationConfigStore.getState().stopTranslation(),
    updateUiProgress: (current, total, phase, status, taskId) =>
      useTranslationConfigStore.getState().updateProgress(current, total, phase, status, taskId),
    updatePhase: (fileId, phase, update) =>
      useFilesStore.getState().updatePhase(fileId, phase, update),
    batchUpdateEntries: (fileId, updates) =>
      useFilesStore.getState().batchUpdateEntries(fileId, updates),
    applyStreamingPartials: (fileId, updates) =>
      useStreamingOverlayStore.getState().applyPartials(fileId, updates),
    clearStreamingIds: (fileId, ids) =>
      useStreamingOverlayStore.getState().clearIds(fileId, ids),
    clearStreamingFile: (fileId) => useStreamingOverlayStore.getState().clearFile(fileId),
    getTokensUsed: (fileId) => useFilesStore.getState().getFile(fileId)?.tokensUsed || 0,
    getAllTerms: () => useTermsStore.getState().terms,
    flushPersist: () => flushFilesStorePersist(),
    translateBatch: llmTranslateBatch,
    notifySuccess: (message) => toast.success(message),
    notifyError: (message) => toast.error(message),
  };
}

export async function startTranslation(
  fileId: string,
  depsOverride?: Partial<TranslationServiceDeps>
): Promise<{ tokens: number; entries: SubtitleEntry[]; phases: FilePhases } | null> {
  const deps = { ...createDefaultDeps(), ...depsOverride };

  const file = deps.getFile(fileId);
  if (!file) return null;

  // 如果翻译已完成，跳过
  if (file.phases.translating.status === 'completed') {
    logger.info('翻译已完成，跳过');
    return null;
  }

  const config = deps.getConfig();
  if (!deps.isConfigured()) {
    deps.notifyError('请先配置翻译 API');
    return null;
  }

  try {
    const controller = await deps.beginSession(file.taskId);

    const entries = deps.getTaskEntries(file.taskId);

    // 恢复翻译进度（断点续跑时保持已有进度）
    const restoredProgress = file.phases.translating.progress > 0 ? file.phases.translating.progress : 0;
    const restoredTokens = file.phases.translating.tokens || 0;

    // 只有未完成才设置 active 状态，但保留已有进度和 tokens
    const translatingStatus = deps.getFile(fileId)?.phases.translating.status;
    if (translatingStatus !== 'completed') {
      deps.updatePhase(fileId, 'translating', {
        status: 'active',
        progress: restoredProgress,
        tokens: restoredTokens,
      });
    }

    await executeTranslation(
      {
        entries,
        filename: file.name,
        config: {
          batchSize: config.batchSize,
          contextBefore: config.contextBefore,
          contextAfter: config.contextAfter,
          threadCount: config.threadCount,
        },
        controller,
        taskId: file.taskId,
      },
      {
        translateBatch: (
          texts,
          signal,
          contextBefore,
          contextAfter,
          terms,
          onPartial,
          onAttemptStart
        ) =>
          deps.translateBatch(config, texts, {
            signal,
            contextBefore,
            contextAfter,
            terms,
            onPartial,
            onAttemptStart,
          }),
        batchUpdateEntries: (updates) => {
          deps.batchUpdateEntries(fileId, updates);
        },
        // 流式只打内存 overlay，不碰 filesStore / persist
        applyStreamingPartials: (updates) => {
          deps.applyStreamingPartials(fileId, updates);
        },
        clearStreamingIds: (ids) => {
          deps.clearStreamingIds(fileId, ids);
        },
        getCurrentEntries: () => deps.getTaskEntries(file.taskId),
        updateProgress: async (
          current: number,
          total: number,
          phase: 'direct' | 'completed',
          status: string,
          taskId: string,
          newTokens?: number
        ) => {
          await deps.updateUiProgress(current, total, phase, status, taskId);

          // 进度与 token 解耦；tokensDelta 在 store 内原子累加（并发 batch 安全）
          const progress = total > 0 ? Math.round((current / total) * 100) : 0;
          if (newTokens !== undefined && newTokens > 0) {
            deps.updatePhase(fileId, 'translating', {
              progress,
              tokensDelta: newTokens,
            });
          } else {
            deps.updatePhase(fileId, 'translating', { progress });
          }
        },
        getRelevantTerms: (batchText: string, before: string, after: string): Term[] => {
          return getRelevantTermsUtil(deps.getAllTerms(), batchText, before, after);
        },
        formatTermsForPrompt: (terms: Term[]): string => formatTermsForPromptUtil(terms),
      }
    );

    if (controller.signal.aborted) {
      logger.info('翻译已中止（文件已删除）');
      deps.clearStreamingFile(fileId);
      return null;
    }

    // 完成翻译 — 更新 tasks（内存操作）；updatePhase(completed) 会 flush persist
    deps.clearStreamingFile(fileId);
    const finalTokens = deps.getTokensUsed(fileId);
    deps.updatePhase(fileId, 'translating', {
      status: 'completed',
      progress: 100,
      tokens: finalTokens,
    });
    await deps.flushPersist();

    const lastEntries = deps.getTaskEntries(file.taskId);
    const finalPhases = deps.getFile(fileId)?.phases;
    deps.notifySuccess(`${file.name} 翻译完成`);
    logger.info(`任务完成，总消耗 ${finalTokens} tokens`);
    return { tokens: finalTokens, entries: lastEntries, phases: finalPhases! };
  } catch (error) {
    deps.clearStreamingFile(fileId);
    const appError = toAppError(error, '翻译失败');
    logger.error(appError.message, appError);
    deps.notifyError(`翻译失败: ${appError.message}`);

    const phases = deps.getFile(fileId)?.phases;
    if (phases?.translating.status === 'active') {
      deps.updatePhase(fileId, 'translating', {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      await deps.flushPersist();
    }
  } finally {
    deps.endSession();
  }
  return null;
}
