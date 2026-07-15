/**
 * 翻译编排服务
 * 负责协调整个翻译流程，包括批处理、进度更新、历史记录保存
 */

import type { SubtitleEntry, Term, TranslationStatus, TranslationHistoryEntry } from '@/types';
import { useFilesStore } from '@/stores/filesStore';
import toast from 'react-hot-toast';
import { API_CONSTANTS } from '@/constants/api';
import { toAppError } from '@/utils/errors';
import { logger } from '@/utils/logger';

export interface BatchInfo {
  batchIndex: number;
  untranslatedEntries: SubtitleEntry[];
  textsToTranslate: string[];
  contextBeforeTexts: string;
  contextAfterTexts: string;
  relevantTerms: Term[];  // 改为传递术语数组
}

export interface TranslationConfig {
  batchSize: number;
  contextBefore: number;
  contextAfter: number;
  threadCount: number;
}

export interface TranslationCallbacks {
  translateBatch: (
    texts: string[],
    signal?: AbortSignal,
    contextBefore?: string,
    contextAfter?: string,
    terms?: string,
    /** 流式 partial：key 为 "1"|"2"|...，与 texts 下标对应 */
    onPartial?: (translations: Record<string, { direct: string }>) => void,
    /** 格式重试 attempt 从 1 起；>1 时应清本批 overlay */
    onAttemptStart?: (attempt: number) => void
  ) => Promise<{ translations: Record<string, { direct: string }>; tokensUsed: number; partial?: boolean }>;
  /**
   * Apply an entire batch of entry patches in one store mutation.
   * Prefer this over per-line updateEntry on the translation hot path.
   */
  batchUpdateEntries: (
    updates: Array<{
      id: number;
      text: string;
      translatedText: string;
      status?: TranslationStatus;
    }>
  ) => void | Promise<void>;
  /**
   * 流式 UI 层：只更新内存 overlay，不写 filesStore / 不触发 persist。
   * 缺省时降级忽略 partial（仅最终 batch 落库）。
   */
  applyStreamingPartials?: (updates: Array<{ id: number; text: string }>) => void;
  /** 批次定稿或失败后清掉对应条目的流式 overlay */
  clearStreamingIds?: (ids: number[]) => void;
  /** 从 store 读当前条目（补扫 missing/pending 用） */
  getCurrentEntries?: () => SubtitleEntry[];
  updateProgress: (
    current: number,
    total: number,
    phase: 'direct' | 'completed',
    status: string,
    taskId: string,
    newTokens?: number  // 新增参数：用于传递本次翻译使用的 tokens
  ) => Promise<void>;
  getRelevantTerms: (batchText: string, before: string, after: string) => Term[];
  formatTermsForPrompt: (terms: Term[]) => string;  // 新增
}

export interface TranslationOptions {
  entries: SubtitleEntry[];
  filename: string;
  config: TranslationConfig;
  controller: AbortController;
  taskId: string;
}

/**
 * 计算实际翻译进度（仅 completed 算成功；missing 可重试）
 */
export function calculateActualProgress(entries: SubtitleEntry[]): {
  completed: number;
  total: number;
} {
  const completed = entries.filter(
    entry => entry.translationStatus === 'completed'
  ).length;
  return { completed, total: entries.length };
}

export type BatchEntryUpdate = {
  id: number;
  text: string;
  translatedText: string;
  status: TranslationStatus;
};

/**
 * 将 LLM 返回映射为条目更新。
 * - 有非空 direct → completed
 * - 键缺失 / 空 direct → missing（不再伪装成 completed + 空译文）
 */
export function finalizeBatchTranslations(
  untranslatedEntries: Array<Pick<SubtitleEntry, 'id' | 'text'>>,
  translations: Record<string, { direct: string }>
): BatchEntryUpdate[] {
  const updates: BatchEntryUpdate[] = [];
  const returnedEntryIds = new Set<number>();

  for (const [key, value] of Object.entries(translations)) {
    const resultIndex = parseInt(key, 10) - 1;
    const entry = untranslatedEntries[resultIndex];
    if (!entry || typeof value !== 'object' || value == null) continue;
    const direct = typeof value.direct === 'string' ? value.direct : '';
    if (!direct.trim()) continue;
    returnedEntryIds.add(entry.id);
    updates.push({
      id: entry.id,
      text: entry.text,
      translatedText: direct,
      status: 'completed',
    });
  }

  for (const entry of untranslatedEntries) {
    if (!returnedEntryIds.has(entry.id)) {
      updates.push({
        id: entry.id,
        text: entry.text,
        translatedText: '',
        status: 'missing',
      });
    }
  }

  return updates;
}

/**
 * 创建翻译批次
 */
