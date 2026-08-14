// Layer2 DP 软切分。
//
// 长度策略（翻译质量优先，观看次之）：
// 1) 词/字 ≤ limit 且 显示字符 ≤ charLimit：不切
// 2) 略超（各自 ≤ limit+grace）：仅好切点切到目标内；无好切点则整句保留
// 3) 远超：必须切，允许普通词界；多 token 段须同时 ≤ word/字 hard 与 char hard
// 单 ASR token 不可拆，可单独成段（即使单 token 超长 URL）。
// 拉丁：词数 + 字符(×5.5) 双约束；CJK：仅字数（charLimit=∞）。

import {
  BOUNDARY_COST,
  FORBIDDEN_COST,
  GOOD_SILENCE_SEC,
  LENGTH_GRACE_CHARS,
  LENGTH_GRACE_UNITS,
  LENGTH_PENALTY_WEIGHT,
  MIN_FRAGMENT_UNITS,
} from './constants';
import {
  joinTokenTexts,
  segmentDisplayChars,
  type LanguageProfile,
} from './profiles';
import type { SilenceQuery, WordToken } from './types';
import {
  endsWithOpeningPunctuation,
  endsWithSoftPunctuation,
  isConnectorLike,
  isDiscourseMarkerComma,
  isFunctionWordLeft,
  isNumericContinuation,
  isTerminalBoundary,
  isToBindingLeft,
  startsWithClosingPunctuation,
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
  // 话语标记 + 逗号（"Okay," / "Now,"）不给逗号折扣：单独成行是闪帧。
  if (isDiscourseMarkerComma(left.word)) return BOUNDARY_COST.word;
  if (left.word.trimEnd().endsWith(',') || left.word.trimEnd().endsWith('，') || left.word.trimEnd().endsWith('、')) {
    return BOUNDARY_COST.comma;
  }

  // 功能词护栏：切在冠词/介词/助动词/to 之后 = 拆散短语，无折扣。
  if (isFunctionWordLeft(left.word)) {
    return BOUNDARY_COST.word;
  }

  if (silence) {
    const sil = silence(left, right);
    // 微停顿（< GOOD_SILENCE_SEC）只是词间抖动，不给折扣；
    // 真停顿给折扣，但封顶与逗号持平（1.5），绝不让停顿压过标点。
    if (sil != null && sil >= GOOD_SILENCE_SEC) {
      return 2.0 - 0.5 * Math.min(1, (sil - GOOD_SILENCE_SEC) / 0.9);
    }
  }

  // 不定式/to 介词短语起手：切在 "to" 之前是天然意群边界（"| to have"、"| to the upside"）。
  // 但 "need to" / "going to" / "have to" 等情态绑定结构不拆。
  // 注意：放在静音之后——"x [真停顿] to" 应取停顿折扣（更便宜）而非 to 奖励。
  const rightStripped = right.word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
  if (rightStripped === 'to' && !isToBindingLeft(left.word)) {
    return BOUNDARY_COST.connector;
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
  if (isDiscourseMarkerComma(left.word)) return false;
  if (left.word.trimEnd().endsWith(',') || left.word.trimEnd().endsWith('，') || left.word.trimEnd().endsWith('、')) {
    return true;
  }
  if (isFunctionWordLeft(left.word)) return false;
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

export interface DualLimits {
  /** 词/字 hard */
  unit: number;
  /** 显示字符 hard；Infinity = 不启用 */
  char: number;
}

function isFiniteCharLimit(charLimit: number): boolean {
  return Number.isFinite(charLimit) && charLimit < Number.POSITIVE_INFINITY;
}

/** 单 token 永远合法；多 token 须同时满足 unit 与 char hard */
function isValidSegment(
  tokenCount: number,
  segUnits: number,
  segChars: number,
  hard: DualLimits,
): boolean {
  if (tokenCount <= 1) return true;
  if (segUnits > hard.unit) return false;
  if (isFiniteCharLimit(hard.char) && segChars > hard.char) return false;
  return true;
}

function withinTarget(units: number, chars: number, unitLimit: number, charLimit: number): boolean {
  if (units > unitLimit) return false;
  if (isFiniteCharLimit(charLimit) && chars > charLimit) return false;
  return true;
}

function withinGrace(
  units: number,
  chars: number,
  unitLimit: number,
  charLimit: number,
  unitGrace: number,
  charGrace: number,
): boolean {
  if (units > unitLimit + unitGrace) return false;
  if (isFiniteCharLimit(charLimit) && chars > charLimit + charGrace) return false;
  return true;
}

function absorbShortFragments(
  cutsRel: number[],
  prefix: number[],
  charOf: (a: number, b: number) => number,
  n: number,
  hard: DualLimits,
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
        const mergedC = charOf(a, c - 1);
        if (isValidSegment(mergedT, mergedU, mergedC, hard)) {
          const ix = cutsRel.indexOf(b);
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
        const mergedC = charOf(z, b - 1);
        if (isValidSegment(mergedT, mergedU, mergedC, hard)) {
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

function cutsRespectHardLimit(
  cutsRel: number[],
  prefix: number[],
  charOf: (a: number, b: number) => number,
  n: number,
  hard: DualLimits,
): boolean {
  const bounds = [0, ...cutsRel, n];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i];
    const b = bounds[i + 1];
    const u = prefix[b] - prefix[a];
    const c = charOf(a, b - 1);
    if (!isValidSegment(b - a, u, c, hard)) return false;
  }
  return true;
}

/**
 * 从左贪心：多 token 段同时不超过 unit/char hard。
 * 返回 1-indexed cutsRel。
 */
function greedyCutsByHardLimit(
  prefix: number[],
  charOf: (a: number, b: number) => number,
  n: number,
  hard: DualLimits,
): number[] {
  const cuts: number[] = [];
  let start = 0;
  for (let i = 1; i < n; i++) {
    const units = prefix[i + 1] - prefix[start];
    const tok = i - start + 1;
    const chars = charOf(start, i);
    if (tok > 1 && !isValidSegment(tok, units, chars, hard)) {
      cuts.push(i);
      start = i;
    }
  }
  return cuts;
}

export type DpSplitMode = 'quality' | 'force';

/**
 * 对单个 span 做 DP 软切分。
 * hard 为多 token 段必须满足的上限；limit 仅用于长度惩罚目标。
 */
export function dpSplitSpan(
  tokens: WordToken[],
  start: number,
  end: number,
  profile: LanguageProfile,
  limit: number,
  hard: DualLimits,
  silence: SilenceQuery | undefined,
  mode: DpSplitMode = 'force',
): number[] | null {
  const n = end - start + 1;
  if (n < 2) return [];

  const prefix = new Array<number>(n + 1).fill(0);
  for (let k = 0; k < n; k++) {
    prefix[k + 1] = prefix[k] + profile.tokenUnits(tokens[start + k].word);
  }

  // charOf：相对 span 的 [a,b] 闭区间（0-based within span）。
  // 字符上限未启用（CJK 等 charLimit=Infinity）时，segChars 在所有消费点
  // （isValidSegment / charPenalty）都被短路，跳过昂贵的字符串拼接。
  const charLimited = isFiniteCharLimit(hard.char);
  const charOf: (a: number, b: number) => number = charLimited
    ? (a, b) => segmentDisplayChars(tokens, start + a, start + b, profile)
    : (_a, _b) => 0;

  const totalChars = charOf(0, n - 1);
  if (isValidSegment(n, prefix[n], totalChars, hard)) return [];

  const baseCost = new Array<number>(n + 1).fill(FORBIDDEN_COST);
  baseCost[0] = 0;
  for (let k = 1; k < n; k++) {
    baseCost[k] = boundaryBaseCost(tokens, start + k - 1, profile, silence);
  }
  baseCost[n] = 0;

  const onlyGood = mode === 'quality';
  const qualityOk = new Array<boolean>(n + 1).fill(false);
  if (onlyGood) {
    for (let k = 1; k < n; k++) {
      qualityOk[k] = isQualityCutBoundary(tokens, start + k - 1, profile, silence);
    }
  }

  const dp = new Array<number>(n + 1).fill(Infinity);
  const prev = new Array<number>(n + 1).fill(0);
  dp[0] = 0;

  for (let i = 1; i <= n; i++) {
    for (let j = i - 1; j >= 0; j--) {
      const segLen = prefix[i] - prefix[j];
      const tokenCount = i - j;
      // 词/字单调：超 unit 可 break；先判再算字符，避免 break 迭代仍拼接字符串
      if (tokenCount > 1 && segLen > hard.unit) break;
      const segChars = charOf(j, i - 1);
      if (!isValidSegment(tokenCount, segLen, segChars, hard)) continue;
      if (baseCost[j] === Infinity || dp[j] === Infinity) continue;
      if (onlyGood && j > 0 && j < n && !qualityOk[j]) continue;
      const lengthPenalty =
        limit > 0 ? (LENGTH_PENALTY_WEIGHT * Math.abs(segLen - limit)) / limit : 0;
      // 字符也略拉向 char 目标（若启用）
      let charPenalty = 0;
      if (isFiniteCharLimit(hard.char) && hard.char > 0) {
        charPenalty =
          (LENGTH_PENALTY_WEIGHT * 0.5 * Math.abs(segChars - hard.char)) / hard.char;
      }
      const cost = dp[j] + baseCost[j] + lengthPenalty + charPenalty;
      // 并列取舍按语言类型分：
      // - 拉丁（按词切）：取更靠前的 j → 分段更均衡，避免切出碎尾
      // - CJK（ASR 字符碎片、无词界信息）：取更靠后的 j → 首段尽量贴近上限，
      //   切点更容易落在真实词界上（日语/中文碎片流的经验最优）
      const better = profile.isCharBased ? cost < dp[i] : cost <= dp[i];
      if (better) {
        dp[i] = cost;
        prev[i] = j;
      }
    }
  }

  if (dp[n] === Infinity) {
    if (mode === 'quality') return null;
    return greedyCutsByHardLimit(prefix, charOf, n, hard).map((k) => start + k - 1);
  }

  const cutsRel: number[] = [];
  let cur = n;
  while (cur > 0) {
    const p = prev[cur];
    if (p > 0) cutsRel.push(p);
    cur = p;
  }
  cutsRel.reverse();

  absorbShortFragments(cutsRel, prefix, charOf, n, hard);

  if (mode === 'quality') {
    if (!cutsRespectHardLimit(cutsRel, prefix, charOf, n, hard)) return null;
    for (const c of cutsRel) {
      if (c > 0 && c < n && !qualityOk[c]) return null;
    }
    return cutsRel.map((k) => start + k - 1);
  }

  if (!cutsRespectHardLimit(cutsRel, prefix, charOf, n, hard)) {
    return greedyCutsByHardLimit(prefix, charOf, n, hard).map((k) => start + k - 1);
  }

  return cutsRel.map((k) => start + k - 1);
}

function totalUnits(tokens: WordToken[], profile: LanguageProfile): number {
  let u = 0;
  for (const t of tokens) u += profile.tokenUnits(t.word);
  return u;
}

function totalChars(tokens: WordToken[], profile: LanguageProfile): number {
  return joinTokenTexts(
    tokens.map((t) => t.word),
    profile,
  ).length;
}

/**
 * 对已硬切分句子做 DP 软切分。
 * @param limit 词/字目标（设置值）
 * @param charLimit 显示字符目标；Infinity 表示不启用（CJK）
 */
export function splitSpanByDp(
  tokens: WordToken[],
  profile: LanguageProfile,
  limit: number,
  _presetMaxRatio = 1.0,
  silence?: SilenceQuery,
  grace: number = LENGTH_GRACE_UNITS,
  charLimit: number = Number.POSITIVE_INFINITY,
  charGrace: number = LENGTH_GRACE_CHARS,
): Array<[number, number]> {
  if (tokens.length < 2) {
    return tokens.length === 0 ? [] : [[0, 0]];
  }

  const units = totalUnits(tokens, profile);
  const chars = totalChars(tokens, profile);

  // ① 词/字与字符均未超目标：不切
  if (withinTarget(units, chars, limit, charLimit)) {
    return [[0, tokens.length - 1]];
  }

  const hardTarget: DualLimits = { unit: limit, char: charLimit };
  let cuts: number[] | null;

  if (withinGrace(units, chars, limit, charLimit, grace, charGrace)) {
    // ② 略超：仅好切点切到目标 hard；失败则整句保留
    cuts = dpSplitSpan(
      tokens,
      0,
      tokens.length - 1,
      profile,
      limit,
      hardTarget,
      silence,
      'quality',
    );
    if (cuts === null) {
      return [[0, tokens.length - 1]];
    }
  } else {
    // ③ 远超：强制切
    cuts = dpSplitSpan(
      tokens,
      0,
      tokens.length - 1,
      profile,
      limit,
      hardTarget,
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

/** 供 A/B：旧逻辑 = 仅词/字 force hard，无 grace、无字符 cap */
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
      { unit: limit, char: Number.POSITIVE_INFINITY },
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
