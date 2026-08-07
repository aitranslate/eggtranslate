/**
 * A/B：旧「一律 hard limit」 vs 新「好切点 + grace」。
 * 用指标判断重构是否正向，而不是只靠感觉。
 */
import { describe, it, expect } from 'vitest';
import { getProfile } from '../profiles';
import { splitSpanByDp, splitSpanByDpLegacyHard } from '../softSplit';
import { LENGTH_GRACE_UNITS } from '../constants';
import type { WordToken } from '../types';

function tok(words: string[]): WordToken[] {
  return words.map((word, i) => ({
    word,
    start: i * 0.4,
    end: i * 0.4 + 0.3,
  }));
}

function unitsOf(
  tokens: WordToken[],
  a: number,
  b: number,
  profile: ReturnType<typeof getProfile>,
): number {
  let u = 0;
  for (let i = a; i <= b; i++) u += profile.tokenUnits(tokens[i].word);
  return u;
}

function metrics(
  tokens: WordToken[],
  ranges: Array<[number, number]>,
  profile: ReturnType<typeof getProfile>,
  limit: number,
) {
  const segs = ranges.map(([a, b]) => ({
    a,
    b,
    units: unitsOf(tokens, a, b, profile),
    text: tokens
      .slice(a, b + 1)
      .map((t) => t.word)
      .join(' '),
  }));
  const overLimit = segs.filter((s) => s.units > limit && bMinusA(s) > 0);
  const overGrace = segs.filter(
    (s) => s.units > limit + LENGTH_GRACE_UNITS && s.b - s.a + 1 > 1,
  );
  const tiny = segs.filter((s) => s.units <= 2 && s.b - s.a + 1 > 1);
  // 坏切：段末不是标点/逗号，且下一段以小写连词以外的普通词开始... 简化：孤立 1 词段
  const singleWord = segs.filter((s) => s.b - s.a + 1 === 1 && tokens.length > 3);
  return {
    n: segs.length,
    overLimit: overLimit.length,
    overGrace: overGrace.length,
    tiny: tiny.length,
    singleWord: singleWord.length,
    maxUnits: Math.max(...segs.map((s) => s.units), 0),
    segs,
  };
}

function bMinusA(s: { a: number; b: number }) {
  return s.b - s.a;
}

type Case = { name: string; words: string[]; lang: string; limit: number };

const CASES: Case[] = [
  {
    name: '13_plain_short',
    words: 'one two three four five six seven eight nine ten eleven twelve thirteen'.split(
      ' ',
    ),
    lang: 'en',
    limit: 12,
  },
  {
    name: '13_with_comma',
    words:
      'one two three four five six seven, eight nine ten eleven twelve thirteen'.split(
        ' ',
      ),
    lang: 'en',
    limit: 12,
  },
  {
    name: '18_with_but',
    words:
      'Today the pipeline keeps complete semantic sentences for accurate review, but it should split long lines near punctuation.'.split(
        ' ',
      ),
    lang: 'en',
    limit: 12,
  },
  {
    name: '30_plain_force',
    words: Array.from({ length: 30 }, (_, i) => `w${i}`),
    lang: 'en',
    limit: 12,
  },
  {
    name: 'under_budget',
    words: 'hello world this is fine'.split(' '),
    lang: 'en',
    limit: 12,
  },
  {
    name: 'news_clause',
    words:
      'Smoke from hundreds of wildfires in Canada is triggering air quality alerts throughout the U.S.'.split(
        ' ',
      ),
    lang: 'en',
    limit: 16,
  },
];

describe('grace vs legacy hard A/B', () => {
  const rows: Array<Record<string, unknown>> = [];

  for (const c of CASES) {
    it(`compare_${c.name}`, () => {
      const profile = getProfile(c.lang);
      const tokens = tok(c.words);
      const legacy = splitSpanByDpLegacyHard(tokens, profile, c.limit);
      const next = splitSpanByDp(tokens, profile, c.limit);
      const mL = metrics(tokens, legacy, profile, c.limit);
      const mN = metrics(tokens, next, profile, c.limit);
      rows.push({
        case: c.name,
        legacy_n: mL.n,
        next_n: mN.n,
        legacy_overLimit: mL.overLimit,
        next_overLimit: mN.overLimit,
        legacy_overGrace: mL.overGrace,
        next_overGrace: mN.overGrace,
        legacy_single: mL.singleWord,
        next_single: mN.singleWord,
        legacy_max: mL.maxUnits,
        next_max: mN.maxUnits,
      });

      // 硬约束：新方案多 token 不得超过 limit+grace
      expect(mN.overGrace).toBe(0);

      // 用例断言
      if (c.name === '13_plain_short') {
        expect(mN.n).toBe(1);
        expect(mL.n).toBeGreaterThanOrEqual(2); // 旧方案会硬拆
      }
      if (c.name === '13_with_comma') {
        expect(mN.n).toBeGreaterThanOrEqual(2);
        expect(mN.maxUnits).toBeLessThanOrEqual(c.limit);
      }
      if (c.name === '30_plain_force') {
        expect(mN.n).toBeGreaterThan(1);
        expect(mN.maxUnits).toBeLessThanOrEqual(c.limit);
      }
      if (c.name === 'under_budget') {
        expect(mN.n).toBe(1);
        expect(mL.n).toBe(1);
      }
    });
  }

  it('summary_positive_or_neutral', () => {
    // 汇总：新方案不应在 force 场景放宽 hard；grace 场景减少无意义切分
    const plain13 = rows.find((r) => r.case === '13_plain_short')!;
    const force30 = rows.find((r) => r.case === '30_plain_force')!;
    const comma = rows.find((r) => r.case === '13_with_comma')!;

    // 正向：13 词无好切点不再被硬拆
    expect(plain13.next_n).toBe(1);
    expect((plain13.legacy_n as number) > 1).toBe(true);

    // 中性/正向：远超仍强制 ≤ limit
    expect(force30.next_max).toBeLessThanOrEqual(12);
    expect(force30.next_overGrace).toBe(0);

    // 正向：有逗号仍切开
    expect((comma.next_n as number) >= 2).toBe(true);

    // 打印便于人工审
    // eslint-disable-next-line no-console
    console.log('[grace A/B]', JSON.stringify(rows, null, 2));
  });
});
