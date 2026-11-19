// Watchability 合并 —— OneAsr crates/oneasr-core/src/sentence_boundary/watchability_merge.rs 的移植。
// 在 DP 之后、翻译之前跑：把闪帧段 / 孤儿尾巴 / 被切开的定语回粘，避免「一行一闪」和残句。

import {
  CHARS_PER_WORD_BUDGET,
  FLASH_SEC,
  MERGE_BUDGET_SEC,
  ORPHAN_MERGE_BUDGET_SEC,
  ORPHAN_MERGE_GRACE_UNITS,
  ORPHAN_TAIL_CJK_UNITS,
  ORPHAN_TAIL_LATIN_UNITS,
  ORPHAN_TAIL_MAX_SEC,
  WATCHABILITY_GAP_SEC,
} from './constants';
import type { LanguageProfile, Preset } from './profiles';
import { joinWords } from './spacing';
import {
  isCaseParticleBeforePredicate,
  isConnectorLike,
  isDiscourseMarkerText,
  isFunctionWordLeft,
  isJaAddressGreetingBind,
  isJapaneseLexicalBind,
  isJapaneseSpokenEnd,
  isJaTurnStartAfter,
  isLineStartBoundParticle,
  isOpenGenitiveLink,
  isSplitHai,
  stripToken,
} from './textRules';

export interface CueWord {
  text: string;
  start: number | null;
  end: number | null;
}

export type Cue = [number, number];

/** 句末收尾符（. ! ? 及全角、分号逗号）。 */
const isSentenceCloseChar = (ch: string): boolean =>
  ['.', '!', '?', ';', '。', '！', '？', '；', '，', '、', ','].includes(ch);

const cueText = (words: readonly CueWord[], cue: Cue): string =>
  joinWords(words.slice(cue[0], cue[1] + 1).map((w) => w.text));

const cueUnits = (words: readonly CueWord[], cue: Cue, profile: LanguageProfile): number => {
  let sum = 0;
  for (let i = cue[0]; i <= cue[1]; i++) sum += profile.tokenUnits(words[i]!.text);
  return sum;
};

const cueStart = (words: readonly CueWord[], cue: Cue): number => words[cue[0]]?.start ?? 0;
const cueEnd = (words: readonly CueWord[], cue: Cue): number => words[cue[1]]?.end ?? 0;
const cueDuration = (words: readonly CueWord[], cue: Cue): number => cueEnd(words, cue) - cueStart(words, cue);

const LATIN_LINE_END_CONNECTORS = [
  'and', 'or', 'to', 'for', 'with', 'that', 'which', 'when', 'if', 'but', 'so',
];
const CJK_LINE_END_CONNECTORS = [
  '然后', '而且', '并且', '因为', '所以', '但是', '如果', '为了', '以及', '还有', '并', '和', '与',
  '及', '或', '来', '去', '在', '对', '把', '将', '大约', '这', '那', '这个', '那个', '一个',
];
const LATIN_CONTINUATIONS = [
  'a', 'an', 'the', 'to', 'of', 'and', 'or', 'with', 'for', 'this', 'that', 'if', 'so', 'then',
  'while', 'it', 'you', 'we', 'they',
];
const CJK_CONTINUATIONS = [
  '个', '这个', '那个', '这', '那', '然后', '并且', '而且', '而', '并', '因为', '所以', '如果', '还',
  '继续', '将', '与', '和',
];

const isLineEndConnectorToken = (token: string, profile: LanguageProfile): boolean => {
  const t = stripToken(token).toLowerCase();
  if (!t) return false;
  return (
    LATIN_LINE_END_CONNECTORS.includes(t) ||
    CJK_LINE_END_CONNECTORS.includes(t) ||
    isConnectorLike(token, profile.connectors)
  );
};

const isContinuationToken = (token: string, profile: LanguageProfile): boolean => {
  const t = stripToken(token).toLowerCase();
  if (!t) return false;
  return (
    LATIN_CONTINUATIONS.includes(t) ||
    CJK_CONTINUATIONS.includes(t) ||
    isConnectorLike(token, profile.connectors)
  );
};

const textUnits = (text: string, profile: LanguageProfile): number => {
  const t = text.trim();
  if (!t) return 0;
  if (profile.isCharBased) return [...t].filter((c) => !/\s/.test(c)).length;
  return t.split(/\s+/).filter(Boolean).length;
};

