import type { NormalizedWordToken } from '@/types/transcription';

const CURRENCY_SYMBOLS = new Set(['$', '€', '£', '¥', '₹']);
const UNIT_SUFFIXES = new Set([
  'k', 'm', 'b', 't', 'x', 's', 'ms',
  'kg', 'g', 'mg', 'lb', 'lbs',
  'km', 'cm', 'mm', 'ft', 'in',
  'h', 'hr', 'hrs', 'min', 'mins',
  'usd', 'eur', 'gbp', 'jpy', 'cny',
]);

export function normalizeWordTokens(
  words: Array<{ text: string; start: number; end: number }>
): NormalizedWordToken[] {
  const result: NormalizedWordToken[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const text = word.text.trim();
    if (!text) continue;

    const prev = result.length > 0 ? result[result.length - 1] : null;

    // 独立标点 → 附加到前词
    if (prev && isStandalonePunctuation(text) && !isCurrencyPrefix(text)) {
      prev.text += text;
      prev.end = word.end;
      continue;
    }

    // 缩写合并：单字母 + .m./.s./.k.
    if (prev && text.length >= 3 && text.startsWith('.') &&
        prev.text.length === 1 && /[a-zA-Z]/.test(prev.text)) {
      const suffix = text.substring(1).toLowerCase();
      if (['m', 's', 'k'].includes(suffix[0])) {
        prev.text += text;
        prev.end = word.end;
        continue;
      }
    }

    // 数字合并
    if (prev && isDigitString(prev.text) && text.length >= 1) {
      const ch = text[0];
      if ((ch === '.' || ch === ':' || ch === '/' || ch === '-') && text.length > 1 && isDigitString(text.substring(1))) {
        prev.text += text;
        prev.end = word.end;
        continue;
      }
      if (ch === ',' && text.length === 4 && /^\d{3}$/.test(text.substring(1))) {
        prev.text += text;
        prev.end = word.end;
        continue;
      }
    }

    // 货币合并
    if (isCurrencyPrefix(text) && i + 1 < words.length && /^\d/.test(words[i + 1].text)) {
      const next = words[i + 1];
      result.push({ text: text + next.text, start: word.start, end: next.end });
      i++;
      continue;
    }

    // 单位合并
    if (prev && isDigitString(prev.text) && UNIT_SUFFIXES.has(text.toLowerCase())) {
      prev.text += text;
      prev.end = word.end;
      continue;
    }

    result.push({ text, start: word.start, end: word.end });
  }

  return result;
}

function isStandalonePunctuation(text: string): boolean {
  return text.length === 1 && /^[^\w\s]$/.test(text);
}

function isCurrencyPrefix(text: string): boolean {
  return CURRENCY_SYMBOLS.has(text) || /^(EUR|GBP|JPY|CNY|INR)$/i.test(text);
}

function isDigitString(text: string): boolean {
  return /^\d+$/.test(text);
}
