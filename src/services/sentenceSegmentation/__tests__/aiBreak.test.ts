// AI 断句兜底模块的单元测试。
// 核心保证：AI 只改 DP 硬刀；任何失败或比 DP 更碎都回退；
// 未触发 span 的输出与 segmentWords 完全一致。

import { describe, it, expect } from 'vitest';
import { segmentWords, segmentWordsWithAiFallback } from '../index';
import {
  aiAcceptableVsDp,
  aiNotWorseThanDp,
  buildAiBreakPrompt,
  computeSpanCuts,
  isStructurallyBadCut,
  mapBreakMarksToCuts,
  materializeCuts,
  projectCutsToPieceBudget,
  scoreCutList,
  segmentsWithinLimits,
  type SplitPiece,
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
    expect(jaPrompt).toContain('connector word');
  });

  it('把 DP 初刀写成长度预算，允许多标候选', () => {
    const en = getProfile('en');
    const prompt = buildAiBreakPrompt(
      'one two three four five six',
      en,
      en.sourceLimit('standard'),
      en.sourceCharLimit('standard'),
      ['one two three', 'four five six'],
    );
    expect(prompt).toContain('First-pass pieces:');
    expect(prompt).toContain('1. one two three');
    expect(prompt).toContain('2. four five six');
    expect(prompt).toContain('cut this into 2 pieces');
    expect(prompt).toContain('without a natural boundary');
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

  it('虚词甩尾是结构坏刀', () => {
    const en = getProfile('en');
    const words = mkWords('see the price today');
    expect(isStructurallyBadCut(toks(words), 1, en)).toBe(true); // the |
    expect(isStructurallyBadCut(toks(words), 0, en)).toBe(false);
  });

  it('下一行以收束助词开头是结构坏刀', () => {
    const zh = getProfile('zh');
    const words: WordWithTime[] = [w(0, '台风'), w(1, '的'), w(2, '形状')];
    expect(isStructurallyBadCut(toks(words), 0, zh)).toBe(true); // | 的
    expect(isStructurallyBadCut(toks(words), 1, zh)).toBe(false); // 的 | 形状
  });
});

// ---- 采纳门槛：不能比 DP 更差 ----

function piecesOf(texts: string[]): SplitPiece[] {
  return texts.map((text, i) => ({
    text,
    start: i * 0.3,
    end: i * 0.3 + 0.3,
    originalIndex: i,
  }));
}

describe('aiNotWorseThanDp', () => {
  const en = getProfile('en');

  it('中性多切（没有好切点）→ 拒绝', () => {
    const pieces = piecesOf([
      'one', 'two', 'three', 'four',
      'five', 'six', 'seven', 'eight',
      'nine', 'ten', 'eleven', 'twelve',
    ]);
    expect(aiNotWorseThanDp(pieces, [5], en, 2)).toBe(true);
    expect(aiNotWorseThanDp(pieces, [3, 7], en, 2)).toBe(false);
  });

  it('多出来的刀落在连词前 → 接受', () => {
    const pieces = piecesOf([
      'one', 'two', 'three', 'four',
      'five', 'six', 'because', 'eight',
      'nine', 'ten', 'eleven', 'twelve',
    ]);
    // 3 段 vs DP 2 段，多出的刀在 because 前
    expect(aiNotWorseThanDp(pieces, [5, 8], en, 2)).toBe(true);
  });

  it('1–2 词残段 → 拒绝', () => {
    const pieces = piecesOf(['one', 'two', 'three', 'four', 'five', 'six']);
    expect(aiNotWorseThanDp(pieces, [1], en, 2)).toBe(false);
  });

  it('虚词甩尾 → 拒绝', () => {
    const pieces = piecesOf(['see', 'the', 'price', 'today', 'clearly', 'now']);
    expect(aiNotWorseThanDp(pieces, [1], en, 2)).toBe(false);
  });
});

describe('projectCutsToPieceBudget', () => {
  const en = getProfile('en');

  it('多出来的中性刀被合掉，连词刀留下', () => {
    const texts = [
      'one', 'two', 'three', 'four', 'five', 'six',
      'because', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    ];
    const pieces = piecesOf(texts);
    // 刀在 2（中性）、5（because 前，连词好切点）、8（中性）
    const { cuts } = projectCutsToPieceBudget(pieces, [2, 5, 8], en, 16, 88, 2);
    expect(cuts).toEqual([5]);
  });

  it('结构坏刀先丢掉', () => {
    const pieces = piecesOf(['see', 'the', 'price', 'today', 'clearly', 'now', 'here', 'too']);
    const { cuts } = projectCutsToPieceBudget(pieces, [1, 4], en, 16, 88, 2);
    expect(cuts).toEqual([4]);
    expect(isStructurallyBadCut(
      pieces.map((p) => ({ word: p.text, start: p.start, end: p.end })),
      1,
      en,
    )).toBe(true);
  });
});

