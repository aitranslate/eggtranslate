// Layer2 排版 DP —— OneAsr crates/oneasr-core/src/sentence_boundary/subtitle_layout.rs 的移植。
//
// 三个模式：
//   VadInsideBudget —— 预算内：只认强停顿（≥0.50s 词缝）或软标点/逗号，两侧各 ≥min_side
//   Quality         —— grace 带：只认「好切点」，且存在合法切点时不整段保留
//   Force           —— 超 grace：先按标点做首选刀（两侧 ≥min_side），剩余超限段再走代价排序
// 没有 VAD 数据（我们只有词级时间戳），VAD 分支自动失效，退化为词缝判定。

import {
  COMMA_COST,
  CONNECTOR_COST,
  FORBIDDEN_COST,
  GOOD_SILENCE_SEC,
  GLUE_GAP_SEC,
  LENGTH_PENALTY_WEIGHT,
  MIN_FRAGMENT_UNITS,
  SOFT_COST,
  TERMINAL_COST,
  WEAK_ENDING_COST,
  WORD_COST,
  INSIDE_BUDGET_GAP_SEC,
  SHORT_SEGMENT_PENALTY,
} from './constants';
import type { LanguageProfile } from './profiles';
import { joinWords } from './spacing';
import {
  endsWithOpeningPunctuation,
  endsWithSoftPunctuation,
  isBoundConnector,
  isCaseParticleBeforePredicate,
  isCommaToken,
  isConnectorLike,
  isDiscourseMarkerComma,
  isFunctionWordLeft,
  isJapaneseLexicalBind,
  isJapaneseSpokenEnd,
  isLineStartBoundParticle,
  isNumericContinuation,
  isOpenGenitiveLink,
  isPhraseCloseParticle,
  isSingleCjkCharToken,
  isSplitConnectorPair,
  isTimeGluedContent,
  isWeakCueEnding,
  lexicalCutCost,
  startsWithClosingPunctuation,
  stripToken,
} from './textRules';

export interface TimedWord {
  text: string;
  start: number | null;
  end: number | null;
}

export type Preset = 'short' | 'standard' | 'loose';

export interface SpanBudget {
  /** 阅读量上限：拉丁词数 / CJK 字数 */
  limit: number;
  /** 单行宽度上限：加权字符（全角 1 / 半角 0.5；拉丁直接数字符） */
  widthLimit: number;
  grace: number;
  forceCeiling: number;
  /** 单条最长时长（秒） */
  maxDuration: number;
}

export function spanBudgetFor(profile: LanguageProfile, preset: Preset): SpanBudget | null {
  const limit = profile.sourceLimit(preset);
  if (limit <= 0) return null;
  return {
    limit,
    widthLimit: profile.widthLimit(preset),
    grace: profile.lengthGraceUnits(),
    forceCeiling: profile.forceUnitCeiling(limit),
    maxDuration: profile.maxDuration,
  };
}

interface HardLimits {
  target: number;
  maxUnit: number;
  /** 单行宽度上限（加权字符） */
  width: number;
  /** 单条最长时长（秒） */
  maxDur: number;
}

/** 超过上限的容差：只用于「没有合法切点就保留整段」的判定（15%）。 */
export const WIDTH_GRACE_RATIO = 1.15;

const charLimited = (h: HardLimits): boolean => Number.isFinite(h.width) && h.width < Number.POSITIVE_INFINITY;

const hardValid = (h: HardLimits, tokenCount: number, units: number, width: number): boolean => {
  if (tokenCount <= 1) return true;
  if (units > h.maxUnit) return false;
  if (charLimited(h) && width > h.width) return false;
  return true;
};

const peek = (words: readonly TimedWord[], index: number): string => words[index]?.text ?? '';

function timing(w: TimedWord | undefined): [number, number] | null {
  if (!w || w.start == null || w.end == null) return null;
  if (!Number.isFinite(w.start) || !Number.isFinite(w.end)) return null;
  return [w.start, w.end];
}

/** 切在第 i 个词之后的时间缝隙（秒）；任一侧无时间戳返回 null。 */
export function gapAt(words: readonly TimedWord[], i: number): number | null {
  const left = timing(words[i]);
  const right = timing(words[i + 1]);
  if (!left || !right) return null;
  const gap = right[0] - left[1];
  return gap > 0 ? gap : 0;
}

