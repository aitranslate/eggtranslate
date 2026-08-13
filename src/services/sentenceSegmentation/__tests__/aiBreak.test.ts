// AI 断句兜底模块的单元测试。
// 核心保证：AI 只作用于「必须切且无好切点」的 span；任何失败回退 DP；
// 未触发 span 的输出与 segmentWords 完全一致。

import { describe, it, expect } from 'vitest';
import { segmentWords, segmentWordsWithAiFallback } from '../index';
import {
  buildAiBreakPrompt,
  computeSpanCuts,
  mapBreakMarksToCuts,
  materializeCuts,
  segmentsWithinLimits,
  type BreakMark,
} from '../aiBreak';
import { getProfile } from '../profiles';
import type { WordToken, WordWithTime } from '../types';

function w(index: number, text: string, spanSec = 0.3): WordWithTime {
  const start = index * 0.5;
  return { text, start, end: start + spanSec };
}

function mkWords(text: string): WordWithTime[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((t, i) => w(i, t));
}

function toks(words: WordWithTime[]): WordToken[] {
  return words.map((x) => ({ word: x.text, start: x.start, end: x.end }));
}

/** 24 个无标点英文词（standard 16 词必切；无静音、无连词 → 触发 AI）。 */
function longUnpunctuatedEn(): WordWithTime[] {
  return Array.from({ length: 24 }, (_, i) => w(i, `word${i}`));
}

// ---- 提示词 ----

describe('buildAiBreakPrompt', () => {
  it('按语言 profile 填长度预算', () => {
    const en = getProfile('en');
    const enPrompt = buildAiBreakPrompt('some text', en, en.sourceLimit('standard'), en.sourceCharLimit('standard'));
    expect(enPrompt).toContain('16 words and 88 characters');
    expect(enPrompt).toContain('connector word');

    const ja = getProfile('ja');
    const jaPrompt = buildAiBreakPrompt('こんにちは', ja, ja.sourceLimit('standard'), ja.sourceCharLimit('standard'));
    expect(jaPrompt).toContain('22 characters');
    expect(jaPrompt).not.toContain('connector word');
  });
});

// ---- 标记解析 ----

describe('mapBreakMarksToCuts', () => {
  const enProfile = getProfile('en');
  const jaProfile = getProfile('ja');

  it('英文：标记在词界（前后带空格）', () => {
    const words = mkWords('So you can see exactly how it works');
    const marked = 'So you can see exactly [BR] how it works';
    expect(mapBreakMarksToCuts(marked, toks(words), enProfile)).toEqual([
      { tokenIndex: 4, charOffset: 0 },
    ]);
  });

  it('英文：重复锚对按标记偏移就近取舍', () => {
    // 两个 "that you"：正确断点在第 2 处
    const words = mkWords('The fact that you acknowledged that you were going to stay');
    const marked = 'The fact that you acknowledged that [BR] you were going to stay';
    expect(mapBreakMarksToCuts(marked, toks(words), enProfile)).toEqual([
      { tokenIndex: 5, charOffset: 0 },
    ]);
  });

  it('英文：词内标记吸附到最近词界（不拆词）', () => {
    const words = mkWords('this is a framework test here');
    const marked = 'this is a frame[BR]work test here';
    const cuts = mapBreakMarksToCuts(marked, toks(words), enProfile);
    expect(cuts.length).toBe(1);
    expect(cuts[0].charOffset).toBe(0);
    expect(cuts[0].tokenIndex === 2 || cuts[0].tokenIndex === 3).toBe(true);
  });

  it('英文：AI 改动远处文本时锚点仍能定位', () => {
    const words = mkWords('so you can see exactly how it works');
    const marked = 'so you can see exactly [BR] how it works fine';
    expect(mapBreakMarksToCuts(marked, toks(words), enProfile)).toEqual([
      { tokenIndex: 4, charOffset: 0 },
    ]);
  });

  it('日文：单字锚 + 多字 token 前/后缀匹配', () => {
    const words: WordWithTime[] = [
      w(0, 'さ'), w(1, 'ら'), w(2, 'に'), w(3, '本'), w(4, '格'), w(5, '始動'), w(6, 'した'), w(7, '150'), w(8, '万'),
    ];
    const marked = 'さらに本格始動した[BR]150万';
    expect(mapBreakMarksToCuts(marked, toks(words), jaProfile)).toEqual([
      { tokenIndex: 6, charOffset: 0 },
    ]);
  });

  it('CJK：标记落在多字词 token 内部 → 词内断点', () => {
    const words: WordWithTime[] = [
      w(0, '蜡烛线区间', 2.0), w(1, '但存在'), w(2, '一个问题'),
    ];
    const marked = '蜡烛线[BR]区间但存在一个问题';
    const marks = mapBreakMarksToCuts(marked, toks(words), jaProfile);
    expect(marks.length).toBe(1);
    expect(marks[0].tokenIndex).toBe(0);
    expect(marks[0].charOffset).toBe(3);
  });

  it('锚点完全找不到时用纯偏移兜底', () => {
    const words = mkWords('The quick brown fox jumps over');
    const marked = 'The quick brown [BR] fox jumps over';
    // 锚词被改成不存在的词
    const weird = 'The quick brwn [BR] fx jumps over';
    const cuts = mapBreakMarksToCuts(weird, toks(words), enProfile);
    expect(cuts.length).toBe(1);
    expect(cuts[0].tokenIndex).toBe(2);
  });

  it('多标记：第二个标记的偏移按已找到的标记数校正', () => {
    const words = mkWords('one two three four five six seven eight nine');
    const marked = 'one two three [BR] four five six [BR] seven eight nine';
    const cuts = mapBreakMarksToCuts(marked, toks(words), enProfile);
    expect(cuts).toEqual([
      { tokenIndex: 2, charOffset: 0 },
      { tokenIndex: 5, charOffset: 0 },
    ]);
  });
});

