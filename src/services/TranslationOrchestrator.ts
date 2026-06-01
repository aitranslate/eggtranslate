/**
 * 翻译编排服务
 * 负责协调整个翻译流程，包括批处理、进度更新、历史记录保存
 */

import type { SubtitleEntry, Term, TranslationStatus, TranslationHistoryEntry } from '@/types';
import { useFilesStore } from '@/stores/filesStore';
import toast from 'react-hot-toast';
import { API_CONSTANTS } from '@/constants/api';
import { toAppError } from '@/utils/errors';

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
    terms?: string
  ) => Promise<{ translations: Record<string, { direct: string }>; tokensUsed: number }>;
  updateEntry: (
    id: number,
    text: string,
    translatedText: string,
    status?: TranslationStatus  // 新增可选参数
  ) => Promise<void>;
  updateProgress: (
    current: number,
    total: number,
    phase: 'direct' | 'splitting' | 'completed',
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
 * 计算实际翻译进度
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
  taskId: string,
  formatTermsForPrompt: (terms: Term[]) => string,  // 新增参数
  updateProgressCallback: (completed: number, tokensUsed?: number) => Promise<void>
): Promise<{ batchIndex: number; success: boolean }> {
  console.log(`[TranslationOrchestrator] 开始处理批次 ${batch.batchIndex + 1}，包含 ${batch.untranslatedEntries.length} 个未翻译条目`);
  try {
    // 使用 formatTermsForPrompt 格式化术语
    const termsText = formatTermsForPrompt(batch.relevantTerms);

    const translationResult = await callbacks.translateBatch(
      batch.textsToTranslate,
      controller.signal,
      batch.contextBeforeTexts,
      batch.contextAfterTexts,
      termsText  // 使用格式化后的术语
    );

    const batchUpdates: { id: number; text: string; translatedText: string; status: TranslationStatus }[] = [];

    // 记录 LLM 返回的条目 ID
    const returnedEntryIds = new Set<number>();

    for (const [key, value] of Object.entries(translationResult.translations)) {
      const resultIndex = parseInt(key) - 1;
      const untranslatedEntry = batch.untranslatedEntries[resultIndex];

      if (untranslatedEntry && typeof value === 'object' && value.direct) {
        returnedEntryIds.add(untranslatedEntry.id);
        batchUpdates.push({
          id: untranslatedEntry.id,
          text: untranslatedEntry.text,
          translatedText: value.direct,
          status: 'completed'
        });
      }
    }

    // 对于批次中 LLM 未返回的条目（合并翻译策略），也标记为 completed
    for (const entry of batch.untranslatedEntries) {
      if (!returnedEntryIds.has(entry.id)) {
        batchUpdates.push({
          id: entry.id,
          text: entry.text,
          translatedText: '',  // LLM 采用合并策略，本条无独立翻译
          status: 'completed'
        });
      }
    }

    if (batchUpdates.length > 0) {
      for (const update of batchUpdates) {
        await callbacks.updateEntry(
          update.id,
          update.text,
          update.translatedText,
          update.status  // 传递状态
        );
      }

      // 传递本次翻译使用的 tokens
      await updateProgressCallback(batchUpdates.length, translationResult.tokensUsed);

      console.log(`[TranslationOrchestrator] 批次 ${batch.batchIndex + 1} 翻译成功，更新了 ${batchUpdates.length} 个条目，消耗 ${translationResult.tokensUsed} tokens`);
    }

    return { batchIndex: batch.batchIndex, success: true };
  } catch (error) {
    if (error instanceof Error && error.name !== 'AbortError') {
      const appError = toAppError(error);
      console.error(`[TranslationOrchestrator] 批次 ${batch.batchIndex + 1} 翻译失败:`, appError.message);
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
  const { entries, filename, config, controller, taskId } = options;

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
        taskId,
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

  // 完成翻译
  const finalProgress = calculateActualProgress(entries);
  const statusText =
    finalProgress.completed === entries.length ? '翻译完成' : '部分翻译';

  await callbacks.updateProgress(
    finalProgress.completed,
    entries.length,
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
    console.error('[TranslationOrchestrator]', appError.message, appError);
  }
}