const textLooksLikeDanglingLeadin = (text: string, profile: LanguageProfile): boolean => {
  const t = text.trim();
  if (!t) return false;
  const endsComma = t.endsWith(',') || t.endsWith('，');
  if (!endsComma) return false;
  // 按字计的语言数非空白字符，按词计的语言数词。
  const units = profile.isCharBased
    ? [...t].filter((c) => !/\s/.test(c)).length
    : t.split(/\s+/).filter(Boolean).length;
  const cap = profile.isCharBased ? 12 : 6;
  if (units <= 0 || units > cap) return false;
  const first = t
    .split(/[\s,，]/)
    .find((p) => p.length > 0)
    ?.toLowerCase();
  if (!first) return false;
  const LEADINS = [
    'well', 'so', 'now', 'but', 'and', 'or', 'yet', 'still', 'okay', 'ok', 'right', 'look',
    'listen', 'basically', 'fundamentally', 'actually', 'literally', 'essentially', 'however',
    'therefore', 'meanwhile', 'anyway', 'also',
  ];
  return LEADINS.includes(first);
};

const isShortInterjection = (words: readonly CueWord[], cue: Cue, profile: LanguageProfile): boolean => {
  const units = cueUnits(words, cue, profile);
  const max = profile.isCharBased ? 6 : 2;
  if (units <= 0 || units > max) return false;
  const text = cueText(words, cue);
  if (isDiscourseMarkerText(text)) return true;
  const c = [...text];
  return isSentenceCloseChar(c[c.length - 1] ?? '');
};

const isOrphanTail = (words: readonly CueWord[], cue: Cue, profile: LanguageProfile): boolean => {
  const dur = cueDuration(words, cue);
  if (dur <= 0) return false;
  const text = cueText(words, cue);
  const discourse = isDiscourseMarkerText(text) || textLooksLikeDanglingLeadin(text, profile);
  const maxDur = discourse ? 2.5 : ORPHAN_TAIL_MAX_SEC;
  if (dur > maxDur) return false;
  if (discourse) return true;
  const units = cueUnits(words, cue, profile);
  const cap = profile.isCharBased ? ORPHAN_TAIL_CJK_UNITS : ORPHAN_TAIL_LATIN_UNITS;
  return units > 0 && units <= cap;
};

const pairExceedsCaps = (
  words: readonly CueWord[],
  left: Cue,
  right: Cue,
  profile: LanguageProfile,
  unitCap: number,
  charCap: number,
  unitGrace = 0,
): boolean => {
  const mergedText = joinWords(words.slice(left[0], right[1] + 1).map((w) => w.text));
  const pairDur = cueEnd(words, right) - cueStart(words, left);
  if (profile.maxDuration > 0 && pairDur > profile.maxDuration) return true;
  if (Number.isFinite(charCap) && profile.widthOf(mergedText) > charCap) return true;
  const pairUnits = cueUnits(words, left, profile) + cueUnits(words, right, profile);
  const tokenCount = left[1] - left[0] + 1 + (right[1] - right[0] + 1);
  if (tokenCount > 1 && pairUnits > unitCap + unitGrace) return true;
  if (Number.isFinite(charCap)) {
    const merged = joinWords(words.slice(left[0], right[1] + 1).map((w) => w.text));
    const charGrace = unitGrace > 0 ? Math.round(unitGrace * CHARS_PER_WORD_BUDGET) : 0;
    if ([...merged].length > charCap + charGrace) return true;
  }
  return false;
};

const isClosedSentencePair = (
  words: readonly CueWord[],
  left: Cue,
  right: Cue,
  profile: LanguageProfile,
  preset: Preset,
): boolean => {
  const leftText = cueText(words, left);
  const c = [...leftText];
  const last = c[c.length - 1] ?? '';
  if (!isSentenceCloseChar(last)) return false;
  if ((last === ',' || last === '，' || last === '、') && (isDiscourseMarkerText(leftText) || textLooksLikeDanglingLeadin(leftText, profile))) {
    return false;
  }
  if (isShortInterjection(words, left, profile)) return false;
  const rightUnits = cueUnits(words, right, profile);
  const afterthought = rightUnits > 0 && rightUnits <= (profile.isCharBased ? 4 : 2);
  if (afterthought || isShortInterjection(words, right, profile)) return false;

  // ASR 标点很密（常常 5–6 个词就一个句号），严格「一句一条」会把 90 秒素材切成
  // 70 条。这里的例外：左句很短、停顿很小、合起来仍在一行内 —— 那更像是 ASR 多打
  // 了一个句号，而不是真的两句。真停顿（≥0.35s）仍然照断。
  const widthLimit = profile.widthLimit(preset);
  const leftWidth = profile.widthOf(cueText(words, left));
  const gap = cueStart(words, right) - cueEnd(words, left);
  const mergedWidth = profile.widthOf(joinWords(words.slice(left[0], right[1] + 1).map((w) => w.text)));
  const mergedDur = cueEnd(words, right) - cueStart(words, left);
  if (
    leftWidth <= widthLimit * 0.75 &&
    gap <= 0.35 &&
    mergedWidth <= widthLimit &&
    (profile.maxDuration <= 0 || mergedDur <= profile.maxDuration)
  ) {
    return false;
  }
  return true;
};

