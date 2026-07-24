import { describe, it, expect } from 'vitest';
import {
  parseTerminologyContent,
  mergeGlossaryWithUserTerms,
  groundGlossaryForTranslation,
  sourceGroundedInText,
  alignStyleGuideToGlossary,
  finalizeAgentGlossary,
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

describe('sourceGroundedInText', () => {
  it('matches word boundaries not substrings', () => {
    expect(sourceGroundedInText('POI', 'the POI is here')).toBe(true);
    expect(sourceGroundedInText('POI', 'the point is here')).toBe(false);
    expect(sourceGroundedInText('scale', 'upscale filter')).toBe(false);
    expect(sourceGroundedInText('scale', 'the scale works')).toBe(true);
  });

  it('allows compact multi-word ASR forms', () => {
    expect(sourceGroundedInText('fair value', 'the fairvalue gap')).toBe(true);
  });

  it('grounds Latin term next to CJK (ASCII boundaries)', () => {
    expect(sourceGroundedInText('Acme', '欢迎来到Acme公司')).toBe(true);
    expect(sourceGroundedInText('Nasdaq', '我只做Nasdaq')).toBe(true);
  });

  it('grounds pure CJK terms by literal include', () => {
    expect(sourceGroundedInText('基础命中', '我在讲基础命中策略')).toBe(true);
    expect(sourceGroundedInText('情绪失控', '避免情绪失控很重要')).toBe(true);
    expect(sourceGroundedInText('不存在词', '我在讲基础命中策略')).toBe(false);
  });
});

describe('groundGlossaryForTranslation', () => {
  it('drops ungrounded agent invention', () => {
    const g = groundGlossaryForTranslation(
      [
        { source: 'Acme', target: '艾克米' },
        { source: 'NotInText', target: '不在' },
      ],
      'Welcome to Acme Corp.'
    );
    expect(g.map((x) => x.source)).toEqual(['Acme']);
  });

  it('expands A (B) only when parts appear', () => {
    const g = groundGlossaryForTranslation(
      [{ source: 'Acme (AC)', target: '艾克米' }],
      'We use AC daily. No full brand.'
    );
    expect(g).toHaveLength(1);
    expect(g[0].source).toBe('AC');
    expect(g[0].target).toBe('艾克米');
  });
});

describe('mergeGlossaryWithUserTerms', () => {
  const transcript = 'Hello world. Hello again. FOO bar.';

  it('user target wins on same grounded source', () => {
    const merged = mergeGlossaryWithUserTerms(
      [{ source: 'Hello', target: '你好' }],
      [{ original: 'Hello', translation: '哈喽', notes: 'user' }],
      { transcriptText: transcript }
    );
    expect(merged.some((g) => g.source === 'Hello' && g.target === '哈喽')).toBe(
      true
    );
  });

  it('does not dump ungrounded user terms by default', () => {
    const merged = mergeGlossaryWithUserTerms(
      [{ source: 'Hello', target: '你好' }],
      [{ original: 'NotPresent', translation: '不存在' }],
      { transcriptText: transcript }
    );
    expect(merged.every((g) => g.source !== 'NotPresent')).toBe(true);
  });

  it('forceAllUserTerms includes ungrounded user sources', () => {
    const merged = mergeGlossaryWithUserTerms(
      [],
      [{ original: 'NotPresent', translation: '不存在' }],
      { transcriptText: transcript, forceAllUserTerms: true }
    );
    expect(merged.some((g) => g.source === 'NotPresent')).toBe(true);
  });

  it('drops ungrounded agent rows when transcript provided', () => {
    const merged = mergeGlossaryWithUserTerms(
      [{ source: 'Invented', target: '发明' }],
      [],
      { transcriptText: transcript }
    );
    expect(merged).toHaveLength(0);
  });
});

describe('alignStyleGuideToGlossary', () => {
  it('rewrites conflicting quoted targets', () => {
    const style =
      '核心概念"base hits"译为"垒打"。核心概念"base hits"译为"基础安打"。';
    const fixed = alignStyleGuideToGlossary(style, [
      { source: 'base hits', target: '基础安打' },
    ]);
    expect(fixed).not.toMatch(/垒打/);
    expect(fixed.match(/基础安打/g)?.length).toBe(2);
  });
});

describe('finalizeAgentGlossary', () => {
  it('grounds and aligns style', () => {
    const r = finalizeAgentGlossary(
      [{ source: 'Hello', target: '你好' }],
      [{ original: 'Hello', translation: '哈喽' }],
      '"Hello"译为"你好"',
      { transcriptText: 'Hello world' }
    );
    expect(r.glossary.some((g) => g.target === '哈喽')).toBe(true);
    expect(r.styleGuide).toMatch(/哈喽|Hello/);
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
