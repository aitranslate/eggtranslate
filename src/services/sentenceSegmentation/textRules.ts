// 语法判定 —— OneAsr crates/oneasr-core/src/sentence_boundary/boundary_rules.rs 的移植。
// 只做判定，不含任何数据表（表在 wordTables.ts）。

import {
  CJK_CONNECTOR_BIND_LEFT,
  CJK_FUNCTION_WORDS_LEFT,
  CJK_PHRASE_CLOSE,
  DISCOURSE_MARKERS,
  EN_FUNCTION_WORDS_LEFT,
  JA_ADDRESS_TOKENS,
  JA_COPULA_ENDINGS,
  JA_DEMONSTRATIVES,
  JA_GREETING_TOKENS,
  JA_HIRAGANA_NON_BIND,
  JA_LINE_START_PARTICLES,
  JA_NOMINALIZER_TAILS,
  JA_NOT_COPULA,
  JA_PHRASE_CLOSE,
  JA_PREDICATE_STEMS,
  JA_PREDICATE_SUFFIXES,
  JA_SURU_FORMS,
  JA_TURN_STARTERS,
  KO_LINE_START_PARTICLES,
  KO_PHRASE_CLOSE,
  TO_BINDING_LEFT,
  ZH_CONNECTOR_STARTS,
  ZH_LINE_START_PARTICLES,
} from './wordTables';
import { GLUE_GAP_SEC, GLUED_WORD_COST, GOOD_SILENCE_SEC, WORD_COST } from './constants';

const TERMINAL_CHARS = new Set([
  '.', '!', '?', '。', '！', '？', '｡', '．', '﹒', '…', '‥', '‼', '⁇', '⁈', '⁉',
  '؟', '۔', '።', '፧', '፨', '။', '।', '॥', '։',
]);

const CLOSERS = new Set(['"', "'", ')', ']', '}', '”', '’', '»', '›', '）', '】', '｝', '〉', '》', '」', '』', '〕', '〗', '〙', '〛']);

const OPENING_PUNCT = new Set(['(', '[', '{', '（', '【', '「', '『', '《', '“', '‘']);
const CLOSING_PUNCT = new Set([')', ']', '}', '）', '】', '」', '』', '》', '”', '’']);
const SOFT_PUNCT = new Set([';', ':', '；', '：']);

const set = (list: readonly string[]) => new Set(list);
const EN_FW = set(EN_FUNCTION_WORDS_LEFT);
const CJK_FW = set(CJK_FUNCTION_WORDS_LEFT);
const JA_DEM = set(JA_DEMONSTRATIVES);
const CJK_CLOSE = set(CJK_PHRASE_CLOSE);
const JA_CLOSE = set(JA_PHRASE_CLOSE);
const KO_CLOSE = set(KO_PHRASE_CLOSE);
const DISCOURSE = set(DISCOURSE_MARKERS);
const TO_BIND = set(TO_BINDING_LEFT);
const CJK_BIND_LEFT = set(CJK_CONNECTOR_BIND_LEFT);
const ZH_LINE_START = set(ZH_LINE_START_PARTICLES);
const KO_LINE_START = set(KO_LINE_START_PARTICLES);
const JA_LINE_START = set(JA_LINE_START_PARTICLES);
const JA_NOMINALIZER = set(JA_NOMINALIZER_TAILS);
const ZH_CONN_STARTS = set(ZH_CONNECTOR_STARTS);
const JA_SURU = set(JA_SURU_FORMS);
const JA_TURN_NONBIND = set(JA_HIRAGANA_NON_BIND);
const JA_TURN_START = set(JA_TURN_STARTERS);
const JA_ADDRESS = set(JA_ADDRESS_TOKENS);
const JA_GREETING = set(JA_GREETING_TOKENS);
const JA_COPULA = set(JA_COPULA_ENDINGS);
const JA_NOT_COP = set(JA_NOT_COPULA);
const JA_STEMS = set(JA_PREDICATE_STEMS);
const JA_SUFFIXES = set(JA_PREDICATE_SUFFIXES);
const MS = new Set(['まし', 'でし', 'だっ']);

