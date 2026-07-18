/**
 * LLM 翻译调用服务（纯业务，不依赖 Zustand）
 *
 * - translateBatch：批译 + 流式 partial + 与流式同口径的解析/重试
 * - testLlmConnection：设置页连接测试
 *
 * 流式与定稿必须对齐：
 * - 流式 UI 用 extractStreamingDirects（容忍半截 JSON）
 * - 定稿解析与流式同口径；末次允许部分成功，缺条交给 orchestrator 标 missing
 *
 * 纠错（仅失败路径，成功首轮零开销）：
 * - 第 1 次：原 prompt 流式主译
 * - 不齐/解不出：把模型输出回灌 assistant + user 写明 missing/extra/empty，再请求
 * - 最多 3 轮；纠错轮低温；结果按非空 direct merge 取优
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

type LlmChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

/** 批内格式/键校验最大尝试次数：1 主译 + 最多 2 轮对话纠错 */
const MAX_FORMAT_ATTEMPTS = 3;
const PRIMARY_TEMPERATURE = 0.3;
/** 纠错轮低温，提高「按 missing 列表补键」服从度 */
const REPAIR_TEMPERATURE = 0.1;

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

export type TranslationGaps = {
  /** 完全没有该键 */
  missingKeys: string[];
  /** 有键但 direct 为空 */
  emptyKeys: string[];
  /** 不在 1..n 的多余数字键 */
  extraKeys: string[];
  filled: number;
  total: number;
};

/**
 * 对照期望行数，描述模型结果缺口（纠错 prompt 与单测用）。
 */
export function describeTranslationGaps(
  result: Record<string, { direct: string }>,
  originalTexts: string[]
): TranslationGaps {
  const total = originalTexts.length;
  const expected = new Set(originalTexts.map((_, i) => String(i + 1)));
  const missingKeys: string[] = [];
  const emptyKeys: string[] = [];

  for (let i = 0; i < total; i++) {
    const key = String(i + 1);
    const direct = result[key]?.direct;
    if (direct === undefined) {
      missingKeys.push(key);
    } else if (typeof direct !== 'string' || !direct.trim()) {
      emptyKeys.push(key);
    }
  }

  const extraKeys = Object.keys(result)
    .filter((k) => /^\d+$/.test(k) && !expected.has(k))
    .sort((a, b) => Number(a) - Number(b));

  return {
    missingKeys,
    emptyKeys,
    extraKeys,
    filled: countFilledKeys(result, originalTexts),
    total,
  };
}

/**
 * 构造纠错 user 消息：明确 missing / empty / extra，要求完整 JSON（VC 风格，ET schema）。
 */
export function buildRepairFeedbackMessage(
  originalTexts: string[],
  result: Record<string, { direct: string }>,
  options?: { unparseable?: boolean }
): string {
  const required = originalTexts.map((_, i) => String(i + 1));
  const requiredList = required.join(', ');

  if (options?.unparseable || countFilledKeys(result, originalTexts) === 0) {
    return [
      'Validation failed: could not parse a usable translation JSON (0 filled entries).',
      `Required keys: ${requiredList} (exactly ${required.length} items).`,
      'Output ONLY a valid JSON object. Each value MUST be {"origin":"<source>","direct":"<translation>"}.',
      'Do not wrap in markdown. Do not omit any key.',
    ].join('\n');
  }

  const gaps = describeTranslationGaps(result, originalTexts);
  const parts: string[] = ['Validation failed.'];

  if (gaps.missingKeys.length) {
    parts.push(
      `Missing keys (no entry at all): ${JSON.stringify(gaps.missingKeys)} — you must translate these.`
    );
  }
  if (gaps.emptyKeys.length) {
    parts.push(
      `Empty "direct" fields: ${JSON.stringify(gaps.emptyKeys)} — provide non-empty translations.`
    );
  }
  if (gaps.extraKeys.length) {
    parts.push(
      `Extra keys (not in input, remove them): ${JSON.stringify(gaps.extraKeys)}.`
    );
  }

  parts.push(
    `Required keys: ${requiredList} (ALL ${required.length} keys).`,
    `Progress: ${gaps.filled}/${gaps.total} filled.`,
    'Fix the errors above and output ONLY a complete valid JSON object.',
    'Each value MUST be {"origin":"<source line>","direct":"<translation>"}.',
    'Keep already-correct directs; fill every missing/empty key. No markdown, no explanation.'
  );

  return parts.join('\n');
}

/**
 * 合并两次解析结果：仅用非空 direct 覆盖，避免纠错轮把已有好译文冲掉。
 */
export function mergeTranslationResults(
  base: Record<string, { direct: string }>,
  incoming: Record<string, { direct: string }>,
  originalTexts: string[]
): Record<string, { direct: string }> {
  const out: Record<string, { direct: string }> = { ...base };
  for (let i = 0; i < originalTexts.length; i++) {
    const key = String(i + 1);
    const direct = incoming[key]?.direct;
    if (typeof direct === 'string' && direct.trim()) {
      out[key] = { direct };
    }
  }
  return out;
}

