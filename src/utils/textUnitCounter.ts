/**
 * 判断语言是否按字符计数（CJK 等）
 */

const CJK_LANGS = new Set(['zh', 'yue', 'ja', 'ko', 'th']);

export function isCharUnitLanguage(langCode: string): boolean {
  const key = langCode.toLowerCase().split(/[-_]/)[0];
  return CJK_LANGS.has(key);
}
