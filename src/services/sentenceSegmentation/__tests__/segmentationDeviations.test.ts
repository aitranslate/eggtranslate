// 与 OneAsr 的有意偏离（两处，都写在代码注释里）：
//
// 1. 单行预算取代「词数 × 5.5 估算字符」：一条字幕必须落在 Netflix 口径的单行宽度内，
//    不再出现 88 字符的宽行。OneAsr 会保留宽行，我们按 42/56/64 切。
// 2. 参数取自 Netflix TTSG（拉丁 42 字符、中韩 16、日 13 全角；时长 ≤7s），
//    standard / loose 上浮，因为 ASR 原文不可压缩。

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
  it('单行宽度是硬约束：超宽必切，不保留整句', () => {
    const dir = join(process.cwd(), 'src', 'services', 'sentenceSegmentation', '__tests__', 'fixtures');
    const fixture = JSON.parse(readFileSync(join(dir, 'en_probe.words.json'), 'utf8')) as {
      words: Word[];
    };
    const cues = toCues(fixture.words);
    // OneAsr 把这条 100 字符的句子切成 2 条宽行；我们切成 3 条单行。
    expect(cues.length).toBe(3);
    expect(cues[1]!.text).toBe('Welcome everyone into this crash course about our new');
    expect(cues[2]!.text).toBe('15-minute timeframe entry models and strategy.');
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