export function createTranslationBatches(
  entries: SubtitleEntry[],
  config: TranslationConfig,
  callbacks: TranslationCallbacks
): BatchInfo[] {
  const { batchSize, contextBefore, contextAfter } = config;
  const totalBatches = Math.ceil(entries.length / batchSize);
  const allBatches: BatchInfo[] = [];

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const startIdx = batchIndex * batchSize;
    const endIdx = Math.min(startIdx + batchSize, entries.length);
    const batchEntries = entries.slice(startIdx, endIdx);

    const untranslatedEntries = batchEntries.filter(
      entry => entry.translationStatus !== 'completed'
    );

    if (untranslatedEntries.length === 0) {
      continue;
    }

    const contextBeforeTexts = entries
      .slice(Math.max(0, startIdx - contextBefore), startIdx)
      .map(e => e.text)
      .join('\n');

    const contextAfterTexts = entries
      .slice(endIdx, Math.min(entries.length, endIdx + contextAfter))
      .map(e => e.text)
      .join('\n');

    const batchText = untranslatedEntries.map(e => e.text).join(' ');
    const relevantTerms = callbacks.getRelevantTerms(
      batchText,
      contextBeforeTexts,
      contextAfterTexts
    );

    const textsToTranslate = untranslatedEntries.map(e => e.text);

    allBatches.push({
      batchIndex,
      untranslatedEntries,
      textsToTranslate,
      contextBeforeTexts,
      contextAfterTexts,
      relevantTerms  // 传递术语数组而非格式化字符串
    });
  }

  return allBatches;
}

/**
 * 执行单个翻译批次
 */
export async function processBatch(
  batch: BatchInfo,
  controller: AbortController,
  callbacks: TranslationCallbacks,
  formatTermsForPrompt: (terms: Term[]) => string,  // 新增参数
  updateProgressCallback: (completed: number, tokensUsed?: number) => Promise<void>
): Promise<{ batchIndex: number; success: boolean }> {
  logger.info(`开始处理批次 ${batch.batchIndex + 1}，包含 ${batch.untranslatedEntries.length} 个未翻译条目`);
  const batchEntryIds = batch.untranslatedEntries.map((e) => e.id);

  try {
    // 使用 formatTermsForPrompt 格式化术语
    const termsText = formatTermsForPrompt(batch.relevantTerms);

    // 流式 partial → 内存 overlay（不写 filesStore，避免卡顿）
    const onPartial = (partial: Record<string, { direct: string }>) => {
      if (!callbacks.applyStreamingPartials) return;
      const streamingUpdates: Array<{ id: number; text: string }> = [];

      for (const [key, value] of Object.entries(partial)) {
        const resultIndex = parseInt(key, 10) - 1;
        const entry = batch.untranslatedEntries[resultIndex];
        if (!entry || typeof value !== 'object' || !value.direct) continue;
        streamingUpdates.push({ id: entry.id, text: value.direct });
      }

      if (streamingUpdates.length > 0) {
        callbacks.applyStreamingPartials(streamingUpdates);
      }
    };

    const translationResult = await callbacks.translateBatch(
      batch.textsToTranslate,
      controller.signal,
      batch.contextBeforeTexts,
      batch.contextAfterTexts,
      termsText,  // 使用格式化后的术语
      onPartial,
      // 重试时清掉上轮半截流式，避免「UI 31 条 / 定稿失败」叠在一起
      (attempt) => {
        if (attempt > 1) callbacks.clearStreamingIds?.(batchEntryIds);
      }
    );

    const batchUpdates = finalizeBatchTranslations(
      batch.untranslatedEntries,
      translationResult.translations
    );
    const filledCount = batchUpdates.filter((u) => u.status === 'completed').length;
    const missingCount = batchUpdates.filter((u) => u.status === 'missing').length;

    // 先清 overlay 再落正式数据，避免一帧内 overlay 盖住 completed
    callbacks.clearStreamingIds?.(batchEntryIds);

    if (batchUpdates.length > 0) {
      // One store mutation for the whole batch (not one per line)
      await callbacks.batchUpdateEntries(batchUpdates);

      // 进度只计有独立译文的行；missing 不计入 completed
      await updateProgressCallback(filledCount, translationResult.tokensUsed);

      logger.info(
        `批次 ${batch.batchIndex + 1} 定稿：completed=${filledCount} missing=${missingCount}，消耗 ${translationResult.tokensUsed} tokens`
      );
    }

    return { batchIndex: batch.batchIndex, success: true };
  } catch (error) {
    callbacks.clearStreamingIds?.(batchEntryIds);
    if (error instanceof Error && error.name !== 'AbortError') {
      const appError = toAppError(error);
      logger.error(`批次 ${batch.batchIndex + 1} 翻译失败:`, appError.message);
      toast.error(`批次 ${batch.batchIndex + 1} 翻译失败`);
      // 抛出错误以触发快速失败
      throw error;
    }
    // AbortError 时不抛出，正常返回
    return { batchIndex: batch.batchIndex, success: false };
  }
}

