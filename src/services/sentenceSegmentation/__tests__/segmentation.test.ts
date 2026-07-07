// DP 断句模块的回归测试 —— 移植自 D:\voxtrans 的 sentence_boundary/tests.rs。
//
// voxtrans 的 tests 部分是两步流水线（Layer1 硬切分 build_deterministic_sentence_spans
// + Layer2 DP subtitle_layout）。本模块同样两层：splitTextToSentences（Layer1，对应
// 硬切分）与 segmentWords / splitSpanByDp（Layer1+Layer2 全流水线，对应 build_source_
// sentences_from_words_with_progress）。下面按这两层分别移植对应用例。

import { describe, it, expect } from 'vitest';
import { segmentText, segmentWords } from '../index';
import { splitTextToSentences } from '../hardSplit';
import { splitSpanByDp } from '../softSplit';
import { getProfile, tokenize } from '../profiles';
import type { WordWithTime } from '../types';

/** voxtrans 的 w(index, text)：start=index*0.5, end=start+0.3（秒）。 */
function w(index: number, text: string): WordWithTime {
  const start = index * 0.5;
  return { text, start, end: start + 0.3 };
}

/** 把一段文本按空格拆成带均匀时间戳的单词序列。 */
function mkWords(text: string): WordWithTime[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((t, i) => w(i, t));
}

// ---- Layer1：硬切分（splitTextToSentences）----

describe('Layer1 硬切分', () => {
  it('deterministic_spans_split_on_terminal_punctuation', () => {
    const sentences = splitTextToSentences('Hello world. Next sentence?', 'en');
    expect(sentences).toEqual(['Hello world.', 'Next sentence?']);
  });

  it('soft_punctuation_does_not_create_extra_split', () => {
    const tokens = Array.from({ length: 45 }, (_, i) => (i === 29 ? 'checkpoint,' : 'word'));
    const sentences = splitTextToSentences(tokens.join(' '), 'en');
    // 逗号不构成句子边界，整段为一句（与 voxtrans 的 deterministic span (0,44) 一致）。
    expect(sentences).toHaveLength(1);
  });

  it('abbreviation_terminal_punctuation_does_not_split', () => {
    const sentences = splitTextToSentences('Mr. Smith arrived.', 'en');
    expect(sentences).toEqual(['Mr. Smith arrived.']);
  });

  it('single_letter_enumeration_token_forces_split', () => {
    const sentences = splitTextToSentences('step one B. So let us go.', 'en');
    expect(sentences).toEqual(['step one B.', 'So let us go.']);
  });

  it('consecutive_single_letter_initials_chain_only_protects_internal_pair', () => {
    const sentences = splitTextToSentences('J. K. Rowling', 'en');
    expect(sentences).toEqual(['J. K.', 'Rowling']);
  });

  it('broad_terminal_punctuation_splits_other_languages', () => {
    const sentences = splitTextToSentences('你好． Next⁉ Again', 'zh');
    expect(sentences).toEqual(['你好．', 'Next⁉', 'Again']);
  });

  it('terminal_punctuation_still_splits_long_runs', () => {
    const text =
      'This long sentence has no useful internal punctuation it keeps running through several separate ideas the recognizer only produced a final period';
    const tokens = text.split(/\s+/);
    tokens[6] = 'punctuation.';
    const sentences = splitTextToSentences(tokens.join(' '), 'en');
    expect(sentences).toHaveLength(2);
    expect(sentences[0]).toContain('punctuation.');
  });
});

// ---- Layer1 + Layer2：完整断句流水线（segmentWords）----

