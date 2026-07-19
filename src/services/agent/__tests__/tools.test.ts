import { describe, it, expect, vi } from 'vitest';
import { dispatchTool } from '../tools/registry';
import { coerceToolInt, parseToolArgs } from '../toolTypes';
import type { AgentToolContext } from '../toolTypes';

function baseCtx(over: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    transcriptEntries: [
      { index: 1, text: 'Hello order block world', start: '0' },
      { index: 2, text: 'Another order block', start: '1' },
    ],
    ...over,
  };
}

describe('parseToolArgs (lenient)', () => {
  it('repairs trailing commas and markdown fences', () => {
    expect(parseToolArgs('{"pattern":"x",}')).toEqual({ pattern: 'x' });
    expect(parseToolArgs('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('coerceToolInt accepts numeric strings', () => {
    expect(coerceToolInt('12')).toBe(12);
    expect(coerceToolInt(3.0)).toBe(3);
    expect(coerceToolInt(true)).toBeNull();
  });
});

describe('agent tools', () => {
  it('search_transcript finds hits', async () => {
    const r = await dispatchTool(
      'search_transcript',
      JSON.stringify({ pattern: 'order block' }),
      baseCtx()
    );
    expect(r.terminate).toBe(false);
    expect(r.content).toMatch(/Found 2/);
  });

  it('submit_translation enforces full coverage', async () => {
    const ctx = baseCtx({
      expectedIndices: new Set([1, 2]),
      indexToSource: { 1: 'Hello', 2: 'World' },
    });
    const bad = await dispatchTool(
      'submit_translation',
      JSON.stringify({ translations: [{ index: 1, text: '你好' }] }),
      ctx
    );
    expect(bad.terminate).toBe(false);
    expect(bad.content).toMatch(/Missing/);

    const ok = await dispatchTool(
      'submit_translation',
      JSON.stringify({
        translations: [
          { index: 1, text: '你好' },
          { index: 2, text: '世界' },
        ],
      }),
      ctx
    );
    expect(ok.terminate).toBe(true);
    expect(ctx.finalResult).toBeTruthy();
  });

  it('submit_result accepts glossary', async () => {
    const ctx = baseCtx();
    const r = await dispatchTool(
      'submit_result',
      JSON.stringify({
        glossary: [{ source: 'Hello', target: '你好' }],
        style_guide: 'Keep it short.',
      }),
      ctx
    );
    expect(r.terminate).toBe(true);
    expect((ctx.finalResult as { glossary: unknown[] }).glossary).toHaveLength(1);
  });

  it('submit_qa_report accepts empty issues', async () => {
    const ctx = baseCtx();
    const r = await dispatchTool(
      'submit_qa_report',
      JSON.stringify({ issues: [] }),
      ctx
    );
    expect(r.terminate).toBe(true);
  });

  it('web_search respects budget and uses Parallel when fetch ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          result: { content: [{ text: 'Parallel says TBR is a trading term.' }] },
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const ctx = baseCtx({ webSearchCount: 0, maxWebSearches: 2, title: 'demo' });
    const r = await dispatchTool(
      'web_search',
      JSON.stringify({ query: 'TBR trading' }),
      ctx
    );
    expect(r.content).toMatch(/web_search/);
    expect(r.content).toMatch(/Parallel says/);
    expect(ctx.webSearchCount).toBe(1);
    expect(fetchMock).toHaveBeenCalled();

    ctx.maxWebSearches = 1;
    ctx.webSearchCount = 1;
    const budget = await dispatchTool(
      'web_search',
      JSON.stringify({ query: 'another' }),
      ctx
    );
    expect(budget.content).toMatch(/budget exhausted/);

    vi.unstubAllGlobals();
  });
});