/** \p{L} + 组合标记：切边时保留字母与音符（印地语 matra / 阿拉伯 harakat）。 */
const reTokenCore = /[\p{L}\p{N}\p{M}]/u;
const reAlnum = /[\p{L}\p{N}]/u;

export function stripToken(token: string): string {
  let start = -1;
  let end = -1;
  for (let i = 0; i < token.length; ) {
    const cp = token.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    if (reTokenCore.test(ch)) {
      if (start < 0) start = i;
      end = i + ch.length;
    }
    i += ch.length;
  }
  if (start < 0) return '';
  return token.slice(start, end);
}

const chars = (s: string): string[] => [...s];
const lower = (s: string) => s.toLowerCase();
const lastChar = (s: string) => {
  const c = chars(s);
  return c.length ? c[c.length - 1]! : '';
};
const firstChar = (s: string) => {
  const c = chars(s);
  return c.length ? c[0]! : '';
};

export function isSoftPunctuation(c: string): boolean {
  return SOFT_PUNCT.has(c);
}
export function isOpeningPunctuation(c: string): boolean {
  return OPENING_PUNCT.has(c);
}
export function isClosingPunctuation(c: string): boolean {
  return CLOSING_PUNCT.has(c);
}
export function isTerminalChar(c: string): boolean {
  return TERMINAL_CHARS.has(c);
}
export function isCommaToken(token: string): boolean {
  const c = lastChar(token.trimEnd());
  return c === ',' || c === '，' || c === '、';
}
export function endsWithSoftPunctuation(token: string): boolean {
  return SOFT_PUNCT.has(lastChar(token.trimEnd()));
}
export function endsWithOpeningPunctuation(token: string): boolean {
  return OPENING_PUNCT.has(lastChar(token.trimEnd()));
}
export function startsWithClosingPunctuation(token: string): boolean {
  return CLOSING_PUNCT.has(firstChar(token.trimStart()));
}
/** 去掉结尾引号/右括号后的 token。 */
export function stripTrailingClosers(token: string): string {
  let end = token.trimEnd().length;
  while (end > 0) {
    const c = token[end - 1]!;
    if (!CLOSERS.has(c)) break;
    end -= 1;
  }
  return token.slice(0, end);
}

/** 「真正断句」的句末标点（去尾括号后判定，排除缩写/小数）。 */
export function hasBreakTerminalPunctuation(token: string): boolean {
  const normalized = stripTrailingClosers(token.trim());
  if (!normalized) return false;
  if (!TERMINAL_CHARS.has(lastChar(normalized))) return false;
  return !isNonBreakTerminalCase(normalized);
}

const COMMON_ABBREVIATIONS = new Set([
  'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'sr.', 'jr.', 'st.', 'vs.', 'etc.', 'inc.', 'ltd.',
  'co.', 'corp.', 'dept.', 'approx.', 'fig.', 'no.', 'vol.', 'a.m.', 'p.m.', 'u.s.', 'u.k.',
  'e.g.', 'i.e.', 'cf.', 'al.', 'ca.', 'esp.', 'jan.', 'feb.', 'mar.', 'apr.', 'jun.', 'jul.',
  'aug.', 'sep.', 'sept.', 'oct.', 'nov.', 'dec.',
]);

function looksLikeDottedAbbreviation(token: string): boolean {
  // U.S / p.m / e.g：内部带点且各段 ≤2 字符
  const t = token.replace(/[。．]+$/, '.');
  if (!t.includes('.')) return false;
  const parts = t.split('.');
  if (parts.length < 3) return false;
  return parts.slice(0, -1).every((p) => p.length > 0 && p.length <= 2);
}

function looksLikeDecimalNumber(token: string): boolean {
  return /^\d+(?:[.,]\d+)+[.!?]?$/.test(token) || /^\d+[.,]$/.test(token);
}

export function isNonBreakTerminalCase(token: string): boolean {
  const t = lower(token);
  if (COMMON_ABBREVIATIONS.has(t)) return true;
  if (looksLikeDottedAbbreviation(t)) return true;
  return looksLikeDecimalNumber(t);
}

/** 单字母带点（B. / J.）——枚举可切，缩写链不切。 */
export function isSingleLetterDotted(token: string): boolean {
  return /^[A-Za-z]\.$/.test(token.trim());
}

