// DP 断句模块总入口 —— Layer1 硬切分 + Layer2 DP 软切分。
// Layer2：词/字 + 拉丁字符(×5.5) 双目标；略超无好切点可 grace；远超必切。
// AI 兜底（segmentWordsWithAiFallback）：仅对「必须切且无好切点」的 span 调一次 AI 找断点，
// 失败一律回退 DP 结果 —— 关闭 AI 与开启失败时，行为与 segmentWords 完全一致。

import { getProfile, joinTokenTexts, tokenize } from './profiles';
import { splitTextToSentences, mapSentencesToWordRanges } from './hardSplit';
import { splitSpanByDp } from './softSplit';
import { mergeWatchabilitySegments } from './watchabilityMerge';
import {
  buildAiBreakPrompt,
  computeSpanCuts,
  mapBreakMarksToCuts,
  materializeCuts,
  segmentsWithinLimits,
  MIN_PIECE_MS,
  type AiBreaker,
} from './aiBreak';
import type { DpSegment, Preset, Segment, SilenceQuery, WordToken, WordWithTime } from './types';

export { mergeWatchabilitySegments } from './watchabilityMerge';
export {
  WORD_LIMITS,
  CJK_CHAR_LIMITS,
  LATIN_CHAR_LIMITS,
  CHARS_PER_WORD_BUDGET,
  getProfile,
  joinTokenTexts,
} from './profiles';
export {
  buildAiBreakPrompt,
  computeSpanCuts,
  mapBreakMarksToCuts,
  materializeCuts,
  segmentsWithinLimits,
  MIN_PIECE_MS,
  type AiBreaker,
  type AiBreakResult,
  type BreakMark,
  type SplitPiece,
  type SpanCutInfo,
} from './aiBreak';

/**
 * 纯文本断句（复刻 / 离线测试用，不带 VAD 静音信息）。
 */
export function segmentText(text: string, lang: string, preset: Preset = 'standard'): Segment[] {
  const profile = getProfile(lang);
  const limit = profile.sourceLimit(preset);
  const charLimit = profile.sourceCharLimit(preset);
  const sentences = splitTextToSentences(text, lang);
  const out: Segment[] = [];

  for (const sentence of sentences) {
    const tokens = tokenize(sentence, profile);
    if (tokens.length === 0) continue;
    const ranges = splitSpanByDp(tokens, profile, limit, 1.0, undefined, undefined, charLimit);
    const split = ranges.length > 1;
    for (const [a, b] of ranges) {
      out.push({
        text: joinTokenTexts(
          tokens.slice(a, b + 1).map((t) => t.word),
          profile
        ),
        reason: split ? 'subtitle-layout' : 'hard',
      });
    }
  }
  return out;
}

/** 把 DP ranges 转为 DpSegment（segmentsWords 与 AI 兜底回退共用，保证行为一致）。 */
function dpRangesToSegments(
  slice: WordWithTime[],
  ws: number,
  ranges: Array<[number, number]>,
  profile: ReturnType<typeof getProfile>,
): DpSegment[] {
  const out: DpSegment[] = [];
  for (const [a, b] of ranges) {
    const segWords = slice.slice(a, b + 1);
    out.push({
      text: joinTokenTexts(
        segWords.map((w) => w.text),
        profile
      ),
      startTime: Math.round(segWords[0].start * 1000),
      endTime: Math.round(segWords[segWords.length - 1].end * 1000),
      wordStart: ws + a,
      wordEnd: ws + b,
      words: segWords,
    });
  }
  return out;
}

/**
 * 音频流转录（带单词级时间戳）断句。
 * words 的 start/end 单位为秒；产出 startTime/endTime 为毫秒。
 * 切分仅在 ASR token 边界。
 * Layer2：词/字与拉丁字符双约束；略超仅好切点；远超必切。
 */
export function segmentWords(
  words: WordWithTime[],
  lang: string,
  preset: Preset = 'standard',
  options: { watchabilityMerge?: boolean } = {},
): DpSegment[] {
  if (words.length === 0) return [];
  const profile = getProfile(lang);
  const limit = profile.sourceLimit(preset);
  const charLimit = profile.sourceCharLimit(preset);

  // Layer1：硬切分用空格拼接（与 mapSentencesToWordRanges 对齐）
  const text = words.map((w) => w.text).join(' ');
  const sentences = splitTextToSentences(text, lang);
  const ranges = mapSentencesToWordRanges(sentences, words);

  const out: DpSegment[] = [];
  for (const [ws, we] of ranges) {
    const slice = words.slice(ws, we + 1);
    const tokens: WordToken[] = slice.map((w) => ({
      word: w.text,
      start: w.start,
      end: w.end,
    }));

    const silence: SilenceQuery = (left, right) => {
      if (left.end == null || right.start == null) return null;
      const gap = right.start - left.end;
      return gap > 0 ? gap : null;
    };

    const dpRanges = splitSpanByDp(
      tokens,
      profile,
      limit,
      1.0,
      silence,
      undefined,
      charLimit,
    );
    out.push(...dpRangesToSegments(slice, ws, dpRanges, profile));
  }

  return options.watchabilityMerge
    ? mergeWatchabilitySegments(out, lang, preset)
    : out;
}