// ---- 物化（词内拆分 + 时间戳内插）----

describe('materializeCuts', () => {
  it('边界断点只产生 cut', () => {
    const words = mkWords('a b c d');
    const { pieces, cuts } = materializeCuts(toks(words), [{ tokenIndex: 1, charOffset: 0 }]);
    expect(pieces.map((p) => p.text)).toEqual(['a', 'b', 'c', 'd']);
    expect(cuts).toEqual([1]);
  });

  it('CJK 词内拆分：文本切开 + 时间戳按字符比例内插', () => {
    // '蜡烛线区间' 共 5 字，切在第 3 字后 → 左片 3/5 时长
    const words: WordWithTime[] = [
      { text: '蜡烛线区间', start: 0, end: 4 },
      { text: '后面', start: 4, end: 5 },
    ];
    const { pieces, cuts } = materializeCuts(toks(words), [{ tokenIndex: 0, charOffset: 3 }]);
    expect(pieces.map((p) => p.text)).toEqual(['蜡烛线', '区间', '后面']);
    expect(pieces[0].start).toBe(0);
    expect(pieces[0].end).toBeCloseTo(4 * (3 / 5), 6);
    expect(pieces[1].start).toBeCloseTo(4 * (3 / 5), 6);
    expect(pieces[1].end).toBe(4);
    expect(cuts).toEqual([0]);
  });

  it('半片过短（< minPieceMs）→ 放弃词内拆分', () => {
    const words: WordWithTime[] = [
      { text: '很短', start: 0, end: 0.3 },
      { text: '后面', start: 0.3, end: 1 },
    ];
    const { pieces, cuts } = materializeCuts(toks(words), [{ tokenIndex: 0, charOffset: 1 }]);
    expect(pieces.map((p) => p.text)).toEqual(['很短', '后面']);
    expect(cuts).toEqual([]);
  });

  it('无时间戳的纯文本 token：拆分文本但不内插时间', () => {
    const tokens: WordToken[] = [{ word: '甲乙丙丁' }, { word: '后' }];
    const { pieces, cuts } = materializeCuts(tokens, [{ tokenIndex: 0, charOffset: 2 }]);
    expect(pieces.map((p) => p.text)).toEqual(['甲乙', '丙丁', '后']);
    expect(pieces[0].start).toBeUndefined();
    expect(cuts).toEqual([0]);
  });
});

// ---- 上限校验 ----

describe('segmentsWithinLimits', () => {
  const en = getProfile('en');
  const ja = getProfile('ja');

  it('英文：词数与字符双约束', () => {
    const mk = (text: string) =>
      mkWords(text).map((x) => ({
        text: x.text,
        start: x.start,
        end: x.end,
        originalIndex: 0,
      }));
    // 16 个单词（31 字符）恰好达标
    const ok = mk('a b c d e f g h i j k l m n o p');
    expect(segmentsWithinLimits(ok, [15], en, 16, 88)).toBe(true);
    // 17 个单词超词数
    const overWords = mk('a b c d e f g h i j k l m n o p q');
    expect(segmentsWithinLimits(overWords, [16], en, 16, 88)).toBe(false);
  });

  it('CJK：字符单位约束', () => {
    const chars = Array.from({ length: 24 }, (_, i) => ({
      text: String.fromCharCode(0x4e00 + i),
      originalIndex: 0,
    }));
    expect(segmentsWithinLimits(chars, [21], ja, 22, Infinity)).toBe(true);
    expect(segmentsWithinLimits(chars, [22], ja, 22, Infinity)).toBe(false);
  });
});

// ---- 触发检测 ----

