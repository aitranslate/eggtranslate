// DP 断句模块总入口 —— 复刻 D:\voxtrans 的两层流水线。
//
// 两条入口：
//   1. segmentText(text, lang, preset)   纯文本路径（复刻/测试用，无 VAD）。
//      拼接文本 → sentence-splitter / 标点硬切分 → 超长句跑 DP（按空格分词）。
//   2. segmentWords(words, lang, preset)  音频流集成（带单词级时间戳 + VAD）。
//      拼接文本 → 硬切分 → 映射回单词区间 → 每个超长区间跑 DP（用时间戳算 VAD
//      静音代价）→ 产出带毫秒时间戳的 DpSegment[]。
//
// 两条路径在"硬切分 + DP 软切分"上完全一致，区别仅在于是否带时间戳/VAD。

import { KEEP_INTACT_RATIO } from './constants';
import { getProfile, tokenize } from './profiles';
import { splitTextToSentences, mapSentencesToWordRanges } from './hardSplit';
import { splitSpanByDp } from './softSplit';
import type { DpSegment, Preset, Segment, SilenceQuery, WordToken, WordWithTime } from './types';

/** 把一组 token 切片拼成文本。 */
function joinTokens(tokens: WordToken[]): string {
  return tokens.map((t) => t.word).join(' ');
}

/**
 * 纯文本断句（复刻 / 离线测试用，不带 VAD 静音信息）。
 * 返回每段文本 + 切分原因（硬切分 / DP 软切分）。
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
        text: joinTokens(tokens.slice(a, b + 1)),
        reason: split ? 'subtitle-layout' : 'hard',
      });
    }
  }
  return out;
}

/**
 * 音频流转录（带单词级时间戳）断句。
 * words 的 start/end 单位为秒；产出 startTime/endTime 为毫秒。
 */
export function segmentWords(
  words: WordWithTime[],
  lang: string,
  preset: Preset = 'standard',
): DpSegment[] {
  if (words.length === 0) return [];
  const profile = getProfile(lang);
  const limit = profile.sourceLimit(preset);

  // Layer1：把整段转录文本硬切分成句子。
  const text = words.map((w) => w.text).join(' ');
  const sentences = splitTextToSentences(text, lang);

  // 把句子映射回单词下标区间。
  const ranges = mapSentencesToWordRanges(sentences, words);

  const out: DpSegment[] = [];
  for (const [ws, we] of ranges) {
    const slice = words.slice(ws, we + 1);
    const tokens: WordToken[] = slice.map((w) => ({ word: w.text, start: w.start, end: w.end }));

    // VAD：相邻单词之间的静音秒数（右 start - 左 end），≤0 视为无静音。
    const silence: SilenceQuery = (left, right) => {
      if (left.end == null || right.start == null) return null;
      const gap = right.start - left.end;
      return gap > 0 ? gap : null;
    };

    // Layer2：超长句跑 DP（带 VAD）。
    const dpRanges = splitSpanByDp(tokens, profile, limit, KEEP_INTACT_RATIO, silence);
    for (const [a, b] of dpRanges) {
      const segWords = slice.slice(a, b + 1);
      out.push({
        text: segWords.map((w) => w.text).join(' '),
        startTime: Math.round(segWords[0].start * 1000),
        endTime: Math.round(segWords[segWords.length - 1].end * 1000),
        wordStart: ws + a,
        wordEnd: ws + b,
        words: segWords,
      });
    }
  }
  return out;
}
