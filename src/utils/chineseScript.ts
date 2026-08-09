/**
 * 中文简繁字形处理。
 *
 * 仅在目标语言为「简体中文」时，将译文中的繁体字形转为简体。
 * 其它语言一律原样返回；不改提示词。
 *
 * 使用 opencc-js/t2cn（繁→简专用字典，同步、纯前端）。
 */

import { Converter } from 'opencc-js/t2cn';

/** 与 LANGUAGE_OPTIONS 中简体项 value 一致 */
export const SIMPLIFIED_CHINESE_TARGET = '简体中文';

export function isSimplifiedChineseTarget(
  targetLanguage: string | null | undefined
): boolean {
  return (targetLanguage ?? '').trim() === SIMPLIFIED_CHINESE_TARGET;
}

type ConvertFn = (text: string) => string;

let t2s: ConvertFn | null = null;

function getTraditionalToSimplified(): ConvertFn {
  if (!t2s) {
    // from: 't' = 通用繁体；to: 'cn' = 大陆简体
    t2s = Converter({ from: 't', to: 'cn' });
  }
  return t2s;
}

/**
 * 目标为简体中文时繁转简；否则原样返回。
 * 空串 / 非简体目标：零开销直通。
 */
export function maybeSimplifyChinese(
  text: string,
  targetLanguage: string | null | undefined
): string {
  if (!text || !isSimplifiedChineseTarget(targetLanguage)) return text;
  try {
    return getTraditionalToSimplified()(text);
  } catch {
    return text;
  }
}
