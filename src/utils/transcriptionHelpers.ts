/**
 * 转录辅助函数
 * 用于音视频转录过程中的批次处理和 LLM 跳过判断
 */

import { TRANSCRIPTION_BATCH_CONSTANTS } from '@/constants/transcription';
import type { TranscriptionWord } from '@/types';

// 重新导出类型
export type { TranscriptionWord };

/**
 * 检查词是否以句子结束标点结尾
 * @param word - 单词文本
 * @returns 是否以标点结尾
 */
export const hasEndingPunctuation = (word: string): boolean => {
  const endings = ['.', '!', '?', '。', '！', '？', '...', '…'];
  return endings.some(ending => word.endsWith(ending));
};

/**
 * 检查批次第一个词前面是否有停顿
 * @param firstWord - 批次第一个词
 * @param words - 所有单词数组
 * @param threshold - 停顿阈值（秒）
 * @returns 是否有停顿
 */
export const hasPauseBefore = (
  firstWord: TranscriptionWord,
  words: TranscriptionWord[],
  threshold: number
): boolean => {
  const idx = words.indexOf(firstWord);
  if (idx === 0) return true; // 第一个词，前面默认有停顿

  const prevWord = words[idx - 1];
  const gap = firstWord.start - prevWord.end;
  return gap > threshold;
};

/**
 * 判断是否可以跳过 LLM 处理
 * @param wordsInBatch - 批次中的单词
 * @param pauseFound - 是否找到停顿
 * @param pauseGap - 停顿时长
 * @param startIdx - 批次在 allWords 中的起始索引
 * @param allWords - 所有单词数组
 * @returns 是否可以跳过 LLM
 */
export const shouldSkipLLM = (
  wordsInBatch: TranscriptionWord[],
  pauseFound: boolean,
  pauseGap: number,
  startIdx: number,
  allWords: TranscriptionWord[]
): boolean => {
  const PAUSE_THRESHOLD = TRANSCRIPTION_BATCH_CONSTANTS.PAUSE_THRESHOLD;
  const wordCount = wordsInBatch.length;

  // 场景 1: 极短片段 (1-2 个词) + 前后都有停顿
  if (wordCount <= TRANSCRIPTION_BATCH_CONSTANTS.VERY_SHORT_WORD_COUNT && pauseFound && pauseGap > PAUSE_THRESHOLD) {
    const hasPause = hasPauseBefore(wordsInBatch[0], allWords, PAUSE_THRESHOLD);
    if (hasPause) {
      return true;
    }
  }

  // 场景 2: 完整句子（以标点结尾）+ 后面有停顿 + 长度不超过 COMPLETE_SENTENCE_WORD_COUNT 词
  const lastWord = wordsInBatch[wordCount - 1];
  if (hasEndingPunctuation(lastWord.text) && pauseFound && wordCount <= TRANSCRIPTION_BATCH_CONSTANTS.COMPLETE_SENTENCE_WORD_COUNT) {
    return true;
  }

  // 场景 3: 短片段 (3-SHORT_WORD_COUNT 个词) + 前后都有长停顿
  if (wordCount <= TRANSCRIPTION_BATCH_CONSTANTS.SHORT_WORD_COUNT && wordCount > TRANSCRIPTION_BATCH_CONSTANTS.VERY_SHORT_WORD_COUNT && pauseFound && pauseGap > PAUSE_THRESHOLD) {
    const hasPause = hasPauseBefore(wordsInBatch[0], allWords, PAUSE_THRESHOLD);
    if (hasPause) {
      return true;
    }
  }

  return false;
};
