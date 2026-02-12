/**
 * 转录流程服务
 * 封装完整的音视频转录流程：AssemblyAI 转录 -> LLM分割 -> 字幕生成
 */

import { SubtitleEntry, type LLMConfig as BaseLLMConfig } from '@/types';
import type { TranscriptionWord } from '@/types/transcription';
import { assemblyaiService } from './assemblyaiService';
import { ASSEMBLYAI_CONFIG } from '@/constants/assemblyai';
import dataManager from '@/services/dataManager';
import { createBatches, logBatchOverview, type BatchInfo } from '@/utils/batchProcessor';
import { formatSRTTime } from '@/utils/timeFormat';
import { getSentenceSegmentationPrompt } from '@/utils/translationPrompts';
import { getLlmWordsAndSplits, mapLlmSplitsToOriginal, reconstructSentences } from '@/utils/sentenceTools';
import { jsonrepair } from 'jsonrepair';
import { callLLM } from '@/utils/llmApi';
import { toast } from 'react-hot-toast';
import { API_CONSTANTS } from '@/constants/api';
import { AUDIO_CONSTANTS, TRANSCRIPTION_BATCH_CONSTANTS, TRANSCRIPTION_PROGRESS } from '@/constants/transcription';
import { toAppError } from '@/utils/errors';

// 重新导出类型
export type { TranscriptionWord };

/**
 * 转录 LLM 配置（继承基础 LLM 配置，增加转录相关字段）
 */
export interface TranscriptionLLMConfig extends BaseLLMConfig {
  sourceLanguage: string;
  threadCount?: number;  // LLM 并发线程数，默认 4
}

/**
 * 进度更新回调
 */
export interface ProgressCallbacks {
  onTranscribing?: () => void;
  onLLMMerging?: () => void;
  onLLMProgress?: (completed: number, total: number, percent: number, cumulativeTokens: number) => void;
}

/**
 * 转录结果
 */
export interface TranscriptionResult {
  entries: SubtitleEntry[];
  duration: number;
  totalChunks: number;
  tokensUsed: number; // LLM 组句消耗的 tokens
}

/**
 * 调用 LLM 进行句子分割
 */
const callLlmApi = async (prompt: string, config: TranscriptionLLMConfig): Promise<{ content: string; tokensUsed: number }> => {
  const result = await callLLM(
    {
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      model: config.model
    },
    [{ role: 'user', content: prompt }],
    { temperature: API_CONSTANTS.DEFAULT_TEMPERATURE }
  );

  return { content: result.content, tokensUsed: result.tokensUsed };
};

/**
 * 处理单个批次（LLM 句子分割或直接连接）
 */
const processBatch = async (
  batch: BatchInfo,
  llmConfig: TranscriptionLLMConfig
): Promise<{
  sentences: Array<{ sentence: string; startIdx: number; endIdx: number }>;
  tokensUsed: number;
}> => {
  // 如果标记为跳过 LLM，直接将单词连接成句子
  if (batch.skipLLM) {
    const originalWords = batch.words.map(w => w.text);
    const sentence = originalWords.join(' ');
    const startIdx = batch.startIdx;
    const endIdx = batch.startIdx + batch.words.length - 1;

    return {
      sentences: [{
        sentence,
        startIdx,
        endIdx
      }],
      tokensUsed: 0
    };
  }

  // 调用 LLM 进行句子分割
  const wordsList = batch.words.map(w => w.text);
  const segmentationPrompt = getSentenceSegmentationPrompt(
    wordsList,
    TRANSCRIPTION_BATCH_CONSTANTS.LLM_MAX_WORDS,
    llmConfig.sourceLanguage
  );

  const { content: llmResponse, tokensUsed } = await callLlmApi(segmentationPrompt, llmConfig);

  // 使用 jsonrepair 清理 markdown 代码块等格式问题
  const repairedJson = jsonrepair(llmResponse);
  const parsed = JSON.parse(repairedJson);
  const llmSentences = parsed.sentences || [];

  // 核心逻辑：用序列匹配将 LLM 分组映射回原始单词
  const originalCleanWords = batch.words.map(w => w.text.toLowerCase().replace(/[^a-z0-9]/g, ''));

  // 提取 LLM 的清理后单词和分割点
  const [llmCleanWords, llmSplitIndices] = getLlmWordsAndSplits(llmSentences);

  // 用序列匹配将分割点映射回原始单词
  const originalSplitIndices = mapLlmSplitsToOriginal(originalCleanWords, llmCleanWords, llmSplitIndices);

  // 用原始单词重建句子（保留原始文本，包括大小写和标点）
  const originalWords = batch.words.map(w => w.text);
  const reconstructedSentences = reconstructSentences(originalWords, originalSplitIndices);

  // 直接使用 originalSplitIndices 计算每个句子的索引范围
  const completeSplitIndices = [...originalSplitIndices];
  if (completeSplitIndices.length === 0 || completeSplitIndices[completeSplitIndices.length - 1] !== originalWords.length) {
    completeSplitIndices.push(originalWords.length);
  }

  const sentenceMappings: Array<{ sentence: string; startIdx: number; endIdx: number }> = [];
  let lastSplitIdx = 0;
  for (let i = 0; i < completeSplitIndices.length; i++) {
    const splitIdx = completeSplitIndices[i];
    if (splitIdx > lastSplitIdx) {
      const startIdx = batch.startIdx + lastSplitIdx;
      const endIdx = batch.startIdx + splitIdx - 1;
      sentenceMappings.push({
        sentence: reconstructedSentences[i] || originalWords.slice(lastSplitIdx, splitIdx).join(' '),
        startIdx,
        endIdx
      });
    }
    lastSplitIdx = splitIdx;
  }

  return {
    sentences: sentenceMappings,
    tokensUsed
  };
};

