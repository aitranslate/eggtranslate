// 语言 profile —— OneAsr crates/oneasr-core/src/sentence_boundary/profile.rs 的移植。
// 差异：中文的 jieba 词界顾问不引入（不新接库），退化为「无词界信息」。

import {
  CHARS_PER_WORD_BUDGET,
  LENGTH_GRACE_UNITS,
} from './constants';
import {
  DE_CONNECTORS,
  EN_CONNECTORS,
  ES_CONNECTORS,
  FR_CONNECTORS,
  IT_CONNECTORS,
  JA_CONNECTORS,
  KO_CONNECTORS,
  PT_CONNECTORS,
  U35_SPACED_CONNECTORS,
  U35_SPACED_FUNCTION_WORDS,
  ZH_CONNECTORS,
} from './wordTables';

export type Preset = 'short' | 'standard' | 'loose';

export interface LanguageProfile {
  key: string;
  connectors: readonly string[];
  /** 英文走 Punkt（我们复用 sentence-splitter）。 */
  usesPunktSentenceBoundary: boolean;
  isCharBased: boolean;
  functionWordsLeft: readonly string[];
  /** 单 token 的长度单位（拉丁=词，CJK=字）。 */
  tokenUnits(token: string): number;
  sourceLimit(preset: Preset): number;
  sourceCharLimit(preset: Preset): number;
  /** quality 模式的宽窄（CJK 6，其它 2）。 */
  lengthGraceUnits(): number;
  /** force 上限 = 预设值本身，不另设膨胀阈值。 */
  forceUnitCeiling(limit: number): number;
}

const isCjkChar = (c: string): boolean => {
  const v = c.codePointAt(0)!;
  return (
    (v >= 0x3040 && v <= 0x30ff) ||
    (v >= 0x3400 && v <= 0x4dbf) ||
    (v >= 0x4e00 && v <= 0x9fff) ||
    (v >= 0xf900 && v <= 0xfaff) ||
    (v >= 0xac00 && v <= 0xd7af)
  );
};

/** CJK 字计数：CJK/字母各算 1；连续 ASCII 字母数字串算 1。 */
export function countCharUnits(text: string): number {
  let total = 0;
  let inAsciiGroup = false;
  for (const ch of text) {
    if (/\s/.test(ch)) {
      if (inAsciiGroup) {
        total += 1;
        inAsciiGroup = false;
      }
      continue;
    }
    if (/[A-Za-z0-9]/.test(ch)) {
      inAsciiGroup = true;
      continue;
    }
    if (inAsciiGroup) {
      total += 1;
      inAsciiGroup = false;
    }
    if (isCjkChar(ch) || /[\p{L}\p{N}]/u.test(ch)) total += 1;
  }
  if (inAsciiGroup) total += 1;
  return total;
}

const latinTokenUnits = (token: string): number => {
  for (const ch of token) {
    if (isCjkChar(ch)) {
      const units = countCharUnits(token);
      return units === 0 ? 0 : units;
    }
  }
  return /[\p{L}\p{N}]/u.test(token) ? 1 : 0;
};

const cjkTokenUnits = (token: string): number => countCharUnits(token);

const latinCharLimit = (wordLimit: number): number =>
  Math.round(wordLimit * CHARS_PER_WORD_BUDGET);

interface Limits {
  short: number;
  standard: number;
  loose: number;
}

function makeProfile(opts: {
  key: string;
  connectors: readonly string[];
  punkt?: boolean;
  charBased?: boolean;
  limits: Limits;
  charBasedLimit?: boolean;
  grace?: number;
  functionWordsLeft?: readonly string[];
}): LanguageProfile {
  const charBased = opts.charBased === true;
  const units = charBased ? cjkTokenUnits : latinTokenUnits;
  return {
    key: opts.key,
    connectors: opts.connectors,
    usesPunktSentenceBoundary: opts.punkt === true,
    isCharBased: charBased,
    functionWordsLeft: opts.functionWordsLeft ?? [],
    tokenUnits: units,
    sourceLimit: (preset) => opts.limits[preset],
    sourceCharLimit: (preset) =>
      opts.charBasedLimit === false ? Number.POSITIVE_INFINITY : latinCharLimit(opts.limits[preset]),
    lengthGraceUnits: () => opts.grace ?? LENGTH_GRACE_UNITS,
    forceUnitCeiling: (limit) => limit,
  };
}

