// 与 OneAsr 的有意偏离。
//
// 移植 OneAsr 后仍保留两条更严格的规则，原因写在 softSplit.ts / watchabilityMerge.ts
// 对应位置：
//
// 1. 字符预算单独超限（词/字仍在预设内）且整段没有标点可切时，不硬拆。
//    字符预算 = 词数 × 5.5 只是估算，数字/复合词多的句子会假性超限；硬拆只能落在
//    短语中间，把一句话切成 "...entry models" | "and strategy."。
// 2. 短句 + 句末标点不再自动算「语气词」跨句前粘，必须是真话语标记（Okay./Now.）。
//    否则被切出来的残句会跨过句号粘到下一句，一行里出现两个句子。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { segmentWords } from '../index';

const fmt = (ms: number): string => {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};

interface Word {
  text: string;
  start: number;
  end: number;
}

const toCues = (words: Word[], lang = 'en', preset: 'short' | 'standard' | 'loose' = 'standard') =>
  segmentWords(words, lang, preset, { watchabilityMerge: true }).map((c) => ({
    start: fmt(c.startTime),
    end: fmt(c.endTime),
    text: c.text,
  }));

describe('断句：与 OneAsr 的有意偏离', () => {
  it('字符预算单独超限时不硬拆句子（90s_en 的前两句）', () => {
    const dir = join(process.cwd(), 'src', 'services', 'sentenceSegmentation', '__tests__', 'fixtures');
    const fixture = JSON.parse(readFileSync(join(dir, 'en_probe.words.json'), 'utf8')) as {
      words: Word[];
    };
    const cues = toCues(fixture.words);
    // OneAsr 会切成「...entry models」|「and strategy.」；这里整句保留。
    expect(cues.map((c) => c.text)).toEqual([
      'Alright, Flips!',
      'Welcome everyone into this crash course about our new 15-minute timeframe entry models and strategy.',
    ]);
    expect(cues[1]!.start).toBe('00:00:02,920');
    expect(cues[1]!.end).toBe('00:00:08,300');
  });

  it('段内有逗号时仍然按标点切，不触发整段保留', () => {
    const words: Word[] = [
      { text: 'so', start: 0, end: 0.2 },
      { text: 'the', start: 0.2, end: 0.4 },
      { text: '6', start: 0.4, end: 0.6 },
      { text: 'PM', start: 0.6, end: 0.8 },
      { text: 'candle', start: 0.8, end: 1.0 },
      { text: 'is', start: 1.0, end: 1.2 },
      { text: 'like', start: 1.2, end: 1.4 },
      { text: 'this,', start: 1.4, end: 1.6 },
      { text: 'and', start: 1.8, end: 2.0 },
      { text: 'then', start: 2.0, end: 2.2 },
      { text: 'it', start: 2.2, end: 2.4 },
      { text: 'sweeps', start: 2.4, end: 2.6 },
      { text: 'the', start: 2.6, end: 2.8 },
      { text: 'high', start: 2.8, end: 3.0 },
      { text: 'of', start: 3.0, end: 3.2 },
      { text: 'the', start: 3.2, end: 3.4 },
      { text: 'range.', start: 3.4, end: 3.6 },
    ];
    const cues = toCues(words, 'en', 'short');
    expect(cues.length).toBeGreaterThan(1);
    expect(cues[0]!.text.endsWith('this,')).toBe(true);
  });

  it('短句 + 句末标点仍按 OneAsr 与后句合并（避免闪帧行）', () => {
    const words: Word[] = [
      { text: 'On', start: 0, end: 0.2 },
      { text: 'NQ.', start: 0.2, end: 0.4 },
      { text: 'And', start: 0.6, end: 0.8 },
      { text: 'then', start: 0.8, end: 1.0 },
      { text: 'on', start: 1.0, end: 1.2 },
      { text: 'ES.', start: 1.2, end: 1.4 },
    ];
    const cues = toCues(words, 'en', 'standard');
    expect(cues.map((c) => c.text)).toEqual(['On NQ. And then on ES.']);
  });
});