describe('aiAcceptableVsDp', () => {
  const en = getProfile('en');

  it('合法切分即可，不再因为好切点变少而拒绝', () => {
    const tokens = [
      { word: 'one' }, { word: 'two' }, { word: 'three,' }, { word: 'four' },
      { word: 'five' }, { word: 'six' }, { word: 'seven' }, { word: 'eight' },
    ];
    const dp = scoreCutList(tokens, [2], en, 16, 88);
    const ai = scoreCutList(tokens, [4], en, 16, 88);
    expect(dp.quality).toBeGreaterThan(0);
    expect(ai.quality).toBe(0);
    expect(aiAcceptableVsDp(ai, dp)).toBe(true);
  });

  it('中性更细切分 → 拒绝；连词处多切 → 接受', () => {
    const tokens = Array.from({ length: 12 }, (_, i) => ({ word: `w${i}` }));
    const dp = scoreCutList(tokens, [5], en, 16, 88);
    const aiNeutral = scoreCutList(tokens, [3, 7], en, 16, 88);
    expect(aiNeutral.pieceCount).toBeGreaterThan(dp.pieceCount);
    expect(aiAcceptableVsDp(aiNeutral, dp)).toBe(false);

    const withConn = [
      ...Array.from({ length: 6 }, (_, i) => ({ word: `w${i}` })),
      { word: 'because' },
      ...Array.from({ length: 5 }, (_, i) => ({ word: `z${i}` })),
    ];
    const dp2 = scoreCutList(withConn, [8], en, 16, 88);
    const aiConn = scoreCutList(withConn, [2, 5], en, 16, 88);
    expect(aiConn.pieceCount).toBe(3);
    expect(aiConn.quality).toBeGreaterThan(0);
    expect(aiAcceptableVsDp(aiConn, dp2)).toBe(true);
  });
});

// ---- 端到端：segmentWordsWithAiFallback ----

