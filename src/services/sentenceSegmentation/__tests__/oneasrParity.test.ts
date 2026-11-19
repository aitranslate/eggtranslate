// OneAsr 断句一致性回归：期望值由 OneAsr 自己的
// `cargo run -p oneasr-core --example replay_pipeline -- <words.json> standard`
// 产出（同目录 fixtures/*.expected.srt）。比对文本与起始时间；
// 结束时间不比对——OneAsr 的 SRT 导出会用 enforce_monotonic 夹掉相邻重叠。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { segmentWords } from '../index';

interface Cue {
  start: string;
  text: string;
}

function parseSrt(raw: string): Cue[] {
  const out: Cue[] = [];
  for (const block of raw.replace(/\r/g, '').split('\n\n')) {
    const lines = block.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length < 3) continue;
    const m = /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/.exec(lines[1] ?? '');
    if (!m) continue;
    out.push({ start: m[1]!, text: lines.slice(2).join(' ') });
  }
  return out;
}

const fmt = (ms: number): string => {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};

// en_probe 不在里面：那条刻意偏离 OneAsr（见 segmentationDeviations.test.ts）
const CASES = ['en_slice', 'zh_slice', 'ja_tiny'];

describe('OneAsr 断句一致性', () => {
  for (const id of CASES) {
    it(`${id} 与 OneAsr 输出逐条一致`, () => {
      const dir = join(process.cwd(), 'src', 'services', 'sentenceSegmentation', '__tests__', 'fixtures');
      const fixture = JSON.parse(readFileSync(join(dir, `${id}.words.json`), 'utf8')) as {
        lang: string;
        preset: 'short' | 'standard' | 'loose';
        words: Array<{ text: string; start: number; end: number }>;
      };
      const expected = parseSrt(readFileSync(join(dir, `${id}.expected.srt`), 'utf8'));
      const ours = segmentWords(fixture.words, fixture.lang, fixture.preset, {
        watchabilityMerge: true,
      }).map((c) => ({ start: fmt(c.startTime), text: c.text }));

      expect(ours.length).toBe(expected.length);
      expect(ours).toEqual(expected);
    });
  }
});
