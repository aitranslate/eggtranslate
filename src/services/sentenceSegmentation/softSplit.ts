// Layer2 DP 软切分。
//
// 长度策略（翻译质量优先，观看次之）：
// 1) ≤ limit：不切
// 2) limit < units ≤ limit+grace：仅在「好切点」切开到每段 ≤ limit；无好切点则整句保留
// 3) units > limit+grace：必须切，允许普通词界，每段多 token ≤ limit
// 单 ASR token 不可拆，可单独成段。

import {
  BOUNDARY_COST,
  FORBIDDEN_COST,
  GOOD_SILENCE_SEC,
  LENGTH_GRACE_UNITS,
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

export function boundaryBaseCost(
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

/**
 * quality 模式用的「好切点」：标点 / 连词 / 明显静音。
 * 不含普通词缝；也不含词间自然缝隙（< GOOD_SILENCE_SEC）。
 */
export function isQualityCutBoundary(
  tokens: WordToken[],
  i: number,
  profile: LanguageProfile,
  silence: SilenceQuery | undefined,
): boolean {
  const left = tokens[i];
  const right = tokens[i + 1];
  if (!left || !right) return false;
  if (endsWithOpeningPunctuation(left.word) || startsWithClosingPunctuation(right.word)) {
    return false;
  }
  if (isNumericContinuation(left.word, right.word)) return false;
  if (isTerminalBoundary(left.word)) return true;
  if (endsWithSoftPunctuation(left.word)) return true;
  if (left.word.trimEnd().endsWith(',') || left.word.trimEnd().endsWith('，')) {
    return true;
  }
  if (
    isConnectorLike(right.word, profile.connectors) &&
    !isConnectorLike(left.word, profile.connectors)
  ) {
    return true;
  }
  if (silence) {
    const sil = silence(left, right);
    if (sil != null && sil >= GOOD_SILENCE_SEC) return true;
  }
  return false;
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

      if (segIdx + 2 < bounds.length) {
        const c = bounds[segIdx + 2];
        const mergedU = prefix[c] - prefix[a];
        const mergedT = c - a;
        if (isValidSegment(mergedT, mergedU, hardLimit)) {
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
 * 从左贪心：在不超过 hardLimit 的前提下尽量长。
 * 返回 1-indexed cutsRel（在第 k 个 token 后切）。
 */
function greedyCutsByHardLimit(prefix: number[], n: number, hardLimit: number): number[] {
  const cuts: number[] = [];
  let start = 0;
  for (let i = 1; i < n; i++) {
    const units = prefix[i + 1] - prefix[start];
    const tok = i - start + 1;
    if (tok > 1 && units > hardLimit) {
      cuts.push(i);
      start = i;
    }
  }
  return cuts;
}

export type DpSplitMode = 'quality' | 'force';

/**
 * 对单个 span 做 DP 软切分。
 * @param mode quality = 仅好切点，失败返回 null（由调用方整句保留）
 *             force = 允许词界，失败回退贪心
 * @returns 绝对 token 下标（切分点左侧）；null 表示 quality 模式无法合法切开
 */
export function dpSplitSpan(
  tokens: WordToken[],
  start: number,
  end: number,
  profile: LanguageProfile,
  limit: number,
  hardLimit: number,
  silence: SilenceQuery | undefined,
  mode: DpSplitMode = 'force',
): number[] | null {
  const n = end - start + 1;
  if (n < 2) return [];

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

  const onlyGood = mode === 'quality';
  // quality 允许切的边界（相对 span 的 1..n-1）
  const qualityOk = new Array<boolean>(n + 1).fill(false);
  if (onlyGood) {
    for (let k = 1; k < n; k++) {
      qualityOk[k] = isQualityCutBoundary(
        tokens,
        start + k - 1,
        profile,
        silence,
      );
    }
  }

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
      // 在 j 处切开（j 为前一段终点）：quality 模式只允许好切点
      if (onlyGood && j > 0 && j < n && !qualityOk[j]) continue;
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
    if (mode === 'quality') return null;
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

  // quality：吸收后若破坏 hardLimit 或引入非好切点，整句保留
  if (mode === 'quality') {
    if (!cutsRespectHardLimit(cutsRel, prefix, n, hardLimit)) return null;
    for (const c of cutsRel) {
      if (c > 0 && c < n && !qualityOk[c]) return null;
    }
    return cutsRel.map((k) => start + k - 1);
  }

  if (!cutsRespectHardLimit(cutsRel, prefix, n, hardLimit)) {
    return greedyCutsByHardLimit(prefix, n, hardLimit).map((k) => start + k - 1);
  }

  return cutsRel.map((k) => start + k - 1);
}

function totalUnits(tokens: WordToken[], profile: LanguageProfile): number {
  let u = 0;
  for (const t of tokens) u += profile.tokenUnits(t.word);
  return u;
}

/**
 * 对已硬切分句子做 DP 软切分。
 * @param _presetMaxRatio 已废弃，保留签名兼容。
 * @param grace 无好切点时允许略超 limit 的缓冲，默认 LENGTH_GRACE_UNITS。
 */
export function splitSpanByDp(
  tokens: WordToken[],
  profile: LanguageProfile,
  limit: number,
  _presetMaxRatio = 1.0,
  silence?: SilenceQuery,
  grace: number = LENGTH_GRACE_UNITS,
): Array<[number, number]> {
  if (tokens.length < 2) {
    return tokens.length === 0 ? [] : [[0, 0]];
  }

  const units = totalUnits(tokens, profile);

  // ① 未超目标：不切
  if (units <= limit) {
    return [[0, tokens.length - 1]];
  }

  let cuts: number[] | null;

  if (units <= limit + grace) {
    // ② 略超：仅好切点切到 ≤ limit；失败则整句保留（可到 limit+grace）
    cuts = dpSplitSpan(
      tokens,
      0,
      tokens.length - 1,
      profile,
      limit,
      limit,
      silence,
      'quality',
    );
    if (cuts === null) {
      return [[0, tokens.length - 1]];
    }
  } else {
    // ③ 远超：必须切，允许词界，每段 ≤ limit
    cuts = dpSplitSpan(
      tokens,
      0,
      tokens.length - 1,
      profile,
      limit,
      limit,
      silence,
      'force',
    );
    if (cuts === null) {
      cuts = [];
    }
  }

  const bounds = [0, ...cuts.map((c) => c + 1), tokens.length];
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    ranges.push([bounds[i], bounds[i + 1] - 1]);
  }
  return ranges;
}

/** 供 A/B 对比：旧逻辑 = 一律 hard limit，无 grace / quality 门闩 */
export function splitSpanByDpLegacyHard(
  tokens: WordToken[],
  profile: LanguageProfile,
  limit: number,
  silence?: SilenceQuery,
): Array<[number, number]> {
  if (tokens.length < 2) {
    return tokens.length === 0 ? [] : [[0, 0]];
  }
  const cuts =
    dpSplitSpan(
      tokens,
      0,
      tokens.length - 1,
      profile,
      limit,
      limit,
      silence,
      'force',
    ) ?? [];
  const bounds = [0, ...cuts.map((c) => c + 1), tokens.length];
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    ranges.push([bounds[i], bounds[i + 1] - 1]);
  }
  return ranges;
}