export function inList(token: string, list: readonly string[]): boolean {
  const t = lower(stripToken(token));
  return list.includes(t);
}

export function isFunctionWordLeft(token: string, extras: readonly string[] = []): boolean {
  const t = lower(stripToken(token));
  if (!t) return false;
  if (EN_FW.has(t) || CJK_FW.has(t) || JA_DEM.has(t)) return true;
  return extras.includes(t);
}

export function isPhraseCloseParticle(token: string): boolean {
  const t = stripToken(token);
  if (!t) return false;
  if (JA_DEM.has(t)) return false;
  if (JA_CLOSE.has(t) || CJK_CLOSE.has(t) || KO_CLOSE.has(t)) return true;
  const c = chars(t);
  if (c.length < 2) return false;
  const last = c[c.length - 1]!;
  if (JA_CLOSE.has(t) || isJaSingleParticleChar(last)) return true;
  return last === '的';
}

function isJaSingleParticleChar(c: string): boolean {
  return ['は', 'が', 'を', 'に', 'の', 'と', 'で', 'も', 'へ', 'や'].includes(c);
}

export function isWeakCueEnding(token: string, connectors: readonly string[]): boolean {
  const t = stripToken(token);
  if (!t) return false;
  if (isConnectorLike(token, connectors)) return true;
  if (t === '了' || t === '着' || t === '的') return true;
  if (chars(t).length >= 2 && t.endsWith('的')) return true;
  return JA_CLOSE.has(t) || KO_CLOSE.has(t);
}

export function isLineStartBoundParticle(token: string): boolean {
  const t = stripToken(token);
  if (!t) return false;
  if (JA_LINE_START.has(t) || KO_LINE_START.has(t) || ZH_LINE_START.has(t)) return true;
  return t.startsWith('の') && chars(t).length > 1;
}

const isKatakanaChar = (c: string): boolean => {
  const v = c.codePointAt(0)!;
  return ((v >= 0x30a0 && v <= 0x30ff) || (v >= 0xff66 && v <= 0xff9d)) && c !== '・' && c !== '゠';
};
const isKatakanaToken = (token: string): boolean => {
  const t = stripToken(token);
  if (!t) return false;
  let saw = false;
  for (const ch of t) {
    if (isKatakanaChar(ch) || ch === 'ー' || ch === 'ｰ' || ch === '・') {
      if (isKatakanaChar(ch)) saw = true;
      continue;
    }
    return false;
  }
  return saw;
};
const isKatakanaRunBind = (l: string, r: string): boolean => isKatakanaToken(l) && isKatakanaToken(r);

const isSplitCopulaTa = (prev: string, left: string): boolean =>
  stripToken(left) === 'た' && MS.has(stripToken(prev));

export const isSplitHai = (left: string, right: string): boolean => {
  if (stripToken(left) !== 'は') return false;
  const r = stripToken(right);
  return r === 'い' || r.startsWith('いじゃあ') || r.startsWith('いえ') || r === 'いはい';
};

const isHiragana = (c: string): boolean => {
  const v = c.codePointAt(0)!;
  return v >= 0x3040 && v <= 0x309f;
};
const isKanji = (c: string): boolean => {
  const v = c.codePointAt(0)!;
  return (v >= 0x4e00 && v <= 0x9fff) || (v >= 0x3400 && v <= 0x4dbf) || (v >= 0xf900 && v <= 0xfaff);
};
const isCjkLetter = (c: string): boolean => {
  const v = c.codePointAt(0)!;
  return (
    (v >= 0x3040 && v <= 0x30ff) ||
    (v >= 0x3400 && v <= 0x4dbf) ||
    (v >= 0x4e00 && v <= 0x9fff) ||
    (v >= 0xf900 && v <= 0xfaff) ||
    (v >= 0xff66 && v <= 0xff9d)
  );
};

const STRIP_END_PARTICLES = new Set(['よ', 'ね', 'さ', 'わ', 'か', 'な']);
function stripJaEndParticles(token: string): string {
  let t = token;
  for (let i = 0; i < 3; i++) {
    const last = lastChar(t);
    if (!STRIP_END_PARTICLES.has(last)) break;
    const next = t.slice(0, t.length - last.length);
    if (!next) break;
    t = next;
  }
  return t;
}