/**
 * 执行翻译流程
 */
export async function executeTranslation(
  options: TranslationOptions,
  callbacks: TranslationCallbacks
): Promise<void> {
  const { entries, config, controller, taskId } = options;

  const initialProgress = calculateActualProgress(entries);
  let currentCompletedCount = initialProgress.completed;

  // 跳过初始化进度调用：如果已有完成条目，说明是断点续跑，
  // 进度已在 UI 显示，不需要重置为 0%
  if (currentCompletedCount === 0) {
    await callbacks.updateProgress(
      currentCompletedCount,
      entries.length,
      'direct',
      `准备翻译... (已完成: ${currentCompletedCount}/${entries.length})`,
      taskId
    );
  }

  // 创建批次（createTranslationBatches 已经只返回有未翻译条目的批次）
  const batchesToTranslate = createTranslationBatches(entries, config, callbacks);

  // 更新进度的回调
  const updateProgressCallback = async (completedEntries: number, tokensUsed?: number) => {
    currentCompletedCount += completedEntries;
    const percentage = Math.round((currentCompletedCount / entries.length) * 100);
    const statusText = `翻译中... (${currentCompletedCount}/${entries.length}) ${percentage}%`;
    await callbacks.updateProgress(
      currentCompletedCount,
      entries.length,
      'direct',
      statusText,
      taskId,
      tokensUsed  // 传递本次翻译使用的 tokens
    );
  };

  // 按线程数分组处理批次
  for (let i = 0; i < batchesToTranslate.length; i += config.threadCount) {
    const currentBatchGroup = batchesToTranslate.slice(i, i + config.threadCount);

    const batchPromises = currentBatchGroup.map(batch =>
      processBatch(
        batch,
        controller,
        callbacks,
        callbacks.formatTermsForPrompt,  // 传递格式化函数
        updateProgressCallback
      )
    );

    // 新增：批次失败立即中断
    try {
      await Promise.all(batchPromises);
    } catch (error) {
      // 任何批次失败 → 抛出错误中断整个翻译
      throw new Error(`批次翻译失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 补扫：主循环后仍 pending/missing 的行再跑一轮（流式缺 key 落 missing 后可再凑）
  if (callbacks.getCurrentEntries && !controller.signal.aborted) {
    const latest = callbacks.getCurrentEntries();
    const incomplete = latest.filter((e) => e.translationStatus !== 'completed');
    if (incomplete.length > 0) {
      logger.info(`主循环后补扫 ${incomplete.length} 条未完成译文`);
      const recoveryBatches = createTranslationBatches(latest, config, callbacks);
      for (let i = 0; i < recoveryBatches.length; i += config.threadCount) {
        if (controller.signal.aborted) break;
        const group = recoveryBatches.slice(i, i + config.threadCount);
        try {
          await Promise.all(
            group.map((batch) =>
              processBatch(
                batch,
                controller,
                callbacks,
                callbacks.formatTermsForPrompt,
                updateProgressCallback
              )
            )
          );
        } catch (error) {
          // 补扫失败不整单推翻：已有译文保留，缺条维持 missing
          logger.error('补扫批次失败（保留已译结果）:', error);
          break;
        }
      }
    }
  }

  // 完成翻译：进度以 store 最新条目为准（勿用启动时的 entries 快照）
  const finalEntries = callbacks.getCurrentEntries?.() ?? entries;
  const finalProgress = calculateActualProgress(finalEntries);
  const statusText =
    finalProgress.completed === finalEntries.length ? '翻译完成' : '部分翻译';

  await callbacks.updateProgress(
    finalProgress.completed,
    finalEntries.length,
    'completed',
    statusText,
    taskId
  );
}

/**
 * 保存翻译历史记录
 */
export async function saveTranslationHistory(
  taskId: string,
  filename: string,
  tokensUsed: number,
  addHistoryEntry: (entry: Omit<TranslationHistoryEntry, 'timestamp'>) => Promise<void>
): Promise<void> {
  try {
    await new Promise(resolve => setTimeout(resolve, API_CONSTANTS.HISTORY_SAVE_DELAY_MS));

    const currentTask = useFilesStore.getState().tasks.find((t) => t.taskId === taskId);

    if (currentTask) {
      const finalTokens = currentTask.phases?.translating?.tokens || tokensUsed || 0;
      const actualCompleted =
        currentTask.subtitle_entries?.filter(
          (entry: SubtitleEntry) => entry.translationStatus === 'completed'
        ).length || 0;

      if (actualCompleted > 0) {
        await addHistoryEntry({
          taskId,
          filename,
          completedCount: actualCompleted,
          totalTokens: finalTokens,
          phases: currentTask.phases,
          subtitle_entries: currentTask.subtitle_entries
        });
      }
    }
  } catch (error) {
    const appError = toAppError(error, '保存历史记录失败');
    logger.error(appError.message, appError);
  }
}
