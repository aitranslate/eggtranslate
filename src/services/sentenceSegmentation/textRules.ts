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
 * 功能词（左词）护栏：切在冠词 / 介词 / 助动词 / to / 代词所有格之后，
 * 等于切开一个不可分割的短语（"the | price"、"can | see"、"in | the"）。
 * DP 无语义，这条词表是它唯一能理解的「语法」。
 * 注意：故意不含 "that"——它既是指示词又是补语引导词（"see that | the..." 是好刀）。
 */
const FUNCTION_WORDS_LEFT = new Set([
  'a', 'an', 'the', 'this', 'these', 'those', 'my', 'your', 'his', 'her', 'its',
  'our', 'their', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from',
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  'do', 'does', 'did', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'have', 'has', 'had', 'not', 'and', 'but', 'or', 'nor', 'so', 'as', 'than',
  'towards', 'into', 'onto', 'above', 'below', 'under', 'over', 'through',
  'across', 'along', 'around', 'against', 'between', 'during', 'within',
  'without', 'upon', 'near', 'behind', 'beyond', 'among', 'inside', 'outside',
  'beside', 'off', 'via', 'per',
]);

/** CJK 单字功能词护栏（ASR 词 token 若恰为单字功能词则不给切点折扣）。 */
const CJK_FUNCTION_WORDS_LEFT = new Set([
  '的', '了', '和', '与', '及', '或', '在', '是', '把', '被', '将', '从',
  '对', '向', '往', '于', '给', '让', '使', '还', '也', '都', '就', '又',
  '而', '但', '会', '要', '能', '着', '过', '吗', '呢', '吧', '啊',
]);

/**
 * 话语标记词（后跟逗号）："Okay," / "Now," / "So," 单独成行会产生闪帧，
 * 逗号折扣对它们不适用，保持与后续子句粘合。
 */
const DISCOURSE_MARKERS = new Set([
  'okay', 'ok', 'now', 'so', 'well', 'right', 'alright', 'look', 'listen',
  'then', 'hey', 'oh', 'uh', 'um', 'hmm',
]);

/** 左词是否为「话语标记 + 逗号」（切在其后 = 闪帧，不给折扣）。 */
export function isDiscourseMarkerComma(token: string): boolean {
  const trimmed = token.trimEnd();
  if (!trimmed.endsWith(',') && !trimmed.endsWith('，')) return false;
  const t = trimmed.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
  return DISCOURSE_MARKERS.has(t);
}

/**
 * 与 "to" 绑定的左词：need to / going to / have to / want to / try to / about to …
 * 切在它们之后 = 拆散情态结构，不给 "to" 起手奖励。
 */
const TO_BINDING_LEFT = new Set([
  'need', 'needs', 'needed', 'want', 'wants', 'wanted', 'going', 'have', 'has',
  'had', 'try', 'tries', 'trying', 'tried', 'able', 'supposed', 'expected',
  'likely', 'unlikely', 'required', 'meant', 'forced', 'bound', 'about',
  'prepared', 'ready', 'willing', 'reluctant', 'tend', 'tends', 'tended',
  'plan', 'plans', 'planned', 'hope', 'hopes', 'hoped',
]);

/** 左词是否与后续 "to" 绑定（其后的 "to" 起手不构成独立断点）。 */
export function isToBindingLeft(token: string): boolean {
  const t = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
  return TO_BINDING_LEFT.has(t);
}

/** 左词是否为功能词（切在其后 = 拆散短语）。 */
export function isFunctionWordLeft(token: string): boolean {
  const t = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
  if (!t) return false;
  return FUNCTION_WORDS_LEFT.has(t) || CJK_FUNCTION_WORDS_LEFT.has(t);
}

/**
 * VAD 静音强度（0~1）—— 与 voxtrans vad_strength 近似对齐：
 * 停顿 ≥1.2s 视为强停顿（≈0.85），越短越弱。
 */
export function vadStrength(silenceSec: number): number {
  return Math.min(0.9, Math.max(0, silenceSec / 1.4));
}
