// 断句预算回归：一条字幕必须落在「单行宽度」内。
//
// 宽度口径 = Netflix 的加权字符（全角 1，半角/空格 0.5；拉丁直接数字符）。
// 预算数值见 profiles.ts：short = Netflix 原值，standard / loose 上浮（源文是
// ASR 原文、不可压缩，按 Netflix 原值切会把语音切成一堆 0.6s 碎条）。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { segmentWords } from '../index';
import { getProfile } from '../profiles';

const DIR = join(__dirname, 'fixtures');

interface Word {
  text: string;
  start: number;
  end: number;
}

const load = (id: string) =>
  JSON.parse(readFileSync(join(DIR, `${id}.words.json`), 'utf8')) as {
    lang: string;
    preset: 'short' | 'standard' | 'loose';
    words: Word[];
  };

describe('单行宽度预算', () => {
  for (const id of ['en_slice', 'zh_slice', 'ja_slice']) {
    it(`${id}：每条不超单行宽度、不超 7s`, () => {
      const fixture = load(id);
      const profile = getProfile(fixture.lang);
      const cues = segmentWords(fixture.words, fixture.lang, fixture.preset, {
        watchabilityMerge: true,
      });
      expect(cues.length).toBeGreaterThan(0);

      const limit = profile.widthLimit(fixture.preset);
      for (const cue of cues) {
        const width = profile.widthOf(cue.text);
        // 单 token 不可再拆（长单词 / URL），放行
        if (cue.words.length > 1) {
          expect(width, `超宽：${cue.text}`).toBeLessThanOrEqual(limit);
        }
        // 允许 1s 余量：只有「合法切点会切出碎句」时我们才宁可让这条略长
        expect((cue.endTime - cue.startTime) / 1000).toBeLessThanOrEqual(profile.maxDuration + 1);
      }
    });
  }

  it('en_probe：100 字符的长句按单行预算切成 3 条，而不是整句保留', () => {
    const fixture = load('en_probe');
    const cues = segmentWords(fixture.words, fixture.lang, 'standard', {
      watchabilityMerge: true,
    });
    expect(cues.map((c) => c.text)).toEqual([
      'Alright, Flips!',
      'Welcome everyone into this crash course about our new',
      '15-minute timeframe entry models and strategy.',
    ]);
    const profile = getProfile('en');
    for (const cue of cues) {
      expect(profile.widthOf(cue.text)).toBeLessThanOrEqual(profile.widthLimit('standard'));
    }
  });

  it('三档预设宽度递增，且都来自 Netflix 数值', () => {
    const profile = getProfile('en');
    expect(profile.widthLimit('short')).toBe(42);
    expect(profile.widthLimit('standard')).toBeGreaterThan(profile.widthLimit('short'));
    expect(profile.widthLimit('loose')).toBeGreaterThan(profile.widthLimit('standard'));
    expect(getProfile('zh').widthLimit('short')).toBe(16);
    expect(getProfile('ja').widthLimit('short')).toBe(13);
    expect(getProfile('ko').widthLimit('short')).toBe(16);
  });
});