const EN_PROFILE = makeProfile({
  key: 'en',
  connectors: EN_CONNECTORS,
  punkt: true,
  limits: { short: 12, standard: 16, loose: 20 },
});

const ZH_PROFILE = makeProfile({
  key: 'zh',
  connectors: ZH_CONNECTORS,
  charBased: true,
  limits: { short: 16, standard: 22, loose: 28 },
  charBasedLimit: false,
  grace: 6,
});

const JA_PROFILE = makeProfile({
  key: 'ja',
  connectors: JA_CONNECTORS,
  charBased: true,
  limits: { short: 16, standard: 22, loose: 28 },
  charBasedLimit: false,
  grace: 6,
});

const KO_PROFILE = makeProfile({
  key: 'ko',
  connectors: KO_CONNECTORS,
  charBased: true,
  limits: { short: 15, standard: 20, loose: 26 },
  charBasedLimit: false,
});

const TH_PROFILE = makeProfile({
  key: 'th',
  connectors: [],
  charBased: true,
  limits: { short: 24, standard: 32, loose: 42 },
  charBasedLimit: false,
});

const FR_PROFILE = makeProfile({
  key: 'fr',
  connectors: FR_CONNECTORS,
  limits: { short: 11, standard: 14, loose: 18 },
  functionWordsLeft: U35_SPACED_FUNCTION_WORDS,
});
const DE_PROFILE = makeProfile({
  key: 'de',
  connectors: DE_CONNECTORS,
  limits: { short: 11, standard: 14, loose: 18 },
  functionWordsLeft: U35_SPACED_FUNCTION_WORDS,
});
const ES_PROFILE = makeProfile({
  key: 'es',
  connectors: ES_CONNECTORS,
  limits: { short: 11, standard: 14, loose: 18 },
  functionWordsLeft: U35_SPACED_FUNCTION_WORDS,
});
const PT_PROFILE = makeProfile({
  key: 'pt',
  connectors: PT_CONNECTORS,
  limits: { short: 11, standard: 14, loose: 18 },
  functionWordsLeft: U35_SPACED_FUNCTION_WORDS,
});
const IT_PROFILE = makeProfile({
  key: 'it',
  connectors: IT_CONNECTORS,
  limits: { short: 11, standard: 14, loose: 18 },
  functionWordsLeft: U35_SPACED_FUNCTION_WORDS,
});
const AR_PROFILE = makeProfile({
  key: 'ar',
  connectors: [
    'ولكن', 'لأن', 'لذلك', 'ثم', 'أو', 'عندما', 'حيث', 'لكن', 'بسبب', 'إضافة',
  ],
  limits: { short: 12, standard: 16, loose: 20 },
  functionWordsLeft: U35_SPACED_FUNCTION_WORDS,
});
const DEFAULT_PROFILE = makeProfile({
  key: 'default',
  connectors: U35_SPACED_CONNECTORS,
  limits: { short: 12, standard: 16, loose: 20 },
  functionWordsLeft: U35_SPACED_FUNCTION_WORDS,
});

const languageKey = (lang: string): string => {
  const trimmed = lang.trim();
  const end = trimmed.search(/[-_]/);
  return (end < 0 ? trimmed : trimmed.slice(0, end)).toLowerCase();
};

export function getProfile(lang: string): LanguageProfile {
  switch (languageKey(lang)) {
    case 'zh':
    case 'yue':
      return ZH_PROFILE;
    case 'ja':
      return JA_PROFILE;
    case 'ko':
      return KO_PROFILE;
    case 'en':
      return EN_PROFILE;
    case 'fr':
      return FR_PROFILE;
    case 'de':
      return DE_PROFILE;
    case 'es':
      return ES_PROFILE;
    case 'pt':
      return PT_PROFILE;
    case 'it':
      return IT_PROFILE;
    case 'ar':
      return AR_PROFILE;
    case 'th':
      return TH_PROFILE;
    default:
      return DEFAULT_PROFILE;
  }
}
