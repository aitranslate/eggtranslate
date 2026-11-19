// Layer1 硬切分 —— OneAsr crates/oneasr-core/src/sentence_boundary/semantic.rs 的移植。
//
// 英文：sentence-splitter（Punkt 移植，项目已有依赖）统计断句 + 句号规则兜底；
// 其它语言：句末标点规则 + profile 缩写表；另外补两条例外：
//   - 单字母带点（B. / J.）只在缩写链（J. K.）里抑制切分；
//   - 引号内的 ?/! （a "What Do You See?" post）不是句末。

import { split } from 'sentence-splitter';
import type { LanguageProfile } from './profiles';
import { spacingPieces } from './spacing';
import {
  isClosingPunctuation,
  isJapaneseSpokenEnd,
  isJaTurnStartAfter,
  isOpeningPunctuation,
  isTerminalChar,
  stripToken,
  stripTrailingClosers,
} from './textRules';

export type SplitReason = 'terminal-punctuation' | 'subtitle-layout';

export interface SplitPoint {
  index: number;
  reason: SplitReason;
}

const COMMON_ABBREVIATIONS = new Set([
  'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'rev.', 'hon.', 'sr.', 'jr.', 'st.', 'mt.', 'no.', 'vs.',
  'etc.', 'al.', 'cf.', 'fig.', 'ed.', 'vol.', 'pp.', 'dept.', 'inc.', 'ltd.', 'co.', 'corp.',
  'bros.', 'llc.', 'jan.', 'feb.', 'mar.', 'apr.', 'jun.', 'jul.', 'aug.', 'sep.', 'sept.',
  'oct.', 'nov.', 'dec.', 'ave.', 'blvd.', 'rd.', 'ln.', 'ct.', 'pl.', 'pres.', 'gov.', 'sen.',
  'rep.', 'capt.', 'cmdr.', 'col.', 'gen.', 'lt.', 'maj.', 'sgt.', 'adm.', 'univ.', 'assn.',
  'assoc.', 'esq.', 'mx.', 'fr.', 'amb.',
]);

const isCommonAbbreviation = (lower: string): boolean => COMMON_ABBREVIATIONS.has(lower);

const isDottedAbbreviation = (lower: string): boolean => {
  const s = lower.replace(/\.+$/, '').trim();
  if (!s) return false;
  const parts = s.split('.');
  if (parts.length < 2) return false;
  return parts.every((p) => p.length > 0 && p.length <= 3 && /^[A-Za-z]+$/.test(p));
};

const isTerminalEnd = (token: string, abbrs: readonly string[]): boolean => {
  const normalized = stripTrailingClosers(token.trim());
  if (!normalized) return false;
  const c = [...normalized];
  if (!isTerminalChar(c[c.length - 1]!)) return false;
  return !abbrs.includes(normalized.toLowerCase());
};

const isTerminalEndRuleFallback = (token: string): boolean => {
  const normalized = stripTrailingClosers(token.trim());
  if (!normalized) return false;
  const c = [...normalized];
  if (!isTerminalChar(c[c.length - 1]!)) return false;
  const lower = normalized.toLowerCase();
  if (isCommonAbbreviation(lower)) return false;
  if (isDottedAbbreviation(lower)) return false;
  return true;
};

const isSingleLetterDotted = (token: string): boolean => {
  const c = [...stripTrailingClosers(token.trim())];
  return c.length === 2 && /[A-Za-z]/.test(c[0]!) && c[1] === '.';
};

const isQuestionBangTerminal = (token: string): boolean => {
  const c = [...stripTrailingClosers(token.trim())];
  if (!c.length) return false;
  return ['!', '?', '！', '？', '‼', '⁇', '⁈', '⁉'].includes(c[c.length - 1]!);
};

const isCloserOnlyToken = (token: string): boolean => {
  const trimmed = token.trim();
  return trimmed.length > 0 && stripTrailingClosers(trimmed) === '';
};

const nextContentWord = (units: readonly string[], index: number): string | null => {
  for (let i = index + 1; i < units.length; i++) {
    const u = units[i]!;
    if (!isCloserOnlyToken(u)) return u;
  }
  return null;
};

const looksLikeEnglishSentenceStart = (token: string): boolean => {
  let trimmed = token.trim();
  while (trimmed) {
    const c = [...trimmed][0]!;
    if (isOpeningPunctuation(c) || ['"', "'", '«', '‹'].includes(c)) {
      trimmed = trimmed.slice(c.length);
      continue;
    }
    break;
  }
  for (const ch of trimmed) {
    if (/[\p{L}]/u.test(ch)) return ch === ch.toUpperCase() && ch !== ch.toLowerCase();
  }
  return false;
};

/** 引号/标题里的 ?! 不是句末：下一个内容词不是句首就并回去。 */
export function shouldSuppressQuestionBangSplit(units: readonly string[], index: number): boolean {
  const token = units[index];
  if (token == null || !isQuestionBangTerminal(token)) return false;
  const next = nextContentWord(units, index);
  if (next == null) return false;
  return !looksLikeEnglishSentenceStart(next);
}

