/**
 * Agent 全管线：tool-loop 术语 / 翻译 / QA（mock callLLM）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAgentTranslation } from '../pipeline';
import type { SubtitleEntry, TranslationConfig } from '@/types';
import type { RunAgentTranslationInput } from '../types';

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

const entries: SubtitleEntry[] = [
  {
    id: 1,
    startTime: '00:00:00,000',
    endTime: '00:00:01,000',
    text: 'Hello',
    translatedText: '',
    translationStatus: 'pending',
  },
  {
    id: 2,
    startTime: '00:00:01,000',
    endTime: '00:00:02,000',
    text: 'World',
    translatedText: '',
    translationStatus: 'pending',
  },
];

const baseConfig = (): TranslationConfig => ({
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
  // Integration mock only submits once; disable soft web friction for path test.
  agentSoftWebNudge: false,
  agentMaxWebSearches: 0,
  agentExpandUserTerms: false,
});

function assistantTool(
  name: string,
  args: unknown,
  id = 'c1'
): {
  content: string;
  tokensUsed: number;
  toolCalls: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  message: {
    role: 'assistant';
    content: null;
    tool_calls: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
  };
} {
  const toolCalls = [
    {
      id,
      type: 'function' as const,
      function: { name, arguments: JSON.stringify(args) },
    },
  ];
  return {
    content: '',
    tokensUsed: 2,
    toolCalls,
    message: { role: 'assistant', content: null, tool_calls: toolCalls },
  };
}

describe('runAgentTranslation full tool-loop', () => {
  beforeEach(() => {
    callLLM.mockReset();
  });

  it('terminology submit → translate submit → risk-skip QA → pipeline_end', async () => {
    const events: string[] = [];

    // risk 模式：译文已用 glossary target，干净窗跳过 LLM QA
    callLLM
      .mockResolvedValueOnce(
        assistantTool('submit_result', {
          glossary: [{ source: 'Hello', target: '你好' }],
          style_guide: 'Natural Chinese.',
        })
      )
      .mockResolvedValueOnce(
        assistantTool('submit_translation', {
          translations: [
            { index: 1, text: '你好' },
            { index: 2, text: '世界' },
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
        events.push(e.type);
      },
      // 全 tool 路径不再依赖 translateBatch；保留注入位
      translateBatch: vi.fn(async () => ({ translations: {}, tokensUsed: 0 })),
    };

    const result = await runAgentTranslation(entries, input);
    expect(result.tokensUsed).toBeGreaterThan(0);
    expect(callLLM).toHaveBeenCalled();
    // tools 被传入
    const firstTools = callLLM.mock.calls[0][2]?.tools;
    expect(Array.isArray(firstTools)).toBe(true);
    expect(events).toContain('terminology_done');
    expect(events).toContain('translation_partial');
    expect(events).toContain('window_done');
    expect(events).toContain('pipeline_end');
  });

  it('emits pipeline_error then rethrows on non-abort failure', async () => {
    const events: Array<{ type: string; error?: string }> = [];
    // tool 与 fallback 都会打 callLLM，需全部失败才能冒泡
    callLLM.mockRejectedValue(new Error('LLM down'));

    const input: RunAgentTranslationInput = {
      fileId: 'f1',
      taskId: 't1',
      filename: 'a.srt',
      config: baseConfig(),
      signal: new AbortController().signal,
      userTerms: [],
      onEvent: (e) => {
        events.push({
          type: e.type,
          error: e.type === 'pipeline_error' ? e.error : undefined,
        });
      },
      translateBatch: vi.fn(async () => ({ translations: {}, tokensUsed: 0 })),
    };

    await expect(runAgentTranslation(entries, input)).rejects.toThrow();
    const errEv = events.find((e) => e.type === 'pipeline_error');
    expect(errEv).toBeTruthy();
    expect(errEv?.error).toBeTruthy();
    expect(events.some((e) => e.type === 'pipeline_end')).toBe(false);
  });

  it('resume from translate stage re-emits glossary for UI', async () => {
    const { loadAgentJob } = await import('../checkpointStore');
    vi.mocked(loadAgentJob).mockResolvedValueOnce({
      schemaVersion: 1,
      taskId: 't1',
      fileId: 'f1',
      fingerprint: 'fp',
      stage: 'translate',
      glossary: [
        { source: 'key levels', target: '关键位' },
        { source: 'order block', target: '订单块' },
      ],
      styleGuide: 'Trading tone.',
      windowResults: {},
      updatedAt: Date.now(),
    });

    const events: Array<{ type: string; glossary?: unknown[] }> = [];
    // risk：有 glossary 但译文未用 target → 触发 QA
    callLLM
      .mockResolvedValueOnce(
        assistantTool('submit_translation', {
          translations: [
            { index: 1, text: '你好' },
            { index: 2, text: '世界' },
          ],
        })
      )
      .mockResolvedValueOnce(
        assistantTool('submit_qa_report', { issues: [] })
      );

    await runAgentTranslation(entries, {
      fileId: 'f1',
      taskId: 't1',
      filename: 'a.srt',
      config: baseConfig(),
      signal: new AbortController().signal,
      userTerms: [],
      onEvent: (e) => {
        events.push({
          type: e.type,
          glossary: e.type === 'terminology_done' ? e.glossary : undefined,
        });
      },
    });

    const termDone = events.find((e) => e.type === 'terminology_done');
    expect(termDone).toBeTruthy();
    expect(termDone?.glossary).toHaveLength(2);
    // Resume must not call terminology submit_result
    for (const call of callLLM.mock.calls) {
      const tools = call[2]?.tools as
        | Array<{ function?: { name?: string } }>
        | undefined;
      const names = (tools || []).map((t) => t.function?.name);
      expect(names).not.toContain('submit_result');
    }
  });

  it('abort does not emit pipeline_error', async () => {
    const events: string[] = [];
    const ac = new AbortController();
    ac.abort();

    const input: RunAgentTranslationInput = {
      fileId: 'f1',
      taskId: 't1',
      filename: 'a.srt',
      config: baseConfig(),
      signal: ac.signal,
      userTerms: [],
      onEvent: (e) => {
        events.push(e.type);
      },
      translateBatch: vi.fn(async () => ({ translations: {}, tokensUsed: 0 })),
    };

    await expect(runAgentTranslation(entries, input)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(events).not.toContain('pipeline_error');
  });
});
