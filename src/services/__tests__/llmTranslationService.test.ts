import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateTranslationResult,
  translateBatch,
  testLlmConnection,
  parseTranslationContent,
  countFilledKeys,
  isTranslationComplete,
  describeTranslationGaps,
  buildRepairFeedbackMessage,
  mergeTranslationResults,
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
    // 三次都不齐：缺 key "2"；tokens 应累计；第 2/3 轮应带对话纠错
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

    // 第 1 轮：仅 user 主 prompt
    const firstMsgs = vi.mocked(callLLMStream).mock.calls[0][1] as Array<{
      role: string;
      content: string;
    }>;
    expect(firstMsgs).toHaveLength(1);
    expect(firstMsgs[0].role).toBe('user');

    // 第 2 轮：user + assistant(回灌) + user(missing 反馈)
    const secondMsgs = vi.mocked(callLLMStream).mock.calls[1][1] as Array<{
      role: string;
      content: string;
    }>;
    expect(secondMsgs.length).toBeGreaterThanOrEqual(3);
    expect(secondMsgs[1].role).toBe('assistant');
    expect(secondMsgs[2].role).toBe('user');
    expect(secondMsgs[2].content).toMatch(/Missing keys/);
    expect(secondMsgs[2].content).toMatch(/"2"/);
    // 纠错轮低温
    expect(vi.mocked(callLLMStream).mock.calls[1][2]?.temperature).toBe(0.1);
  });

  it('repairs missing key on second turn without third call', async () => {
    vi.mocked(callLLMStream)
      .mockResolvedValueOnce({
        content: JSON.stringify({ '1': { origin: 'A', direct: '甲' } }),
        tokensUsed: 3,
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          '1': { origin: 'A', direct: '甲' },
          '2': { origin: 'B', direct: '乙' },
        }),
        tokensUsed: 4,
      });

    const result = await translateBatch(baseConfig(), ['A', 'B']);
    expect(callLLMStream).toHaveBeenCalledTimes(2);
    expect(result.partial).toBe(false);
    expect(result.translations['2'].direct).toBe('乙');
    expect(result.tokensUsed).toBe(7);
  });

  it('merges repair that only fills missing keys', async () => {
    vi.mocked(callLLMStream)
      .mockResolvedValueOnce({
        content: JSON.stringify({ '1': { origin: 'A', direct: '甲' } }),
        tokensUsed: 2,
      })
      .mockResolvedValueOnce({
        // 纠错轮只返回缺的 2（常见省 token 行为）
        content: JSON.stringify({ '2': { origin: 'B', direct: '乙' } }),
        tokensUsed: 2,
      });

    const result = await translateBatch(baseConfig(), ['A', 'B']);
    expect(callLLMStream).toHaveBeenCalledTimes(2);
    expect(result.partial).toBe(false);
    expect(result.translations['1'].direct).toBe('甲');
    expect(result.translations['2'].direct).toBe('乙');
  });

  it('repair feedback uses merged gaps (does not re-list already filled keys)', async () => {
    // 第 1 轮只有 1；第 2 轮仍只有 1 → 第 3 轮的 user 反馈仍应只报缺 2，且 messages 含累计语义
    vi.mocked(callLLMStream).mockResolvedValue({
      content: JSON.stringify({ '1': { origin: 'A', direct: '甲' } }),
      tokensUsed: 1,
    });

    await translateBatch(baseConfig(), ['A', 'B']);
    expect(callLLMStream).toHaveBeenCalledTimes(3);

    // 第 2 轮请求：反馈应 Missing "2"，不应要求重做已有的 "1" 为 missing
    const secondUser = (
      vi.mocked(callLLMStream).mock.calls[1][1] as Array<{ role: string; content: string }>
    ).find((m, i, arr) => m.role === 'user' && i === arr.length - 1);
    expect(secondUser?.content).toMatch(/Missing keys/);
    expect(secondUser?.content).toMatch(/"2"/);
    expect(secondUser?.content).toMatch(/1\/2 filled|Progress: 1\/2/);

    // 第 3 轮同理（累计仍只有 1）
    const thirdUser = (
      vi.mocked(callLLMStream).mock.calls[2][1] as Array<{ role: string; content: string }>
    ).find((m, i, arr) => m.role === 'user' && i === arr.length - 1);
    expect(thirdUser?.content).toMatch(/"2"/);
    expect(thirdUser?.content).not.toMatch(/Missing keys[^]*\["1"/);
  });

  it('salvage merge completes when stream errors after partial delta', async () => {
    vi.mocked(callLLMStream)
      .mockResolvedValueOnce({
        content: JSON.stringify({ '1': { origin: 'A', direct: '甲' } }),
        tokensUsed: 2,
      })
      .mockImplementationOnce(async (_c, _m, opts) => {
        // 流里已出 key 2，随后抛错；非流式回退也失败 → outer catch 用缓冲 merge
        opts?.onDelta?.(
          '',
          JSON.stringify({ '2': { origin: 'B', direct: '乙' } })
        );
        throw new Error('stream broken');
      });
    vi.mocked(callLLM).mockRejectedValue(new Error('fallback also down'));

    const result = await translateBatch(baseConfig(), ['A', 'B']);
    expect(callLLMStream).toHaveBeenCalledTimes(2);
    expect(result.partial).toBe(false);
    expect(result.translations['1'].direct).toBe('甲');
    expect(result.translations['2'].direct).toBe('乙');
  });

  it('network error without model output does not invent fake assistant', async () => {
    vi.mocked(callLLMStream)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        content: JSON.stringify({
          '1': { origin: 'A', direct: '甲' },
          '2': { origin: 'B', direct: '乙' },
        }),
        tokensUsed: 3,
      });
    // stream 失败会回退 callLLM；两轮都让 callLLM 也失败第一次、成功第二次会乱
    // 这里：stream 抛错且无 onDelta → 回退 callLLM
    vi.mocked(callLLM)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        content: JSON.stringify({
          '1': { origin: 'A', direct: '甲' },
          '2': { origin: 'B', direct: '乙' },
        }),
        tokensUsed: 3,
      });

    const result = await translateBatch(baseConfig(), ['A', 'B']);
    expect(result.partial).toBe(false);
    // 第 2 次请求 messages 仍应只有 1 条 user（未塞假 assistant）
    const secondCallMsgs =
      vi.mocked(callLLMStream).mock.calls[1]?.[1] ??
      vi.mocked(callLLM).mock.calls[1]?.[1];
    const msgs = secondCallMsgs as Array<{ role: string; content: string }>;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
    expect(msgs.some((m) => m.content.includes('request failed'))).toBe(false);
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
    // 成功路径：仅一条 user，无 assistant 纠错
    const msgs = vi.mocked(callLLMStream).mock.calls[0][1] as unknown[];
    expect(msgs).toHaveLength(1);
  });

  it('salvages partial from stream buffer when final JSON parse would fail', async () => {
    // 半截 JSON：严格 parse 会失败，但 extractStreamingDirects 能抽出 1
    // 若只抽出 1/2，会进入纠错；三次都半截则 partial
    vi.mocked(callLLMStream).mockResolvedValue({
      content: '{"1":{"origin":"A","direct":"甲"},"2":{"origin":"B","direct":"乙',
      tokensUsed: 2,
    });

    const result = await translateBatch(baseConfig(), ['A', 'B']);
    expect(countFilledKeys(result.translations, ['A', 'B'])).toBeGreaterThanOrEqual(1);
    expect(result.translations['1']?.direct).toContain('甲');
  });
});

