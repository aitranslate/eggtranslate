import type { SubtitleLengthPreset } from '@/types/transcription';

// 原文长度限制（按语言组）
const SOURCE_LIMITS: Record<string, Record<SubtitleLengthPreset, number>> = {
  cjk:      { short: 16, standard: 22, loose: 28 },
  korean:   { short: 15, standard: 20, loose: 26 },
  longword: { short: 11, standard: 14, loose: 18 },
  standard: { short: 12, standard: 16, loose: 20 },
};

// 译文长度限制（按语言组）
const TARGET_LIMITS: Record<string, Record<SubtitleLengthPreset, number>> = {
  cjk:        { short: 16, standard: 22, loose: 28 },
  korean:     { short: 15, standard: 20, loose: 26 },
  thai:       { short: 24, standard: 32, loose: 42 },
  vietnamese: { short: 11, standard: 14, loose: 18 },
  longword:   { short: 9,  standard: 11, loose: 14 },
  mediumword: { short: 10, standard: 12, loose: 15 },
  standard:   { short: 10, standard: 12, loose: 16 },
};

const LANG_TO_GROUP: Record<string, string> = {
  zh: 'cjk', yue: 'cjk', ja: 'cjk',
  ko: 'korean',
  de: 'longword', fr: 'longword',
  tr: 'longword', pl: 'longword', ru: 'longword',
  es: 'mediumword', it: 'mediumword', pt: 'mediumword',
  nl: 'mediumword', id: 'mediumword',
  th: 'thai', vi: 'vietnamese',
};

function getLangGroup(langCode: string): string {
  const key = langCode.toLowerCase().split(/[-_]/)[0];
  return LANG_TO_GROUP[key] || 'standard';
}

export function getSourceLimit(langCode: string, preset: SubtitleLengthPreset): number {
  const group = getLangGroup(langCode);
  return SOURCE_LIMITS[group]?.[preset] ?? SOURCE_LIMITS.standard[preset];
}

export function getTargetLimit(langCode: string, preset: SubtitleLengthPreset): number {
  const group = getLangGroup(langCode);
  return TARGET_LIMITS[group]?.[preset] ?? TARGET_LIMITS.standard[preset];
}

export const PRESET_LABELS: Record<SubtitleLengthPreset, string> = {
  short: '短',
  standard: '标准',
  loose: '宽松',
};