function spokenEndAt(words: readonly TimedWord[], i: number): boolean {
  const left = words[i];
  if (!left) return false;
  const prev = i === 0 ? '' : peek(words, i - 1);
  return isJapaneseSpokenEnd(prev, left.text, peek(words, i + 1), peek(words, i + 2));
}

/** 切在第 i 个词之后的代价（越低越好切）。 */
export function boundaryBaseCost(
  words: readonly TimedWord[],
  i: number,
  profile: LanguageProfile,
): number {
  const left = words[i];
  const right = words[i + 1];
  if (!left) return FORBIDDEN_COST;
  if (!right) return 0;

  if (endsWithOpeningPunctuation(left.text) || startsWithClosingPunctuation(right.text)) return FORBIDDEN_COST;
  if (isNumericContinuation(left.text, right.text)) return FORBIDDEN_COST;
  if (isJapaneseLexicalBind(left.text, right.text)) return FORBIDDEN_COST;
  const next2 = peek(words, i + 2);
  if (isLineStartBoundParticle(right.text) && !isSplitHaiSafe(right.text, next2)) return FORBIDDEN_COST;

  if (
    hasBreakTerminal(left.text) &&
    !(profile.usesPunktSentenceBoundary && shouldSuppressQuestionBang(words, i))
  ) {
    return TERMINAL_COST;
  }
  if (spokenEndAt(words, i)) return TERMINAL_COST;
  if (endsWithSoftPunctuation(left.text)) return SOFT_COST;
  if (isCommaToken(left.text) && !isDiscourseMarkerComma(left.text)) return COMMA_COST;
  if (isOpenGenitiveLink(left.text, right.text)) return 15.0;
  if (isCaseParticleBeforePredicate(left.text, right.text)) return WORD_COST;
  if (isWeakCueEnding(left.text, profile.connectors)) return WEAK_ENDING_COST;
  if (isPhraseCloseParticle(left.text)) return COMMA_COST;
  if (isFunctionWordLeft(left.text, profile.functionWordsLeft)) return FORBIDDEN_COST;

  const rightStripped = stripToken(right.text).toLowerCase();
  if (rightStripped === 'to' && !isToBinding(left.text)) return CONNECTOR_COST;
  if (
    isConnectorLike(right.text, profile.connectors) &&
    !isConnectorLike(left.text, profile.connectors) &&
    !isBoundConnector(left.text, right.text, profile.connectors)
  ) {
    return CONNECTOR_COST;
  }
  if (isSplitConnectorPair(right.text, next2, profile.connectors) && !isConnectorLike(left.text, profile.connectors)) {
    return CONNECTOR_COST;
  }
  if (isTimeGluedContent(left.text, right.text, gapAt(words, i))) return 8.5;
  const gap = gapAt(words, i);
  if (gap != null && gap >= GOOD_SILENCE_SEC) return 2.0 - (0.5 * Math.min(gap - GOOD_SILENCE_SEC, 0.9)) / 0.9;
  return lexicalCutCost(gap);
}

/** quality 模式：切在第 i 个词之后是否算「好切点」。 */
export function isQualityCutBoundary(
  words: readonly TimedWord[],
  i: number,
  profile: LanguageProfile,
): boolean {
  const left = words[i];
  const right = words[i + 1];
  if (!left || !right) return false;
  if (endsWithOpeningPunctuation(left.text) || startsWithClosingPunctuation(right.text)) return false;
  if (isNumericContinuation(left.text, right.text)) return false;
  if (isJapaneseLexicalBind(left.text, right.text)) return false;
  const next2 = peek(words, i + 2);
  if (
    hasBreakTerminal(left.text) &&
    !(profile.usesPunktSentenceBoundary && shouldSuppressQuestionBang(words, i))
  ) {
    return true;
  }
  if (spokenEndAt(words, i)) return true;
  if (endsWithSoftPunctuation(left.text)) return true;
  if (isDiscourseMarkerComma(left.text)) return false;
  if (isCommaToken(left.text)) return true;
  if (isLineStartBoundParticle(right.text) && !isSplitHaiSafe(right.text, next2)) return false;
  if (isOpenGenitiveLink(left.text, right.text) || isCaseParticleBeforePredicate(left.text, right.text)) return false;
  if (isWeakCueEnding(left.text, profile.connectors)) return false;
  if (isPhraseCloseParticle(left.text)) return true;
  if (isFunctionWordLeft(left.text, profile.functionWordsLeft)) return false;
  if (
    isConnectorLike(right.text, profile.connectors) &&
    !isConnectorLike(left.text, profile.connectors) &&
    !isBoundConnector(left.text, right.text, profile.connectors)
  ) {
    return true;
  }
  if (isSplitConnectorPair(right.text, next2, profile.connectors) && !isConnectorLike(left.text, profile.connectors)) {
    return true;
  }
  if (isTimeGluedContent(left.text, right.text, gapAt(words, i))) return false;
  const gap = gapAt(words, i);
  if (gap != null && gap >= GOOD_SILENCE_SEC) return true;
  return false;
}

