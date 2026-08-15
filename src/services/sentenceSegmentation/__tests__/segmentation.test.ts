// DP 断句模块的回归测试 —— 移植自 D:\voxtrans 的 sentence_boundary/tests.rs。
//
// voxtrans 的 tests 部分是两步流水线（Layer1 硬切分 build_deterministic_sentence_spans
// + Layer2 DP subtitle_layout）。本模块同样两层：splitTextToSentences（Layer1，对应
// 硬切分）与 segmentWords / splitSpanByDp（Layer1+Layer2 全流水线，对应 build_source_
// sentences_from_words_with_progress）。下面按这两层分别移植对应用例。

import { describe, it, expect } from 'vitest';
import { segmentText, segmentWords } from '../index';
import { splitTextToSentences } from '../hardSplit';
import { isQualityCutBoundary, splitSpanByDp } from '../softSplit';
import { getProfile, joinTokenTexts, tokenize } from '../profiles';
import {
  isFunctionWordLeft,
  isJapaneseOrthographicBind,
  isPhraseCloseParticle,
  stripToken,
} from '../textRules';
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
    // 词 cap=12 + 字符 cap=66：长句必多段；逗号处仍应作为优质切点出现
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs.some((s) => s.text.includes('review,'))).toBe(true);
    for (const s of segs) {
      const words = s.text.split(/\s+/).filter(Boolean).length;
      if (s.words.length > 1) {
        expect(words).toBeLessThanOrEqual(12);
        expect(s.text.length).toBeLessThanOrEqual(66);
      }
    }
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
    // 硬上限下可多段；首段仍止于 "review,"
    const first = tokens.slice(ranges[0][0], ranges[0][1] + 1).map((t) => t.word).join(' ');
    expect(first.endsWith('review,')).toBe(true);
    expect(ranges.length).toBeGreaterThanOrEqual(2);
    for (const [a, b] of ranges) {
      expect(b - a + 1).toBeLessThanOrEqual(12);
    }
  });

  it('force_path_en_short_far_over_grace_each_seg_leq_12', () => {
    // 30 词无标点 > 12+2 → 强制切，每段 ≤12
    const words = mkWords(
      Array.from({ length: 30 }, (_, i) => `word${i}`).join(' '),
    );
    const segs = segmentWords(words, 'en', 'short');
    expect(segs.length).toBeGreaterThan(1);
    for (const s of segs) {
      expect(s.words.length).toBeLessThanOrEqual(12);
    }
  });

  it('grace_keeps_13_words_when_no_good_cut_short_limit_12', () => {
    // 13 词、无逗号/连词 → 略超 short=12，整句保留（翻译质量）
    const words = mkWords(
      'one two three four five six seven eight nine ten eleven twelve thirteen',
    );
    const segs = segmentWords(words, 'en', 'short');
    expect(segs).toHaveLength(1);
    expect(segs[0].words.length).toBe(13);
  });

  it('good_comma_cut_splits_even_inside_grace_band', () => {
    // 13 词但中间有逗号 → 有好切点，应按 limit 切开（不整句赖 grace）
    const words = mkWords(
      'one two three four five six seven, eight nine ten eleven twelve thirteen',
    );
    const segs = segmentWords(words, 'en', 'short');
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs[0].text.endsWith('seven,') || segs[0].text.includes('seven,')).toBe(true);
    for (const s of segs) {
      expect(s.words.length).toBeLessThanOrEqual(12);
    }
  });

  it('force_path_zh_short_far_over_grace', () => {
    // 模拟 ASR：单字/双字 token，总计远超 16+2
    const tokens = [
      '我', '们', '今天', '要', '讨', '论', '的', '是', '关', '于',
      '人', '工', '智', '能', '在', '教', '育', '领', '域', '的',
      '应', '用', '前', '景', '和', '发', '展', '趋', '势',
    ];
    const words = tokens.map((t, i) => w(i, t));
    const segs = segmentWords(words, 'zh', 'short');
    expect(segs.length).toBeGreaterThan(1);
    for (const s of segs) {
      const chars = [...s.text].filter((ch) => /[\u4e00-\u9fff]/.test(ch)).length;
      if (s.words.length > 1) {
        expect(chars).toBeLessThanOrEqual(16);
      }
    }
  });

  it('latin_char_cap_splits_url_dense_line_under_word_limit', () => {
    // 用户反馈：词数仅 11（≤ short=12）但含长 URL/邮箱，显示字符 ~90 ≫ 66
    const text =
      "Definitely buy it@sistersmacha.com that's sistersmacha.com and alrighty, back to the show.";
    const segs = segmentWords(mkWords(text), 'en', 'short');
    expect(segs.length).toBeGreaterThanOrEqual(2);
    for (const s of segs) {
      if (s.words.length > 1) {
        expect(s.text.length).toBeLessThanOrEqual(66 + 11); // hard 目标 66；force 路径应 ≤66
        expect(s.text.length).toBeLessThanOrEqual(66);
      }
    }
  });

  it('normal_prose_under_word_limit_not_cut_by_char_budget', () => {
    // 普通 9 词短句，字符约 44 < 66，不应被字符 cap 误伤
    const text = 'The quick brown fox jumps over the lazy dog.';
    const segs = segmentWords(mkWords(text), 'en', 'short');
    expect(segs).toHaveLength(1);
  });

  it('long_digit_token_counts_toward_char_budget', () => {
    // 词数不多但超长数字/账号推高字符（>66）→ 应在 and 等好处切开
    const text =
      'Please dial 18005551234999887766 and also try 18005559876112233445 for support desk';
    expect(text.length).toBeGreaterThan(66);
    const segs = segmentWords(mkWords(text), 'en', 'short');
    expect(segs.length).toBeGreaterThanOrEqual(2);
    for (const s of segs) {
      if (s.words.length > 1) expect(s.text.length).toBeLessThanOrEqual(66);
    }
  });

  it('force_path_does_not_cut_after_english_function_word', () => {
    const words = mkWords(
      'Then she looked at the sides of the well and noticed they were filled with maps pictures',
    );
    const segs = segmentWords(words, 'en', 'short');
    expect(segs.length).toBeGreaterThan(1);
    for (const s of segs) {
      const last = s.text.trim().split(/\s+/).pop()?.toLowerCase() ?? '';
      expect(['the', 'a', 'an', 'of', 'to', 'at', 'and', 'with']).not.toContain(last);
    }
  });

  it('force_path_keeps_japanese_particle_with_preceding_phrase', () => {
    const tokens = [
      '私', 'は', '駅', 'の', '前', 'で', '友達', 'を', '待って', 'いた',
      'けれど', '雨', 'が', '強く', 'なって', 'きた', 'ので', 'すぐ', '帰った',
    ];
    const segs = segmentWords(tokens.map((t, i) => w(i, t)), 'ja', 'short');
    expect(segs.length).toBeGreaterThan(1);
    for (const s of segs) {
      const firstTok = s.words[0]?.text ?? '';
      expect(['は', 'が', 'を', 'に', 'の']).not.toContain(firstTok);
    }
  });

  it('watchability_merges_latin_orphan_tail_after_word_budget', () => {
    const tokens = [
      'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
      'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
      'or', 'extra', 'bits',
    ];
    const words = tokens.map((t, i) => {
      const start = i * 0.25;
      return { text: t, start, end: start + 0.2 };
    });
    const segs = segmentWords(words, 'en', 'standard', { watchabilityMerge: true });
    expect(segs.some((s) => /^\s*or extra bits\s*$/i.test(s.text))).toBe(false);
    expect(segs[segs.length - 1].text).toMatch(/or extra bits$/i);
  });

  it('single_oversize_cjk_token_stays_intact', () => {
    const words = [w(0, '这是一个超过十六个汉字限制的超长识别单元示例词')];
    const segs = segmentWords(words, 'zh', 'short');
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe(words[0].text);
  });

  it('korean_joins_eojeol_tokens_with_spaces', () => {
    const profile = getProfile('ko');
    expect(profile.joinWithSpace).toBe(true);
    expect(profile.isCharBased).toBe(true);
    const text = joinTokenTexts(['국방부가', '촛불', '위수령을', '검토했다는'], profile);
    expect(text).toBe('국방부가 촛불 위수령을 검토했다는');
  });

  it('korean_particle_suffix_eojeol_is_not_a_quality_cut', () => {
    const tokens = [
      { word: '국방부가', start: 0, end: 0.4 },
      { word: '촛불', start: 0.4, end: 0.7 },
    ];
    expect(isPhraseCloseParticle('국방부가')).toBe(false);
    expect(isPhraseCloseParticle('가')).toBe(true);
    expect(isQualityCutBoundary(tokens, 0, getProfile('ko'), undefined)).toBe(false);
  });

  it('japanese_standalone_particle_remains_a_quality_cut', () => {
    const tokens = [
      { word: '友達', start: 0, end: 0.3 },
      { word: 'を', start: 0.3, end: 0.4 },
      { word: '待って', start: 0.4, end: 0.8 },
    ];
    expect(isPhraseCloseParticle('を')).toBe(true);
    expect(isQualityCutBoundary(tokens, 1, getProfile('ja'), undefined)).toBe(true);
  });

  it('japanese_small_kana_and_chōonpu_stay_bound', () => {
    expect(isJapaneseOrthographicBind('ニ', 'ュ')).toBe(true);
    expect(isJapaneseOrthographicBind('ュ', 'ー')).toBe(true);
    expect(isJapaneseOrthographicBind('待っ', 'て')).toBe(true);
    const tokens = [
      '10', '時', 'の', 'NHK', 'ニ', 'ュ', 'ー', 'ス', 'です。',
      '中国', 'の', '習', '近', '平', '国', '家', '主', '席', 'は',
    ];
    const segs = segmentWords(tokens.map((t, i) => w(i, t)), 'ja', 'short');
    const joined = segs.map((s) => s.text).join('|');
    expect(joined).not.toMatch(/ニ\|/);
    expect(joined).not.toMatch(/\|ー/);
    expect(joined).not.toMatch(/\|ュ/);
  });

  it('does_not_cut_inside_zh_bound_connector', () => {
    const tokens = [
      '我', '不', '知', '道', '有', '多', '少', '中', '国', '人', '只',
      '因为', '这', '不', '痛', '不', '痒', '的', '头', '发', '而',
      '吃', '苦', '受', '难', '灭', '亡。',
    ];
    const segs = segmentWords(tokens.map((t, i) => w(i, t)), 'zh', 'short');
    expect(segs.some((s) => s.text.endsWith('只'))).toBe(false);
    expect(segs.some((s) => /只因为/.test(s.text))).toBe(true);
  });

  it('alice_well_sentence_does_not_end_on_of', () => {
    const text =
      'Then she looked at the sides of the well, and noticed that they were filled with cupboards and bookshelves.';
    const segs = segmentWords(mkWords(text), 'en', 'standard');
    for (const s of segs) {
      const last = s.text.trim().split(/\s+/).pop()?.toLowerCase() ?? '';
      expect(['of', 'the', 'a', 'and']).not.toContain(last);
    }
  });

  it('french_spaced_u35_does_not_cut_after_function_word', () => {
    const profile = getProfile('fr');
    expect(profile.joinWithSpace).toBe(true);
    expect(profile.connectors).toContain('mais');
    expect(profile.functionWordsLeft).toContain('le');
    const tokens = [
      'Le', 'président', 'a', 'parlé', 'de', 'la', 'situation', 'économique',
      'dans', 'le', 'pays', 'et', 'les', 'mesures', 'que', 'le', 'gouvernement',
      'veut', 'prendre', 'pour', 'aider', 'les', 'citoyens',
    ];
    const segs = segmentWords(tokens.map((t, i) => w(i, t)), 'fr', 'short');
    expect(segs.length).toBeGreaterThan(1);
    expect(segs.every((s) => /\s/.test(s.text))).toBe(true);
    for (const s of segs) {
      const last = s.text.trim().split(/\s+/).pop()?.toLowerCase() ?? '';
      expect(['le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'et']).not.toContain(last);
    }
  });

  it('spanish_prefers_cut_before_pero', () => {
    const tokens = [
      'El', 'gobierno', 'anunció', 'medidas', 'nuevas', 'para', 'la', 'economía',
      'pero', 'los', 'expertos', 'creen', 'que', 'todavía', 'falta', 'mucho',
      'trabajo', 'serio',
    ];
    const segs = segmentWords(tokens.map((t, i) => w(i, t)), 'es', 'short');
    expect(segs.length).toBeGreaterThan(1);
    expect(segs.some((s) => /^pero\b/i.test(s.text))).toBe(true);
  });

  it('german_profile_is_spaced_with_article_guard', () => {
    const profile = getProfile('de');
    expect(profile.joinWithSpace).toBe(true);
    expect(profile.functionWordsLeft).toContain('der');
    expect(profile.connectors).toContain('und');
    const tokens = [
      'Der', 'Kanzler', 'sprach', 'über', 'die', 'Lage', 'in', 'dem', 'Land',
      'und', 'die', 'Bürger', 'warten', 'auf', 'eine', 'klare', 'Antwort',
      'von', 'der', 'Regierung',
    ];
    const segs = segmentWords(tokens.map((t, i) => w(i, t)), 'de', 'short');
    expect(segs.length).toBeGreaterThan(1);
    for (const s of segs) {
      const last = s.text.trim().split(/\s+/).pop()?.toLowerCase() ?? '';
      expect(['der', 'die', 'das', 'den', 'dem', 'ein', 'eine', 'und', 'von']).not.toContain(last);
    }
  });

  it('hindi_strip_keeps_matra_so_ka_matches', () => {
    expect(stripToken('का')).toBe('का');
    expect(stripToken('तो,')).toBe('तो');
    const extras = getProfile('hi').functionWordsLeft;
    expect(isFunctionWordLeft('का', extras)).toBe(true);
    expect(isFunctionWordLeft('तो', extras)).toBe(true);
  });

  it('hindi_does_not_end_a_cue_on_ka_or_to', () => {
    // 语料 25-hi-dosakhiyan words 397–399 曾切成「संसार का | सबसे」
    const tokens = [
      'लेकिन', 'संसार', 'का', 'सबसे', 'रूपवान', 'पुरुष', 'भी', 'मेरे',
      'चित', 'को', 'आकरशित', 'नहीं', 'कर', 'सकता।',
      'अब', 'वही', 'मेरे', 'सर्वस्व', 'है',
    ];
    const segs = segmentWords(tokens.map((t, i) => w(i, t)), 'hi', 'short');
    expect(segs.length).toBeGreaterThan(1);
    const banned = new Set(['का', 'की', 'के', 'को', 'तो', 'में', 'से']);
    for (const s of segs) {
      const last = stripToken(s.text.trim().split(/\s+/).pop() ?? '');
      expect(banned.has(last)).toBe(false);
    }
    expect(segs.some((s) => /संसार का सबसे/.test(s.text))).toBe(true);
  });

  it('zh_de_is_phrase_close_not_function_forbid', () => {
    expect(isPhraseCloseParticle('的')).toBe(true);
    expect(isPhraseCloseParticle('了')).toBe(true);
    expect(isFunctionWordLeft('的')).toBe(false);
    const tokens = [
      { word: '风', start: 0, end: 0.2 },
      { word: '的', start: 0.2, end: 0.35 },
      { word: '形', start: 0.35, end: 0.5 },
    ];
    expect(isQualityCutBoundary(tokens, 1, getProfile('zh'), undefined)).toBe(true);
  });

  it('zh_prefers_cut_after_de_not_before', () => {
    const tokens = [
      '这', '件', '事', '情', '已', '经', '说', '明', '了', '台', '风', '的',
      '涡', '旋', '形', '状', '是', '如', '何', '形', '成', '的',
    ];
    const segs = segmentWords(tokens.map((t, i) => w(i, t)), 'zh', 'short');
    expect(segs.length).toBeGreaterThan(1);
    expect(segs.some((s) => s.words[s.words.length - 1]?.text === '的')).toBe(true);
    expect(segs.every((s) => s.words[0]?.text !== '的')).toBe(true);
  });

  it('cjk_force_cut_prefers_pause_over_abutting_chars', () => {
    const tokens: WordWithTime[] = [];
    let t = 0;
    for (let i = 0; i < 20; i++) {
      const ch = '甲乙丙丁戊己庚辛壬癸'[i % 10]!;
      if (i === 8) t += 0.45;
      tokens.push({ text: ch, start: t, end: t + 0.12 });
      t += 0.12;
    }
    const segs = segmentWords(tokens, 'zh', 'short');
    expect(segs.length).toBeGreaterThan(1);
    expect(segs.some((s) => s.wordEnd === 7)).toBe(true);
  });

  it('cjk_connector_is_preferred_cut_before', () => {
    const profile = getProfile('zh');
    expect(profile.connectors).toContain('但是');
    // 左词不能是「了/的」等禁切功能词，否则 FORBIDDEN 会压过连词奖励。
    const tokens = [
      '前', '面', '这', '些', '内', '容', '都', '已', '经', '处', '理', '完',
      '但是', '后', '面', '还', '有', '很', '多', '问', '题', '需', '要', '讨', '论',
    ];
    const segs = segmentWords(tokens.map((t, i) => w(i, t)), 'zh', 'short');
    expect(segs.length).toBeGreaterThan(1);
    expect(segs.some((s) => s.text.startsWith('但是'))).toBe(true);
  });
});
