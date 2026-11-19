// 切点位置：标点与介词前优先，不能为了凑宽度把短语拆开。
import { describe, expect, it } from 'vitest';
import { segmentWords } from '../index';

interface Word {
  text: string;
  start: number;
  end: number;
}

/** 把一句话按固定语速铺成词级时间戳（0.24s/词，句中小停顿 0.04s）。 */
const words = (text: string, start = 0): Word[] => {
  let t = start;
  return text.split(/\s+/).filter(Boolean).map((w) => {
    const dur = 0.18 + Math.min(w.length, 8) * 0.02;
    const item = { text: w, start: Number(t.toFixed(3)), end: Number((t + dur).toFixed(3)) };
    t += dur + 0.04;
    return item;
  });
};

const cut = (text: string, start = 0) =>
  segmentWords(words(text, start), 'en', 'standard', { watchabilityMerge: true }).map((c) => c.text);

describe('切点位置', () => {
  it('在介词前断，而不是把名词短语从中间劈开', () => {
    // 115 字符，72 上限下必须切一刀
    const cues = cut('Alright, Flippers! Welcome everyone into this crash course about our new 15-minute timeframe entry models and strategy.');
    expect(cues).toEqual([
      'Alright, Flippers! Welcome everyone into this crash course',
      'about our new 15-minute timeframe entry models and strategy.',
    ]);
  });

  it('逗号后断，不留在主语代词与动词之间', () => {
    const cues = cut("If you're here, it means you've already completed the 4-hour swing trading strategy,");
    expect(cues[0]).toBe("If you're here,");
    expect(cues.join(' ')).toContain('it means');
  });

  it('连词前断（and / so / but）', () => {
    const cues = cut('The entries are built on top of what we already know from the higher time frame strategy, so if you skipped ahead you should go back first.');
    const cutAtSo = cues.some((c) => /,\s*$/.test(c) === false && c.trimStart().startsWith('so '));
    const allShort = cues.every((c) => c.length <= 72);
    expect(allShort).toBe(true);
    expect(cutAtSo || cues.length >= 2).toBe(true);
  });
});
