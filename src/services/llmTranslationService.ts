/**
 * LLM 翻译调用服务（纯业务，不依赖 Zustand）
 *
 * - translateBatch：批译 + 流式 partial + 与流式同口径的解析/重试
 * - testLlmConnection：设置页连接测试
 *
 * 流式与定稿必须对齐：
 * - 流式 UI 用 extractStreamingDirects（容忍半截 JSON）
 * - 旧逻辑定稿用严格 JSON.parse + 全 key 校验 → 缺 1 条就整批重试/失败，
 *   但 UI 已显示 31/32，表现为「卡在处理中」。
 * - 现：定稿解析与流式同口径；末次重试允许部分成功，缺条交给 orchestrator 标 missing。
 */

import type { LlmProfile, TranslationConfig } from '@/types';
import { callLLM, callLLMStream } from '@/utils/llmApi';
import { jsonrepair } from 'jsonrepair';
import { generateSharedPrompt, generateDirectPrompt } from '@/utils/translationPrompts';
import { extractStreamingDirects } from '@/utils/streamingJson';
import {
  getActiveLlmConfig,
  getActiveProfile,
} from '@/utils/llmProfiles';
import { toAppError } from '@/utils/errors';
import { logger } from '@/utils/logger';

export type TranslateBatchResult = {
  translations: Record<string, { direct: string }>;
  tokensUsed: number;
  /** 是否未凑齐全部非空 direct（调用方可标 missing 或再补扫） */
  partial?: boolean;
};

export type TranslateBatchOptions = {
  signal?: AbortSignal;
  contextBefore?: string;
  contextAfter?: string;
  terms?: string;
  /** 流式过程中：已解析出的 partial direct，按 "1"|"2"|... 索引 */
  onPartial?: (translations: Record<string, { direct: string }>) => void;
  /**
   * 每次尝试开始时调用（attempt 从 1 起）。
   * attempt>1 时应用侧应清掉本批 overlay，避免上次半截流盖住重试。
   */
  onAttemptStart?: (attempt: number) => void;
};

const MAX_FORMAT_ATTEMPTS = 3;

/**
 * 校验模型返回的 JSON 是否覆盖每一行原文（且 direct 非空）。
 * 导出以便单测；定稿主路径用 countFilledKeys / isTranslationComplete。
 */
export function validateTranslationResult(
  result: Record<string, { direct: string }>,
  originalTexts: string[]
): void {
  const expectedKeys = originalTexts.map((_, i) => String(i + 1));
  const actualKeys = Object.keys(result);

  for (const key of expectedKeys) {
    if (!actualKeys.includes(key)) {
      throw new Error(`翻译结果缺少键 "${key}"`);
    }
    const entry = result[key];
    if (!entry || typeof entry !== 'object' || !('direct' in entry)) {
      throw new Error(`翻译结果 "${key}" 格式无效`);
    }
    if (!String(entry.direct ?? '').trim()) {
      throw new Error(`翻译结果 "${key}" 译文为空`);
    }
  }
}

/** 有非空 direct 的条数 */
export function countFilledKeys(
  result: Record<string, { direct: string }>,
  originalTexts: string[]
): number {
  let n = 0;
  for (let i = 0; i < originalTexts.length; i++) {
    const direct = result[String(i + 1)]?.direct;
    if (typeof direct === 'string' && direct.trim()) n += 1;
  }
  return n;
}

export function isTranslationComplete(
  result: Record<string, { direct: string }>,
  originalTexts: string[]
): boolean {
  return countFilledKeys(result, originalTexts) === originalTexts.length;
}

/**
 * 与流式 UI 同口径解析模型输出：
 * 1) jsonrepair + JSON.parse（完整/近完整）
 * 2) extractStreamingDirects（半截 JSON / 缺闭合）
 */
export function parseTranslationContent(
  content: string
): Record<string, { direct: string }> {
  const out: Record<string, { direct: string }> = {};

  if (content?.trim()) {
    try {
      const repaired = jsonrepair(content);
      const parsed: unknown = JSON.parse(repaired);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(
          parsed as Record<string, unknown>
        )) {
          if (!/^\d+$/.test(key)) continue;
          if (value && typeof value === 'object' && value !== null && 'direct' in value) {
            const d = (value as { direct: unknown }).direct;
            out[key] = { direct: typeof d === 'string' ? d : d == null ? '' : String(d) };
          } else if (typeof value === 'string') {
            out[key] = { direct: value };
          }
        }
      }
    } catch {
      // fall through to streaming extractor
    }
  }

  // 流式抽取可补全 parse 失败或残缺对象
  const directs = extractStreamingDirects(content || '');
  for (const [key, text] of Object.entries(directs)) {
    if (!out[key]?.direct?.trim() && text.trim()) {
      out[key] = { direct: text };
    }
  }

  return out;
}

