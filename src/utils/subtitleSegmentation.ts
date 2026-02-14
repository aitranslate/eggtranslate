export interface AssemblyAISentence {
  text: string;
  start: number;
  end: number;
}

export enum LanguageType {
  LATIN = 'latin',
  CJK = 'cjk'
}

const LANGUAGE_TYPE_MAP: Record<string, LanguageType> = {
  'zh': LanguageType.CJK, 'ja': LanguageType.CJK, 'ko': LanguageType.CJK, 'my': LanguageType.CJK,
  'km': LanguageType.CJK, 'lo': LanguageType.CJK, 'th': LanguageType.CJK, 'bo': LanguageType.CJK,
  'en': LanguageType.LATIN, 'en_au': LanguageType.LATIN, 'en_uk': LanguageType.LATIN, 'en_us': LanguageType.LATIN,
  'es': LanguageType.LATIN, 'fr': LanguageType.LATIN, 'de': LanguageType.LATIN, 'it': LanguageType.LATIN,
  'pt': LanguageType.LATIN, 'ru': LanguageType.LATIN, 'nl': LanguageType.LATIN, 'fi': LanguageType.LATIN,
  'pl': LanguageType.LATIN, 'uk': LanguageType.LATIN, 'cs': LanguageType.LATIN, 'da': LanguageType.LATIN,
  'et': LanguageType.LATIN, 'el': LanguageType.LATIN, 'hu': LanguageType.LATIN, 'is': LanguageType.LATIN,
  'no': LanguageType.LATIN, 'nn': LanguageType.LATIN, 'ro': LanguageType.LATIN, 'sk': LanguageType.LATIN,
  'sl': LanguageType.LATIN, 'sv': LanguageType.LATIN, 'hi': LanguageType.LATIN, 'vi': LanguageType.LATIN,
  'id': LanguageType.LATIN, 'ms': LanguageType.LATIN, 'tl': LanguageType.LATIN, 'jv': LanguageType.LATIN,
  'ar': LanguageType.LATIN, 'fa': LanguageType.LATIN, 'he': LanguageType.LATIN, 'tr': LanguageType.LATIN,
  'ur': LanguageType.LATIN, 'af': LanguageType.LATIN, 'sq': LanguageType.LATIN, 'am': LanguageType.LATIN,
  'hy': LanguageType.LATIN, 'as': LanguageType.LATIN, 'az': LanguageType.LATIN, 'eu': LanguageType.LATIN,
  'be': LanguageType.LATIN, 'bn': LanguageType.LATIN, 'bs': LanguageType.LATIN, 'br': LanguageType.LATIN,
  'bg': LanguageType.LATIN, 'ca': LanguageType.LATIN, 'hr': LanguageType.LATIN, 'fo': LanguageType.LATIN,
  'gl': LanguageType.LATIN, 'ka': LanguageType.LATIN, 'gu': LanguageType.LATIN, 'ht': LanguageType.LATIN,
  'ha': LanguageType.LATIN, 'haw': LanguageType.LATIN, 'lv': LanguageType.LATIN, 'lt': LanguageType.LATIN,
  'lb': LanguageType.LATIN, 'mk': LanguageType.LATIN, 'mg': LanguageType.LATIN, 'ml': LanguageType.LATIN,
  'mt': LanguageType.LATIN, 'mi': LanguageType.LATIN, 'mr': LanguageType.LATIN, 'mn': LanguageType.LATIN,
  'ne': LanguageType.LATIN, 'pa': LanguageType.LATIN, 'ps': LanguageType.LATIN, 'sa': LanguageType.LATIN,
  'sr': LanguageType.LATIN, 'sn': LanguageType.LATIN, 'sd': LanguageType.LATIN, 'si': LanguageType.LATIN,
  'so': LanguageType.LATIN, 'su': LanguageType.LATIN, 'sw': LanguageType.LATIN, 'tg': LanguageType.LATIN,
  'ta': LanguageType.LATIN, 'tt': LanguageType.LATIN, 'te': LanguageType.LATIN, 'tk': LanguageType.LATIN,
  'uz': LanguageType.LATIN, 'cy': LanguageType.LATIN, 'yi': LanguageType.LATIN, 'yo': LanguageType.LATIN,
  'la': LanguageType.LATIN, 'ln': LanguageType.LATIN, 'kn': LanguageType.LATIN, 'kk': LanguageType.LATIN,
  'oc': LanguageType.LATIN, 'ms_MY': LanguageType.LATIN
};

const PUNCTUATION = {
  END: ['.', '!', '?', '\u3002', '\uff01', '\uff1f'],
  MIDDLE: [',', '\u3001', '\uff0c'],
  SPACE: [' ', '\t', '\n']
};

const CONNECTORS: Record<string, string[]> = {
  'en': ['that', 'which', 'where', 'when', 'because', 'but', 'and', 'or'],
  'zh': ['因为', '所以', '但是', '而且', '虽然', '如果', '即使', '尽管'],
  'ja': ['けれども', 'しかし', 'だから', 'それで', 'ので', 'のに', 'ため'],
  'fr': ['que', 'qui', 'où', 'quand', 'mais', 'et'],
  'es': ['que', 'cual', 'donde', 'cuando', 'pero', 'y', 'o'],
  'de': ['dass', 'wo', 'wenn', 'weil', 'aber', 'und'],
  'it': ['che', 'dove', 'quando', 'perché', 'ma', 'e']
};

export function detectLanguageType(languageCode: string): LanguageType {
  return LANGUAGE_TYPE_MAP[languageCode] || LanguageType.LATIN;
}

export function countLatinWords(text: string): number {
  return text.trim().split(/\s+/).filter(w => w).length;
}

