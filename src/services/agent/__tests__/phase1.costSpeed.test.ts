/**
 * Phase 1: window glossary filter, risk QA, translate loop options, run_stats.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { filterGlossaryForWindow } from '../windowGlossary';
import { assessWindowRisk } from '../windowRisk';
import {
  DEFAULT_TRANSLATE_MAX_ROUNDS,
  translateToolChoice,
  runTranslateWindowAgent,
} from '../agents/translateAgent';
import {
  applyAgentEventToStatus,
  createIdleAgentRunStatus,
} from '../agentRunStatus';
import { runAgentTranslation } from '../pipeline';
import type { SubtitleEntry, TranslationConfig } from '@/types';
import type { AgentEvent, RunAgentTranslationInput } from '../types';

vi.mock('@/utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../checkpointStore', () => ({
  loadAgentJob: vi.fn(async () => null),
  saveAgentJob: vi.fn(async () => {}),
  clearAgentJob: vi.fn(async () => {}),
  computeAgentFingerprint: vi.fn(() => 'fp'),
  createEmptyJob: vi.fn(({ taskId, fileId, fingerprint }) => ({
    schemaVersion: 1,
    taskId,
    fileId,
    fingerprint,
    stage: 'terminology',
    glossary: [],
    styleGuide: '',
    windowResults: {},
    updatedAt: 0,
  })),
}));

const callLLM = vi.fn();
vi.mock('@/utils/llmApi', () => ({
  callLLM: (...args: unknown[]) => callLLM(...args),
  callLLMStream: vi.fn(),
}));

const runWindowQaAgent = vi.fn();
vi.mock('../agents/qaAgent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agents/qaAgent')>();
  return {
    ...actual,
    runWindowQaAgent: (...args: unknown[]) => runWindowQaAgent(...args),
  };
});

function assistantTool(name: string, args: unknown, id = 'c1') {
  const toolCalls = [
    {
      id,
      type: 'function' as const,
      function: { name, arguments: JSON.stringify(args) },
    },
  ];
  return {
    content: '',
    tokensUsed: 5,
    toolCalls,
    message: { role: 'assistant' as const, content: null, tool_calls: toolCalls },
  };
}

const baseConfig = (over: Partial<TranslationConfig> = {}): TranslationConfig => ({
  profiles: [
    {
      id: 'custom',
      name: 'c',
      baseURL: 'https://x',
      apiKey: 'k',
      model: 'm',
    },
  ],
  activeProfileId: 'custom',
  sourceLanguage: 'English',
  targetLanguage: '简体中文',
  batchSize: 20,
  threadCount: 2,
  contextBefore: 2,
  contextAfter: 2,
  agentTranslationEnabled: true,
  agentWindowSize: 10,
  agentMaxConcurrency: 1,
  agentSoftWebNudge: false,
  agentMaxWebSearches: 0,
  agentExpandUserTerms: false,
  ...over,
});

const entries: SubtitleEntry[] = [
  {
    id: 1,
    startTime: '00:00:00,000',
    endTime: '00:00:01,000',
    text: 'Hello Acme Corp',
    translatedText: '',
    translationStatus: 'pending',
  },
  {
    id: 2,
    startTime: '00:00:01,000',
    endTime: '00:00:02,000',
    text: 'Simple line',
    translatedText: '',
    translationStatus: 'pending',
  },
];

describe('filterGlossaryForWindow', () => {
  it('returns only glossary entries grounded in window texts', () => {
    const glossary = [
      { source: 'Acme Corp', target: '艾克米' },
      { source: 'UnrelatedTerm', target: '无关' },
      { source: 'Hello', target: '你好' },
    ];
    const filtered = filterGlossaryForWindow(glossary, [
      'Hello Acme Corp',
      'Simple line',
    ]);
    const sources = filtered.map((g) => g.source);
    expect(sources).toContain('Acme Corp');
    expect(sources).toContain('Hello');
    expect(sources).not.toContain('UnrelatedTerm');
    const acme = filtered.find((g) => g.source === 'Acme Corp');
    expect(acme?.target).toBe('艾克米');
  });

  it('returns empty when no sources hit the window', () => {
    const filtered = filterGlossaryForWindow(
      [{ source: 'OnlyElsewhere', target: '别处' }],
      ['Nothing matches here']
    );
    expect(filtered).toEqual([]);
  });
});

describe('window risk (product = risk only)', () => {
  it('flags glossary target missing as risk', () => {
    const risk = assessWindowRisk({
      segments: [{ index: 1, text: 'Hello Acme Corp' }],
      translations: [{ index: 1, text: '你好公司' }],
      glossary: [{ source: 'Acme Corp', target: '艾克米' }],
    });
    expect(risk.risk).toBe(true);
    expect(risk.signals).toContain('glossary_target_missing');
  });

  it('low risk when glossary targets present and coverage full', () => {
    const risk = assessWindowRisk({
      segments: [
        { index: 1, text: 'Hello Acme Corp' },
        { index: 2, text: 'Simple line' },
      ],
      translations: [
        { index: 1, text: '你好 艾克米' },
        { index: 2, text: '简单一句' },
      ],
      glossary: [{ source: 'Acme Corp', target: '艾克米' }],
    });
    expect(risk.risk).toBe(false);
    expect(risk.signals).toEqual([]);
  });
});

describe('translate loop options', () => {
  it('DEFAULT_TRANSLATE_MAX_ROUNDS is ≤ 8', () => {
    expect(DEFAULT_TRANSLATE_MAX_ROUNDS).toBeLessThanOrEqual(8);
    expect(DEFAULT_TRANSLATE_MAX_ROUNDS).toBeGreaterThan(0);
  });

  it('translateToolChoice forces submit_translation', () => {
    const tc = translateToolChoice();
    expect(tc).toEqual({
      type: 'function',
      function: { name: 'submit_translation' },
    });
  });

  it('runTranslateWindowAgent passes tightened maxRounds and forced tool_choice', async () => {
    callLLM.mockReset();
    callLLM.mockResolvedValueOnce(
      assistantTool('submit_translation', {
        translations: [{ index: 1, text: '你好' }],
      })
    );

    const result = await runTranslateWindowAgent({
      window: {
        windowIndex: 0,
        segments: [
          {
            index: 1,
            text: 'Hello',
            entryId: 1,
            start: '00:00:00,000',
            end: '00:00:01,000',
          },
        ],
      },
      glossary: [{ source: 'Hello', target: '你好' }],
      styleGuide: 'Natural.',
      config: baseConfig(),
      signal: new AbortController().signal,
    });

    expect(result.translations).toHaveLength(1);
    expect(callLLM).toHaveBeenCalledTimes(1);
    const opts = callLLM.mock.calls[0][2] as {
      tool_choice?: unknown;
    };
    expect(opts.tool_choice).toEqual({
      type: 'function',
      function: { name: 'submit_translation' },
    });
  });
});

describe('run_stats → status reduction', () => {
  it('exposes stage token breakdown and qa run/skip counts', () => {
    const events: AgentEvent[] = [
      { type: 'pipeline_start', totalEntries: 10, totalWindows: 2 },
      {
        type: 'run_stats',
        tokensTerminology: 100,
        tokensTranslate: 200,
        tokensQa: 50,
        tokensTotal: 350,
        qaWindowsRun: 1,
        qaWindowsSkipped: 1,
        totalWindows: 2,
      },
      { type: 'pipeline_end' },
    ];
    let s = createIdleAgentRunStatus('f', 't');
    for (const e of events) {
      s = applyAgentEventToStatus(s, e, { fileId: 'f', taskId: 't' });
    }
    expect(s.tokensTerminology).toBe(100);
    expect(s.tokensTranslate).toBe(200);
    expect(s.tokensQa).toBe(50);
    expect(s.tokensTotal).toBeGreaterThanOrEqual(350);
    expect(s.qaWindowsRun).toBe(1);
    expect(s.qaWindowsSkipped).toBe(1);
    expect(s.recentEvents.some((e) => e.text.includes('跳'))).toBe(true);
  });
});

describe('pipeline QA branch (product = risk, stubbed QA)', () => {
  beforeEach(() => {
    callLLM.mockReset();
    runWindowQaAgent.mockReset();
    runWindowQaAgent.mockResolvedValue({ issues: [], tokensUsed: 3 });
  });

  async function runWithTranslations(translationText: [string, string]) {
    const events: AgentEvent[] = [];
    callLLM
      .mockResolvedValueOnce(
        assistantTool('submit_result', {
          glossary: [{ source: 'Acme Corp', target: '艾克米' }],
          style_guide: 'Natural Chinese.',
        })
      )
      .mockResolvedValueOnce(
        assistantTool('submit_translation', {
          translations: [
            { index: 1, text: translationText[0] },
            { index: 2, text: translationText[1] },
          ],
        })
      );

    const input: RunAgentTranslationInput = {
      fileId: 'f1',
      taskId: 't1',
      filename: 'a.srt',
      config: baseConfig(),
      signal: new AbortController().signal,
      userTerms: [],
      onEvent: (e) => {
        events.push(e);
      },
    };

    await runAgentTranslation(entries, input);
    return events;
  }

  it('skips LLM QA on clean window (risk product default)', async () => {
    const events = await runWithTranslations(['你好 艾克米', '简单一句']);
    expect(runWindowQaAgent).not.toHaveBeenCalled();
    const stats = events.find((e) => e.type === 'run_stats');
    expect(stats?.type).toBe('run_stats');
    if (stats?.type === 'run_stats') {
      expect(stats.qaWindowsSkipped).toBe(1);
      expect(stats.qaWindowsRun).toBe(0);
    }
    expect(events.some((e) => e.type === 'pipeline_end')).toBe(true);
  });

  it('runs LLM QA when glossary target missing', async () => {
    const events = await runWithTranslations(['你好公司', '简单一句']);
    expect(runWindowQaAgent).toHaveBeenCalledTimes(1);
    const stats = events.find((e) => e.type === 'run_stats');
    if (stats?.type === 'run_stats') {
      expect(stats.qaWindowsRun).toBe(1);
      expect(stats.qaWindowsSkipped).toBe(0);
    }
  });
});
