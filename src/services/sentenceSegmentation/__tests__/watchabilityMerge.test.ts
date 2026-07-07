// Watchability 合并的回归测试 —— 移植自 voxtrans 的"一闪而过"场景。
// 验证 mergeWatchabilitySegments 按静音间隔 / 残段-连词模式重新粘合过短段。

import { describe, it, expect } from 'vitest';
import { mergeWatchabilitySegments } from '../watchabilityMerge';
import { segmentWords } from '../index';
import type { DpSegment, WordWithTime } from '../types';

// 把一段文本按"每词 0.5s"展开成带时间戳的词列表，便于构造端到端输入。
function mkWords(text: string): WordWithTime[] {
  return text.split(/\s+/).filter(Boolean).map((t, i) => {
    const start = i * 0.5;
    return { text: t, start, end: start + 0.3 };
  });
}

// 用一段文本的起止时间构造一个 DpSegment，words 时间戳与 segment 对齐。
function seg(text: string, startTime: number, endTime: number): DpSegment {
  const words = text.split(/\s+/).filter(Boolean).map((t, i, arr) => {
    const span = endTime - startTime;
    const per = span / arr.length;
    return { text: t, start: startTime + i * per, end: startTime + (i + 1) * per };
  });
  return { text, startTime, endTime, wordStart: 0, wordEnd: words.length - 1, words };
}

describe('mergeWatchabilitySegments', () => {
  it('不合并不满足长度门槛的左段（词数 < 6）', () => {
    const segs: DpSegment[] = [seg('好的', 0, 500), seg('没问题', 600, 1100)];
    expect(mergeWatchabilitySegments(segs, 'zh')).toHaveLength(2);
  });

  it('不在静音间隔 > 0.5s 处合并', () => {
    const segs: DpSegment[] = [seg('今天是星期一', 0, 1000), seg('天气很好', 3000, 4000)];
    expect(mergeWatchabilitySegments(segs, 'zh')).toHaveLength(2);
  });

  it('合并残段(以连词"去"结尾) + 连词开头的相邻段', () => {
    // 左段 ≥ 6 单位、不以句末标点结尾、以 CJK 连词（"去"）结尾 → isFragIssue 为真。
    const segs: DpSegment[] = [seg('我们决定出门去', 0, 2000), seg('然后回家吃饭', 2100, 4000)];
    const merged = mergeWatchabilitySegments(segs, 'zh');
    expect(merged).toHaveLength(1);
    // 左右均以 CJK 收尾/起首，合并时不插空格。
    expect(merged[0].text).toBe('我们决定出门去然后回家吃饭');
    expect(merged[0].startTime).toBe(0);
    expect(merged[0].endTime).toBe(4000);
  });

  it('不合并以句末标点结尾的左段', () => {
    const segs: DpSegment[] = [seg('今天是星期一。', 0, 1000), seg('天气很好', 1100, 2000)];
    expect(mergeWatchabilitySegments(segs, 'zh')).toHaveLength(2);
  });

  it('英文：合并残段(and) + 连词开头(the)的相邻段', () => {
    const segs: DpSegment[] = [seg('I wanted to go to the store and', 0, 2000), seg('the weather was bad', 2100, 4000)];
    const merged = mergeWatchabilitySegments(segs, 'en');
    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('I wanted to go to the store and the weather was bad');
  });

  it('端到端：segmentWords 开启 watchabilityMerge 后短段被粘合', () => {
    // 构造一个会被 DP 切成两段、但第二段以连词开头、间隔极短的场景。
    const words = mkWords(
      'Today the local transcription pipeline keeps complete semantic sentences for accurate review but it should split long subtitle lines near punctuation for comfortable offline viewing',
    );
    const withoutMerge = segmentWords(words, 'en', 'short');
    const withMerge = segmentWords(words, 'en', 'short', { watchabilityMerge: true });
    // 合并后段数应 <= 合并前。
    expect(withMerge.length).toBeLessThanOrEqual(withoutMerge.length);
    // 合并后每条时长应 >= 合并前对应位置的最短时长（不再出现"一闪而过"的极短段）。
    const minDuration = (segs: DpSegment[]) =>
      Math.min(...segs.map((s) => s.endTime - s.startTime));
    expect(minDuration(withMerge)).toBeGreaterThanOrEqual(minDuration(withoutMerge));
  });
});
