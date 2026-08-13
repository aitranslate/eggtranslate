/**
 * AI 断句的真实 LLM 调用（breeder 实现）。
 * 纯服务：复用翻译配置的 activeProfile + callLLM（含 rpm 限流/重试）。
 * 任何失败返回 null → 上层回退规则断句，绝不中断转录管线。
 */

import { callLLM } from '@/utils/llmApi';
import { getActiveLlmConfig } from '@/utils/llmProfiles';
import { useTranslationConfigStore } from '@/stores/translationConfigStore';
import { logger } from '@/utils/logger';
import type { AiBreaker } from '@/services/sentenceSegmentation';

/** 单次 AI 断句调用超时：推理类模型思考较久，给足余量；超时即回退。 */
const BREAK_CALL_TIMEOUT_MS = 120_000;

/** 按 span 文本的响应缓存上限（超出淘汰最旧）。 */
const CACHE_MAX_ENTRIES = 300;

const responseCache = new Map<string, string | null>();

function cleanFencedContent(content: string): string | null {
  const cleaned = content
    .replace(/^```[a-z]*\n?/, '')
    .replace(/```\s*$/, '')
    .trim();
  return cleaned || null;
}

function abortAfter(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/**
 * 创建真实 AI 断句回调：入参完整提示词 → 返回带 [BR] 标记的原文或 null。
 * 未配置 LLM / 调用失败 / 超时 → null（上层回退 DP）。
 */
export function createAiSentenceBreaker(): AiBreaker {
  return async (prompt: string): Promise<string | null> => {
    const hit = responseCache.get(prompt);
    if (hit !== undefined) return hit;

    const config = useTranslationConfigStore.getState().config;
    const llm = getActiveLlmConfig(config);
    if (!llm.baseURL?.trim() || !llm.model?.trim()) {
      responseCache.set(prompt, null);
      return null;
    }

    let result: string | null = null;
    try {
      const { signal, clear } = abortAfter(BREAK_CALL_TIMEOUT_MS);
      try {
        const res = await callLLM(
          llm,
          [{ role: 'user', content: prompt }],
          { maxRetries: 1, temperature: 0.1, signal },
        );
        result = cleanFencedContent(res.content);
      } finally {
        clear();
      }
    } catch (error) {
      logger.warn('[aiSentenceBreaker] 调用失败，回退规则断句', error);
      result = null;
    }

    if (responseCache.size >= CACHE_MAX_ENTRIES) {
      const oldest = responseCache.keys().next().value;
      if (oldest !== undefined) responseCache.delete(oldest);
    }
    responseCache.set(prompt, result);
    return result;
  };
}

/** 仅测试用：清空响应缓存。 */
export function clearAiSentenceBreakerCache(): void {
  responseCache.clear();
}