/**
 * 执行转录流程
 * @param fileRef - 音视频文件引用
 * @param llmConfig - LLM 配置
 * @param callbacks - 进度回调
 * @returns 转录结果
 */
export const runTranscriptionPipeline = async (
  fileRef: File,
  llmConfig: TranscriptionLLMConfig,
  callbacks: ProgressCallbacks = {}
): Promise<TranscriptionResult> => {
  // 1. AssemblyAI 转录（替换解码+静音检测+切片+模型调用）
  callbacks.onTranscribing?.();

  // 从 store 获取热词（所有分组的词汇合并）
  const config = await dataManager.getTranscriptionConfig();
  const allKeyterms = config.keytermGroups?.flatMap(g => g.keyterms) || [];

  const allWords = await assemblyaiService.transcribe(fileRef, {
    keyterms: allKeyterms
  });

  const duration = allWords[allWords.length - 1]?.end_time || 0;
  const totalChunks = 1;  // API 自动处理，不再切片

  await new Promise(r => setTimeout(r, API_CONSTANTS.STATE_UPDATE_DELAY_MS));
  toast(`转录完成，共 ${allWords.length} 个单词`);

  // 2. LLM 句子分割
  callbacks.onLLMMerging?.();

  // 批次切分
  const batches = createBatches(allWords);
  logBatchOverview(batches);

  // 统计需要 LLM 处理的批次（跳过 skipLLM 的批次）
  const llmBatches = batches.filter(b => !b.skipLLM);
  const totalLlmBatches = llmBatches.length;

  // 按线程数分组处理批次（与翻译流程保持一致）
  const threadCount = llmConfig.threadCount || 4;
  const allReconstructedSentences: Array<Array<{ sentence: string; startIdx: number; endIdx: number }>> = new Array(batches.length);

  // 记录 tokens 使用量（包括所有批次，但只累积 LLM 处理的）
  const tokensMap = new Map<number, number>();

  for (let i = 0; i < batches.length; i += threadCount) {
    const currentBatchGroup = batches.slice(i, i + threadCount);

    const batchPromises = currentBatchGroup.map(async (batch, groupIndex) => {
      const batchIdx = i + groupIndex;
      try {
        const { sentences, tokensUsed } = await processBatch(batch, llmConfig);
        allReconstructedSentences[batchIdx] = sentences;
        tokensMap.set(batchIdx, tokensUsed);

        // 只有需要 LLM 处理的批次才更新进度
        if (!batch.skipLLM) {
          // 计算累积 tokens：只包括 LLM 处理的批次
          const cumulativeTokens = Array.from(tokensMap.entries())
            .filter(([idx]) => !batches[idx].skipLLM)
            .reduce((sum, [, tokens]) => sum + tokens, 0);

          // 统计已完成 LLM 处理的批次数
          const completedLlmBatches = Array.from(tokensMap.entries())
            .filter(([idx]) => !batches[idx].skipLLM).length;

          // 调试日志
          console.log(`[LLM组句] 批次 ${completedLlmBatches}/${totalLlmBatches} 完成:`, {
            batchIdx,
            batchTokens: tokensUsed,
            cumulativeTokens,
            mapEntries: Array.from(tokensMap.entries())
          });

          // 更新进度（传递累积总量）
          const percent = Math.floor(
            TRANSCRIPTION_PROGRESS.LLM_PROGRESS_START +
            (completedLlmBatches / totalLlmBatches) * TRANSCRIPTION_PROGRESS.LLM_PROGRESS_RANGE
          );
          callbacks.onLLMProgress?.(
            completedLlmBatches,
            totalLlmBatches,
            percent,
            cumulativeTokens // ✅ 传递累积总量
          );
        }
      } catch (error) {
        const reasonText = batch.reason === 'pause'
          ? `pause ${batch.pauseGap?.toFixed(1)}s`
          : batch.reason === 'punctuation' ? 'punctuation' : 'limit';
        const appError = toAppError(error);
        console.error(`[TranscriptionPipeline] Batch #${batch.startIdx} (${batch.words.length} words, ${reasonText}) 处理失败:`, appError.message);
        // 抛出错误，停止转录流程
        throw new Error(`LLM 句子分割失败（批次 #${batch.startIdx}）: ${appError.message}`);
      }
    });

    await Promise.all(batchPromises);
  }

  // 计算总 tokens 使用量（只包括 LLM 处理的批次）
  const totalTokensUsed = Array.from(tokensMap.entries())
    .filter(([idx]) => !batches[idx].skipLLM)
    .reduce((sum, [, tokens]) => sum + tokens, 0);

  // 5. 生成字幕条目
  const entries: SubtitleEntry[] = [];
  let entryId = 1;

  for (const batchSentences of allReconstructedSentences) {
    for (const { sentence, startIdx, endIdx } of batchSentences) {
      if (startIdx >= allWords.length || endIdx >= allWords.length) {
        continue;
      }

      entries.push({
        id: entryId++,
        startTime: formatSRTTime(allWords[startIdx].start_time),
        endTime: formatSRTTime(allWords[endIdx].end_time),
        text: sentence,
        translatedText: '',
        translationStatus: 'pending'
      });
    }
  }

  if (entries.length === 0) {
    throw new Error('LLM 句子分割失败，请检查 API 配置');
  }

  return {
    entries,
    duration,
    totalChunks,
    tokensUsed: totalTokensUsed
  };
};
