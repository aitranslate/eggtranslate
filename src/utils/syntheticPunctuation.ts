import type { NormalizedWordToken } from '@/types/transcription';

const SENTENCE_GAP_SEC = 2.0;
const MIN_WORDS_PER_SENTENCE = 4;
const EXISTING_PUNCTUATION = new Set([',', ';', ':', '.', '!', '?', '，', '；', '：', '。', '！', '？']);

export function insertSyntheticPunctuation(words: NormalizedWordToken[]): NormalizedWordToken[] {
  const result: NormalizedWordToken[] = [];
  let wordsSinceLastBreak = 0;

  for (let i = 0; i < words.length; i++) {
    const word = { ...words[i] };
    result.push(word);
    wordsSinceLastBreak++;

    const hasExistingPunct = EXISTING_PUNCTUATION.has(word.text[word.text.length - 1]);
    if (hasExistingPunct) {
      wordsSinceLastBreak = 0;
      continue;
    }

    // 检查与下一个词的间隔
    if (i + 1 < words.length) {
      const gap = words[i + 1].start - word.end;
      if (gap >= SENTENCE_GAP_SEC && wordsSinceLastBreak >= MIN_WORDS_PER_SENTENCE) {
        word.text += '.';
        wordsSinceLastBreak = 0;
      }
    }
  }

  return result;
}
