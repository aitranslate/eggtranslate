import { describe, it, expect } from 'vitest';
import {
  parseTerminologyContent,
  mergeGlossaryWithUserTerms,
  formatAgentTermsBlock,
} from '../terminology';
import { splitAgentWindows } from '../windows';
import { mapWindowTranslations, resolveWindowSegment } from '../pipeline';
import type { TranscriptEntry } from '../toolTypes';

describe('parseTerminologyContent', () => {
  it('parses glossary and style_guide', () => {
    const r = parseTerminologyContent(
      JSON.stringify({
        glossary: [
          { source: 'TBR', target: '时间基准区间', note: 'trading' },
          { source: 'OK', target: '好的' },
        ],
        style_guide: 'Keep jargon consistent.',
      })
    );
    expect(r.glossary).toHaveLength(2);
    expect(r.glossary[0].source).toBe('TBR');
    expect(r.styleGuide).toMatch(/jargon/);
  });

  it('tolerates fenced / slightly broken JSON via repair path', () => {
    const r = parseTerminologyContent(
      `{"glossary":[{"source":"A","target":"甲"}],"style_guide":"x"}`
    );
    expect(r.glossary[0].target).toBe('甲');
  });
});

describe('mergeGlossaryWithUserTerms', () => {
  it('user target wins on same source', () => {
    const merged = mergeGlossaryWithUserTerms(
      [{ source: 'Hello', target: '你好' }],
      [{ original: 'Hello', translation: '哈喽', notes: 'user' }]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].target).toBe('哈喽');
  });
});

describe('formatAgentTermsBlock', () => {
  it('includes style and glossary lines', () => {
    const block = formatAgentTermsBlock(
      [{ source: 'A', target: '甲' }],
      'Be concise.',
      []
    );
    expect(block).toMatch(/Style guide/);
    expect(block).toMatch(/A -> 甲/);
  });
});

describe('splitAgentWindows', () => {
  it('splits by window size without dropping indices', () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      startTime: '0',
      endTime: '1',
      text: `t${i}`,
      translatedText: '',
      translationStatus: 'pending' as const,
    }));
    const wins = splitAgentWindows(entries, 10, 2);
    expect(wins.length).toBe(3);
    const all = wins.flatMap((w) => w.entryIndices);
    expect(all).toEqual([...Array(25).keys()]);
    expect(wins[0].contextAfterIndices.length).toBe(2);
    expect(wins[1].contextBeforeIndices.length).toBe(2);
  });
});

describe('mapWindowTranslations index robustness', () => {
  it('maps window-local 1..n to entryIds', () => {
    const segs: TranscriptEntry[] = [
      { index: 1, entryId: 101, text: 'A' },
      { index: 2, entryId: 102, text: 'B' },
    ];
    expect(resolveWindowSegment(segs, 1)?.entryId).toBe(101);
    expect(
      mapWindowTranslations(segs, [
        { index: 1, text: '甲' },
        { index: 2, text: '乙' },
      ])
    ).toEqual([
      { entryId: 101, text: '甲' },
      { entryId: 102, text: '乙' },
    ]);
  });

  it('maps 1..n even when prompt used non-contiguous global labels', () => {
    const segs: TranscriptEntry[] = [
      { index: 1, entryId: 201, text: 'A' },
      { index: 2, entryId: 202, text: 'B' },
    ];
    const rows = mapWindowTranslations(segs, [
      { index: 1, text: '甲' },
      { index: 2, text: '乙' },
    ]);
    expect(rows.map((r) => r.entryId)).toEqual([201, 202]);
  });
});
