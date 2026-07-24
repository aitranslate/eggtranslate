import { describe, it, expect, vi } from 'vitest';
import { expandUserTerms } from '../expandUserTerms';
import { checkGlobalTerminology } from '../terminologyCheck';
import { projectContext } from '../projectContext';
import {
  splitBriefingEntryWindows,
  unionGlossaries,
  mergeStyleGuides,
} from '../windows';
import type { LLMMessage } from '@/utils/llmApi';

describe('expandUserTerms literal', () => {
  it('maps case variants of user source', async () => {
    const { rows } = await expandUserTerms({
      userTerms: [{ original: 'Hello', translation: '哈喽' }],
      transcriptText: 'Hello world. HELLO again.',
      useLlm: false,
    });
    expect(rows.some((r) => r.target === '哈喽')).toBe(true);
    expect(rows.every((r) => /hello/i.test(r.source))).toBe(true);
  });

  it('skips ungrounded user terms', async () => {
    const { rows } = await expandUserTerms({
      userTerms: [{ original: 'NotHere', translation: '无' }],
      transcriptText: 'Hello world',
      useLlm: false,
    });
    expect(rows).toHaveLength(0);
  });
});

describe('checkGlobalTerminology', () => {
  it('flags inconsistent targets when some use canonical', () => {
    const issues = checkGlobalTerminology(
      [{ source: 'Acme', target: '艾克米' }],
      [
        { index: 1, text: 'Acme is great' },
        { index: 2, text: 'Buy Acme now' },
      ],
      [
        { index: 1, text: '艾克米很好' },
        { index: 2, text: '现在购买Acme' },
      ]
    );
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues.some((i) => i.index === 2)).toBe(true);
  });

  it('no issue when all consistent', () => {
    const issues = checkGlobalTerminology(
      [{ source: 'Acme', target: '艾克米' }],
      [
        { index: 1, text: 'Acme is great' },
        { index: 2, text: 'Buy Acme now' },
      ],
      [
        { index: 1, text: '艾克米很好' },
        { index: 2, text: '现在购买艾克米' },
      ]
    );
    expect(issues).toHaveLength(0);
  });
});

describe('projectContext', () => {
  it('keeps system and first user; compresses old rounds', () => {
    const messages: LLMMessage[] = [
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'FULL TRANSCRIPT' },
    ];
    for (let r = 1; r <= 6; r++) {
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: `c${r}`,
            type: 'function',
            function: { name: 'search_transcript', arguments: '{"pattern":"x"}' },
          },
        ],
      });
      messages.push({
        role: 'tool',
        tool_call_id: `c${r}`,
        content: `result ${r} `.repeat(20),
      });
    }
    const projected = projectContext(messages, { keepRecentTurns: 2 });
    expect(projected[0].content).toBe('SYS');
    expect(projected[1].content).toBe('FULL TRANSCRIPT');
    expect(projected.length).toBeLessThan(messages.length);
    expect(
      projected.some(
        (m) => m.role === 'user' && String(m.content).includes('prior round')
      )
    ).toBe(true);
  });
});

describe('briefing windows', () => {
  it('splits long transcripts into multiple windows', () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({
      index: i + 1,
      text: 'word '.repeat(100),
    }));
    const wins = splitBriefingEntryWindows(entries, 2000, 2);
    expect(wins.length).toBeGreaterThan(1);
    const total = wins.reduce((n, w) => n + w.length, 0);
    // overlap means sum of lengths > n
    expect(total).toBeGreaterThanOrEqual(100);
  });

  it('unionGlossaries first-seen wins', () => {
    const u = unionGlossaries([
      [{ source: 'A', target: '甲' }],
      [
        { source: 'A', target: '忽略' },
        { source: 'B', target: '乙' },
      ],
    ]);
    expect(u).toHaveLength(2);
    expect(u.find((g) => g.source === 'A')?.target).toBe('甲');
  });

  it('mergeStyleGuides keeps primary length', () => {
    const s = mergeStyleGuides(['short', 'this is a longer primary style guide text']);
    expect(s).toMatch(/longer primary/);
  });
});