/**
 * 与流式 UI 同口径解析模型输出（三阶段，后两阶段按需）：
 * 1) 严格 `JSON.parse`（完整合法 JSON → 可走快路径）
 * 2) `jsonrepair` + `JSON.parse`（近完整 / 可修复）
 * 3) `extractStreamingDirects`（半截 JSON / 缺闭合 / 非常规结构）
 *
 * 快路径：步骤 1 成功且所有数值键的 `direct` 均非空时，跳过步骤 3 的全文本扫描。
 * 经 jsonrepair 得到的对象仍会跑步骤 3（修补可能吞掉半截字段）。
 */
export function parseTranslationContent(
  content: string
): Record<string, { direct: string }> {
  const out: Record<string, { direct: string }> = {};
  // 流式抽取是否还可能补出新条目
  let streamingCanAddMore = true;

  if (content?.trim()) {
    let parsed: unknown;
    let isCompleteJson = false;
    try {
      parsed = JSON.parse(content);
      isCompleteJson = true;
    } catch {
      try {
        const repaired = jsonrepair(content);
        parsed = JSON.parse(repaired);
      } catch {
        parsed = undefined;
      }
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      let allFilled = true;
      for (const [key, value] of Object.entries(
        parsed as Record<string, unknown>
      )) {
        if (!/^\d+$/.test(key)) continue;
        if (value && typeof value === 'object' && value !== null && 'direct' in value) {
          const d = (value as { direct: unknown }).direct;
          const direct = typeof d === 'string' ? d : d == null ? '' : String(d);
          out[key] = { direct };
          if (!direct.trim()) allFilled = false;
        } else if (typeof value === 'string') {
          out[key] = { direct: value };
          if (!value.trim()) allFilled = false;
        } else {
          // 非常规结构（嵌套/数组等）：流式抽取仍可能补出译文
          allFilled = false;
        }
      }
      streamingCanAddMore = !(isCompleteJson && allFilled);
    }
  }

  // 流式抽取可补全 parse 失败或残缺对象
  if (streamingCanAddMore) {
    const directs = extractStreamingDirects(content || '');
    for (const [key, text] of Object.entries(directs)) {
      if (!out[key]?.direct?.trim() && text.trim()) {
        out[key] = { direct: text };
      }
    }
  }

  return out;
}

