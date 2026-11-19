// 译文字数预算 —— 让翻译那一步把「这条多长时间」当约束，而不是凭感觉写长。
//
// CPS（字符/秒）的标准值是针对目标语言的：中文 9、日文 4（全角）、韩文 12、
// 英文 20（Netflix TTSG）。断句管不到 CPS（切分不改变字/秒），但翻译可以：
// 给出「这条最多多少字」，模型才会主动压缩。

import { getProfile } from './profiles';

/** 目标语言名 → 该语言的 CPS 上限。未知语言按 17 估算。 */
export function cpsMaxForLanguage(targetLanguage: string): number {
  const t = targetLanguage.trim().toLowerCase();
  if (!t) return 17;
  if (/中文|chinese|简体|繁体|^zh/.test(t)) return 9;
  if (/日语|日文|japanese|^ja/.test(t)) return 4;
  if (/韩语|韩文|korean|^ko/.test(t)) return 12;
  if (/英语|英文|english|^en/.test(t)) return 20;
  return 17;
}

/**
 * 一条字幕最多能写多少字：
 * 时长（秒）× 目标语言 CPS，向下取整；至少 4 个字（否则模型会 Abbreviations 到不可用）。
 */
export function maxCharsForCue(targetLanguage: string, durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return Math.max(4, Math.floor(durationSec * cpsMaxForLanguage(targetLanguage)));
}

/** 源语言 profile 的 CPS 上限（用于度量/提示，不参与断句）。 */
export function cpsMaxForSourceLanguage(sourceLanguage: string): number {
  return getProfile(sourceLanguage).cpsMax;
}