describe('computeSpanCuts', () => {
  it('长句无标点无停顿且必须切 → needsAi', () => {
    const profile = getProfile('en');
    const words = longUnpunctuatedEn();
    const info = computeSpanCuts(words, profile, profile.sourceLimit('standard'), profile.sourceCharLimit('standard'));
    expect(info.boundaries.length).toBeGreaterThan(0);
    expect(info.needsAi).toBe(true);
  });

  it('有逗号好切点 → 不触发', () => {
    const profile = getProfile('en');
    const words = Array.from({ length: 24 }, (_, i) => w(i, i === 11 ? 'point,' : `word${i}`));
    const info = computeSpanCuts(words, profile, profile.sourceLimit('standard'), profile.sourceCharLimit('standard'));
    expect(info.needsAi).toBe(false);
  });

  it('未超上限不切 → 不触发', () => {
    const profile = getProfile('en');
    const info = computeSpanCuts(mkWords('short sentence here'), profile, profile.sourceLimit('standard'), profile.sourceCharLimit('standard'));
    expect(info.needsAi).toBe(false);
  });
});

// ---- 端到端：segmentWordsWithAiFallback ----

describe('segmentWordsWithAiFallback', () => {
  it('未触发 span 的输出与 segmentWords 完全一致（AI 不被调用）', async () => {
    let calls = 0;
    const breaker = async () => {
      calls++;
      return null;
    };
    const words = mkWords('This is a short sentence. And another one here.');
    const plain = segmentWords(words, 'en', 'standard');
    const ai = await segmentWordsWithAiFallback(words, 'en', 'standard', { aiBreaker: breaker });
    expect(ai).toEqual(plain);
    expect(calls).toBe(0);
  });

  it('AI 返回 null → 与 segmentWords 一致', async () => {
    const words = longUnpunctuatedEn();
    const plain = segmentWords(words, 'en', 'standard');
    const ai = await segmentWordsWithAiFallback(words, 'en', 'standard', { aiBreaker: async () => null });
    expect(ai).toEqual(plain);
  });

  it('AI 抛异常 → 与 segmentWords 一致', async () => {
    const words = longUnpunctuatedEn();
    const plain = segmentWords(words, 'en', 'standard');
    const ai = await segmentWordsWithAiFallback(words, 'en', 'standard', {
      aiBreaker: async () => {
        throw new Error('boom');
      },
    });
    expect(ai).toEqual(plain);
  });

  it('AI 无标记 / 超上限 → 回退 DP', async () => {
    const words = longUnpunctuatedEn();
    const plain = segmentWords(words, 'en', 'standard');
    const noMark = await segmentWordsWithAiFallback(words, 'en', 'standard', {
      aiBreaker: async () => words.map((x) => x.text).join(' '),
    });
    expect(noMark).toEqual(plain);
    const overLimit = await segmentWordsWithAiFallback(words, 'en', 'standard', {
      aiBreaker: async () => 'word0 [BR] word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12 word13 word14 word15 word16 word17 word18 word19 word20 word21 word22 word23',
    });
    expect(overLimit).toEqual(plain);
  });

  it('AI 有效标记 → 采纳（英文词界）', async () => {
    const words = longUnpunctuatedEn();
    const marked = words.map((x) => x.text).join(' ');
    const ai = await segmentWordsWithAiFallback(words, 'en', 'standard', {
      aiBreaker: async (prompt) => {
        expect(prompt).toContain('16 words and 88 characters');
        return marked.slice(0, marked.indexOf('word12')) + '[BR] ' + marked.slice(marked.indexOf('word12'));
      },
    });
    const plain = segmentWords(words, 'en', 'standard');
    expect(ai).not.toEqual(plain);
    // AI 采纳：断点在 word11 | word12（纯 DP 会切在 word7 | word8）
    const joined = ai.map((s) => s.text).join(' | ');
    expect(joined).toContain('word11 | word12');
  });

  it('CJK 词内断点：采纳并内插时间戳', async () => {
    // token0 = 12 字 + 14 个单字 token = 26 单位（超出 22+grace，必切）；
    // AI 切在 token0 第 6 字之后 → 左片 6 单位 / 右片 20 单位
    const restChars = Array.from('あいうえおかきくけこさしすせ');
    const words: WordWithTime[] = [
      { text: '一二三四五六七八九十甲乙', start: 0, end: 0.45 },
      ...restChars.map((ch, i) => ({
        text: ch,
        start: 0.5 + i * 0.5,
        end: 0.5 + i * 0.5 + 0.45,
      })),
    ];
    const ai = await segmentWordsWithAiFallback(words, 'zh', 'standard', {
      aiBreaker: async () => {
        return `一二三四五六[BR]七八九十甲乙${restChars.join('')}`;
      },
      minPieceMs: 0,
    });
    const first = ai[0];
    expect(first.text).toBe('一二三四五六');
    expect(first.startTime).toBe(0);
    expect(first.endTime).toBeCloseTo(Math.round(0.45 * (6 / 12) * 1000), 0);
    expect(ai[1].text.startsWith('七八九十甲乙')).toBe(true);
  });

  it('onAiResolved 报告采纳/回退', async () => {
    const events: boolean[] = [];
    await segmentWordsWithAiFallback(longUnpunctuatedEn(), 'en', 'standard', {
      aiBreaker: async () => null,
      onAiResolved: (_text, accepted) => events.push(accepted),
    });
    expect(events).toEqual([false]);
  });
});