/** 预算内（VadInsideBudget）：强停顿或软标点/逗号，两侧都要够长。 */
function isStrongSilenceCutBoundary(
  words: readonly TimedWord[],
  i: number,
  profile: LanguageProfile,
  leftUnits: number,
  rightUnits: number,
): boolean {
  const left = words[i];
  const right = words[i + 1];
  if (!left || !right) return false;
  const minSide = profile.isCharBased ? 6 : 4;
  if (leftUnits < minSide || rightUnits < minSide) return false;
  if (endsWithOpeningPunctuation(left.text) || startsWithClosingPunctuation(right.text)) return false;
  if (isNumericContinuation(left.text, right.text)) return false;
  if (isJapaneseLexicalBind(left.text, right.text)) return false;
  const next2 = peek(words, i + 2);
  if (isLineStartBoundParticle(right.text) && !isSplitHaiSafe(right.text, next2)) return false;
  if (isOpenGenitiveLink(left.text, right.text) || isCaseParticleBeforePredicate(left.text, right.text)) return false;
  if (isFunctionWordLeft(left.text, profile.functionWordsLeft)) return false;
  // 句首不落在功能词上（除非左侧本身以标点收尾）。
  if (
    isFunctionWordLeft(right.text, profile.functionWordsLeft) &&
    ![...left.text].some((c) => [',', '，', '、', ';', '；', ':', '：', '.', '。', '!', '！', '?', '？', '…'].includes(c))
  ) {
    return false;
  }
  if (isTimeGluedContent(left.text, right.text, gapAt(words, i))) return false;
  if (endsWithSoftPunctuation(left.text)) return true;
  if (isCommaToken(left.text) && !isDiscourseMarkerComma(left.text)) return true;
  const gap = gapAt(words, i);
  if (gap != null && gap >= INSIDE_BUDGET_GAP_SEC) return true;
  return false;
}

/** Force 首选刀：只认标点（软标点/逗号）。 */
function isForcePreferredCut(words: readonly TimedWord[], i: number, profile: LanguageProfile): boolean {
  const left = words[i];
  const right = words[i + 1];
  if (!left || !right) return false;
  if (endsWithOpeningPunctuation(left.text) || startsWithClosingPunctuation(right.text)) return false;
  if (isNumericContinuation(left.text, right.text)) return false;
  if (isJapaneseLexicalBind(left.text, right.text)) return false;
  const next2 = peek(words, i + 2);
  if (isLineStartBoundParticle(right.text) && !isSplitHaiSafe(right.text, next2)) return false;
  if (isOpenGenitiveLink(left.text, right.text) || isCaseParticleBeforePredicate(left.text, right.text)) return false;
  if (isWeakCueEnding(left.text, profile.connectors)) return false;
  if (isFunctionWordLeft(left.text, profile.functionWordsLeft)) return false;
  if (isTimeGluedContent(left.text, right.text, gapAt(words, i))) return false;
  if (
    hasBreakTerminal(left.text) &&
    !(profile.usesPunktSentenceBoundary && shouldSuppressQuestionBang(words, i))
  ) {
    return true;
  }
  if (spokenEndAt(words, i)) return true;
  if (endsWithSoftPunctuation(left.text)) return true;
  if (isCommaToken(left.text) && !isDiscourseMarkerComma(left.text)) return true;
  return false;
}