const isJaBareParticle = (token: string): boolean =>
  JA_CLOSE.has(token) || ['って', 'です', 'ます', 'だ', 'た', 'て'].includes(token);

const isJaContentStart = (token: string): boolean => {
  if (!token || isJaBareParticle(token)) return false;
  const c = firstChar(token);
  return reAlnum.test(c) || isCjkLetter(c);
};

const jaHasContent = (token: string): boolean => {
  const t = stripToken(token);
  if (!t || isLineStartBoundParticle(t)) return false;
  return chars(t).some((c) => reAlnum.test(c) || isCjkLetter(c));
};

const isSuruCompoundBind = (left: string, right: string): boolean => {
  const r = stripJaEndParticles(stripToken(right));
  if (!JA_SURU.has(r)) return false;
  return chars(stripToken(left)).some(isKanji);
};

const isJaNameSuffixBind = (left: string, right: string): boolean => {
  const r = stripToken(right);
  return ['さん', 'ちゃん', 'くん', '様', 'さま', '氏', '君'].includes(r) && jaHasContent(left);
};

const TE_AUX = new Set([
  'いる', 'います', 'いた', 'いて', 'ほしい', '欲しい', 'ください', '下さい', 'もらう',
  'くれる', 'あげる', 'しまう', 'おく', 'みる', 'いく', 'くる', 'ある', 'やる',
]);
const isTeAuxiliaryBind = (left: string, right: string): boolean => {
  const l = stripToken(left);
  const r = stripJaEndParticles(stripToken(right));
  if (!(l.endsWith('て') || l.endsWith('で'))) return false;
  if (chars(l).length < 1) return false;
  return TE_AUX.has(r);
};

const JA_CASE_TOPIC = new Set([
  'は', 'が', 'を', 'に', 'の', 'と', 'で', 'も', 'へ', 'や', 'から', 'まで', 'より', 'ので', 'のに', 'って',
]);
const isJaCaseTopicParticle = (token: string): boolean => JA_CASE_TOPIC.has(token);

const isHiraganaRun = (s: string): boolean => chars(s).every((c) => isHiragana(c) || c === 'ー' || c === 'ｰ');

const PUNCT_ANY = new Set(['。', '.', '！', '!', '？', '?', '…', '，', '、', ',', '；', ';', '：', ':']);

function isHiraganaContinuationBind(left: string, right: string): boolean {
  const l = stripToken(left);
  const r = stripToken(right);
  if (!l || !r) return false;
  if (chars(left).some((c) => PUNCT_ANY.has(c))) return false;
  if (JA_TURN_NONBIND.has(r) || JA_DEM.has(r)) return false;
  if (!chars(r).every((c) => isHiragana(c) || c === 'ー' || c === 'ｰ')) return false;
  if (chars(l).some(isKanji)) return !isJaCaseTopicParticle(r);
  if (isLineStartBoundParticle(right) || isJaBareParticle(r)) return false;
  if (isHiraganaRun(l) && !isJaCaseTopicParticle(l) && l !== 'です' && l !== 'ます') return true;
  return false;
}