export interface SegmentWordsAiOptions {
  aiBreaker: AiBreaker;
  /** AI 调用并发，默认 3。 */
  concurrency?: number;
  /** 词内拆分半片最短毫秒，默认 MIN_PIECE_MS。 */
  minPieceMs?: number;
  watchabilityMerge?: boolean;
  /** 每次 AI 调用结束（采纳或回退）时回调，供统计/调试；tokensUsed 为本次调用消耗。 */
  onAiResolved?: (spanText: string, accepted: boolean, tokensUsed: number) => void;
  /** 断句进度：已处理 AI 句数 / 总触发句数（未触发 AI 的文件不会回调）。 */
  onAiProgress?: (resolved: number, total: number) => void;
}

async function runPool<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  concurrency: number,
): Promise<void> {
  let idx = 0;
  const size = Math.min(Math.max(1, concurrency), Math.max(1, items.length));
  const runners = Array.from({ length: size }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

/**
 * AI 兜底断句：与 segmentWords 同一管线，仅对「必须切且无好切点」的 span
 * 调用 aiBreaker 找断点。任何失败（调用失败 / 无标记 / 超上限）→ 该 span 回退 DP 结果，
 * 未触发 AI 的 span 与 segmentWords 输出逐字节一致。
 */
export async function segmentWordsWithAiFallback(
  words: WordWithTime[],
  lang: string,
  preset: Preset = 'standard',
  options: SegmentWordsAiOptions,
): Promise<DpSegment[]> {
  if (words.length === 0) return [];
  const profile = getProfile(lang);
  const limit = profile.sourceLimit(preset);
  const charLimit = profile.sourceCharLimit(preset);

  const text = words.map((w) => w.text).join(' ');
  const sentences = splitTextToSentences(text, lang);
  const ranges = mapSentencesToWordRanges(sentences, words);

  // 第一遍：全部 span 跑 DP + 触发判定
  const spans = ranges.map(([ws, we], idx) => ({
    idx,
    ws,
    we,
    slice: words.slice(ws, we + 1),
    info: computeSpanCuts(words.slice(ws, we + 1), profile, limit, charLimit),
  }));
  const aiSpans = spans.filter((s) => s.info.needsAi);
  // 筛完立刻报 0/N，UI 不必等第一次 LLM 才从「AI断句中」变成分数
  options.onAiProgress?.(0, aiSpans.length);

  // AI 结果：spanIdx → pieces/cuts；无记录 = 回退 DP
  const aiResults = new Map<
    number,
    { pieces: import('./aiBreak').SplitPiece[]; cuts: number[] }
  >();
  let resolvedCount = 0;

  await runPool(
    aiSpans,
    async (span) => {
      const spanText = joinTokenTexts(span.info.tokens.map((t) => t.word), profile);
      let accepted = false;
      let tokensUsed = 0;
      try {
        const result = await options.aiBreaker(buildAiBreakPrompt(spanText, profile, limit, charLimit));
        tokensUsed = result.tokensUsed ?? 0;
        const marked = result.content;
        if (marked != null) {
          const marks = mapBreakMarksToCuts(marked, span.info.tokens, profile);
          if (marks.length > 0) {
            const { pieces, cuts } = materializeCuts(
              span.info.tokens,
              marks,
              options.minPieceMs ?? MIN_PIECE_MS,
            );
            if (cuts.length > 0 && segmentsWithinLimits(pieces, cuts, profile, limit, charLimit)) {
              aiResults.set(span.idx, { pieces, cuts });
              accepted = true;
            }
          }
        }
      } catch {
        // AI 任何异常 → 回退 DP
      }
      resolvedCount++;
      options.onAiProgress?.(resolvedCount, aiSpans.length);
      options.onAiResolved?.(spanText, accepted, tokensUsed);
    },
    options.concurrency ?? 3,
  );

  // 第二遍：按 span 顺序产出 DpSegment
  const out: DpSegment[] = [];
  for (const span of spans) {
    const ai = aiResults.get(span.idx);
    if (!ai) {
      out.push(...dpRangesToSegments(span.slice, span.ws, span.info.ranges, profile));
      continue;
    }
    const bounds = [0, ...ai.cuts.map((c) => c + 1), ai.pieces.length];
    for (let i = 0; i < bounds.length - 1; i++) {
      const segPieces = ai.pieces.slice(bounds[i], bounds[i + 1]);
      const segWords: WordWithTime[] = segPieces.map((p) => ({
        text: p.text,
        start: p.start ?? 0,
        end: p.end ?? 0,
      }));
      const firstOrig = segPieces[0].originalIndex;
      const lastOrig = segPieces[segPieces.length - 1].originalIndex;
      out.push({
        text: joinTokenTexts(segWords.map((w) => w.text), profile),
        startTime: Math.round(segWords[0].start * 1000),
        endTime: Math.round(segWords[segWords.length - 1].end * 1000),
        // 词内拆分的两个半片共享原始 token 下标（仅回写 words 切片用）
        wordStart: span.ws + firstOrig,
        wordEnd: span.ws + lastOrig,
        words: segWords,
        aiSplit: true,
      });
    }
  }

  return options.watchabilityMerge
    ? mergeWatchabilitySegments(out, lang, preset)
    : out;
}