/** 段内是否有可用的标点切点（逗号/软标点/句末，且不落在话语标记后）。 */
function hasPunctuationCut(words: readonly TimedWord[], start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const left = words[i];
    const right = words[i + 1];
    if (!left || !right) continue;
    if (endsWithSoftPunctuation(left.text)) return true;
    if (isCommaToken(left.text) && !isDiscourseMarkerComma(left.text)) return true;
    if (hasBreakTerminal(left.text)) return true;
  }
  return false;
}

function shouldKeepShortCut(words: readonly TimedWord[], start: number, cutK: number, profile: LanguageProfile): boolean {
  const leftIdx = start + cutK - 1;
  const rightIdx = start + cutK;
  const left = words[leftIdx];
  const right = words[rightIdx];
  if (!left || !right) return false;
  const next2 = peek(words, rightIdx + 1);
  if (spokenEndAt(words, leftIdx)) return true;
  if (isSplitConnectorPair(right.text, next2, profile.connectors)) return true;
  return (
    isConnectorLike(right.text, profile.connectors) &&
    !isConnectorLike(left.text, profile.connectors) &&
    !isBoundConnector(left.text, right.text, profile.connectors)
  );
}

// ---- 与 semantic/text_rules 共用的细判定（避免在 DP 里重复实现） ----

import { hasBreakTerminalPunctuation, isSplitHai, isToBindingLeft } from './textRules';
import { shouldSuppressQuestionBangSplit } from './hardSplit';

const hasBreakTerminal = (token: string): boolean => hasBreakTerminalPunctuation(token);
const isToBinding = (token: string): boolean => isToBindingLeft(token);

const isSplitHaiSafe = (right: string, next2: string): boolean => isSplitHai(right, next2);

function shouldSuppressQuestionBang(words: readonly TimedWord[], i: number): boolean {
  return shouldSuppressQuestionBangSplit(
    words.map((w) => w.text),
    i,
  );
}

// ---- DP 本体 ----

function computeBaseCosts(words: readonly TimedWord[], start: number, end: number, profile: LanguageProfile): number[] {
  const n = end - start + 1;
  const base = new Array<number>(n + 1).fill(FORBIDDEN_COST);
  base[0] = 0;
  for (let k = 1; k < n; k++) base[k] = boundaryBaseCost(words, start + k - 1, profile);
  base[n] = 0;
  return base;
}

function absorbShortFragments(
  cutsRel: number[],
  prefix: number[],
  charOf: (a: number, b: number) => number,
  n: number,
  hard: HardLimits,
  keepCut: (cutK: number) => boolean,
): void {
  for (;;) {
    if (cutsRel.length === 0) return;
    const bounds = [0, ...cutsRel, n];
    let absorbed = false;
    for (let segIdx = 0; segIdx < bounds.length - 1; segIdx++) {
      const a = bounds[segIdx]!;
      const b = bounds[segIdx + 1]!;
      const units = prefix[b]! - prefix[a]!;
      if (units <= 0 || units > MIN_FRAGMENT_UNITS) continue;
      if (segIdx + 2 < bounds.length && !keepCut(b)) {
        const c = bounds[segIdx + 2]!;
        if (hardValid(hard, c - a, prefix[c]! - prefix[a]!, charOf(a, c - 1))) {
          const ix = cutsRel.indexOf(b);
          if (ix >= 0) {
            cutsRel.splice(ix, 1);
            absorbed = true;
            break;
          }
        }
      }
      if (segIdx > 0 && !keepCut(a)) {
        const z = bounds[segIdx - 1]!;
        if (hardValid(hard, b - z, prefix[b]! - prefix[z]!, charOf(z, b - 1))) {
          const ix = cutsRel.indexOf(a);
          if (ix >= 0) {
            cutsRel.splice(ix, 1);
            absorbed = true;
            break;
          }
        }
      }
    }
    if (!absorbed) return;
  }
}

