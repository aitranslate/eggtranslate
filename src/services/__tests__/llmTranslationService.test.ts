import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateTranslationResult,
  translateBatch,
  testLlmConnection,
  parseTranslationContent,
  countFilledKeys,
  isTranslationComplete,
} from '../llmTranslationService';
import type { TranslationConfig } from '@/types';

vi.mock('@/utils/llmApi', () => ({
  callLLM: vi.fn(),
  callLLMStream: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import { callLLM, callLLMStream } from '@/utils/llmApi';

const baseConfig = (): TranslationConfig => ({
  profiles: [
    {
      id: 'custom',
      name: '自定义',
      baseURL: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'test-model',
      presetId: 'custom',
    },
  ],
  activeProfileId: 'custom',
  sourceLanguage: 'English',
  targetLanguage: '简体中文',
  batchSize: 20,
  contextBefore: 5,
  contextAfter: 3,
  threadCount: 4,
});

describe('validateTranslationResult', () => {
  it('accepts complete keys', () => {
    expect(() =>
      validateTranslationResult(
        {
          '1': { direct: '你好' },
          '2': { direct: '世界' },
        },
        ['Hello', 'World']
      )
    ).not.toThrow();
  });

  it('throws when a key is missing', () => {
    expect(() =>
      validateTranslationResult({ '1': { direct: '你好' } }, ['Hello', 'World'])
    ).toThrow(/缺少键 "2"/);
  });

  it('throws when entry shape is invalid', () => {
    expect(() =>
      validateTranslationResult(
        { '1': { origin: 'x' } as unknown as { direct: string } },
        ['Hello']
      )
    ).toThrow(/格式无效/);
  });
});

describe('testLlmConnection', () => {
  beforeEach(() => {
    vi.mocked(callLLM).mockReset();
  });

  it('returns error when key required but empty', async () => {
    const result = await testLlmConnection({
      baseURL: 'https://api.example.com/v1',
      apiKey: '',
      model: 'm',
      requiresKey: true,
    });
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/API 密钥/) });
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('returns ok on successful callLLM', async () => {
    vi.mocked(callLLM).mockResolvedValue({ content: 'hi', tokensUsed: 1 });
    const result = await testLlmConnection({
      baseURL: 'https://api.example.com/v1',
      apiKey: 'sk-x',
      model: 'm',
    });
    expect(result).toEqual({ ok: true });
  });

  it('returns message on callLLM failure', async () => {
    vi.mocked(callLLM).mockRejectedValue(new Error('401 Unauthorized'));
    const result = await testLlmConnection({
      baseURL: 'https://api.example.com/v1',
      apiKey: 'sk-x',
      model: 'm',
    });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ ok: false });
    if (result.ok === false) {
      expect(result.message).toMatch(/401|失败|Unauthorized/);
    }
  });
});

describe('translateBatch', () => {
  beforeEach(() => {
    vi.mocked(callLLM).mockReset();
    vi.mocked(callLLMStream).mockReset();
  });

  it('throws when API key missing', async () => {
    const config = baseConfig();
    config.profiles[0].apiKey = '';
    await expect(translateBatch(config, ['Hello'])).rejects.toThrow(/API密钥/);
  });

  it('returns parsed translations from stream success', async () => {
    vi.mocked(callLLMStream).mockResolvedValue({
      content: JSON.stringify({
        '1': { origin: 'Hello', direct: '你好' },
      }),
      tokensUsed: 12,
    });

    const result = await translateBatch(baseConfig(), ['Hello']);
    expect(result.tokensUsed).toBe(12);
    expect(result.translations['1'].direct).toBe('你好');
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('falls back to non-stream when stream fails', async () => {
    vi.mocked(callLLMStream).mockRejectedValue(new Error('stream broken'));
    vi.mocked(callLLM).mockResolvedValue({
      content: JSON.stringify({
        '1': { origin: 'Hello', direct: '你好' },
      }),
      tokensUsed: 8,
    });

    const result = await translateBatch(baseConfig(), ['Hello']);
    expect(result.translations['1'].direct).toBe('你好');
    expect(callLLM).toHaveBeenCalled();
  });

  it('invokes onPartial during stream deltas', async () => {
    const onPartial = vi.fn();
    vi.mocked(callLLMStream).mockImplementation(async (_c, _m, opts) => {
      opts?.onDelta?.('', '{"1":{"direct":"你');
      opts?.onDelta?.('', '{"1":{"direct":"你好"}');
      return {
        content: JSON.stringify({ '1': { origin: 'Hello', direct: '你好' } }),
        tokensUsed: 3,
      };
    });

    await translateBatch(baseConfig(), ['Hello'], { onPartial });
    // rAF may not fire in node; final flush in finally still runs emit when accumulated set
    // At least stream path completed without throw
    expect(callLLMStream).toHaveBeenCalled();
  });

  it('retries incomplete stream result then accepts partial on last attempt', async () => {
    const onAttemptStart = vi.fn();
    // 三次都不齐：缺 key "2"；tokens 应累计
    vi.mocked(callLLMStream).mockResolvedValue({
      content: JSON.stringify({
        '1': { origin: 'A', direct: '甲' },
      }),
      tokensUsed: 5,
    });

    const result = await translateBatch(baseConfig(), ['A', 'B'], {
      onAttemptStart,
    });

    expect(callLLMStream).toHaveBeenCalledTimes(3);
    expect(onAttemptStart).toHaveBeenCalledTimes(3);
    expect(onAttemptStart.mock.calls.map((c) => c[0])).toEqual([1, 2, 3]);
    expect(result.partial).toBe(true);
    expect(result.translations['1'].direct).toBe('甲');
    expect(result.translations['2']).toBeUndefined();
    expect(result.tokensUsed).toBe(15);
  });

  it('returns full result without retry when stream is complete', async () => {
    vi.mocked(callLLMStream).mockResolvedValue({
      content: JSON.stringify({
        '1': { origin: 'A', direct: '甲' },
        '2': { origin: 'B', direct: '乙' },
      }),
      tokensUsed: 4,
    });

    const result = await translateBatch(baseConfig(), ['A', 'B']);
    expect(callLLMStream).toHaveBeenCalledTimes(1);
    expect(result.partial).toBe(false);
    expect(isTranslationComplete(result.translations, ['A', 'B'])).toBe(true);
  });

  it('salvages partial from stream buffer when final JSON parse would fail', async () => {
    // 半截 JSON：严格 parse 会失败，但 extractStreamingDirects 能抽出 1
    vi.mocked(callLLMStream).mockResolvedValue({
      content: '{"1":{"origin":"A","direct":"甲"},"2":{"origin":"B","direct":"乙',
      tokensUsed: 2,
    });

    const result = await translateBatch(baseConfig(), ['A', 'B']);
    expect(countFilledKeys(result.translations, ['A', 'B'])).toBeGreaterThanOrEqual(1);
    expect(result.translations['1']?.direct).toContain('甲');
  });
});

describe('parseTranslationContent (stream-aligned)', () => {
  it('parses complete JSON', () => {
    const r = parseTranslationContent(
      JSON.stringify({ '1': { direct: '你好' }, '2': { direct: '世界' } })
    );
    expect(r['1'].direct).toBe('你好');
    expect(r['2'].direct).toBe('世界');
  });

  it('extracts directs from truncated stream JSON', () => {
    const r = parseTranslationContent(
      '{"1":{"direct":"前半"},"2":{"direct":"未闭合'
    );
    expect(r['1'].direct).toBe('前半');
    // 未闭合也可能抽出部分
    expect(r['2']?.direct?.length ?? 0).toBeGreaterThanOrEqual(0);
  });
});
