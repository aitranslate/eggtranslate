/**
 * 计算文本长度（单位数）
 * CJK 语言按字符计数，拉丁语言按单词计数
 */

const CJK_LANGS = new Set(['zh', 'yue', 'ja', 'ko', 'th']);

export function isCharUnitLanguage(langCode: string): boolean {
  const key = langCode.toLowerCase().split(/[-_]/)[0];
  return CJK_LANGS.has(key);
}

export function countUnits(text: string, langCode: string): number {
  if (isCharUnitLanguage(langCode)) {
    return countCharUnits(text);
  }
  return countWordUnits(text);
}

function countCharUnits(text: string): number {
  let count = 0;
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }
    if (/[a-zA-Z0-9]/.test(text[i])) {
      count++;
      while (i < text.length && /[a-zA-Z0-9]/.test(text[i])) i++;
    } else {
      count++;
      i++;
    }
  }
  return count;
}

function countWordUnits(text: string): number {
  let count = 0;
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }
    if (/[a-zA-Z0-9]/.test(text[i])) {
      count++;
      while (i < text.length && /[a-zA-Z0-9]/.test(text[i])) i++;
    } else if (isCJK(text[i])) {
      count++;
      i++;
    } else {
      i++;
    }
  }
  return count;
}

function isCJK(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 0x4E00 && code <= 0x9FFF) ||
         (code >= 0x3400 && code <= 0x4DBF) ||
         (code >= 0xF900 && code <= 0xFAFF);
}