/**
 * 调用 LLM 翻译一批字幕文本。
 * 重试策略（与流式对齐）：
 * - 每次尝试：流式优先 → 失败回退非流式
 * - 解析与 UI partial 同一套 parseTranslationContent
 * - 未齐 key：换温度/强调格式再试
 * - 末次仍不齐：返回已有部分（partial:true），不再整批抛死
 * - 仅当 0 条可用译文时才 throw
 */
export async function translateBatch(
  config: TranslationConfig,
  texts: string[],
  options: TranslateBatchOptions = {}
): Promise<TranslateBatchResult> {
  const {
    signal,
    contextBefore = '',
    contextAfter = '',
    terms = '',
    onPartial,
    onAttemptStart,
  } = options;

  const llm = getActiveLlmConfig(config);
  const profile = getActiveProfile(config);
  if (profile.requiresKey !== false && !llm.apiKey?.trim()) {
    throw new Error('请先配置API密钥');
  }

  const textToTranslate = texts.join('\n');
  const sharedPrompt = generateSharedPrompt(contextBefore, contextAfter, terms);
  const directPrompt = generateDirectPrompt(
    textToTranslate,
    sharedPrompt,
    config.sourceLanguage,
    config.targetLanguage
  );

  const retryTemperatures = [0.3, 0.6, 0.9];
  const formatEmphasis = [
    '',
    '\n\nIMPORTANT: Ensure your response is valid JSON with "direct" field for EVERY entry.',
    '\n\nCRITICAL: You MUST return valid JSON with "direct" field for EVERY single line. Do NOT skip any entries.',
  ];

  const llmConfig = {
    baseURL: llm.baseURL,
    apiKey: llm.apiKey,
    model: llm.model,
    rpm: config.rpm,
  };

  let lastError: unknown = null;
  let bestPartial: TranslateBatchResult | null = null;
  /** 各次 attempt 的 usage 累计（含失败轮），避免只记最后一次 */
  let tokensAcc = 0;

  for (let attempt = 1; attempt <= MAX_FORMAT_ATTEMPTS; attempt++) {
    onAttemptStart?.(attempt);

    const promptWithEmphasis = directPrompt + formatEmphasis[attempt - 1];
    let lastPartialSig = '';
    let latestAccumulated = '';
    let parseRaf = 0;

    const emitPartialsFromLatest = () => {
      parseRaf = 0;
      if (!onPartial || !latestAccumulated) return;
      const directs = extractStreamingDirects(latestAccumulated);
      const keys = Object.keys(directs);
      if (keys.length === 0) return;
      const sig = keys.map((k) => `${k}:${directs[k].length}`).join('|');
      if (sig === lastPartialSig) return;
      lastPartialSig = sig;
      const partial: Record<string, { direct: string }> = {};
      for (const k of keys) {
        partial[k] = { direct: directs[k] };
      }
      onPartial(partial);
    };

    const scheduleEmit = (accumulated: string) => {
      if (!onPartial) return;
      latestAccumulated = accumulated;
      if (parseRaf !== 0) return;
      parseRaf =
        typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(emitPartialsFromLatest)
          : (setTimeout(emitPartialsFromLatest, 16) as unknown as number);
    };

    const cancelParseRaf = () => {
      if (parseRaf === 0) return;
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(parseRaf);
      } else {
        clearTimeout(parseRaf);
      }
      parseRaf = 0;
    };

    try {
      let llmResult: { content: string; tokensUsed: number };
      try {
        llmResult = await callLLMStream(
          llmConfig,
          [{ role: 'user', content: promptWithEmphasis }],
          {
            signal,
            temperature: retryTemperatures[attempt - 1],
            maxRetries: 1,
            onDelta: (_delta, accumulated) => scheduleEmit(accumulated),
          }
        );
      } catch (streamErr) {
        if (streamErr instanceof Error && streamErr.name === 'AbortError') {
          throw streamErr;
        }
        logger.error('流式翻译失败，回退非流式:', streamErr);
        llmResult = await callLLM(
          llmConfig,
          [{ role: 'user', content: promptWithEmphasis }],
          {
            signal,
            temperature: retryTemperatures[attempt - 1],
            maxRetries: 1,
          }
        );
        // 非流式也喂一次 partial，便于 UI 立刻出字
        if (llmResult.content) scheduleEmit(llmResult.content);
      } finally {
        cancelParseRaf();
        if (latestAccumulated) emitPartialsFromLatest();
      }

      tokensAcc += llmResult.tokensUsed || 0;

      // 定稿：优先完整 content；若残缺则并入流式累积（与 UI 所见一致）
      const rawForParse =
        llmResult.content?.trim()?.length >= (latestAccumulated?.length ?? 0)
          ? llmResult.content
          : latestAccumulated || llmResult.content;

      const directResult = parseTranslationContent(rawForParse);
      const filled = countFilledKeys(directResult, texts);

      if (filled === 0) {
        throw new Error('翻译结果为空或无法解析');
      }

      if (isTranslationComplete(directResult, texts)) {
        return {
          translations: directResult,
          tokensUsed: tokensAcc,
          partial: false,
        };
      }

      // 不齐：记下最佳部分结果（tokens 用累计）
      const prevFilled = bestPartial
        ? countFilledKeys(bestPartial.translations, texts)
        : 0;
      if (filled > prevFilled) {
        bestPartial = {
          translations: directResult,
          tokensUsed: tokensAcc,
          partial: true,
        };
      } else if (bestPartial) {
        bestPartial = { ...bestPartial, tokensUsed: tokensAcc };
      }

      const missing = texts.length - filled;
      lastError = new Error(
        `翻译结果不完整：${filled}/${texts.length} 条有译文，缺 ${missing} 条`
      );
      logger.error(
        `批次翻译不完整（第${attempt}次尝试）:`,
        lastError instanceof Error ? lastError.message : lastError
      );

      // 未到末次 → 重试凑齐
      if (attempt < MAX_FORMAT_ATTEMPTS) {
        continue;
      }

      // 末次：接受部分成功（缺条由 finalizeBatchTranslations 标 missing）
      logger.info(
        `末次重试仍不齐，接受部分结果 ${filled}/${texts.length}，缺条标 missing`
      );
      return {
        translations: directResult,
        tokensUsed: tokensAcc,
        partial: true,
      };
    } catch (error) {
      cancelParseRaf();
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      lastError = error;
      logger.error(`批次翻译失败（第${attempt}次尝试）:`, error);

      // 尝试从本轮累积流里抢救
      if (latestAccumulated) {
        const salvaged = parseTranslationContent(latestAccumulated);
        const filled = countFilledKeys(salvaged, texts);
        if (filled > 0) {
          const prevFilled = bestPartial
            ? countFilledKeys(bestPartial.translations, texts)
            : 0;
          if (filled > prevFilled) {
            bestPartial = {
              translations: salvaged,
              tokensUsed: tokensAcc,
              partial: true,
            };
          } else if (bestPartial) {
            bestPartial = { ...bestPartial, tokensUsed: tokensAcc };
          }
          if (attempt === MAX_FORMAT_ATTEMPTS) {
            logger.info(
              `异常后从流式缓冲抢救 ${filled}/${texts.length} 条`
            );
            return { ...bestPartial!, tokensUsed: tokensAcc };
          }
        }
      }

      if (attempt === MAX_FORMAT_ATTEMPTS) {
        if (bestPartial && countFilledKeys(bestPartial.translations, texts) > 0) {
          logger.info('全部尝试结束，返回历史最佳部分结果');
          return { ...bestPartial, tokensUsed: tokensAcc };
        }
        throw lastError instanceof Error ? lastError : new Error('翻译失败');
      }
    }
  }

  if (bestPartial && countFilledKeys(bestPartial.translations, texts) > 0) {
    return { ...bestPartial, tokensUsed: tokensAcc };
  }
  throw lastError instanceof Error ? lastError : new Error('翻译失败');
}

export type TestLlmConnectionInput = Pick<
  LlmProfile,
  'baseURL' | 'apiKey' | 'model' | 'requiresKey'
>;

export type TestLlmConnectionResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * 测试 LLM 接口是否可用（不弹 toast，由 UI 决定提示文案）。
 */
export async function testLlmConnection(
  profile: TestLlmConnectionInput,
  options: { maxRetries?: number } = {}
): Promise<TestLlmConnectionResult> {
  if (profile.requiresKey !== false && !profile.apiKey?.trim()) {
    return { ok: false, message: '请先配置 API 密钥' };
  }

  try {
    await callLLM(
      {
        baseURL: profile.baseURL,
        apiKey: profile.apiKey,
        model: profile.model,
      },
      [{ role: 'user', content: 'Hello' }],
      { maxRetries: options.maxRetries ?? 1 }
    );
    return { ok: true };
  } catch (error) {
    const appError = toAppError(error, '连接测试失败');
    logger.error(appError.message, appError);
    return { ok: false, message: appError.message };
  }
}
