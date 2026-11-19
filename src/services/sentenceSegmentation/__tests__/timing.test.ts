// 时间轴铺停顿：不重叠、不超单条上限、把空隙填进去。
import { describe, expect, it } from 'vitest';
import { LEAD_IN_SEC, MIN_DURATION_SEC, MIN_GAP_SEC, padCueTimings } from '../timing';
import type { DpSegment, WordWithTime } from '../types';

const w = (text: string, start: number, end: number): WordWithTime => ({ text, start, end });

const seg = (words: WordWithTime[]): DpSegment => ({
  text: words.map((x) => x.text).join(' '),
  startTime: Math.round(words[0]!.start * 1000),
  endTime: Math.round(words[words.length - 1]!.end * 1000),
  wordStart: 0,
  wordEnd: words.length - 1,
  words,
});

describe('padCueTimings', () => {
  it('把尾部空隙填进本条，但不越过下一条', () => {
    const cues = [seg([w('hello', 0, 0.4)]), seg([w('world', 3, 3.4)])];
    const out = padCueTimings(cues, { maxDuration: 7 });
    expect(out[0]!.startTime).toBe(0);
    // 下一条 3.0 开口：给它预留 lead-in + 最小空隙，本条铺到 3.0 - lead - gap
    const reserve = Math.round((LEAD_IN_SEC + MIN_GAP_SEC) * 1000);
    expect(out[0]!.endTime).toBe(3000 - reserve);
    // 下一条提前 lead-in 出现（但不早于上一条结束 + 空隙）
    expect(out[1]!.startTime).toBe(Math.round((3 - LEAD_IN_SEC) * 1000));
  });

  it('不足 5/6 秒时补到最短时长', () => {
    const cues = [seg([w('hi', 1, 1.2)])];
    const out = padCueTimings(cues, { maxDuration: 7 });
    expect(out[0]!.endTime - out[0]!.startTime).toBeGreaterThanOrEqual(
      Math.round(MIN_DURATION_SEC * 1000) - 1,
    );
  });

  it('向前留 lead-in，但不早于上一条结束 + 最小空隙', () => {
    const cues = [seg([w('a', 0, 0.3)]), seg([w('b', 2, 2.3)])];
    const out = padCueTimings(cues, { maxDuration: 7 });
    expect(out[1]!.startTime).toBe(Math.round((2 - LEAD_IN_SEC) * 1000));
    const tight = padCueTimings([seg([w('a', 0.5, 2.0)]), seg([w('b', 2.02, 4)])], { maxDuration: 7 });
    expect(tight[1]!.startTime).toBeGreaterThanOrEqual(
      tight[0]!.endTime + Math.round(MIN_GAP_SEC * 1000),
    );
  });

  it('不超单条最长时长', () => {
    const cues = [seg([w('long', 0, 1)])];
    const out = padCueTimings(cues, { maxDuration: 7 });
    expect(out[0]!.endTime - out[0]!.startTime).toBeLessThanOrEqual(7000);
  });

  it('所有相邻条之间至少留一个最小空隙', () => {
    const cues = [seg([w('a', 0, 1)]), seg([w('b', 1.001, 2)]), seg([w('c', 2.002, 3)])];
    const out = padCueTimings(cues, { maxDuration: 7 });
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.startTime).toBeGreaterThanOrEqual(
        out[i - 1]!.endTime + Math.round(MIN_GAP_SEC * 1000),
      );
    }
  });
});
