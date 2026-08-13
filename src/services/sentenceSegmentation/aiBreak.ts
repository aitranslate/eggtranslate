// AI 断句兜底（纯逻辑，不依赖任何 AI SDK / store）。
//
// 职责边界：
// - 触发检测：DP 强制切分且所有断点都不是「好切点」的 span 才需要 AI
// - 提示词：冻结的通用模板，长度预算按语言 profile 运行时填
// - 标记解析：[BR] 锚点定位（拉丁按词锚 / CJK 按字锚 + 纯偏移兜底），
//   支持 CJK 多字词 token 的词内断点（拆 token + 时间戳按字符比例内插）
// - 校验：仅一条——分段不超过词/字与字符上限
//
// 失败哲学：任何一步不满足（调用失败 / 无标记 / 超限）→ 回退 DP 原结果，
// AI 断句绝不能比「关掉它」更差。

import { getProfile, joinTokenTexts, type LanguageProfile } from './profiles';
import { isQualityCutBoundary, splitSpanByDp } from './softSplit';
import type { Preset, SilenceQuery, WordToken, WordWithTime } from './types';

/** AI 调用回调：入参完整提示词，返回带 [BR] 标记的原文；失败返回 null。 */
export type AiBreaker = (prompt: string) => Promise<string | null>;

/** 单个断点：tokenIndex 左侧 token 下标；charOffset=0 表示切在 token 之后。 */
export interface BreakMark {
  tokenIndex: number;
  /** >0：切在 token 内部第 charOffset 个字符之后（仅 CJK 多字词 token）。 */
  charOffset: number;
}

/** 词内拆分的两个半片 token（文本 + 时间戳均已切好）。 */
export interface SplitPiece {
  text: string;
  start?: number;
  end?: number;
  /** 原始 words 数组中的 token 下标（两个半片共享，供 wordStart/wordEnd 回写）。 */
  originalIndex: number;
}

/** 一个 span 的 DP 结果 + AI 触发判定。 */
export interface SpanCutInfo {
  tokens: WordToken[];
  /** DP 结果（[start,end] 闭区间，相对 span 内 token 下标）。 */
  ranges: Array<[number, number]>;
  /** DP 断点（切在 boundary 下标 token 之后）。 */
  boundaries: number[];
  /** 每个断点是否「好切点」。 */
  qualityOk: boolean[];
  /** 是否触发 AI（必须切 且 所有断点都不是好切点）。 */
  needsAi: boolean;
}

const BR = '[BR]';

const normAnchor = (s: string) =>
  s.toLowerCase().replace(/^[\s\p{P}]+/u, '').replace(/[\s\p{P}]+$/u, '');

/** 去掉 [BR] 后是否不含空白（CJK 直连文本）。 */
function isCjkText(marked: string): boolean {
  return !/[\x20\u3000\t\r\n]/.test(marked.replace(/\[BR\]/g, ''));
}

/** 长度预算文案（提示词第 1 条用）。 */
export function limitTextFor(profile: LanguageProfile, limit: number, charLimit: number): string {
  return profile.isCharBased
    ? `${limit} characters`
    : `${limit} words and ${charLimit} characters`;
}

/**
 * 冻结的 AI 断句提示词模板。
 * 语言无关：长度预算按 profile 填，连词偏好仅在 profile 有连词表时附加。
 */
export function buildAiBreakPrompt(
  text: string,
  profile: LanguageProfile,
  limit: number,
  charLimit: number,
): string {
  const limitText = limitTextFor(profile, limit, charLimit);
  const connectorRule = profile.connectors.length
    ? `Prefer breaking right before a connector word (${profile.connectors.join(', ')}).\n`
    : '';
  return `Split the text into subtitles by inserting [BR] markers at natural break points.

Rules:
1. Use the SMALLEST number of [BR] so that every segment stays within ${limitText}.
2. Break only at natural boundaries (between clauses or breath groups). Never break inside a phrase, a number, or a proper name.
${connectorRule}3. Do not change, add, or remove any word, letter, or punctuation.
4. Return only the text with [BR] inserted.

Text:
${text}`;
}