describe('Layer1+Layer2 完整断句', () => {
  it('local_subtitle_layout_splits_long_semantic_sentence_near_punctuation', () => {
    const text =
      'Today the local transcription pipeline keeps complete semantic sentences for accurate review, but it should split long subtitle lines near punctuation for comfortable offline viewing.';
    const segs = segmentWords(mkWords(text), 'en', 'short');
    expect(segs).toHaveLength(2);
    expect(segs[0].text).toBe(
      'Today the local transcription pipeline keeps complete semantic sentences for accurate review,',
    );
    expect(segs[1].text).toBe(
      'but it should split long subtitle lines near punctuation for comfortable offline viewing.',
    );
  });

  it('dp_does_not_isolate_leading_discourse_marker', () => {
    const body = [
      'the', 'first', 'step', 'is', 'basically', 'determining', 'your',
      'directional', 'bias', 'and', 'your', 'drawn', 'liquidity', 'on',
      'the', 'daily', 'time', 'frame.',
    ];
    const words = [w(0, 'Now,'), ...body.map((t, i) => w(i + 1, t))];
    const segs = segmentWords(words, 'en', 'short');
    // 不允许出现单独的 "Now," 行，且首行必须以 "Now," 开头。
    expect(segs.some((s) => s.text.trim() === 'Now,')).toBe(false);
    expect(segs[0].text.startsWith('Now,')).toBe(true);
  });

  it('dp_absorbs_trailing_short_fragment', () => {
    const tokens = [
      'this', 'is', 'a', 'long', 'unpunctuated', 'run', 'of', 'words', 'that',
      'must', 'be', 'split', 'into', 'two', 'parts', 'now',
    ];
    const words = tokens.map((t, i) => w(i, t));
    const segs = segmentWords(words, 'en', 'short');
    const last = segs[segs.length - 1];
    expect(last.text.split(/\s+/).length).toBeGreaterThan(2);
  });

  it('short_sentence_with_vad_pause_stays_intact', () => {
    const words: WordWithTime[] = [
      { text: 'Before', start: 0.0, end: 0.2 },
      { text: 'pause', start: 0.3, end: 0.5 },
      { text: 'after', start: 2.8, end: 3.0 },
      { text: 'pause', start: 3.1, end: 3.3 },
    ];
    const segs = segmentWords(words, 'en', 'short');
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe('Before pause after pause');
  });

  it('vad_sustains_segmentation_when_punctuation_stripped', () => {
    // 20 个无标点词，词9→词10 之间有 1.1s 静音（short preset limit=12，超长必切）。
    const words: WordWithTime[] = Array.from({ length: 20 }, (_, i) => {
      const t = i as number;
      if (i < 10) return { text: `w${i}`, start: t, end: t + 0.4 };
      return { text: `w${i}`, start: t + 1.5, end: t + 1.9 };
    });
    const segs = segmentWords(words, 'en', 'short');
    // DP 应在 VAD 静音处（词9 之后）产生切分。
    expect(segs.some((s) => s.wordEnd === 9)).toBe(true);
  });

  it('segmentText_pure_path_splits_terminal_punctuation', () => {
    const segs = segmentText('Hello world. Next sentence?', 'en', 'standard');
    expect(segs.map((s) => s.text)).toEqual(['Hello world.', 'Next sentence?']);
  });
});

// ---- Layer2 单元：splitSpanByDp（与 voxtrans subtitle_layout 直接对应）----

describe('splitSpanByDp 单元', () => {
  it('keeps_intact_when_under_budget', () => {
    const profile = getProfile('en');
    const tokens = tokenize('All right in this video we are talking about habits.', profile);
    const ranges = splitSpanByDp(tokens, profile, profile.sourceLimit('standard'));
    expect(ranges).toEqual([[0, tokens.length - 1]]);
  });

  it('splits_overlong_span_near_comma', () => {
    const profile = getProfile('en');
    const text =
      'Today the local transcription pipeline keeps complete semantic sentences for accurate review, but it should split long subtitle lines near punctuation for comfortable offline viewing.';
    const tokens = tokenize(text, profile);
    const ranges = splitSpanByDp(tokens, profile, profile.sourceLimit('short'));
    // 应切成两段，第一段止于 "review,"。
    const first = tokens.slice(ranges[0][0], ranges[0][1] + 1).map((t) => t.word).join(' ');
    expect(first.endsWith('review,')).toBe(true);
    expect(ranges.length).toBe(2);
  });
});
