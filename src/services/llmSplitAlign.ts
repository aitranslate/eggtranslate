import { buildSourceSplitPrompt, buildAlignPrompt } from '@/utils/splitAlignPrompts';
import { useTranslationConfigStore } from '@/stores/translationConfigStore';
import { callLLM } from '@/utils/llmApi';
import { countUnits } from '@/utils/textUnitCounter';
import { getSourceLimit, getTargetLimit } from '@/utils/subtitleLengthPresets';
import { jsonrepair } from 'jsonrepair';
import type { SubtitleLengthPreset, LLMSourceSplitResult, LLMAlignResult } from '@/types/transcription';
import type { SubtitleEntry } from '@/types';
import { logger } from '@/utils/logger';

const OBVIOUS_OVERLONG_RATIO = 1.5;

/**
 * 调用 LLM（复用底层 callLLM，自动累加 token）
 */
async function callLLMForSplit(prompt: object): Promise<{ content: string; tokensUsed: number }> {
  const config = useTranslationConfigStore.getState().config;
  const result = await callLLM(
    { baseURL: config.baseURL, apiKey: config.apiKey, model: config.model, rpm: config.rpm },
    [
      { role: 'system', content: 'You are a subtitle segmentation assistant. Output JSON only.' },
      { role: 'user', content: JSON.stringify(prompt) },
    ],
    { temperature: 0.3 }
  );
  return result;
}

/**
 * 安全解析 LLM 返回的 JSON（处理 markdown 代码块等）
 */
function safeParseJSON<T>(content: string): T {
  // 先尝试直接解析
  try {
    return JSON.parse(content);
  } catch {
    // 使用 jsonrepair 修复（处理 ```json ... ``` 等情况）
    logger.warn('LLM 返回非标准 JSON，使用 jsonrepair 修复');
    const repaired = jsonrepair(content);
    return JSON.parse(repaired);
  }
}

/**
 * Step 5.1: LLM 原文拆分（支持并发）
 */
export async function llmSourceSplit(params: {
  entries: SubtitleEntry[];
  sourceLang: string;
  targetLang: string;
  preset: SubtitleLengthPreset;
  fullSourceText: string;
  fullDraftTranslation: string;
  threadCount?: number;
  onProgress?: (current: number, total: number, tokensUsed: number) => void;
}): Promise<{ entryId: number; sourceParts: string[]; tokensUsed: number }[]> {
  const { entries, sourceLang, targetLang, preset, fullSourceText, fullDraftTranslation, threadCount = 4, onProgress } = params;
  const sourceLimit = getSourceLimit(sourceLang, preset);
  const targetLimit = getTargetLimit(targetLang, preset);

  // 筛选需要拆分的条目
  const overlongEntries: { entry: SubtitleEntry; mustSplit: boolean }[] = [];
  let skippedCount = 0;

  for (const entry of entries) {
    const sourceUnits = countUnits(entry.text, sourceLang);
    const targetUnits = countUnits(entry.translatedText || '', targetLang);
    const needsSplit = sourceUnits > sourceLimit || targetUnits > targetLimit;

    if (!needsSplit) {
      skippedCount++;
      continue;
    }

    const mustSplit = sourceUnits > sourceLimit * OBVIOUS_OVERLONG_RATIO ||
                      targetUnits > targetLimit * OBVIOUS_OVERLONG_RATIO;
    overlongEntries.push({ entry, mustSplit });
  }

  // 先报告跳过的条目进度
  for (let i = 0; i < skippedCount; i++) {
    onProgress?.(i + 1, entries.length, 0);
  }

  if (overlongEntries.length === 0) {
    return [];
  }

  const results: { entryId: number; sourceParts: string[]; tokensUsed: number }[] = [];
  let processed = skippedCount;
  let totalTokens = 0;

  // 按 threadCount 分组并发处理
  for (let i = 0; i < overlongEntries.length; i += threadCount) {
    const chunk = overlongEntries.slice(i, i + threadCount);

    const chunkResults = await Promise.all(
      chunk.map(async ({ entry, mustSplit }) => {
        try {
          const prompt = buildSourceSplitPrompt({
            sourceLanguage: sourceLang,
            targetLanguage: targetLang,
            fullSourceText,
            fullDraftTranslation,
            sourceText: entry.text,
            sourceLimit,
            targetLimit,
            splitRound: 1,
            mustSplit,
          });

          const { content, tokensUsed } = await callLLMForSplit(prompt);
          const parsed: LLMSourceSplitResult = safeParseJSON(content);

          if (parsed.sourceParts && parsed.sourceParts.length >= 1) {
            return { entryId: entry.id, sourceParts: parsed.sourceParts, tokensUsed };
          }
        } catch {
          // LLM 失败时保留原文不拆分
        }
        return null;
      })
    );

    // 收集结果并更新进度
    for (const result of chunkResults) {
      processed++;
      if (result) {
        totalTokens += result.tokensUsed;
        results.push(result);
      }
      onProgress?.(processed, entries.length, totalTokens);
    }
  }

  return results;
}

/**
 * Step 5.2: LLM 译文对齐
 */
export async function llmAlignTranslation(params: {
  sourceText: string;
  draftTranslation: string;
  splitSourceLines: { id: number; source: string }[];
  sourceLang: string;
  targetLang: string;
  theme: string;
  terminology: { source: string; target: string; note: string }[];
}): Promise<{ translations: { id: number; text: string }[]; tokensUsed: number }> {
  const { sourceLang, targetLang, ...rest } = params;
  const prompt = buildAlignPrompt({
    sourceLanguage: sourceLang,
    targetLanguage: targetLang,
    ...rest,
  });
  const { content, tokensUsed } = await callLLMForSplit(prompt);
  const parsed: LLMAlignResult = safeParseJSON(content);
  return { translations: parsed.translations || [], tokensUsed };
}
