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

/**
 * 去掉首尾标点，但保留字母后的结合音符（\p{M}）。
 * 印地 का / तो、阿语标音符若用 [^\p{L}\p{N}]+$ 会剥成 क / ت，词表永远对不上。
 */
export function stripToken(token: string): string {
  return token.replace(/^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu, '');
}

/** 连词判定：去除首尾标点并转小写后是否在连词表中。 */
export function isConnectorLike(token: string, connectors: string[]): boolean {
  return connectors.includes(stripToken(token).toLowerCase());
}

/**
 * 连词黏着左词：只因为 / 并不是因为 / 之所以。
 * 此时「因为」不是新分句，不能在其前落刀。
 */
const CJK_CONNECTOR_BIND_LEFT = new Set([
  '只', '正', '就', '是', '不', '并', '都', '也', '还', '又', '才', '却', '之',
  '并不是', '不是', '只是',
]);

/** 右词虽是连词，但与左词构成一个词（只+因为），不给连词切分奖励。 */
export function isBoundConnector(left: string, right: string, connectors: string[]): boolean {
  if (!isConnectorLike(right, connectors)) return false;
  const l = stripToken(left);
  return CJK_CONNECTOR_BIND_LEFT.has(l);
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

/**
 * 汉语短语**收束**助词：切在其后是好切点（台风的 | 形状）。
 * 与英语 of 相反——的/了 在修饰语末尾，不是介词短语开头。
 * 只认封闭语法类，不写开放名词。
 */
const CJK_PHRASE_CLOSE = new Set(['的', '了', '着', '过', '吗', '呢', '吧', '啊']);

/** 汉语短语**起手**词：切在其后会拆开「在|教育」「把|门」。 */
const CJK_FUNCTION_WORDS_LEFT = new Set([
  '和', '与', '及', '或', '在', '是', '把', '被', '将', '从',
  '对', '向', '往', '于', '给', '让', '使', '还', '也', '都', '就', '又',
  '而', '但', '会', '要', '能',
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
  const t = stripToken(trimmed).toLowerCase();
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
  return TO_BINDING_LEFT.has(stripToken(token).toLowerCase());
}

/**
 * 日韩文节收束助词：切在其后是自然短语边界（友達を | 待って）。
 * 切在其前才会把助词甩到下一行开头。不含 て/た/し。
 *
 * 韩语 AAI token 已经是어절（국방부가）。几乎每个名词都以后缀助词收尾，
 * 不能把 endsWith(가/을) 当成 quality cut，否则韩语会退化成按字数硬切。
 * 只认「单独的助词 token」。
 */
const JA_PHRASE_CLOSE = new Set([
  'は', 'が', 'を', 'に', 'の', 'と', 'で', 'も', 'へ', 'や', 'より', 'まで', 'から',
]);
const KO_PHRASE_CLOSE = ['은', '는', '이', '가', '을', '를', '의', '에', '와', '과', '도', '로', '으로'];

/** 左词是否收束一个短语（好切点，不是禁切点）。 */
export function isPhraseCloseParticle(token: string): boolean {
  const t = stripToken(token);
  if (!t) return false;
  if (JA_PHRASE_CLOSE.has(t) || CJK_PHRASE_CLOSE.has(t)) return true;
  if (KO_PHRASE_CLOSE.some((p) => t === p)) return true;
  const chars = [...t];
  if (chars.length < 2) return false;
  const last = chars[chars.length - 1]!;
  if (JA_PHRASE_CLOSE.has(last)) return true;
  // 仅末字「的」：所有的 | 人。不用「了」——「为了」是连词，切在其后是错的。
  if (last === '的') return true;
  return false;
}

/** 单字汉字/假名/谚文 token（时间粘连时不要从中间撕开）。 */
export function isSingleCjkCharToken(token: string): boolean {
  const t = stripToken(token);
  if ([...t].length !== 1) return false;
  const c = t.codePointAt(0)!;
  return (
    (c >= 0x3040 && c <= 0x30ff) ||
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xac00 && c <= 0xd7af)
  );
}

/** 两 token 的间隔（秒）。相接或重叠视为 0；缺时间戳返回 null。 */
export function tokenGapSec(
  left: { start?: number; end?: number },
  right: { start?: number; end?: number },
): number | null {
  if (left.end == null || right.start == null) return null;
  const g = right.start - left.end;
  return g > 0 ? g : 0;
}

/** 日语小假名 / 促音 / 长音：必须粘在前一拍，禁止在其间落刀。 */
const JA_SMALL_KANA = new Set([
  'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'っ', 'ゃ', 'ゅ', 'ょ', 'ゎ',
  'ァ', 'ィ', 'ゥ', 'ェ', 'ォ', 'ッ', 'ャ', 'ュ', 'ョ', 'ヮ',
]);

/**
 * 日语字级 token 的正字法绑定：
 * ニュース 不可切成 ニ | ュース；待って 不可切成 待っ | て。
 */
export function isJapaneseOrthographicBind(left: string, right: string): boolean {
  const l = stripToken(left);
  const r = stripToken(right);
  if (!l || !r) return false;
  const r0 = r[0]!;
  const lLast = l[l.length - 1]!;
  if (r0 === 'ー' || r0 === 'ｰ') return true;
  if (JA_SMALL_KANA.has(r0)) return true;
  if (lLast === 'っ' || lLast === 'ッ') return true;
  if (r === 'ん' || r === 'ン') return true;
  return false;
}

/**
 * 左词是否为功能词（切在其后 = 拆散短语）。
 * extras：profile.functionWordsLeft（西/法/德等 U3.5 空格语言）。
 */
export function isFunctionWordLeft(token: string, extras?: readonly string[]): boolean {
  const t = stripToken(token).toLowerCase();
  if (!t) return false;
  if (FUNCTION_WORDS_LEFT.has(t) || CJK_FUNCTION_WORDS_LEFT.has(t)) return true;
  return extras != null && extras.includes(t);
}

/** 去掉句末标点后的核心词，供闪帧/口头禅判定。 */
export function discourseCore(text: string): string {
  return text
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[.!?。！？…,，、]+$/gu, '')
    .toLowerCase();
}

export function isDiscourseMarkerText(text: string): boolean {
  return DISCOURSE_MARKERS.has(discourseCore(text));
}

/**
 * VAD 静音强度（0~1）—— 与 voxtrans vad_strength 近似对齐：
 * 停顿 ≥1.2s 视为强停顿（≈0.85），越短越弱。
 */
export function vadStrength(silenceSec: number): number {
  return Math.min(0.9, Math.max(0, silenceSec / 1.4));
}
