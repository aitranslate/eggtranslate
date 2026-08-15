// AI 断句兜底（纯逻辑，不依赖任何 AI SDK / store）。
//
// 只在 DP 硬断（必须切且没有语言学好切点 / 已有坏刀）时才问模型。
// 此时 DP 已经是「生硬顶格切」，合法的 AI 刀直接换上，不再和 DP 比段数、比分。
// 只丢掉无效结果：没标到刀、超长度预算、虚词甩尾、1–2 单位残段。
// 段数可以多于 DP，但多出来的每一刀都必须是语言学好切点（连词/标点/助词/停顿），
// 否则仍是生硬顶格切，没有比 DP 更好。
// 调用失败或结果无效 → 回退 DP。

import { joinTokenTexts, type LanguageProfile } from './profiles';
import { isQualityCutBoundary, splitSpanByDp } from './softSplit';
import { isFunctionWordLeft, isPhraseCloseParticle } from './textRules';
import type { SilenceQuery, WordToken, WordWithTime } from './types';

/** AI 断句单次结果：content 为带 [BR] 标记的原文；tokensUsed 来自 LLM 客户端的 usage。 */
export interface AiBreakResult {
  content: string | null;
  tokensUsed: number;
}

/** AI 调用回调：入参完整提示词；失败返回 content=null（tokensUsed 仍可能 >0）。 */
export type AiBreaker = (prompt: string) => Promise<AiBreakResult>;

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
  /** 是否触发 AI（DP 硬断，或存在结构坏刀 / 残段）。 */
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
 * 模型标出自然边界；解码器只丢掉坏刀/残段/超限，合法结果直接换下硬断 DP。
 */
export function buildAiBreakPrompt(
  text: string,
  profile: LanguageProfile,
  limit: number,
  charLimit: number,
  dpParts?: string[],
): string {
  const limitText = limitTextFor(profile, limit, charLimit);
  const connectorRule = profile.connectors.length
    ? `Prefer breaking right before a connector word (${profile.connectors.join(', ')}).\n`
    : '';
  const budget =
    dpParts && dpParts.length > 1
      ? `A length-based first pass had to cut this into ${dpParts.length} pieces without a natural boundary. Prefer those clause/breath-group breaks instead.
First-pass pieces:
${dpParts.map((p, i) => `${i + 1}. ${p}`).join('\n')}
`
      : '';
  return `Split the text into subtitles by inserting [BR] markers at natural break points.

Rules:
1. Every piece must stay within ${limitText}.
2. Break only at natural boundaries (between clauses or breath groups). Never break inside a phrase, a number, or a proper name.
${connectorRule}${budget}3. Never break after a function word (article, preposition, auxiliary) or before a phrase-closing particle.
4. Do not change, add, or remove any word, letter, or punctuation.
5. Return only the text with [BR] inserted.

Text:
${text}`;
}

/**
 * DP 硬切是否「结构上坏」：虚词甩尾，或下一行以收束助词开头。
 * 韩语어절 / 英语实词顶格切不是坏刀——那只是长度预算到了。
 * 不用「时间粘连的单字」当坏刀：字级 CJK 几乎每个间隙都粘，会误杀 を|待 这种好刀。
 */
export function isStructurallyBadCut(
  tokens: WordToken[],
  cutAfter: number,
  profile: LanguageProfile,
): boolean {
  const left = tokens[cutAfter];
  const right = tokens[cutAfter + 1];
  if (!left || !right) return false;
  if (isFunctionWordLeft(left.word, profile.functionWordsLeft)) return true;
  if (isPhraseCloseParticle(right.word)) return true;
  return false;
}

function dpHasTinyFragment(
  ranges: Array<[number, number]>,
  tokens: WordToken[],
  profile: LanguageProfile,
): boolean {
  if (ranges.length < 2) return false;
  for (const [a, b] of ranges) {
    let units = 0;
    for (let i = a; i <= b; i++) units += profile.tokenUnits(tokens[i].word);
    if (units > 0 && units <= 2) return true;
  }
  return false;
}

