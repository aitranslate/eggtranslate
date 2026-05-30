import type { NormalizedWordToken, SemanticSegment, SegmentationMode } from '@/types/transcription';
import { normalizeWordTokens } from './wordNormalization';
import { insertSyntheticPunctuation } from './syntheticPunctuation';
import { shouldSplitAfterTerminal } from './terminalPunctuation';

const HARD_SPLIT_GAP_MS = 2000; // 2 秒

/**
 * 语义断句主入口
 * @param words ASR 返回的单词级时间戳
 * @param mode 断句模式
 * @returns 语义段落数组
 */
export function semanticSegment(
  words: Array<{ text: string; start: number; end: number }>,
  mode: SegmentationMode
): SemanticSegment[] {
  // 1. 单词规范化
  const normalized = normalizeWordTokens(words);

  // 2. 合成标点
  const punctuated = insertSyntheticPunctuation(normalized);

  // 3. 按句末标点 + 硬停顿断句
  const segments = splitBySemanticBoundaries(punctuated);

  // 4. 仅转录模式：DP 布局断句（TODO: Task 8 实现）
  // if (mode === 'transcribe') { ... }

  return segments;
}

function splitBySemanticBoundaries(words: NormalizedWordToken[]): SemanticSegment[] {
  const segments: SemanticSegment[] = [];
  let segStart = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    let shouldSplit = false;

    // 规则 A：句末标点
    if (shouldSplitAfterTerminal(word.text)) {
      shouldSplit = true;
    }

    // 规则 B：硬停顿（与下一个词的间隔 >= 2 秒）
    if (!shouldSplit && i + 1 < words.length) {
      const gap = (words[i + 1].start - word.end) * 1000; // 转为毫秒
      if (gap >= HARD_SPLIT_GAP_MS) {
        shouldSplit = true;
      }
    }

    // 最后一个词
    if (!shouldSplit && i === words.length - 1) {
      shouldSplit = true;
    }

    if (shouldSplit) {
      const segWords = words.slice(segStart, i + 1);
      segments.push({
        text: segWords.map(w => w.text).join(' ').replace(/\s+([,.!?;:。！？；：])/g, '$1'),
        start: segWords[0].start,
        end: segWords[segWords.length - 1].end,
        wordStart: segStart,
        wordEnd: i,
      });
      segStart = i + 1;
    }
  }

  return segments;
}