describe('segmentWordsWithAiFallback', () => {
  it('未触发 span 的输出与 segmentWords 完全一致（AI 不被调用）', async () => {
    let calls = 0;
    const breaker = async () => {
      calls++;
      return { content: null, tokensUsed: 0 };
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
    const ai = await segmentWordsWithAiFallback(words, 'en', 'standard', { aiBreaker: async () => ({ content: null, tokensUsed: 0 }) });
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
      aiBreaker: async () => ({ content: words.map((x) => x.text).join(' '), tokensUsed: 0 }),
    });
    expect(noMark).toEqual(plain);
    const overLimit = await segmentWordsWithAiFallback(words, 'en', 'standard', {
      aiBreaker: async () => ({ content: 'word0 [BR] word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12 word13 word14 word15 word16 word17 word18 word19 word20 word21 word22 word23', tokensUsed: 0 }),
    });
    expect(overLimit).toEqual(plain);
  });

  it('AI 有效标记 → 采纳（英文词界）', async () => {
    const words = longUnpunctuatedEn();
    const marked = words.map((x) => x.text).join(' ');
    const ai = await segmentWordsWithAiFallback(words, 'en', 'standard', {
      aiBreaker: async (prompt) => {
        expect(prompt).toContain('16 words and 88 characters');
        return { content: marked.slice(0, marked.indexOf('word12')) + '[BR] ' + marked.slice(marked.indexOf('word12')), tokensUsed: 42 };
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
        return { content: `一二三四五六[BR]七八九十甲乙${restChars.join('')}`, tokensUsed: 10 };
      },
      minPieceMs: 0,
    });
    const first = ai[0];
    expect(first.text).toBe('一二三四五六');
    expect(first.startTime).toBe(0);
    expect(first.endTime).toBeCloseTo(Math.round(0.45 * (6 / 12) * 1000), 0);
    expect(ai[1].text.startsWith('七八九十甲乙')).toBe(true);
  });

  it('onAiResolved 报告采纳/回退与 tokens', async () => {
    const events: Array<{ accepted: boolean; tokensUsed: number }> = [];
    await segmentWordsWithAiFallback(longUnpunctuatedEn(), 'en', 'standard', {
      aiBreaker: async () => ({ content: null, tokensUsed: 7 }),
      onAiResolved: (_text, accepted, tokensUsed) => events.push({ accepted, tokensUsed }),
    });
    expect(events).toEqual([{ accepted: false, tokensUsed: 7 }]);
  });

  it('onAiProgress 筛完立刻报 0/N，再按完成句数推进', async () => {
    const steps: Array<[number, number]> = [];
    await segmentWordsWithAiFallback(longUnpunctuatedEn(), 'en', 'standard', {
      aiBreaker: async () => ({ content: null, tokensUsed: 0 }),
      onAiProgress: (resolved, total) => steps.push([resolved, total]),
    });
    expect(steps).toEqual([[0, 1], [1, 1]]);
  });

  it('resumeSpans 命中相同 spanText 时不调用 LLM，仍采纳已存标记', async () => {
    const words = longUnpunctuatedEn();
    const marked =
      words.map((x) => x.text).join(' ').slice(0, words.map((x) => x.text).join(' ').indexOf('word12')) +
      '[BR] ' +
      words.map((x) => x.text).join(' ').slice(words.map((x) => x.text).join(' ').indexOf('word12'));
    const first = await segmentWordsWithAiFallback(words, 'en', 'standard', {
      aiBreaker: async () => ({ content: marked, tokensUsed: 11 }),
    });
    const spanText = first.map((s) => s.text).join(' ').replace(/\s*\|\s*/g, ' ');
    void spanText;
    const persist: Array<{ spanIdx: number; tokensUsed: number }> = [];
    let calls = 0;
    const resumed = await segmentWordsWithAiFallback(words, 'en', 'standard', {
      aiBreaker: async () => {
        calls += 1;
        return { content: null, tokensUsed: 0 };
      },
      resumeSpans: new Map([
        [0, { spanText: words.map((x) => x.text).join(' '), content: marked, tokensUsed: 11 }],
      ]),
      onAiSpanPersist: async (span) => {
        persist.push({ spanIdx: span.spanIdx, tokensUsed: span.tokensUsed });
      },
    });
    expect(calls).toBe(0);
    expect(persist).toEqual([]);
    expect(resumed.map((s) => s.text)).toEqual(first.map((s) => s.text));
  });

  it('采纳的 AI 分段带 aiSplit；回退 DP 不带', async () => {
    const accepted = await segmentWordsWithAiFallback(longUnpunctuatedEn(), 'en', 'standard', {
      aiBreaker: async (prompt) => {
        const text = prompt.split('Text:\n')[1] ?? '';
        const words = text.split(/\s+/).filter(Boolean);
        const mid = Math.floor(words.length / 2);
        return { content: `${words.slice(0, mid).join(' ')} [BR] ${words.slice(mid).join(' ')}`, tokensUsed: 4 };
      },
    });
    expect(accepted.length).toBeGreaterThan(1);
    expect(accepted.every((s) => s.aiSplit === true)).toBe(true);

    const rejected = await segmentWordsWithAiFallback(longUnpunctuatedEn(), 'en', 'standard', {
      aiBreaker: async () => ({ content: null, tokensUsed: 0 }),
    });
    expect(rejected.every((s) => !s.aiSplit)).toBe(true);
  });

  it('AI 中性多标 → 回退 DP（多出来的刀没有好切点）', async () => {
    const words = longUnpunctuatedEn();
    const plain = segmentWords(words, 'en', 'standard');
    const finer = await segmentWordsWithAiFallback(words, 'en', 'standard', {
      aiBreaker: async () => ({
        content:
          'word0 word1 word2 word3 word4 word5 [BR] word6 word7 word8 word9 word10 word11 [BR] word12 word13 word14 word15 word16 word17 [BR] word18 word19 word20 word21 word22 word23',
        tokensUsed: 1,
      }),
    });
    expect(finer).toEqual(plain);
    expect(finer.every((s) => !s.aiSplit)).toBe(true);
  });

  it('AI 虚词甩尾 → 回退 DP', async () => {
    const words = Array.from({ length: 24 }, (_, i) => w(i, i === 11 ? 'the' : `word${i}`));
    const plain = segmentWords(words, 'en', 'standard');
    const bad = await segmentWordsWithAiFallback(words, 'en', 'standard', {
      aiBreaker: async () => ({
        content: `${words
          .slice(0, 12)
          .map((x) => x.text)
          .join(' ')} [BR] ${words
          .slice(12)
          .map((x) => x.text)
          .join(' ')}`,
        tokensUsed: 1,
      }),
    });
    expect(bad).toEqual(plain);
  });

  it('提示词包含 DP 初刀', async () => {
    const words = longUnpunctuatedEn();
    let seen = '';
    await segmentWordsWithAiFallback(words, 'en', 'standard', {
      aiBreaker: async (prompt) => {
        seen = prompt;
        return { content: null, tokensUsed: 0 };
      },
    });
    expect(seen).toContain('First-pass pieces:');
    expect(seen).toContain('without a natural boundary');
  });
});
