// DP 断句模块总入口 —— Layer1 硬切分 + Layer2 DP 软切分。
// Layer2：词/字 + 拉丁字符(×5.5) 双目标；略超无好切点可 grace；远超必切。
// AI 兜底：只在 DP 硬断时问模型；合法且不超限即换上。
// 多出来的刀必须是好切点。关闭 AI / 结果无效时与 segmentWords 一致。

import { mapPool } from '@/utils/asyncPool';
import { getProfile, joinTokenTexts, tokenize } from './profiles';
import { splitTextToSentences, mapSentencesToWordRanges } from './hardSplit';
import { splitSpanByDp } from './softSplit';
import { mergeWatchabilitySegments } from './watchabilityMerge';
import {
  buildAiBreakPrompt,
  computeSpanCuts,
  dpPartTexts,
  explainRealizeAiPartition,
  mapBreakMarksToCuts,
  materializeCuts,
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
  aiAcceptableVsDp,
  aiNotWorseThanDp,
  buildAiBreakPrompt,
  computeSpanCuts,
  dpPartTexts,
  isStructurallyBadCut,
  mapBreakMarksToCuts,
  materializeCuts,
  projectCutsToPieceBudget,
  realizeAiPartition,
  sanitizeAiCuts,
  scoreCutList,
  segmentsWithinLimits,
  MIN_PIECE_MS,
  type AiBreaker,
  type AiBreakResult,
  type BreakMark,
  type PartitionScore,
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
  /** LLM 并发，默认 4（与设置 threadCount 一致）。 */
  concurrency?: number;
  /** 词内拆分半片最短毫秒，默认 MIN_PIECE_MS。 */
  minPieceMs?: number;
  watchabilityMerge?: boolean;
  /** 每次 AI 调用结束（采纳或回退）时回调；reason 说明为何采纳/回退。 */
  onAiResolved?: (spanText: string, accepted: boolean, tokensUsed: number, reason?: string) => void;
  /** 断句进度：已处理 AI 句数 / 总触发句数（未触发 AI 的文件不会回调）。 */
  onAiProgress?: (resolved: number, total: number) => void;
}

/**
 * AI 兜底断句：仅对 DP 硬断的 span 征求候选刀。
 * 合法（不超限、无坏刀、无残段）即采纳；多出来的刀必须是好切点。
 * 无效结果 → 回退 DP；未触发 AI 的 span 与 segmentWords 逐字节一致。
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

  await mapPool(aiSpans, options.concurrency ?? 4, async (span) => {
    const spanText = joinTokenTexts(span.info.tokens.map((t) => t.word), profile);
    let accepted = false;
    let tokensUsed = 0;
    let reason = 'call-error';
    try {
      const result = await options.aiBreaker(
        buildAiBreakPrompt(
          spanText,
          profile,
          limit,
          charLimit,
          dpPartTexts(span.info.tokens, span.info.ranges, profile),
        ),
      );
      tokensUsed = result.tokensUsed ?? 0;
      const marked = result.content;
      if (marked == null) {
        reason = 'empty-content';
      } else {
        const marks = mapBreakMarksToCuts(marked, span.info.tokens, profile);
        if (marks.length === 0) {
          reason = 'no-marks-parsed';
        } else {
          const materialized = materializeCuts(
            span.info.tokens,
            marks,
            options.minPieceMs ?? MIN_PIECE_MS,
          );
          if (materialized.cuts.length === 0) {
            reason = 'no-cuts-materialized';
          } else {
            const explained = explainRealizeAiPartition(
              materialized.pieces,
              materialized.cuts,
              profile,
              limit,
              charLimit,
              span.info.tokens,
              span.info.ranges,
            );
            reason = explained.reason;
            if (explained.ok && explained.pieces && explained.cuts) {
              aiResults.set(span.idx, { pieces: explained.pieces, cuts: explained.cuts });
              accepted = true;
            }
          }
        }
      }
    } catch {
      reason = 'call-error';
    }
    resolvedCount++;
    options.onAiProgress?.(resolvedCount, aiSpans.length);
    options.onAiResolved?.(spanText, accepted, tokensUsed, reason);
  });

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