/**
 * 调用 LLM 翻译一批字幕文本。
 *
 * 成功路径：第 1 次齐 → 立即返回（无纠错消息、无额外请求）。
 * 失败路径：对话式纠错（assistant 回灌 + missing/extra 反馈），最多 3 轮；
 * 末次仍不齐 → partial:true；仅 0 条可用时 throw。
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

  const llmConfig = {
    baseURL: llm.baseURL,
    apiKey: llm.apiKey,
    model: llm.model,
    rpm: config.rpm,
  };

  /** 累积对话：仅在需要纠错时追加 assistant/user，成功首轮不增长 */
  const messages: LlmChatMessage[] = [{ role: 'user', content: directPrompt }];

  let lastError: unknown = null;
  let bestPartial: TranslateBatchResult | null = null;
  /** 各次 attempt 的 usage 累计（含失败轮），避免只记最后一次 */
  let tokensAcc = 0;

  for (let attempt = 1; attempt <= MAX_FORMAT_ATTEMPTS; attempt++) {
    onAttemptStart?.(attempt);

    const isRepair = attempt > 1;
    const temperature = isRepair ? REPAIR_TEMPERATURE : PRIMARY_TEMPERATURE;
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
      // 始终记下流式累积：异常抢救/定稿不依赖是否挂了 onPartial
      latestAccumulated = accumulated;
      if (!onPartial) return;
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

    const rememberPartial = (translations: Record<string, { direct: string }>) => {
      const merged = bestPartial
        ? mergeTranslationResults(bestPartial.translations, translations, texts)
        : translations;
      const filled = countFilledKeys(merged, texts);
      if (filled === 0) return;
      const prevFilled = bestPartial
        ? countFilledKeys(bestPartial.translations, texts)
        : 0;
      if (filled >= prevFilled) {
        bestPartial = {
          translations: merged,
          tokensUsed: tokensAcc,
          partial: filled < texts.length,
        };
      } else if (bestPartial) {
        bestPartial = { ...bestPartial, tokensUsed: tokensAcc };
      }
    };

    /**
     * 校验失败时扩展对话，供下一轮纠错。
     * @param rawAssistant 本轮模型原文（回灌用）
     * @param gapsSource 用于 missing/empty/extra 的视图——须为 merge 后累计结果，避免把已填好的键再报成 Missing
     */
    const appendRepairTurn = (
      rawAssistant: string,
      gapsSource: Record<string, { direct: string }>,
      unparseable: boolean
    ) => {
      const assistantContent =
        rawAssistant?.trim() ||
        (Object.keys(gapsSource).length
          ? JSON.stringify(gapsSource)
          : '(empty or unparseable output)');
      messages.push({ role: 'assistant', content: assistantContent });
      messages.push({
        role: 'user',
        content: buildRepairFeedbackMessage(texts, gapsSource, { unparseable }),
      });
    };

    try {
      let llmResult: { content: string; tokensUsed: number };
      // 传拷贝：避免调用方/mock 持有同一数组引用，且本轮请求快照不被后续纠错追加污染
      const requestMessages = messages.map((m) => ({ ...m }));
      try {
        llmResult = await callLLMStream(llmConfig, requestMessages, {
          signal,
          temperature,
          maxRetries: 1,
          onDelta: (_delta, accumulated) => scheduleEmit(accumulated),
        });
      } catch (streamErr) {
        if (streamErr instanceof Error && streamErr.name === 'AbortError') {
          throw streamErr;
        }
        logger.error('流式翻译失败，回退非流式:', streamErr);
        llmResult = await callLLM(llmConfig, requestMessages, {
          signal,
          temperature,
          maxRetries: 1,
        });
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
        lastError = new Error('翻译结果为空或无法解析');
        logger.error(
          `批次翻译无法解析（第${attempt}次尝试）:`,
          lastError instanceof Error ? lastError.message : lastError
        );
        if (attempt < MAX_FORMAT_ATTEMPTS) {
          appendRepairTurn(rawForParse || '', directResult, true);
          continue;
        }
        if (bestPartial && countFilledKeys(bestPartial.translations, texts) > 0) {
          return { ...bestPartial, tokensUsed: tokensAcc };
        }
        throw lastError;
      }

      // 与历史 partial merge 后再判是否齐（纠错轮可能只补缺键）
      const merged = bestPartial
        ? mergeTranslationResults(bestPartial.translations, directResult, texts)
        : directResult;
      rememberPartial(directResult);
      // rememberPartial 可能进一步提升 bestPartial；统一用累计视图
      const accumulated = bestPartial?.translations ?? merged;

      if (isTranslationComplete(accumulated, texts)) {
        return {
          translations: accumulated,
          tokensUsed: tokensAcc,
          partial: false,
        };
      }

      const gaps = describeTranslationGaps(accumulated, texts);
      lastError = new Error(
        `翻译结果不完整：${gaps.filled}/${gaps.total} 条有译文，缺 ${
          gaps.total - gaps.filled
        } 条`
      );
      logger.error(
        `批次翻译不完整（第${attempt}次尝试）:`,
        lastError instanceof Error ? lastError.message : lastError,
        gaps
      );

      if (attempt < MAX_FORMAT_ATTEMPTS) {
        // 回灌本轮原文；缺口按累计结果算（已有键不再报 Missing）
        appendRepairTurn(rawForParse || '', accumulated, false);
        continue;
      }

      logger.info(
        `末次纠错仍不齐，接受部分结果 ${gaps.filled}/${gaps.total}，缺条标 missing`
      );
      return {
        translations: accumulated,
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
      if (latestAccumulated?.trim()) {
        const salvaged = parseTranslationContent(latestAccumulated);
        const filled = countFilledKeys(salvaged, texts);
        if (filled > 0) {
          rememberPartial(salvaged);
          const accumulated = bestPartial?.translations ?? salvaged;
          if (isTranslationComplete(accumulated, texts)) {
            return {
              translations: accumulated,
              tokensUsed: tokensAcc,
              partial: false,
            };
          }
          if (attempt < MAX_FORMAT_ATTEMPTS) {
            // 有真实模型碎片：回灌 + 按累计缺口纠错
            appendRepairTurn(latestAccumulated, accumulated, false);
            continue;
          }
          logger.info(
            `异常后从流式缓冲抢救 ${countFilledKeys(accumulated, texts)}/${texts.length} 条`
          );
          return {
            translations: accumulated,
            tokensUsed: tokensAcc,
            partial: true,
          };
        }
        // 有文本但 0 条可解析：仍可走 unparseable 纠错（真实 raw，非假 assistant）
        if (attempt < MAX_FORMAT_ATTEMPTS) {
          appendRepairTurn(
            latestAccumulated,
            bestPartial?.translations ?? {},
            true
          );
          continue;
        }
      }

      if (attempt < MAX_FORMAT_ATTEMPTS) {
        // 纯网络/API 失败且无模型输出：不造假 assistant，原 messages 原样重试
        logger.info(
          `第${attempt}次无模型输出，不扩展对话，下一轮重试（attempt ${attempt + 1}）`
        );
        continue;
      }

      if (bestPartial && countFilledKeys(bestPartial.translations, texts) > 0) {
        logger.info('全部尝试结束，返回历史最佳部分结果');
        return { ...bestPartial, tokensUsed: tokensAcc };
      }
      throw lastError instanceof Error ? lastError : new Error('翻译失败');
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