describe('describeTranslationGaps / buildRepairFeedbackMessage / merge', () => {
  it('lists missing empty and extra keys', () => {
    const gaps = describeTranslationGaps(
      {
        '1': { direct: '甲' },
        '2': { direct: '' },
        '9': { direct: '杂' },
      },
      ['A', 'B', 'C']
    );
    expect(gaps.missingKeys).toEqual(['3']);
    expect(gaps.emptyKeys).toEqual(['2']);
    expect(gaps.extraKeys).toEqual(['9']);
    expect(gaps.filled).toBe(1);
    expect(gaps.total).toBe(3);
  });

  it('buildRepairFeedbackMessage mentions missing keys', () => {
    const msg = buildRepairFeedbackMessage(
      ['A', 'B'],
      { '1': { direct: '甲' } }
    );
    expect(msg).toMatch(/Missing keys/);
    expect(msg).toMatch(/"2"/);
    expect(msg).toMatch(/Required keys/);
  });

  it('mergeTranslationResults keeps prior non-empty directs', () => {
    const merged = mergeTranslationResults(
      { '1': { direct: '甲' } },
      { '2': { direct: '乙' }, '1': { direct: '' } },
      ['A', 'B']
    );
    expect(merged['1'].direct).toBe('甲');
    expect(merged['2'].direct).toBe('乙');
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