function pushSplitPoint(out: SplitPoint[], index: number, reason: SplitReason): void {
  if (out.length && out[out.length - 1]!.index === index) return;
  out.push({ index, reason });
}

/** 把拼好的全文切成句子，返回每句的 [start,end] 字符区间。 */
function sentenceRanges(text: string): Array<[number, number]> {
  const nodes = split(text);
  const ranges: Array<[number, number]> = [];
  for (const node of nodes) {
    if (node.type !== 'Sentence') continue;
    const range = (node as unknown as { range?: readonly [number, number] }).range;
    if (!range) continue;
    ranges.push([range[0], range[1]]);
  }
  return ranges;
}

/** 词的字符区间（与 spacingPieces 同一套空格规则）。 */
function wordOffsets(units: readonly string[]): Array<{ start: number; end: number }> {
  const pieces = spacingPieces(units);
  const out: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const piece of pieces) {
    if (piece.spaceBefore) cursor += 1;
    out.push({ start: cursor, end: cursor + piece.text.length });
    cursor += piece.text.length;
  }
  return out;
}

function buildSplitPointsWithPunkt(units: readonly string[]): SplitPoint[] {
  const n = units.length;
  if (n === 0) return [];
  const text = (() => {
    let out = '';
    for (const piece of spacingPieces(units)) {
      if (piece.spaceBefore) out += ' ';
      out += piece.text;
    }
    return out;
  })();
  if (!text.trim()) return [];

  const offsets = wordOffsets(units);
  const punktSplits = new Set<number>();
  for (const [, end] of sentenceRanges(text)) {
    // 落在哪个词的末尾（end 为开区间）
    for (let i = n - 1; i >= 0; i--) {
      const o = offsets[i]!;
      if (o.end <= end) {
        punktSplits.add(i);
        break;
      }
    }
  }

  const out: SplitPoint[] = [];
  for (let index = 0; index < n; index++) {
    const unit = units[index]!;
    if (punktSplits.has(index)) {
      if (isSingleLetterDotted(unit)) {
        const next = units[index + 1];
        if (next != null && isSingleLetterDotted(next)) continue;
      }
      if (shouldSuppressQuestionBangSplit(units, index)) continue;
      pushSplitPoint(out, index, 'terminal-punctuation');
      continue;
    }
    if (index === n - 1) continue;
    if (isTerminalEndRuleFallback(unit)) {
      if (isSingleLetterDotted(unit)) {
        const next = units[index + 1];
        if (next != null && isSingleLetterDotted(next)) continue;
      }
      if (shouldSuppressQuestionBangSplit(units, index)) continue;
      pushSplitPoint(out, index, 'terminal-punctuation');
    }
  }
  return out;
}

function buildSplitPointsWithRules(units: readonly string[], profile: LanguageProfile): SplitPoint[] {
  const out: SplitPoint[] = [];
  const abbrs = (() => {
    switch (profile.key) {
      case 'fr':
        return ['m.', 'mme.', 'mlle.', 'dr.', 'prof.', 'etc.', 'p.m.', 'a.m.'];
      default:
        return [];
    }
  })();
  for (let index = 0; index < units.length; index++) {
    const here = units[index]!;
    const punctEnd = isTerminalEnd(here, abbrs);
    const next = units[index + 1];
    const next2 = units[index + 2] ?? '';
    const prev = index === 0 ? '' : units[index - 1]!;
    const spokenEnd = next != null && isJapaneseSpokenEnd(prev, here, next, next2);
    const turnBefore = next != null && isJaTurnStartAfter(here, next, next2);
    if (!punctEnd && !spokenEnd && !turnBefore) continue;
    if (punctEnd && isSingleLetterDotted(here)) {
      if (next != null && isSingleLetterDotted(next)) continue;
    }
    pushSplitPoint(out, index, 'terminal-punctuation');
  }
  return out;
}

export function buildSplitPoints(units: readonly string[], profile: LanguageProfile): SplitPoint[] {
  return profile.usesPunktSentenceBoundary
    ? buildSplitPointsWithPunkt(units)
    : buildSplitPointsWithRules(units, profile);
}

/** 切分点 → 词区间（闭区间）。 */
export function splitPointsToSpans(
  wordTotal: number,
  splitPoints: readonly SplitPoint[],
): Array<[number, number]> {
  if (wordTotal === 0) return [];
  const out: Array<[number, number]> = [];
  let cursor = 0;
  for (const { index } of splitPoints) {
    if (index < cursor || index + 1 >= wordTotal) continue;
    out.push([cursor, index]);
    cursor = index + 1;
  }
  out.push([cursor, wordTotal - 1]);
  return out;
}

export { stripToken, isClosingPunctuation };