function canMerge(
  words: readonly CueWord[],
  left: Cue,
  right: Cue,
  unitCap: number,
  charCap: number,
  profile: LanguageProfile,
  preset: Preset,
): boolean {
  if (left[1] + 1 !== right[0]) return false;
  const gap = cueStart(words, right) - cueEnd(words, left);
  const lastWord = words[left[1]]!.text;
  const firstRight = words[right[0]]!.text;
  const next2 = words[right[0] + 1]?.text ?? '';
  if (isLineStartBoundParticle(firstRight) && !isSplitHai(firstRight, next2)) {
    if (gap > ORPHAN_TAIL_MAX_SEC) return false;
    if (cueEnd(words, right) - cueStart(words, left) > MERGE_BUDGET_SEC) return false;
    return !pairExceedsCaps(words, left, right, profile, unitCap, charCap, profile.lengthGraceUnits());
  }
  if (isJapaneseLexicalBind(lastWord, firstRight)) {
    if (gap > ORPHAN_TAIL_MAX_SEC) return false;
    if (cueEnd(words, right) - cueStart(words, left) > MERGE_BUDGET_SEC) return false;
    return !pairExceedsCaps(words, left, right, profile, unitCap, charCap, profile.lengthGraceUnits());
  }
  const prev = left[1] === 0 ? '' : words[left[1] - 1]!.text;
  if (isJapaneseSpokenEnd(prev, lastWord, firstRight, next2)) return false;
  if (
    profile.key === 'ja' &&
    (isJaTurnStartAfter(lastWord, firstRight, next2) ||
      (isConnectorLike(firstRight, profile.connectors) && !isConnectorLike(lastWord, profile.connectors))) &&
    !isJaAddressGreetingBind(lastWord, firstRight)
  ) {
    return false;
  }
  if (gap > WATCHABILITY_GAP_SEC) return false;
  const pairDur = cueEnd(words, right) - cueStart(words, left);
  if (pairDur > ORPHAN_MERGE_BUDGET_SEC) return false;
  if (isClosedSentencePair(words, left, right, profile, preset)) return false;

  const rightOrphan = isOrphanTail(words, right, profile) && !isOrphanTail(words, left, profile);
  if (rightOrphan) {
    return !pairExceedsCaps(words, left, right, profile, unitCap, charCap, ORPHAN_MERGE_GRACE_UNITS);
  }
  const leftOrphan = isOrphanTail(words, left, profile) && !isOrphanTail(words, right, profile);
  if (leftOrphan) {
    const grace = cueDuration(words, right) >= FLASH_SEC ? ORPHAN_MERGE_GRACE_UNITS : 0;
    return !pairExceedsCaps(words, left, right, profile, unitCap, charCap, grace);
  }
  if (pairDur > MERGE_BUDGET_SEC) return false;

  if (
    isOpenGenitiveLink(lastWord, firstRight) ||
    isCaseParticleBeforePredicate(lastWord, firstRight) ||
    isFunctionWordLeft(lastWord, profile.functionWordsLeft)
  ) {
    const rightUnits = cueUnits(words, right, profile);
    const rightCap = profile.isCharBased ? (gap < 0.12 ? 22 : 14) : gap < 0.12 ? 12 : 8;
    if (rightUnits > 0 && rightUnits <= rightCap) {
      return !pairExceedsCaps(words, left, right, profile, unitCap, charCap, ORPHAN_MERGE_GRACE_UNITS);
    }
  }
  if (isLineEndConnectorToken(lastWord, profile) && isContinuationToken(firstRight, profile)) {
    return !pairExceedsCaps(words, left, right, profile, unitCap, charCap, ORPHAN_MERGE_GRACE_UNITS);
  }
  return false;
}