/**
 * 对单个 span 跑 DP 并判定是否需要 AI 兜底。
 * needsAi = 有断点 且 每个断点都不满足好切点判定（复用 DP 的 isQualityCutBoundary）。
 */
export function computeSpanCuts(
  slice: WordWithTime[],
  profile: LanguageProfile,
  limit: number,
  charLimit: number,
): SpanCutInfo {
  const tokens: WordToken[] = slice.map((w) => ({ word: w.text, start: w.start, end: w.end }));
  const silence: SilenceQuery = (left, right) => {
    if (left.end == null || right.start == null) return null;
    const gap = right.start - left.end;
    return gap > 0 ? gap : null;
  };
  const ranges = splitSpanByDp(tokens, profile, limit, 1.0, silence, undefined, charLimit);
  const boundaries: number[] = [];
  for (let i = 0; i < ranges.length - 1; i++) boundaries.push(ranges[i][1]);
  const qualityOk = boundaries.map((b) => isQualityCutBoundary(tokens, b, profile, silence));
  const needsAi = boundaries.length > 0 && qualityOk.every((q) => !q);
  return { tokens, ranges, boundaries, qualityOk, needsAi };
}

/** 在 span 内 token 下标处做词内拆分的字符偏移上限（仅 CJK）。 */
interface OffsetBreak {
  tokenIndex: number;
  charOffset: number;
  score: number;
}

/** 由 targetOffset（原文本中的字符偏移）解析为断点（边界或词内）。 */
function resolveBreakByOffset(
  tokens: WordToken[],
  profile: LanguageProfile,
  targetOffset: number,
): OffsetBreak | null {
  const lens: number[] = [0];
  for (let k = 1; k <= tokens.length; k++) {
    lens.push(joinTokenTexts(tokens.slice(0, k).map((t) => t.word), profile).length);
  }
  for (let k = 0; k < tokens.length; k++) {
    const a = lens[k];
    const b = lens[k + 1];
    if (targetOffset < a || targetOffset > b) continue;
    // 标记恰在 token 前边界 → 切在前一个 token 之后
    if (targetOffset === a && k > 0) {
      return { tokenIndex: k - 1, charOffset: 0, score: 0 };
    }
    // 标记恰在 token 后边界 → 切在当前 token 之后
    if (targetOffset === b) {
      return { tokenIndex: k, charOffset: 0, score: 0 };
    }
    // 词内
    return { tokenIndex: k, charOffset: targetOffset - a, score: 0 };
  }
  return null;
}

/**
 * 解析 AI 返回的带 [BR] 文本 → 断点列表。
 *
 * 定位策略（按优先级）：
 * 1. 锚点匹配：拉丁按整词、CJK 按单字（前/后缀），候选间按「标记偏移 vs 原始偏移」就近取舍
 * 2. 纯偏移兜底：锚点找不到时按字符偏移就近定位（容忍 AI 轻微改字）
 * 3. 词内断点：偏移落在 CJK 多字词 token 内部 → charOffset（拉丁一律吸附到词界）
 */