export function isJapaneseOrthographicBind(left: string, right: string): boolean {
  const l = stripToken(left);
  const r = stripToken(right);
  if (!l || !r) return false;
  const r0 = firstChar(r);
  const lLast = lastChar(l);
  if (r0 === 'ー' || r0 === 'ｰ') return true;
  if (['ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'っ', 'ゃ', 'ゅ', 'ょ', 'ゎ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ', 'ッ', 'ャ', 'ュ', 'ョ', 'ヮ'].includes(r0)) {
    return true;
  }
  if (lLast === 'っ' || lLast === 'ッ') return true;
  return r === 'ん' || r === 'ン';
}

export const isJaAddressGreetingBind = (left: string, right: string): boolean =>
  JA_ADDRESS.has(stripToken(left)) && JA_GREETING.has(stripToken(right));

export function isJapaneseLexicalBind(left: string, right: string): boolean {
  return (
    isJapaneseOrthographicBind(left, right) ||
    isKatakanaRunBind(left, right) ||
    isJaAddressGreetingBind(left, right) ||
    isSuruCompoundBind(left, right) ||
    isJaNameSuffixBind(left, right) ||
    isTeAuxiliaryBind(left, right) ||
    isHiraganaContinuationBind(left, right) ||
    isSplitHai(left, right) ||
    isSplitCopulaTa(left, right)
  );
}

export function isSplitConnectorPair(left: string, right: string, connectors: readonly string[]): boolean {
  const comb = stripToken(left) + stripToken(right);
  return connectors.includes(comb);
}

export function isJaTurnStartAfter(prev: string, token: string, next: string): boolean {
  if (isJaAddressGreetingBind(prev, token)) return false;
  if (isConnectorLike(token, JA_TURN_STARTERS)) return true;
  return isSplitConnectorPair(token, next, JA_TURN_STARTERS);
}

export function isTimeGluedContent(left: string, right: string, gapSec: number | null): boolean {
  if (gapSec == null) return false;
  if (gapSec > GLUE_GAP_SEC) return false;
  if (isLineStartBoundParticle(left) || isLineStartBoundParticle(right)) return false;
  return jaHasContent(left) && jaHasContent(right);
}

function isExplanatoryOrQuestionNo(token: string): boolean {
  const t = stripToken(token);
  if (!t.endsWith('の')) return false;
  const stem = t.slice(0, -1);
  const c = lastChar(stem);
  return ['る', 'う', 'く', 'ぐ', 'す', 'つ', 'ぬ', 'む', 'ぶ', 'い', 'た', 'だ', 'な'].includes(c);
}

const isZhContentStart = (token: string): boolean => {
  if (!token) return false;
  const c = firstChar(token);
  const v = c.codePointAt(0)!;
  return (
    isCjkLetter(c) ||
    (v >= 0xac00 && v <= 0xd7af) ||
    (v >= 0x1100 && v <= 0x11ff) ||
    /[A-Za-z0-9]/.test(c)
  );
};

export function isOpenGenitiveLink(left: string, right: string): boolean {
  const l = stripToken(left);
  const r = stripToken(right);
  if (!l || !r) return false;
  if (chars(left).some((c) => PUNCT_ANY.has(c))) return false;
  if ([...JA_NOMINALIZER].some((tail) => l.endsWith(tail))) return false;
  const jaNo = l.endsWith('の');
  const zhDe = l.endsWith('的');
  if (!jaNo && !zhDe) return false;
  if (jaNo) {
    if (JA_DEM.has(l)) return false;
    if (isExplanatoryOrQuestionNo(l)) return false;
    return isJaContentStart(r);
  }
  if (CJK_FW.has(r) || CJK_CLOSE.has(r)) return false;
  if ([...ZH_CONN_STARTS].some((c) => r.startsWith(c) || r === c)) return false;
  return isZhContentStart(r);
}

const isDaCopula = (token: string): boolean => {
  if (token === 'だ' || token === 'んだ' || token === 'のだ') return true;
  if (JA_NOT_COP.has(token)) return false;
  return token.endsWith('だ') && chars(token).length >= 2;
};

const isShortJaPredicate = (token: string): boolean => {
  const t = stripJaEndParticles(stripToken(token));
  return ['いい', '良い', 'よい', 'ない', 'ほしい', '欲しい', 'ある', 'いる', 'です', 'だ', 'だった'].includes(t);
};

const looksJapanesePredicate = (token: string): boolean => {
  const trimmed = stripJaEndParticles(stripToken(token));
  if (!trimmed) return false;
  if (JA_STEMS.has(trimmed)) return true;
  for (const s of JA_SUFFIXES) {
    if (trimmed.endsWith(s)) return true;
  }
  return false;
};

export function isCaseParticleBeforePredicate(left: string, right: string): boolean {
  const l = stripToken(left);
  const r = stripToken(right);
  if (!l || !r) return false;
  const last = lastChar(l);
  if (last === 'は' || last === 'が') return isShortJaPredicate(r);
  if (!['で', 'に', 'を', 'と'].includes(last)) return false;
  return looksJapanesePredicate(r);
}

export function isJapaneseClauseEndingWithPeek(left: string, right: string, right2: string): boolean {
  if (isLineStartBoundParticle(right) && !isSplitHai(right, right2)) return false;
  if (stripToken(left) === 'か') return true;
  const l = stripJaEndParticles(stripToken(left));
  if (!l) return false;
  for (const s of JA_COPULA) {
    if (l === s || l.endsWith(s)) return true;
  }
  return isDaCopula(l);
}

export function isJapaneseSpokenEnd(prev: string, left: string, right: string, right2: string): boolean {
  if (isLineStartBoundParticle(right) && !isSplitHai(right, right2)) return false;
  if (isSplitCopulaTa(prev, left)) return true;
  return isJapaneseClauseEndingWithPeek(left, right, right2);
}

export function isDiscourseMarkerComma(token: string): boolean {
  const trimmed = token.trimEnd();
  if (!trimmed.endsWith(',') && !trimmed.endsWith('，')) return false;
  return inList(trimmed, DISCOURSE_MARKERS);
}

const MULTI_WORD_LEADINS = new Set([
  'the truth is', 'the fact is', 'the point is', 'the thing is', 'i mean', 'you know',
  'you see', 'in fact', 'of course', 'for example',
]);

export function isDiscourseMarkerText(text: string): boolean {
  let core = text.trim();
  while (core && !reTokenCore.test(firstChar(core))) core = core.slice(1);
  while (core) {
    const c = lastChar(core);
    if (!['.', '!', '?', '。', '！', '？', '…', ',', '，', '、'].includes(c)) break;
    core = core.slice(0, -c.length);
  }
  if (inList(core, DISCOURSE_MARKERS)) return true;
  return MULTI_WORD_LEADINS.has(lower(core));
}

export function isToBindingLeft(token: string): boolean {
  return inList(token, TO_BINDING_LEFT);
}

export function isBoundConnector(left: string, right: string, connectors: readonly string[]): boolean {
  const r = lower(stripToken(right));
  if (!connectors.includes(r)) return false;
  return CJK_BIND_LEFT.has(stripToken(left));
}

export function isConnectorLike(token: string, connectors: readonly string[]): boolean {
  const t = lower(stripToken(token));
  if (!t) return false;
  if (connectors.includes(t)) return true;
  for (const connector of connectors) {
    if (chars(connector).length < 2 || !t.endsWith(connector)) continue;
    const prefix = t.slice(0, t.length - connector.length);
    if (chars(prefix).length === 1) return true;
  }
  return false;
}

/** 普通词界的时间代价（无结构信息时）。 */
export function lexicalCutCost(gapSec: number | null): number {
  if (gapSec == null) return WORD_COST;
  const g = Math.max(0, gapSec);
  if (g >= GOOD_SILENCE_SEC) return 2.0 - (0.5 * Math.min(g - GOOD_SILENCE_SEC, 0.9)) / 0.9;
  if (g <= GLUE_GAP_SEC) {
    if (GLUE_GAP_SEC <= 0) return GLUED_WORD_COST;
    return GLUED_WORD_COST - ((GLUED_WORD_COST - WORD_COST) * g) / GLUE_GAP_SEC;
  }
  const t = (g - GLUE_GAP_SEC) / (GOOD_SILENCE_SEC - GLUE_GAP_SEC);
  return WORD_COST - t * (WORD_COST - 3.2);
}

export function isNumericContinuation(left: string, right: string): boolean {
  const leftHasDigit = /[0-9]/.test(left);
  const rightHasDigit = /[0-9]/.test(right);
  if (!leftHasDigit || !rightHasDigit) return false;
  const leftTail = lastChar(left.trimEnd());
  const rightHead = firstChar(right.trimStart());
  if (['$', '¥', '€', '£', '.', ',', '%'].includes(leftTail)) return true;
  return ['%', '.', ',', '$', '¥', '€', '£'].includes(rightHead);
}

/** 单字符 CJK token（时间粘连时不要从中间撕开）。 */
export function isSingleCjkCharToken(token: string): boolean {
  const t = stripToken(token);
  if (chars(t).length !== 1) return false;
  const v = t.codePointAt(0)!;
  return (
    (v >= 0x3040 && v <= 0x30ff) ||
    (v >= 0x3400 && v <= 0x4dbf) ||
    (v >= 0x4e00 && v <= 0x9fff) ||
    (v >= 0xf900 && v <= 0xfaff) ||
    (v >= 0xac00 && v <= 0xd7af)
  );
}

export { reTokenCore };
