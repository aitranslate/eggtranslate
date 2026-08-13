// 语言 profile：长度预算 + token 计量 + 硬切分策略。
// DP 骨架只调 profile.tokenUnits / sourceLimit / sourceCharLimit。

import type { Preset, WordToken } from './types';

/** 硬切分策略。 */
export type HardSplitStrategy = 'sentence-splitter' | 'punctuation';

export interface LanguageProfile {
  key: string;
  /** 硬切分用 sentence-splitter（英文）还是默认标点（其它语言）。 */
  hardSplit: HardSplitStrategy;
  /** 连词表：DP 中在这些词「前面」切代价更优。 */
  connectors: string[];
  /**
   * 主长度上限：拉丁=词数；CJK=字数（与 UI 一致）。
   */
  sourceLimit(preset: Preset): number;
  /**
   * 显示字符上限（含拼接空格）。
   * 拉丁 = 词数 × CHARS_PER_WORD_BUDGET；CJK 已按字计，返回 Infinity（不双卡）。
   */
  sourceCharLimit(preset: Preset): number;
  /**
   * 是否倾向按「显示字」计（CJK）。
   * 注意：segmentWords 路径 token 已是 ASR 词，不再按字拆 token。
   */
  isCharBased: boolean;
  /** 相邻 token 拼最终文本时是否插空格（CJK 为 false）。 */
  joinWithSpace: boolean;
  /** 单 ASR token 的长度单位（不可拆 token）。 */
  tokenUnits(token: string): number;
}

// ---- 英文连词表（与 voxtrans ENGLISH_CONNECTORS 一致，补充关系代词/连词）----
const ENGLISH_CONNECTORS = [
  'and', 'but', 'or', 'so', 'because', 'when', 'while', 'which', 'that', 'if',
  'then', 'though', 'although', 'however', 'therefore', 'before',
  'where', 'who', 'what', 'whom', 'whose', 'as', 'until', 'once', 'since', 'unless', 'whereas',
];

/** UI：短/标准/宽松 — 拉丁词数 */
export const WORD_LIMITS: Record<Preset, number> = {
  short: 12,
  standard: 16,
  loose: 20,
};

/**
 * 拉丁系显示字符预算系数：正常词长约 4～5 + 空格。
 * charLimit = round(wordLimit × 5.5) → 短 66 / 标准 88 / 宽松 110。
 */
export const CHARS_PER_WORD_BUDGET = 5.5;

/** 由词数预设导出的拉丁字符上限 */
export const LATIN_CHAR_LIMITS: Record<Preset, number> = {
  short: Math.round(WORD_LIMITS.short * CHARS_PER_WORD_BUDGET),
  standard: Math.round(WORD_LIMITS.standard * CHARS_PER_WORD_BUDGET),
  loose: Math.round(WORD_LIMITS.loose * CHARS_PER_WORD_BUDGET),
};

/** UI：短/标准/宽松 — 中日韩等字数 */
export const CJK_CHAR_LIMITS: Record<Preset, number> = {
  short: 16,
  standard: 22,
  loose: 28,
};

function isCjkChar(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return (
    (c >= 0x3040 && c <= 0x30ff) || // 假名
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x4e00 && c <= 0x9fff) || // CJK 统一汉字
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xac00 && c <= 0xd7af) // 韩文音节
  );
}

/**
 * 词级计量（拉丁 / 西里尔 / 阿拉伯 / 印地等）：
 * 一个 ASR token 只要含字母或数字 → 计 1 词；纯标点 → 0。
 */
export function wordTokenUnits(token: string): number {
  return /\p{L}|\p{N}/u.test(token) ? 1 : 0;
}

/**
 * CJK 显示字计量（不拆 token）：
 * - 每个汉字/假名/韩文音节 = 1
 * - 连续拉丁/数字块 = 1（混排英文）
 * - 纯标点 = 0
 */
export function cjkTokenUnits(token: string): number {
  let n = 0;
  let inAsciiWord = false;
  for (const ch of token) {
    if (isCjkChar(ch)) {
      n += 1;
      inAsciiWord = false;
      continue;
    }
    if (/[A-Za-z0-9]/.test(ch)) {
      if (!inAsciiWord) {
        n += 1;
        inAsciiWord = true;
      }
      continue;
    }
    inAsciiWord = false;
  }
  return n;
}

const EnglishProfile: LanguageProfile = {
  key: 'en',
  hardSplit: 'sentence-splitter',
  connectors: ENGLISH_CONNECTORS,
  sourceLimit: (p) => WORD_LIMITS[p],
  sourceCharLimit: (p) => LATIN_CHAR_LIMITS[p],
  isCharBased: false,
  joinWithSpace: true,
  tokenUnits: wordTokenUnits,
};

const CjkProfile: LanguageProfile = {
  key: 'cjk',
  hardSplit: 'punctuation',
  connectors: [],
  sourceLimit: (p) => CJK_CHAR_LIMITS[p],
  // 已按字计，不再叠第二层字符 cap
  sourceCharLimit: () => Number.POSITIVE_INFINITY,
  isCharBased: true,
  joinWithSpace: false,
  tokenUnits: cjkTokenUnits,
};

/** 默认：词级计量 + 空格拼接 + 拉丁字符双约束 */
const DefaultProfile: LanguageProfile = {
  key: 'default',
  hardSplit: 'punctuation',
  connectors: [],
  sourceLimit: (p) => WORD_LIMITS[p],
  sourceCharLimit: (p) => LATIN_CHAR_LIMITS[p],
  isCharBased: false,
  joinWithSpace: true,
  tokenUnits: wordTokenUnits,
};

const CJK_LANG_KEYS = new Set(['zh', 'yue', 'cmn', 'ja', 'jp', 'ko', 'th']);

/** 解析 BCP-47 风格语言标签，返回对应 profile。 */
export function getProfile(lang: string): LanguageProfile {
  const key = lang.trim().split(/[-_]/)[0].toLowerCase();
  if (key === 'en') return EnglishProfile;
  if (CJK_LANG_KEYS.has(key)) return CjkProfile;
  return DefaultProfile;
}

/**
 * 仅 tokenize 用（纯文本路径）。
 * CJK profile 仍按空格拆 ASR 风格 token，不按字拆——与生产 segmentWords 一致。
 */
export function tokenize(sentence: string, _profile: LanguageProfile): WordToken[] {
  return sentence
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ({ word: w }));
}

/** 按 profile 拼接 token 文本（CJK 不插空格，拉丁插空格；混排时 CJK 旁不插）。 */
export function joinTokenTexts(texts: string[], profile: LanguageProfile): string {
  if (texts.length === 0) return '';
  if (profile.joinWithSpace) {
    return texts.join(' ').replace(/\s+/g, ' ').trim();
  }
  let out = texts[0] ?? '';
  for (let i = 1; i < texts.length; i++) {
    const left = out;
    const right = texts[i] ?? '';
    if (!left || !right) {
      out += right;
      continue;
    }
    const leftCh = left[left.length - 1]!;
    const rightCh = right[0]!;
    const needSpace =
      /[A-Za-z0-9]/.test(leftCh) && /[A-Za-z0-9]/.test(rightCh);
    out += needSpace ? ` ${right}` : right;
  }
  return out;
}

/** 段显示字符数（与 joinTokenTexts 一致，数字/URL 全部计入）。 */
export function segmentDisplayChars(
  tokens: WordToken[],
  from: number,
  to: number,
  profile: LanguageProfile,
): number {
  if (to < from) return 0;
  const texts = [];
  for (let i = from; i <= to; i++) texts.push(tokens[i].word);
  return joinTokenTexts(texts, profile).length;
}
