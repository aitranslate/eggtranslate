// Layer2 DP 软切分 —— 逐行移植 D:\voxtrans 的 subtitle_layout.rs（dp_split_span /
// boundary_base_cost / absorb_short_fragments）。
// 输入为 token 序列（纯文本按空格分词、音频流为单词切片），对超过长度预算的
// span 用动态规划求全局最优切分。VAD/静音代价项设为可选（无时间戳则跳过）。

import {
  BOUNDARY_COST,
  FORBIDDEN_COST,
  KEEP_INTACT_RATIO,
  LENGTH_PENALTY_WEIGHT,
  MIN_FRAGMENT_UNITS,
} from './constants';
import type { LanguageProfile } from './profiles';
import type { SilenceQuery, WordToken } from './types';
import {
  endsWithOpeningPunctuation,
  endsWithSoftPunctuation,
  isConnectorLike,
  isNumericContinuation,
  isTerminalBoundary,
  startsWithClosingPunctuation,
  vadStrength,
} from './textRules';

/**
 * 在 token[i] 与 token[i+1] 之间切分的代价（越低越优先）。
 * 无 jieba 顾问时对应 voxtrans 的 DefaultAdvisor：默认 6.0 词界。
 */
function boundaryBaseCost(
  tokens: WordToken[],
  i: number,
  profile: LanguageProfile,
  silence: SilenceQuery | undefined,
): number {
  const left = tokens[i];
  const right = tokens[i + 1];
  if (!left || !right) return FORBIDDEN_COST;

  // 禁止在配对标点内、数字内切断。
  if (endsWithOpeningPunctuation(left.word) || startsWithClosingPunctuation(right.word)) {
    return FORBIDDEN_COST;
  }
  if (isNumericContinuation(left.word, right.word)) {
    return FORBIDDEN_COST;
  }

  if (isTerminalBoundary(left.word)) return BOUNDARY_COST.terminal;
  if (endsWithSoftPunctuation(left.word)) return BOUNDARY_COST.soft;
  if (left.word.trimEnd().endsWith(',') || left.word.trimEnd().endsWith('，')) {
    return BOUNDARY_COST.comma;
  }
  if (silence) {
    const sil = silence(left, right);
    if (sil != null && sil > 0) {
      return 2.0 - vadStrength(sil);
    }
  }
  if (isConnectorLike(right.word, profile.connectors) && !isConnectorLike(left.word, profile.connectors)) {
    return BOUNDARY_COST.connector;
  }
  return BOUNDARY_COST.word;
}

/**
 * 吸收过短的 DP 碎片：把 ≤ MIN_FRAGMENT_UNITS 的段合并进相邻段。
 * 直接修改 cutsRel（相对切分位置，1-indexed：在第 k 个 token 后切）。
 */
function absorbShortFragments(cutsRel: number[], prefix: number[], n: number): void {
  for (;;) {
    if (cutsRel.length === 0) return;
    const boundaries = [...cutsRel, n];
    let prevEnd = 0;
    let found: number | null = null;
    for (let segIdx = 0; segIdx < boundaries.length; segIdx++) {
      const end = boundaries[segIdx];
      const units = prefix[end] - prefix[prevEnd];
      if (units <= MIN_FRAGMENT_UNITS) {
        found = segIdx;
        break;
      }
      prevEnd = end;
    }
    if (found === null) return;
    if (found < cutsRel.length) {
      cutsRel.splice(found, 1);
    } else {
      cutsRel.pop();
    }
  }
}

/**
 * 对单个 span（tokens[start..=end]）做 DP 软切分。
 * 返回绝对 token 下标（0-based，切分点左侧的 token 下标）。
 */
export function dpSplitSpan(
  tokens: WordToken[],
  start: number,
  end: number,
  profile: LanguageProfile,
  limit: number,
  maxUnits: number,
  silence: SilenceQuery | undefined,
): number[] {
  const n = end - start + 1;
  if (n < 2) return [];

  // 前缀和：prefix[k] = tokens[start..start+k) 的长度单位之和。
  const prefix = new Array<number>(n + 1).fill(0);
  for (let k = 0; k < n; k++) {
    prefix[k + 1] = prefix[k] + profile.tokenUnits(tokens[start + k].word);
  }

  // 核心保证：整段在预算内（含 1.15 倍）绝不切。
  if (prefix[n] <= maxUnits) return [];

  // 预计算每个内部边界的基础代价（base_cost[k] 为切在 token start+k-1 与 start+k 之间）。
  const baseCost = new Array<number>(n + 1).fill(FORBIDDEN_COST);
  baseCost[0] = 0;
  for (let k = 1; k < n; k++) {
    baseCost[k] = boundaryBaseCost(tokens, start + k - 1, profile, silence);
  }
  baseCost[n] = 0;

  // dp[i] = 切分 tokens[start..start+i) 的最小总代价。
  const dp = new Array<number>(n + 1).fill(Infinity);
  const prev = new Array<number>(n + 1).fill(0);
  dp[0] = 0;

  for (let i = 1; i <= n; i++) {
    // 从 i-1 向前扫描候选起点 j；段长超 maxUnits 后更早的 j 只会更长，直接 break。
    for (let j = i - 1; j >= 0; j--) {
      const segLen = prefix[i] - prefix[j];
      if (segLen > maxUnits) break;
      if (baseCost[j] === Infinity || dp[j] === Infinity) continue;
      const lengthPenalty = (LENGTH_PENALTY_WEIGHT * Math.abs(segLen - limit)) / limit;
      const cost = dp[j] + baseCost[j] + lengthPenalty;
      if (cost < dp[i]) {
        dp[i] = cost;
        prev[i] = j;
      }
    }
  }

  // 回溯切分点。
  const cutsRel: number[] = [];
  let cur = n;
  while (cur > 0) {
    const p = prev[cur];
    if (p > 0) cutsRel.push(p);
    cur = p;
  }
  cutsRel.reverse();

  absorbShortFragments(cutsRel, prefix, n);

  // 1-indexed 切分位置 → 0-based 绝对下标（切在 token (k-1) 之后）。
  return cutsRel.map((k) => start + k - 1);
}

/**
 * 对一个已硬切分好的句子（token 序列）做 DP 软切分（若超长）。
 * 返回切分后的若干 token 区间 [start,end]（含端点）。
 */
export function splitSpanByDp(
  tokens: WordToken[],
  profile: LanguageProfile,
  limit: number,
  presetMaxRatio = KEEP_INTACT_RATIO,
  silence?: SilenceQuery,
): Array<[number, number]> {
  if (tokens.length < 2) {
    return tokens.length === 0 ? [] : [[0, 0]];
  }
  const maxUnits = limit * presetMaxRatio;
  const cuts = dpSplitSpan(tokens, 0, tokens.length - 1, profile, limit, maxUnits, silence);
  const bounds = [0, ...cuts.map((c) => c + 1), tokens.length];
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    ranges.push([bounds[i], bounds[i + 1] - 1]);
  }
  return ranges;
}
