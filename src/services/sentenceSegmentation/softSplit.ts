// Layer2 DP 软切分。
// 硬上限 = preset limit（多 token 段不得超过）。
// 单 ASR token 即使超 limit 也不可拆，允许单独成段。

import {
  BOUNDARY_COST,
  FORBIDDEN_COST,
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

function boundaryBaseCost(
  tokens: WordToken[],
  i: number,
  profile: LanguageProfile,
  silence: SilenceQuery | undefined,
): number {
  const left = tokens[i];
  const right = tokens[i + 1];
  if (!left || !right) return FORBIDDEN_COST;

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
  if (
    isConnectorLike(right.word, profile.connectors) &&
    !isConnectorLike(left.word, profile.connectors)
  ) {
    return BOUNDARY_COST.connector;
  }
  return BOUNDARY_COST.word;
}

/** 单 token 永远合法；多 token 必须 units ≤ hardLimit */
function isValidSegment(tokenCount: number, segUnits: number, hardLimit: number): boolean {
  if (tokenCount <= 1) return true;
  return segUnits <= hardLimit;
}

/**
 * 吸收过短碎片：仅当合并后仍 ≤ hardLimit 才吸收。
 */
function absorbShortFragments(
  cutsRel: number[],
  prefix: number[],
  n: number,
  hardLimit: number,
): void {
  let guard = 0;
  while (guard++ < n + 5) {
    if (cutsRel.length === 0) return;
    const bounds = [0, ...cutsRel, n];
    let absorbed = false;
    for (let segIdx = 0; segIdx < bounds.length - 1; segIdx++) {
      const a = bounds[segIdx];
      const b = bounds[segIdx + 1];
      const units = prefix[b] - prefix[a];
      if (units > MIN_FRAGMENT_UNITS) continue;

      // 优先与右侧合并，否则与左侧
      if (segIdx + 2 < bounds.length) {
        const c = bounds[segIdx + 2];
        const mergedU = prefix[c] - prefix[a];
        const mergedT = c - a;
        if (isValidSegment(mergedT, mergedU, hardLimit)) {
          // 去掉 b 对应的 cut（cutsRel 中值为 b）
          const cutVal = b;
          const ix = cutsRel.indexOf(cutVal);
          if (ix >= 0) {
            cutsRel.splice(ix, 1);
            absorbed = true;
            break;
          }
        }
      }
      if (segIdx > 0) {
        const z = bounds[segIdx - 1];
        const mergedU = prefix[b] - prefix[z];
        const mergedT = b - z;
        if (isValidSegment(mergedT, mergedU, hardLimit)) {
          const cutVal = a;
          const ix = cutsRel.indexOf(cutVal);
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

function cutsRespectHardLimit(
  cutsRel: number[],
  prefix: number[],
  n: number,
  hardLimit: number,
): boolean {
  const bounds = [0, ...cutsRel, n];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i];
    const b = bounds[i + 1];
    if (!isValidSegment(b - a, prefix[b] - prefix[a], hardLimit)) return false;
  }
  return true;
}

/**
 * 从左贪心：在不超过 hardLimit 的前提下尽量长，保证多 token 合法。
 * 返回 1-indexed cutsRel（在第 k 个 token 后切）。
 */
function greedyCutsByHardLimit(prefix: number[], n: number, hardLimit: number): number[] {
  const cuts: number[] = [];
  let start = 0; // 0-based token index of segment start
  for (let i = 1; i < n; i++) {
    // 尝试把 token i 并入当前段 → 段 [start, i]，units = prefix[i+1]-prefix[start]
    const units = prefix[i + 1] - prefix[start];
    const tok = i - start + 1;
    if (tok > 1 && units > hardLimit) {
      // 在 token (i-1) 后切开；1-indexed cut = i
      cuts.push(i);
      start = i;
    }
  }
  return cuts;
}

/**
 * 对单个 span 做 DP 软切分。
 * 返回绝对 token 下标（0-based，切分点左侧 token 下标）。
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

  const hardLimit = maxUnits;

  const prefix = new Array<number>(n + 1).fill(0);
  for (let k = 0; k < n; k++) {
    prefix[k + 1] = prefix[k] + profile.tokenUnits(tokens[start + k].word);
  }

  if (prefix[n] <= hardLimit) return [];

  const baseCost = new Array<number>(n + 1).fill(FORBIDDEN_COST);
  baseCost[0] = 0;
  for (let k = 1; k < n; k++) {
    baseCost[k] = boundaryBaseCost(tokens, start + k - 1, profile, silence);
  }
  baseCost[n] = 0;

  const dp = new Array<number>(n + 1).fill(Infinity);
  const prev = new Array<number>(n + 1).fill(0);
  dp[0] = 0;

  for (let i = 1; i <= n; i++) {
    for (let j = i - 1; j >= 0; j--) {
      const segLen = prefix[i] - prefix[j];
      const tokenCount = i - j;
      if (tokenCount > 1 && segLen > hardLimit) break;
      if (!isValidSegment(tokenCount, segLen, hardLimit)) continue;
      if (baseCost[j] === Infinity || dp[j] === Infinity) continue;
      const lengthPenalty =
        limit > 0 ? (LENGTH_PENALTY_WEIGHT * Math.abs(segLen - limit)) / limit : 0;
      const cost = dp[j] + baseCost[j] + lengthPenalty;
      if (cost < dp[i]) {
        dp[i] = cost;
        prev[i] = j;
      }
    }
  }

  if (dp[n] === Infinity) {
    return greedyCutsByHardLimit(prefix, n, hardLimit).map((k) => start + k - 1);
  }

  const cutsRel: number[] = [];
  let cur = n;
  while (cur > 0) {
    const p = prev[cur];
    if (p > 0) cutsRel.push(p);
    cur = p;
  }
  cutsRel.reverse();

  absorbShortFragments(cutsRel, prefix, n, hardLimit);

  if (!cutsRespectHardLimit(cutsRel, prefix, n, hardLimit)) {
    return greedyCutsByHardLimit(prefix, n, hardLimit).map((k) => start + k - 1);
  }

  return cutsRel.map((k) => start + k - 1);
}

/**
 * 对已硬切分句子做 DP 软切分。
 * hardLimit = limit（设置值即硬上限）。
 * @param _presetMaxRatio 已废弃，保留签名兼容，始终忽略。
 */
export function splitSpanByDp(
  tokens: WordToken[],
  profile: LanguageProfile,
  limit: number,
  _presetMaxRatio = 1.0,
  silence?: SilenceQuery,
): Array<[number, number]> {
  if (tokens.length < 2) {
    return tokens.length === 0 ? [] : [[0, 0]];
  }
  const hardLimit = limit;
  const cuts = dpSplitSpan(
    tokens,
    0,
    tokens.length - 1,
    profile,
    limit,
    hardLimit,
    silence
  );
  const bounds = [0, ...cuts.map((c) => c + 1), tokens.length];
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    ranges.push([bounds[i], bounds[i + 1] - 1]);
  }
  return ranges;
}