function greedyCutsByHardLimit(
  words: readonly TimedWord[],
  start: number,
  end: number,
  prefix: number[],
  charOf: (a: number, b: number) => number,
  hard: HardLimits,
  profile: LanguageProfile,
): number[] {
  const n = end - start + 1;
  const cuts: number[] = [];
  let segStart = 0;
  let i = 1;
  while (i < n) {
    const units = prefix[i + 1]! - prefix[segStart]!;
    const tokens = i + 1 - segStart;
    const chars = charOf(segStart, i);
    const segDur = (words[start + i]?.end ?? 0) - (words[start + segStart]?.start ?? 0);
    const overDur = hard.maxDur > 0 && segDur > hard.maxDur;
    if (tokens <= 1 || (hardValid(hard, tokens, units, chars) && !overDur)) {
      i += 1;
      continue;
    }
    const overflowLeft = words[start + i - 1]!.text;
    const overflowRight = words[start + i]!.text;
    const overflowGap = gapAt(words, start + i - 1);
    const overflowNext2 = peek(words, start + i + 1);
    const emergency = units > hard.maxUnit + 8;
    const structuralHold =
      (isLineStartBoundParticle(overflowRight) && !isSplitHaiSafe(overflowRight, overflowNext2)) ||
      isOpenGenitiveLink(overflowLeft, overflowRight) ||
      isCaseParticleBeforePredicate(overflowLeft, overflowRight) ||
      isJapaneseLexicalBind(overflowLeft, overflowRight) ||
      isTimeGluedContent(overflowLeft, overflowRight, overflowGap);
    if (structuralHold && !emergency) {
      i += 1;
      continue;
    }
    if (emergency && isJapaneseLexicalBind(overflowLeft, overflowRight)) {
      i += 1;
      continue;
    }
    let punctCut: number | null = null;
    for (let k = i; k >= segStart + 1; k--) {
      const left = words[start + k - 1]!.text;
      if (
        (endsWithSoftPunctuation(left) || isCommaToken(left)) &&
        !isDiscourseMarkerComma(left) &&
        !isWeakCueEnding(left, profile.connectors)
      ) {
        punctCut = k;
        break;
      }
    }
    let cut = punctCut ?? i;
    let glueSteps = 0;
    while (cut > segStart + 1) {
      const left = words[start + cut - 1]!.text;
      const right = words[start + cut]!.text;
      if (
        isFunctionWordLeft(left, profile.functionWordsLeft) ||
        isJapaneseLexicalBind(left, right) ||
        (punctCut == null && isWeakCueEnding(left, profile.connectors))
      ) {
        cut -= 1;
        continue;
      }
      const gap = gapAt(words, start + cut - 1);
      const glued = isSingleCjkCharToken(left) && isSingleCjkCharToken(right) && gap != null && gap <= GLUE_GAP_SEC;
      if (glued && glueSteps < 2) {
        cut -= 1;
        glueSteps += 1;
        continue;
      }
      break;
    }
    cuts.push(cut);
    segStart = cut;
    i = cut;
  }
  return cuts.map((k) => start + k - 1);
}

