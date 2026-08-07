// DP 断句模块总入口 —— Layer1 硬切分 + Layer2 DP 软切分（硬上限 = 设置值）。

import { getProfile, joinTokenTexts, tokenize } from './profiles';
import { splitTextToSentences, mapSentencesToWordRanges } from './hardSplit';
import { splitSpanByDp } from './softSplit';
import { mergeWatchabilitySegments } from './watchabilityMerge';
import type { DpSegment, Preset, Segment, SilenceQuery, WordToken, WordWithTime } from './types';

export { mergeWatchabilitySegments } from './watchabilityMerge';
export { WORD_LIMITS, CJK_CHAR_LIMITS, getProfile, joinTokenTexts } from './profiles';

/**
 * 纯文本断句（复刻 / 离线测试用，不带 VAD 静音信息）。
 */
export function segmentText(text: string, lang: string, preset: Preset = 'standard'): Segment[] {
  const profile = getProfile(lang);
  const limit = profile.sourceLimit(preset);
  const sentences = splitTextToSentences(text, lang);
  const out: Segment[] = [];

  for (const sentence of sentences) {
    const tokens = tokenize(sentence, profile);
    if (tokens.length === 0) continue;
    const ranges = splitSpanByDp(tokens, profile, limit);
    const split = ranges.length > 1;
    for (const [a, b] of ranges) {
      out.push({
        text: joinTokenTexts(
          tokens.slice(a, b + 1).map((t) => t.word),
          profile
        ),
        reason: split ? 'subtitle-layout' : 'hard',
      });
    }
  }
  return out;
}

/**
 * 音频流转录（带单词级时间戳）断句。
 * words 的 start/end 单位为秒；产出 startTime/endTime 为毫秒。
 * 切分仅在 ASR token 边界；硬上限 = preset 设置值。
 */
export function segmentWords(
  words: WordWithTime[],
  lang: string,
  preset: Preset = 'standard',
  options: { watchabilityMerge?: boolean } = {},
): DpSegment[] {
  if (words.length === 0) return [];
  const profile = getProfile(lang);
  const limit = profile.sourceLimit(preset);

  // Layer1：硬切分用空格拼接（与 mapSentencesToWordRanges 对齐）
  const text = words.map((w) => w.text).join(' ');
  const sentences = splitTextToSentences(text, lang);
  const ranges = mapSentencesToWordRanges(sentences, words);

  const out: DpSegment[] = [];
  for (const [ws, we] of ranges) {
    const slice = words.slice(ws, we + 1);
    const tokens: WordToken[] = slice.map((w) => ({
      word: w.text,
      start: w.start,
      end: w.end,
    }));

    const silence: SilenceQuery = (left, right) => {
      if (left.end == null || right.start == null) return null;
      const gap = right.start - left.end;
      return gap > 0 ? gap : null;
    };

    // Layer2：硬上限 = limit（不再 × 1.15）
    const dpRanges = splitSpanByDp(tokens, profile, limit, 1.0, silence);
    for (const [a, b] of dpRanges) {
      const segWords = slice.slice(a, b + 1);
      out.push({
        text: joinTokenTexts(
          segWords.map((w) => w.text),
          profile
        ),
        startTime: Math.round(segWords[0].start * 1000),
        endTime: Math.round(segWords[segWords.length - 1].end * 1000),
        wordStart: ws + a,
        wordEnd: ws + b,
        words: segWords,
      });
    }
  }

  return options.watchabilityMerge
    ? mergeWatchabilitySegments(out, lang, preset)
    : out;
}