function canFlashMerge(
  words: readonly CueWord[],
  left: Cue,
  right: Cue,
  unitCap: number,
  charCap: number,
  profile: LanguageProfile,
  preset: Preset,
): boolean {
  if (left[1] + 1 !== right[0]) return false;
  const gap = cueStart(words, right) - cueEnd(words, left);
  if (gap > WATCHABILITY_GAP_SEC) return false;
  if (cueEnd(words, right) - cueStart(words, left) > MERGE_BUDGET_SEC) return false;
  if (isClosedSentencePair(words, left, right, profile, preset)) return false;
  const lastWord = words[left[1]]!.text;
  const firstRight = words[right[0]]!.text;
  const next2 = words[right[0] + 1]?.text ?? '';
  const prev = left[1] === 0 ? '' : words[left[1] - 1]!.text;
  if (isJapaneseSpokenEnd(prev, lastWord, firstRight, next2)) return false;
  if (isJapaneseLexicalBind(lastWord, firstRight)) {
    return !pairExceedsCaps(words, left, right, profile, unitCap, charCap, profile.lengthGraceUnits());
  }
  if (
    profile.key === 'ja' &&
    (isJaTurnStartAfter(lastWord, firstRight, next2) ||
      (isConnectorLike(firstRight, profile.connectors) && !isConnectorLike(lastWord, profile.connectors))) &&
    !isJaAddressGreetingBind(lastWord, firstRight)
  ) {
    return false;
  }
  const grace = isOrphanTail(words, right, profile) && !isOrphanTail(words, left, profile) ? ORPHAN_MERGE_GRACE_UNITS : 0;
  return !pairExceedsCaps(words, left, right, profile, unitCap, charCap, grace);
}

function absorbFlash(
  words: readonly CueWord[],
  cues: Cue[],
  unitCap: number,
  charCap: number,
  profile: LanguageProfile,
  preset: Preset,
): Cue[] {
  if (cues.length < 2) return cues;
  const out: Cue[] = [];
  let i = 0;
  while (i < cues.length) {
    const cur = cues[i]!;
    const dur = cueDuration(words, cur);
    if (dur >= FLASH_SEC || i + 1 === cues.length) {
      const prev = out[out.length - 1];
      if (dur < FLASH_SEC && prev && canFlashMerge(words, prev, cur, unitCap, charCap, profile, preset)) {
        out[out.length - 1] = [prev[0], cur[1]];
        i += 1;
        continue;
      }
      out.push(cur);
      i += 1;
      continue;
    }
    const next = cues[i + 1]!;
    if (canFlashMerge(words, cur, next, unitCap, charCap, profile, preset)) {
      const merged: Cue = [cur[0], next[1]];
      const prev = out[out.length - 1];
      if (cueDuration(words, merged) < FLASH_SEC && prev && canFlashMerge(words, prev, merged, unitCap, charCap, profile, preset)) {
        out[out.length - 1] = [prev[0], merged[1]];
        i += 2;
        continue;
      }
      out.push(merged);
      i += 2;
      continue;
    }
    const prev = out[out.length - 1];
    if (prev && canFlashMerge(words, prev, cur, unitCap, charCap, profile, preset)) {
      out[out.length - 1] = [prev[0], cur[1]];
      i += 1;
      continue;
    }
    out.push(cur);
    i += 1;
  }
  return out;
}

/** 对 DP 产物做 watchability 合并。输入输出都是词区间（闭区间）。 */
export function mergeWatchabilitySpans(
  words: readonly CueWord[],
  spans: readonly Cue[],
  profile: LanguageProfile,
  preset: Preset,
): Cue[] {
  if (spans.length < 2 || words.length === 0) return spans.map((s) => [s[0], s[1]] as Cue);
  const cues = spans
    .filter(([s, e]) => s < words.length && e < words.length && s <= e)
    .map(([s, e]) => [s, e] as Cue);
  if (cues.length < 2) return cues;

  const unitCap = profile.sourceLimit(preset);
  const charCap = profile.widthLimit(preset);

  const pass1: Cue[] = [];
  let i = 0;
  while (i < cues.length) {
    if (i + 1 >= cues.length) {
      pass1.push(cues[i]!);
      break;
    }
    const left = cues[i]!;
    const right = cues[i + 1]!;
    if (canMerge(words, left, right, unitCap, charCap, profile, preset)) {
      pass1.push([left[0], right[1]]);
      i += 2;
    } else {
      pass1.push(left);
      i += 1;
    }
  }
  return absorbFlash(words, pass1, unitCap, charCap, profile, preset);
}