export function countCJKChars(text: string): number {
  let count = 0, i = 0;
  while (i < text.length) {
    if (/\d/.test(text[i])) { count++; while (i < text.length && /\d/.test(text[i])) i++; }
    else { count++; i++; }
  }
  return count;
}

export function calculateTextLength(text: string, languageType: LanguageType): number {
  switch (languageType) {
    case LanguageType.LATIN: return countLatinWords(text);
    case LanguageType.CJK: return countCJKChars(text);
    default: return countLatinWords(text);
  }
}

export function getSuggestedMaxLength(languageType: LanguageType): number {
  switch (languageType) {
    case LanguageType.LATIN: return 15;
    case LanguageType.CJK: return 30;
    default: return 15;
  }
}

export function segmentText(
  text: string,
  words: Array<{ text: string; start: number; end: number }>,
  languageCode: string,
  maxLength?: number
): Array<{ text: string; start: number; end: number }> {
  const languageType = detectLanguageType(languageCode);
  const limit = maxLength || getSuggestedMaxLength(languageType);
  const segments: Array<{ text: string; start: number; end: number }> = [];

  let currentSentenceWords: Array<{ text: string; start: number; end: number }> = [];
  let currentSentenceText = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const wordText = word.text;

    const hasLongPause = i > 0 && (word.start - words[i - 1].end) > 2000;
    const hasEndPunct = PUNCTUATION.END.some(p => wordText.includes(p));

    currentSentenceWords.push(word);
    currentSentenceText += (currentSentenceText ? ' ' : '') + wordText;

    if (hasEndPunct || hasLongPause) {
      const sentenceLength = calculateTextLength(currentSentenceText, languageType);

      if (sentenceLength <= limit) {
        segments.push({
          text: currentSentenceText.trim(),
          start: currentSentenceWords[0].start,
          end: currentSentenceWords[currentSentenceWords.length - 1].end
        });
      } else {
        const subSentences = splitByMiddlePunctuation(
          currentSentenceText,
          currentSentenceWords,
          languageCode,
          languageType,
          limit
        );
        segments.push(...subSentences);
      }

      currentSentenceWords = [];
      currentSentenceText = '';
    }
  }

  if (currentSentenceWords.length > 0) {
    const sentenceLength = calculateTextLength(currentSentenceText, languageType);
    if (sentenceLength <= limit) {
      segments.push({
        text: currentSentenceText.trim(),
        start: currentSentenceWords[0].start,
        end: currentSentenceWords[currentSentenceWords.length - 1].end
      });
    } else {
      const subSentences = splitByMiddlePunctuation(
        currentSentenceText,
        currentSentenceWords,
        languageCode,
        languageType,
        limit
      );
      segments.push(...subSentences);
    }
  }

  return segments;
}

function splitByMiddlePunctuation(
  sentenceText: string,
  sentenceWords: Array<{ text: string; start: number; end: number }>,
  languageCode: string,
  languageType: LanguageType,
  maxLength: number
): Array<{ text: string; start: number; end: number }> {
  const result: Array<{ text: string; start: number; end: number }> = [];

  if (!sentenceWords || sentenceWords.length === 0) {
    return result;
  }

  let startPos = 0;
  let startWordIndex = 0;

  while (startPos < sentenceText.length && startWordIndex < sentenceWords.length) {
    // 找到当前段落中所有逗号位置
    const commaPositions: number[] = [];
    for (let i = startPos; i < sentenceText.length; i++) {
      if (PUNCTUATION.MIDDLE.includes(sentenceText[i])) {
        commaPositions.push(i + 1); // 保存逗号后的位置
      }
    }

    // 如果没有逗号了，直接添加剩余部分
    if (commaPositions.length === 0) {
      const remainingText = sentenceText.substring(startPos).trim();
      if (remainingText && startWordIndex < sentenceWords.length) {
        result.push({
          text: remainingText,
          start: sentenceWords[startWordIndex].start,
          end: sentenceWords[sentenceWords.length - 1].end
        });
      }
      break;
    }

    // 遍历所有逗号，找到最接近 maxLength 且不超过的那个
    let bestCommaPos = -1;
    let bestLength = 0;
    let bestEndWordIndex = -1;

    for (const commaPos of commaPositions) {
      const segmentText = sentenceText.substring(startPos, commaPos).trim();
      const segmentWordCount = segmentText.split(/\s+/).length;
      const segmentLength = calculateTextLength(segmentText, languageType);
      const endWordIndex = startWordIndex + segmentWordCount;

      // 检查是否满足条件且比当前最优解更好
      if (
        segmentWordCount > 0 &&
        segmentLength <= maxLength &&
        endWordIndex <= sentenceWords.length &&
        segmentLength > bestLength
      ) {
        bestCommaPos = commaPos;
        bestLength = segmentLength;
        bestEndWordIndex = endWordIndex;
      }
    }

    // 如果找到合适的逗号，添加分段
    if (bestCommaPos !== -1 && bestEndWordIndex !== -1) {
      const segmentText = sentenceText.substring(startPos, bestCommaPos).trim();
      result.push({
        text: segmentText,
        start: sentenceWords[startWordIndex].start,
        end: sentenceWords[bestEndWordIndex - 1].end
      });

      startPos = bestCommaPos;
      startWordIndex = bestEndWordIndex;
    } else {
      // 没有合适的逗号，添加剩余部分
      const remainingText = sentenceText.substring(startPos).trim();
      if (remainingText && startWordIndex < sentenceWords.length) {
        result.push({
          text: remainingText,
          start: sentenceWords[startWordIndex].start,
          end: sentenceWords[sentenceWords.length - 1].end
        });
      }
      break;
    }
  }

  return result;
}