export function mapBreakMarksToCuts(
  marked: string,
  tokens: WordToken[],
  profile: LanguageProfile,
): BreakMark[] {
  const cjk = isCjkText(marked);
  const lens: number[] = [0];
  for (let k = 1; k <= tokens.length; k++) {
    lens.push(joinTokenTexts(tokens.slice(0, k).map((t) => t.word), profile).length);
  }
  const marks: BreakMark[] = [];
  let idx = 0;
  let found = 0;
  while (true) {
    const i = marked.indexOf(BR, idx);
    if (i < 0) break;
    const leftMatch = marked
      .slice(0, i)
      .replace(/[\s\p{P}]+$/u, '')
      .match(cjk ? /./u : /[\p{L}\p{N}'\u2019-]+$/u);
    const rightMatch = marked
      .slice(i + 4)
      .replace(/^[\s\p{P}]+/u, '')
      .match(cjk ? /./u : /^[\p{L}\p{N}'\u2019-]+/u);
    const leftAnchor = leftMatch ? normAnchor(leftMatch[0]) : '';
    const rightAnchor = rightMatch ? normAnchor(rightMatch[0]) : '';
    idx = i + 4;
    if (!leftAnchor && !rightAnchor) continue;

    const targetOffset = i - 4 * found;
    const prevBoundary = marks.length ? marks[marks.length - 1].tokenIndex + 1 : 0;

    // 1) 锚点候选
    let bestAnchorCut = -1;
    let bestAnchorScore = Infinity;
    for (let k = Math.max(prevBoundary, 0); k < tokens.length; k++) {
      const ltok = normAnchor(tokens[k].word);
      const hasLeft = leftAnchor
        ? cjk ? ltok.endsWith(leftAnchor) : ltok === leftAnchor
        : true;
      let cutK = -1;
      if (hasLeft && k < tokens.length - 1) {
        const rtok = normAnchor(tokens[k + 1].word);
        const rightOk = rightAnchor
          ? cjk ? rtok.startsWith(rightAnchor) : rtok === rightAnchor
          : true;
        if (rightOk) cutK = k;
      }
      if (cutK < 0 && hasLeft && !rightAnchor) cutK = k;
      if (cutK < 0 && !hasLeft && rightAnchor && k >= 1) {
        const rtok = normAnchor(tokens[k].word);
        if (cjk ? rtok.startsWith(rightAnchor) : rtok === rightAnchor) cutK = k - 1;
      }
      if (cutK < 0 || cutK >= tokens.length - 1) continue;
      const score = Math.abs(lens[cutK + 1] - targetOffset);
      if (score < bestAnchorScore) {
        bestAnchorScore = score;
        bestAnchorCut = cutK;
      }
    }

    // 2) 纯偏移兜底
    const offsetBreak = resolveBreakByOffset(tokens, profile, targetOffset);

    if (bestAnchorCut < 0 && !offsetBreak) continue;

    let mark: BreakMark;
    if (bestAnchorCut >= 0 && offsetBreak) {
      // 两者都有：谁更贴近标记偏移听谁的（容忍锚点误配重复词）
      const offsetBreakOffset =
        lens[offsetBreak.tokenIndex] + offsetBreak.charOffset;
      const offsetScore = Math.abs(offsetBreakOffset - targetOffset);
      mark =
        offsetScore + 2 < bestAnchorScore
          ? { tokenIndex: offsetBreak.tokenIndex, charOffset: offsetBreak.charOffset }
          : { tokenIndex: bestAnchorCut, charOffset: 0 };
    } else if (bestAnchorCut >= 0) {
      mark = { tokenIndex: bestAnchorCut, charOffset: 0 };
    } else {
      mark = { tokenIndex: offsetBreak!.tokenIndex, charOffset: offsetBreak!.charOffset };
    }

    // 拉丁永不拆词：词内断点吸附到最近 token 边界
    if (!cjk && mark.charOffset > 0) {
      const tok = tokens[mark.tokenIndex]?.word ?? '';
      const mid = tok.length / 2;
      mark = {
        tokenIndex: mark.charOffset < mid ? mark.tokenIndex - 1 : mark.tokenIndex,
        charOffset: 0,
      };
    }
    if (mark.tokenIndex < 0 || mark.tokenIndex >= tokens.length - 1) continue;

    marks.push(mark);
    found++;
  }
  return [...marks].sort((a, b) => a.tokenIndex - b.tokenIndex || a.charOffset - b.charOffset);
}

/** 词内拆分两半片的最短时长（毫秒）；更短则放弃词内拆分、吸附回边界。 */
export const MIN_PIECE_MS = 250;

/**
 * 把断点物化为 token 片段序列（词内断点拆成两个带内插时间戳的半片）。
 * 返回 pieces 与「切在 pieces 中第 cutIndex 之后」的 cut 下标列表。
 * 半片时长 < minPieceMs 时放弃该 token 的词内拆分（整 token 保留，仅边界断点生效）。
 */
export function materializeCuts(
  tokens: WordToken[],
  marks: BreakMark[],
  minPieceMs: number = MIN_PIECE_MS,
): { pieces: SplitPiece[]; cuts: number[] } {
  const byToken = new Map<number, BreakMark[]>();
  for (const m of marks) {
    const list = byToken.get(m.tokenIndex) ?? [];
    list.push(m);
    byToken.set(m.tokenIndex, list);
  }

  const pieces: SplitPiece[] = [];
  const cuts: number[] = [];

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    const tkMarks = (byToken.get(k) ?? []).sort((a, b) => a.charOffset - b.charOffset);
    const chars = Array.from(t.word);
    const intra = tkMarks.filter((m) => m.charOffset > 0 && m.charOffset < chars.length);
    const hasBoundaryMark = tkMarks.some((m) => m.charOffset <= 0);

    if (intra.length === 0) {
      pieces.push({ text: t.word, start: t.start, end: t.end, originalIndex: k });
      if (hasBoundaryMark) cuts.push(pieces.length - 1);
      continue;
    }

    // 词内拆分：按 charOffset 分段 + 时间戳按字符比例内插
    const offsets = [...new Set([0, ...intra.map((m) => m.charOffset), chars.length])].sort(
      (a, b) => a - b,
    );
    const hasTime = t.start != null && t.end != null;
    const dur = hasTime ? (t.end! - t.start!) : 0;

    const subPieces: Array<{ text: string; start?: number; end?: number }> = [];
    let allLongEnough = true;
    for (let s = 0; s < offsets.length - 1; s++) {
      const a = offsets[s];
      const b = offsets[s + 1];
      if (a >= b) continue;
      const text = chars.slice(a, b).join('');
      let start: number | undefined;
      let end: number | undefined;
      if (hasTime) {
        start = t.start! + (dur * a) / chars.length;
        end = t.start! + (dur * b) / chars.length;
        if (end - start < minPieceMs / 1000) allLongEnough = false;
      }
      subPieces.push({ text, start, end });
    }

    if (!allLongEnough) {
      // 半片过短：放弃词内拆分，整 token 一片
      pieces.push({ text: t.word, start: t.start, end: t.end, originalIndex: k });
      if (hasBoundaryMark) cuts.push(pieces.length - 1);
      continue;
    }

    const startIdx = pieces.length;
    for (const p of subPieces) {
      pieces.push({ text: p.text, start: p.start, end: p.end, originalIndex: k });
    }
    for (let s = 1; s < subPieces.length; s++) cuts.push(startIdx + s - 1);
    if (hasBoundaryMark) cuts.push(pieces.length - 1);
  }

  return {
    pieces,
    cuts: [...new Set(cuts)]
      .filter((c) => c >= 0 && c < pieces.length - 1)
      .sort((a, b) => a - b),
  };
}

/** 分段是否全部满足上限（多 token 段：词/字与字符双约束；单 token 例外）。 */
export function segmentsWithinLimits(
  pieces: SplitPiece[],
  cuts: number[],
  profile: LanguageProfile,
  limit: number,
  charLimit: number,
): boolean {
  const bounds = [0, ...cuts.map((c) => c + 1), pieces.length];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i];
    const b = bounds[i + 1] - 1;
    const tokCount = b - a + 1;
    if (tokCount <= 1) continue;
    let units = 0;
    for (let j = a; j <= b; j++) units += profile.tokenUnits(pieces[j].text);
    if (units > limit) return false;
    if (Number.isFinite(charLimit)) {
      const text = joinTokenTexts(pieces.slice(a, b + 1).map((p) => p.text), profile);
      if (text.length > charLimit) return false;
    }
  }
  return true;
}
