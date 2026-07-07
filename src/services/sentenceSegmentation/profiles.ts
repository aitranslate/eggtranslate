// 语言 profile —— 复刻 D:\voxtrans 的 language.rs。
// 所有语言相关知识集中在此，DP 骨架不做 `if lang ==` 分支。
// 当前仅重点实现英文（sentence-splitter 硬切分 + 连词代价），其余语言走默认标点。

import type { Preset, WordToken } from './types';

/** 硬切分策略。 */
export type HardSplitStrategy = 'sentence-splitter' | 'punctuation';

export interface LanguageProfile {
  key: string;
  /** 硬切分用 sentence-splitter（英文）还是默认标点（其它语言）。 */
  hardSplit: HardSplitStrategy;
  /** 连词表：DP 中在这些词"前面"切代价更优。 */
  connectors: string[];
  /** 该预设下的长度预算（拉丁=词数，CJK=字数）。 */
  sourceLimit(preset: Preset): number;
  /** 是否按字符计数（CJK）。当前默认 false（按词），其他语言不做字符级。 */
  isCharBased: boolean;
  /** 单 token 的长度单位。 */
  tokenUnits(token: string): number;
}

// ---- 英文连词表（与 voxtrans ENGLISH_CONNECTORS 一致）----
const ENGLISH_CONNECTORS = [
  'and', 'but', 'or', 'so', 'because', 'when', 'while', 'which', 'that', 'if',
  'then', 'though', 'although', 'however', 'therefore',
];

// ---- 长度预算（词数）：short/standard/loose ----
const WORD_LIMITS: Record<Preset, number> = { short: 12, standard: 16, loose: 20 };

// 拉丁语系：含字母/数字记 1 单位，纯标点记 0。
function latinTokenUnits(token: string): number {
  return /[A-Za-z0-9]/.test(token) ? 1 : 0;
}

const EnglishProfile: LanguageProfile = {
  key: 'en',
  hardSplit: 'sentence-splitter',
  connectors: ENGLISH_CONNECTORS,
  sourceLimit: (p) => WORD_LIMITS[p],
  isCharBased: false,
  tokenUnits: latinTokenUnits,
};

// 默认（其它语言）：按词计数，空连词，走默认标点切分。
const DefaultProfile: LanguageProfile = {
  key: 'default',
  hardSplit: 'punctuation',
  connectors: [],
  sourceLimit: (p) => WORD_LIMITS[p],
  isCharBased: false,
  tokenUnits: latinTokenUnits,
};

/** 解析 BCP-47 风格的语言标签，返回对应 profile（未知语言回退默认）。 */
export function getProfile(lang: string): LanguageProfile {
  const key = lang.trim().split(/[-_]/)[0].toLowerCase();
  if (key === 'en') return EnglishProfile;
  return DefaultProfile;
}

/** 仅 tokenize 用：把句子拆成 token（按词或按字）。 */
export function tokenize(sentence: string, profile: LanguageProfile): WordToken[] {
  if (profile.isCharBased) {
    return Array.from(sentence)
      .filter((ch) => ch.trim().length > 0)
      .map((ch) => ({ word: ch }));
  }
  return sentence
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ({ word: w }));
}