function dpSplitSpanUngatedForce(
  words: readonly TimedWord[],
  start: number,
  end: number,
  budget: SpanBudget,
  prefix: number[],
  charOf: (a: number, b: number) => number,
  hard: HardLimits,
  baseCost: number[],
  n: number,
  charBased: boolean,
  profile: LanguageProfile,
): number[] {
  const dp = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
  const prev = new Array<number>(n + 1).fill(0);
  dp[0] = 0;
  const minSide = Math.max(1, Math.min(charBased ? 6 : 4, Math.floor(n / 3)));

  for (let i = 1; i <= n; i++) {
    for (let j = i - 1; j >= 0; j--) {
      const tokenCount = i - j;
      const segUnits = prefix[i]! - prefix[j]!;
      if (tokenCount > 1 && segUnits > hard.maxUnit) break;
      const segChars = charOf(j, i - 1);
      if (!hardValid(hard, tokenCount, segUnits, segChars)) continue;
      if (!Number.isFinite(baseCost[j]!) || !Number.isFinite(dp[j]!)) continue;
      // 最小段长：不留 1–3 个词的小尾巴（要么闪帧、要么翻译不出意思）。
      // 短段按总长的 1/3 打折，避免「9 个单位凑不出 4+4 的合法切点」导致整段不切。
      if (tokenCount > 1 && segUnits < minSide && (j > 0 || i < n)) continue;
      const lengthPenalty = (LENGTH_PENALTY_WEIGHT * Math.abs(segUnits - budget.limit)) / budget.limit;
      let cost = dp[j]! + baseCost[j]! + lengthPenalty;
      if (charLimited(hard) && hard.width > 0) {
        cost += (LENGTH_PENALTY_WEIGHT * 0.5 * Math.abs(segChars - hard.width)) / hard.width;
      }
      if (segUnits > 0 && segUnits <= 2) cost += SHORT_SEGMENT_PENALTY;
      // 超 7s 的重罚（软约束：无解时不会让 DP 变成不可行）
      const segDur = (words[start + i - 1]?.end ?? 0) - (words[start + j]?.start ?? 0);
      if (hard.maxDur > 0 && segDur > hard.maxDur) cost += 50 * (segDur - hard.maxDur);
      const better = charBased ? cost < dp[i]! : cost <= dp[i]!;
      if (better) {
        dp[i] = cost;
        prev[i] = j;
      }
    }
  }

  if (!Number.isFinite(dp[n]!)) {
    return greedyCutsByHardLimit(words, start, end, prefix, charOf, hard, profile);
  }

  const cutsRel: number[] = [];
  let cur = n;
  while (cur > 0) {
    const p = prev[cur]!;
    if (p > 0) cutsRel.push(p);
    cur = p;
  }
  cutsRel.reverse();

  absorbShortFragments(cutsRel, prefix, charOf, n, hard, (cutK) => shouldKeepShortCut(words, start, cutK, profile));

  return cutsRel.map((k) => start + k - 1);
}

export type DpMode = 'inside-budget' | 'quality' | 'force';

/**
 * 对一个语义段做排版切分。
 * 返回切点（绝对词下标，切在该词之后）；空数组 = 整段保留。
 */
