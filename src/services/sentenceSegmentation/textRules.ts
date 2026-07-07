// 标点 / 数字 / 连词 / 缩写 规则 —— 复刻 D:\voxtrans 的 text_rules.rs 与
// subtitle_layout.rs 里的边界判定辅助函数，外加一个缩写保护集（避免 Mr./U.S. 误切）。

/** 句末标点的"末字符"集合（覆盖多语言，含全角 / 全角感叹问号）。 */
const TERMINAL_CHARS = new Set([
  '.', '!', '?', '。', '！', '？', '｡', '﹒', '．', '…', '⁇', '⁉', '‼', '⁈', 'ǃ',
]);

/** 软子句标点（分号 / 冒号，含中文）。 */
const SOFT_CHARS = new Set([';', ':', '，', '；', '：']);

/** 左括号（切分前若 token 以它结尾，则禁止切）。 */
const OPENING_CHARS = new Set([
  '(', '[', '{', '（', '【', '「', '『', '《', '“', '‘',
]);

/** 右括号（切分后若下一 token 以它开头，则禁止切）。 */
const CLOSING_CHARS = new Set([
  ')', ']', '}', '）', '】', '」', '』', '》', '”', '’',
]);

/** 缩写保护集（小写、去尾点后匹配）。用于 Layer1 标点切分与 DP 句末代价判定。 */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'sra', 'srta', 'st', 'vs', 'etc',
  'inc', 'jr', 'co', 'corp', 'ltd', 'dept', 'rep', 'sen', 'gen', 'col',
  'maj', 'capt', 'rev', 'hon', 'pres', 'gov', 'det', 'sgt', 'cpl', 'pvt',
  'ph.d', 'm.d', 'b.a', 'm.a', 'u.s', 'u.k', 'd.c', 'a.m', 'p.m', 'e.g',
  'i.e', 'vol', 'no', 'fig', 'approx', 'est', 'min', 'max', 'temp', 'lit',
  'trans', 'esp', 'ref', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug',
  'sep', 'oct', 'nov', 'dec',
]);

/** 判断 token（可能带尾点）是否属于缩写，避免在其后误切。 */
export function isAbbreviationToken(token: string): boolean {
  const t = token.trim().toLowerCase().replace(/[.。]+$/, '');
  if (ABBREVIATIONS.has(t)) return true;
  // 单大写字母 + 点（如 "B." "U."），但 J. K. 这类链由调用方成对保护。
  if (/^[A-Z]\.$/.test(token.trim())) return true;
  return false;
}

/**
 * 单字母带点（如 "B." / "A."）：除非与下一个 token 也构成单字母链（"J. K."），
 * 否则视作真实句末（复刻 voxtrans 的 is_single_letter_dotted + 链特判）。
 * 用于 Layer1 在 sentence-splitter 之上补切枚举式句末（"step one B."）。
 */
export function isSingleLetterDotted(token: string): boolean {
  const stripped = token.trim().replace(/[）"”』`]+$/u, '');
  const chars = Array.from(stripped);
  return chars.length === 2 && /^[A-Za-z]$/.test(chars[0]) && chars[1] === '.';
}

/** 句末标点边界（且非缩写）→ DP 最高优先切分位置（代价 0.5）。 */
export function isTerminalBoundary(token: string): boolean {
  const trimmed = token.trimEnd();
  const last = trimmed[trimmed.length - 1];
  if (!last || !TERMINAL_CHARS.has(last)) return false;
  return !isAbbreviationToken(token);
}

export function endsWithSoftPunctuation(token: string): boolean {
  const trimmed = token.trimEnd();
  const last = trimmed[trimmed.length - 1];
  return last !== undefined && SOFT_CHARS.has(last);
}

export function endsWithOpeningPunctuation(token: string): boolean {
  const trimmed = token.trimEnd();
  const last = trimmed[trimmed.length - 1];
  return last !== undefined && OPENING_CHARS.has(last);
}

export function startsWithClosingPunctuation(token: string): boolean {
  const trimmed = token.trimStart();
  const first = trimmed[0];
  return first !== undefined && CLOSING_CHARS.has(first);
}

/** 数字连续（如 "3.14"、"$10"、"2026-03"）→ 禁止在中间切断。 */
export function isNumericContinuation(left: string, right: string): boolean {
  const leftHasDigit = /[0-9]/.test(left);
  const rightHasDigit = /[0-9]/.test(right);
  if (!leftHasDigit || !rightHasDigit) return false;
  const leftTail = left.trimEnd().slice(-1);
  const rightHead = right.trimStart()[0];
  return (
    (leftTail === '$' || leftTail === '¥' || leftTail === '€' || leftTail === '£' ||
      leftTail === '.' || leftTail === ',' || leftTail === '%') ||
    (rightHead === '%' || rightHead === '.' || rightHead === ',' ||
      rightHead === '$' || rightHead === '¥' || rightHead === '€' || rightHead === '£')
  );
}

/** 连词判定：去除首尾标点并转小写后是否在连词表中。 */
export function isConnectorLike(token: string, connectors: string[]): boolean {
  const lower = token
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .toLowerCase();
  return connectors.includes(lower);
}

/**
 * VAD 静音强度（0~1）—— 与 voxtrans vad_strength 近似对齐：
 * 停顿 ≥1.2s 视为强停顿（≈0.85），越短越弱。
 */
export function vadStrength(silenceSec: number): number {
  return Math.min(0.9, Math.max(0, silenceSec / 1.4));
}