/**
 * 对单个 span 跑 DP 并判定是否需要 AI 兜底。
 * needsAi = 必须切，且（没有任何语言学好切点 = 硬断
 *   或 至少一刀结构坏 或 切出 1–2 单位残段）。
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
  const hardCut = boundaries.length > 0 && qualityOk.every((q) => !q);
  const badCut = boundaries.some((b) => isStructurallyBadCut(tokens, b, profile));
  const needsAi =
    boundaries.length > 0 &&
    (hardCut || badCut || dpHasTinyFragment(ranges, tokens, profile));
  return { tokens, ranges, boundaries, qualityOk, needsAi };
}

/** DP 各段原文，供提示词展示初刀。 */
export function dpPartTexts(
  tokens: WordToken[],
  ranges: Array<[number, number]>,
  profile: LanguageProfile,
): string[] {
  return ranges.map(([a, b]) =>
    joinTokenTexts(
      tokens.slice(a, b + 1).map((t) => t.word),
      profile,
    ),
  );
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

/** 一套刀的可比较分数：只使用 DP 已经承认的封闭类特征。 */
export interface PartitionScore {
  pieceCount: number;
  crimes: number;
  tinies: number;
  quality: number;
  feasible: boolean;
}

function timestampSilence(left: WordToken, right: WordToken): number | null {
  if (left.end == null || right.start == null) return null;
  const gap = right.start - left.end;
  return gap > 0 ? gap : null;
}

function piecesAsTokens(pieces: SplitPiece[]): WordToken[] {
  return pieces.map((p) => ({ word: p.text, start: p.start, end: p.end }));
}

function rangeUnits(
  tokens: Array<{ text?: string; word?: string }>,
  start: number,
  end: number,
  profile: LanguageProfile,
): number {
  let units = 0;
  for (let i = start; i <= end; i++) {
    const raw = tokens[i];
    const text = raw && 'text' in raw && raw.text != null ? raw.text : (raw as WordToken).word;
    units += profile.tokenUnits(text ?? '');
  }
  return units;
}

function rangeWithinLimit(
  pieces: SplitPiece[],
  start: number,
  end: number,
  profile: LanguageProfile,
  limit: number,
  charLimit: number,
): boolean {
  if (end <= start) return true;
  const units = rangeUnits(pieces, start, end, profile);
  if (units > limit) return false;
  if (Number.isFinite(charLimit)) {
    const text = joinTokenTexts(
      pieces.slice(start, end + 1).map((p) => p.text),
      profile,
    );
    if (text.length > charLimit) return false;
  }
  return true;
}

function keepScore(
  tokens: WordToken[],
  cutAfter: number,
  profile: LanguageProfile,
  silence?: SilenceQuery,
): number {
  if (isStructurallyBadCut(tokens, cutAfter, profile)) return -100;
  if (isQualityCutBoundary(tokens, cutAfter, profile, silence)) return 10;
  return 0;
}

/**
 * 把模型标出的刀收敛到长度预算：先丢掉结构坏刀，再合并「最不值得保留」的刀，
 * 直到段数 ≤ targetPieces。多标的 [BR] 是候选集，不是失败。
 */
export function projectCutsToPieceBudget(
  pieces: SplitPiece[],
  cuts: number[],
  profile: LanguageProfile,
  limit: number,
  charLimit: number,
  targetPieces: number,
  silence: SilenceQuery = timestampSilence,
): { pieces: SplitPiece[]; cuts: number[] } {
  const tokens = piecesAsTokens(pieces);
  let kept = [...new Set(cuts)]
    .filter((c) => c >= 0 && c < pieces.length - 1)
    .filter((c) => !isStructurallyBadCut(tokens, c, profile))
    .sort((a, b) => a - b);

  const boundsOf = (list: number[]) => [0, ...list.map((c) => c + 1), pieces.length];

  while (kept.length + 1 > Math.max(1, targetPieces)) {
    let dropAt = -1;
    let dropKey: [number, number, number] | null = null;
    const bounds = boundsOf(kept);
    for (let i = 0; i < kept.length; i++) {
      const leftStart = bounds[i];
      const rightEnd = bounds[i + 2] - 1;
      if (!rangeWithinLimit(pieces, leftStart, rightEnd, profile, limit, charLimit)) {
        continue;
      }
      const leftUnits = rangeUnits(pieces, bounds[i], bounds[i + 1] - 1, profile);
      const rightUnits = rangeUnits(pieces, bounds[i + 1], bounds[i + 2] - 1, profile);
      const key: [number, number, number] = [
        keepScore(tokens, kept[i], profile, silence),
        Math.min(leftUnits, rightUnits),
        i,
      ];
      if (
        dropAt < 0 ||
        key[0] < dropKey![0] ||
        (key[0] === dropKey![0] && key[1] < dropKey![1]) ||
        (key[0] === dropKey![0] && key[1] === dropKey![1] && key[2] < dropKey![2])
      ) {
        dropAt = i;
        dropKey = key;
      }
    }
    if (dropAt < 0) break;
    kept.splice(dropAt, 1);
  }

  return { pieces, cuts: kept };
}

/** 按刀列表计分（tokens 可以是原始 ASR token，也可以是物化后的 pieces）。 */
export function scoreCutList(
  tokens: WordToken[],
  cuts: number[],
  profile: LanguageProfile,
  limit: number,
  charLimit: number,
  silence: SilenceQuery = timestampSilence,
): PartitionScore {
  const sorted = [...new Set(cuts)]
    .filter((c) => c >= 0 && c < tokens.length - 1)
    .sort((a, b) => a - b);
  const bounds = [0, ...sorted.map((c) => c + 1), tokens.length];
  let crimes = 0;
  let quality = 0;
  let tinies = 0;
  for (const c of sorted) {
    if (isStructurallyBadCut(tokens, c, profile)) crimes += 1;
    else if (isQualityCutBoundary(tokens, c, profile, silence)) quality += 1;
  }
  const asPieces: SplitPiece[] = tokens.map((t, i) => ({
    text: t.word,
    start: t.start,
    end: t.end,
    originalIndex: i,
  }));
  const feasible = segmentsWithinLimits(asPieces, sorted, profile, limit, charLimit);
  for (let i = 0; i < bounds.length - 1; i++) {
    const units = rangeUnits(tokens, bounds[i], bounds[i + 1] - 1, profile);
    if (units > 0 && units <= 2) tinies += 1;
  }
  return { pieceCount: bounds.length - 1, crimes, tinies, quality, feasible };
}

export type AiRealizeReason =
  | 'accepted'
  | 'no-cuts-after-project'
  | 'over-limit'
  | 'more-crimes-than-dp'
  | 'more-tinies-than-dp'
  | 'unjustified-extra-cuts'
  | 'not-feasible'
  | 'single-piece';

/** 硬断 DP 的合法替换：无坏刀/残段/超限；多出来的刀必须是好切点。 */
export function aiPartitionIsLegal(ai: PartitionScore, dp?: PartitionScore): boolean {
  return whyAiRejectedVsDp(ai, dp) == null;
}

export function aiAcceptableVsDp(ai: PartitionScore, dp?: PartitionScore): boolean {
  return aiPartitionIsLegal(ai, dp);
}

export function whyAiRejectedVsDp(ai: PartitionScore, dp?: PartitionScore): AiRealizeReason | null {
  if (!ai.feasible) return 'not-feasible';
  if (ai.pieceCount < 2) return 'single-piece';
  if (ai.crimes > 0) return 'more-crimes-than-dp';
  if (ai.tinies > 0) return 'more-tinies-than-dp';
  if (dp && ai.pieceCount > dp.pieceCount) {
    const extra = ai.pieceCount - dp.pieceCount;
    if (ai.quality < dp.quality + extra) return 'unjustified-extra-cuts';
  }
  return null;
}

/** 无坏刀/残段；若多于 DP 段数，调用方应再用 score 比好切点。 */
export function aiNotWorseThanDp(
  pieces: SplitPiece[],
  cuts: number[],
  profile: LanguageProfile,
  dpPieceCount?: number,
): boolean {
  const scored = scoreCutList(
    piecesAsTokens(pieces),
    cuts,
    profile,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  );
  if (scored.crimes > 0 || scored.tinies > 0 || scored.pieceCount < 2) return false;
  if (dpPieceCount != null && scored.pieceCount > dpPieceCount && scored.quality < scored.pieceCount - dpPieceCount) {
    return false;
  }
  return true;
}

export interface RealizeAiResult {
  ok: boolean;
  reason: AiRealizeReason;
  pieces?: SplitPiece[];
  cuts?: number[];
  aiScore?: PartitionScore;
  dpScore?: PartitionScore;
}

/**
 * 只去掉无效刀：结构坏刀；1–2 单位残段在合并不超限时并回去。
 * 不再把段数压回 DP——硬断 DP 已经是下限，合法的更细切分直接留下。
 */
export function sanitizeAiCuts(
  pieces: SplitPiece[],
  cuts: number[],
  profile: LanguageProfile,
  limit: number,
  charLimit: number,
): { pieces: SplitPiece[]; cuts: number[] } {
  const tokens = piecesAsTokens(pieces);
  let kept = [...new Set(cuts)]
    .filter((c) => c >= 0 && c < pieces.length - 1)
    .filter((c) => !isStructurallyBadCut(tokens, c, profile))
    .sort((a, b) => a - b);

  const boundsOf = (list: number[]) => [0, ...list.map((c) => c + 1), pieces.length];

  let changed = true;
  while (changed) {
    changed = false;
    const bounds = boundsOf(kept);
    for (let i = 0; i < bounds.length - 1; i++) {
      const units = rangeUnits(pieces, bounds[i], bounds[i + 1] - 1, profile);
      if (units === 0 || units > 2) continue;
      const canLeft =
        i > 0 &&
        rangeWithinLimit(pieces, bounds[i - 1], bounds[i + 1] - 1, profile, limit, charLimit);
      const canRight =
        i + 1 < bounds.length - 1 &&
        rangeWithinLimit(pieces, bounds[i], bounds[i + 2] - 1, profile, limit, charLimit);
      if (canLeft) {
        kept.splice(i - 1, 1);
        changed = true;
        break;
      }
      if (canRight) {
        kept.splice(i, 1);
        changed = true;
        break;
      }
    }
  }

  return { pieces, cuts: kept };
}

/**
 * 合法（不超限、无坏刀、无残段）的 AI 刀直接换下硬断 DP。
 */
export function explainRealizeAiPartition(
  pieces: SplitPiece[],
  cuts: number[],
  profile: LanguageProfile,
  limit: number,
  charLimit: number,
  dpTokens: WordToken[],
  dpRanges: Array<[number, number]>,
): RealizeAiResult {
  const cleaned = sanitizeAiCuts(pieces, cuts, profile, limit, charLimit);
  const dpCuts: number[] = [];
  for (let i = 0; i < dpRanges.length - 1; i++) dpCuts.push(dpRanges[i][1]);
  const dpScore = scoreCutList(dpTokens, dpCuts, profile, limit, charLimit);
  if (cleaned.cuts.length === 0) {
    return { ok: false, reason: 'no-cuts-after-project', dpScore };
  }
  if (!segmentsWithinLimits(cleaned.pieces, cleaned.cuts, profile, limit, charLimit)) {
    return { ok: false, reason: 'over-limit', dpScore };
  }
  const aiScore = scoreCutList(
    piecesAsTokens(cleaned.pieces),
    cleaned.cuts,
    profile,
    limit,
    charLimit,
  );
  const vs = whyAiRejectedVsDp(aiScore, dpScore);
  if (vs) return { ok: false, reason: vs, aiScore, dpScore };
  return { ok: true, reason: 'accepted', pieces: cleaned.pieces, cuts: cleaned.cuts, aiScore, dpScore };
}

/** 清洗后的候选刀：合法则换下 DP，否则返回 null。 */
export function realizeAiPartition(
  pieces: SplitPiece[],
  cuts: number[],
  profile: LanguageProfile,
  limit: number,
  charLimit: number,
  dpTokens: WordToken[],
  dpRanges: Array<[number, number]>,
): { pieces: SplitPiece[]; cuts: number[] } | null {
  const explained = explainRealizeAiPartition(
    pieces,
    cuts,
    profile,
    limit,
    charLimit,
    dpTokens,
    dpRanges,
  );
  if (!explained.ok || !explained.pieces || !explained.cuts) return null;
  return { pieces: explained.pieces, cuts: explained.cuts };
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