export function dpSplitSpan(
  words: readonly TimedWord[],
  start: number,
  end: number,
  profile: LanguageProfile,
  budget: SpanBudget,
): number[] {
  const n = end - start + 1;
  if (n < 2) return [];

  const spanText = words
    .slice(start, end + 1)
    .map((w) => w.text)
    .join('');
  void spanText;

  const prefix = new Array<number>(n + 1).fill(0);
  for (let k = 0; k < n; k++) prefix[k + 1] = prefix[k]! + profile.tokenUnits(words[start + k]!.text);

  const hard: HardLimits = {
    target: budget.limit,
    maxUnit: Math.max(budget.forceCeiling, budget.limit),
    width: budget.widthLimit,
    maxDur: budget.maxDuration,
  };
  const charOf = (a: number, b: number): number =>
    profile.widthOf(joinWords(words.slice(start + a, start + b + 1).map((w) => w.text)));

  const totalUnits = prefix[n]!;
  const totalChars = charOf(0, n - 1);
  const totalDur = (words[end]?.end ?? 0) - (words[start]?.start ?? 0);
  const withinTarget = totalUnits <= hard.target && totalChars <= hard.width;
  const inGrace =
    totalUnits <= hard.target + budget.grace && totalChars <= hard.width * WIDTH_GRACE_RATIO;
  const mode: DpMode =
    withinTarget && !(hard.maxDur > 0 && totalDur > hard.maxDur)
      ? 'inside-budget'
      : inGrace && !(hard.maxDur > 0 && totalDur > hard.maxDur)
        ? 'quality'
        : 'force';
  const charBased = profile.isCharBased;

  if (mode === 'force') {
    const minSide = charBased ? 6 : 4;
    const preferredRel: number[] = [];
    for (let k = 1; k < n; k++) {
      const leftU = prefix[k]!;
      const rightU = prefix[n]! - prefix[k]!;
      if (leftU >= minSide && rightU >= minSide && isForcePreferredCut(words, start + k - 1, profile)) {
        preferredRel.push(k);
      }
    }
    if (preferredRel.length) {
      const bounds = [0, ...preferredRel, n];
      const out: number[] = preferredRel.map((k) => start + k - 1);
      for (let w = 0; w + 1 < bounds.length; w++) {
        const a = bounds[w]!;
        const b = bounds[w + 1]!;
        if (b <= a + 1) continue;
        const subUnits = prefix[b]! - prefix[a]!;
        const subChars = charOf(a, b - 1);
        const stillOver = subUnits > hard.maxUnit || (charLimited(hard) && subChars > hard.width);
        if (!stillOver) continue;
        const subN = b - a;
        const subPrefix = new Array<number>(subN + 1).fill(0);
        for (let k = 0; k < subN; k++) subPrefix[k + 1] = prefix[a + k + 1]! - prefix[a]!;
        const subBase = computeBaseCosts(words, start + a, start + b - 1, profile);
        out.push(
          ...dpSplitSpanUngatedForce(
            words,
            start + a,
            start + b - 1,
            budget,
            subPrefix,
            (i, j) => charOf(a + i, a + j),
            hard,
            subBase,
            subN,
            charBased,
            profile,
          ),
        );
      }
      out.sort((x, y) => x - y);
      return out.filter((v, i) => i === 0 || v !== out[i - 1]);
    }
    return dpSplitSpanUngatedForce(
      words,
      start,
      end,
      budget,
      prefix,
      charOf,
      hard,
      computeBaseCosts(words, start, end, profile),
      n,
      charBased,
      profile,
    );
  }

  const baseCost = computeBaseCosts(words, start, end, profile);
  const qualityOk: boolean[] = [];
  for (let k = 1; k < n; k++) {
    const i = start + k - 1;
    qualityOk.push(
      mode === 'inside-budget'
        ? isStrongSilenceCutBoundary(words, i, profile, prefix[k]!, prefix[n]! - prefix[k]!)
        : isQualityCutBoundary(words, i, profile),
    );
  }

  const dp = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
  const prev = new Array<number>(n + 1).fill(0);
  dp[0] = 0;

  for (let i = 1; i <= n; i++) {
    for (let j = i - 1; j >= 0; j--) {
      const tokenCount = i - j;
      const segUnits = prefix[i]! - prefix[j]!;
      if (tokenCount > 1 && segUnits > hard.maxUnit) break;
      const segChars = charOf(j, i - 1);
      if (!hardValid(hard, tokenCount, segUnits, segChars)) continue;
      if (!Number.isFinite(baseCost[j]!) || !Number.isFinite(dp[j]!)) continue;
      if (j > 0 && j < n && !qualityOk[j - 1]) continue;
      // 有合法切点时不保留整段
      if (j === 0 && i === n && qualityOk.some((ok) => ok)) continue;
      const lengthPenalty = (LENGTH_PENALTY_WEIGHT * Math.abs(segUnits - budget.limit)) / budget.limit;
      let cost = dp[j]! + baseCost[j]! + lengthPenalty;
      if (charLimited(hard) && hard.width > 0) {
        cost += (LENGTH_PENALTY_WEIGHT * 0.5 * Math.abs(segChars - hard.width)) / hard.width;
      }
      if (segUnits > 0 && segUnits <= 2) cost += SHORT_SEGMENT_PENALTY;
      // 超 7s 的重罚（软约束：无解时不会让 DP 变成不可行）
      const segDur = (words[start + i - 1]?.end ?? 0) - (words[start + j]?.start ?? 0);
      if (hard.maxDur > 0 && segDur > hard.maxDur) cost += 50 * (segDur - hard.maxDur);
      const better = charBased ? cost < dp[i]! : cost <= dp[i]!;
      if (better) {
        dp[i] = cost;
        prev[i] = j;
      }
    }
  }

  if (!Number.isFinite(dp[n]!)) return [];

  const cutsRel: number[] = [];
  let cur = n;
  while (cur > 0) {
    const p = prev[cur]!;
    if (p > 0) cutsRel.push(p);
    cur = p;
  }
  cutsRel.reverse();

  absorbShortFragments(cutsRel, prefix, charOf, n, hard, (cutK) => {
    if (shouldKeepShortCut(words, start, cutK, profile)) return true;
    return (
      mode === 'inside-budget' &&
      isStrongSilenceCutBoundary(words, start + cutK - 1, profile, prefix[cutK]!, prefix[n]! - prefix[cutK]!)
    );
  });

  if (!cutsRel.every((k) => k > 0 && k - 1 < qualityOk.length && qualityOk[k - 1])) return [];
  return cutsRel.map((k) => start + k - 1);
}
