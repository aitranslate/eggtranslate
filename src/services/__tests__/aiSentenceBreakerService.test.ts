import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetState } = vi.hoisted(() => ({
  mockGetState: vi.fn(() => ({
    config: {
      profiles: [
        { id: 'p1', name: 'p1', baseURL: 'https://api.test/v1', apiKey: 'key', model: 'm1' },
      ],
      activeProfileId: 'p1',
      rpm: 0,
    },
  })),
}));

vi.mock('@/utils/llmApi', () => ({
  callLLM: vi.fn(),
}));

vi.mock('@/stores/translationConfigStore', () => ({
  useTranslationConfigStore: { getState: mockGetState },
}));

import { callLLM } from '@/utils/llmApi';
import { createAiSentenceBreaker, clearAiSentenceBreakerCache } from '../aiSentenceBreakerService';

const mockedCallLLM = vi.mocked(callLLM);

describe('aiSentenceBreakerService', () => {
  beforeEach(() => {
    clearAiSentenceBreakerCache();
    mockedCallLLM.mockReset();
    mockGetState.mockReset();
    mockGetState.mockReturnValue({
      config: {
        profiles: [
          { id: 'p1', name: 'p1', baseURL: 'https://api.test/v1', apiKey: 'key', model: 'm1' },
        ],
        activeProfileId: 'p1',
        rpm: 0,
      },
    });
  });

  it('未配置 LLM → 不调用直接 content=null', async () => {
    mockGetState.mockReturnValue({
      config: {
        profiles: [{ id: 'p1', name: 'p1', baseURL: '', apiKey: '', model: '' }],
        activeProfileId: 'p1',
        rpm: 0,
      },
    });
    const breaker = createAiSentenceBreaker();
    await expect(breaker('some prompt')).resolves.toEqual({ content: null, tokensUsed: 0 });
    expect(mockedCallLLM).not.toHaveBeenCalled();
  });

  it('成功 → 返回去围栏内容与 tokens；同 prompt 命中缓存', async () => {
    mockedCallLLM.mockResolvedValue({
      content: '```text\nhello [BR] world\n```',
      tokensUsed: 10,
    });
    const breaker = createAiSentenceBreaker();
    await expect(breaker('prompt A')).resolves.toEqual({ content: 'hello [BR] world', tokensUsed: 10 });
    // 缓存命中不计 token，避免状态栏 / 阶段累计双计
    await expect(breaker('prompt A')).resolves.toEqual({ content: 'hello [BR] world', tokensUsed: 0 });
    expect(mockedCallLLM).toHaveBeenCalledTimes(1);
  });

  it('调用失败 → content=null（上层回退规则断句）', async () => {
    mockedCallLLM.mockRejectedValue(new Error('network down'));
    const breaker = createAiSentenceBreaker();
    await expect(breaker('prompt B')).resolves.toEqual({ content: null, tokensUsed: 0 });
  });

  it('空内容 → content=null（tokens 如实返回）', async () => {
    mockedCallLLM.mockResolvedValue({ content: '', tokensUsed: 5 });
    const breaker = createAiSentenceBreaker();
    await expect(breaker('prompt C')).resolves.toEqual({ content: null, tokensUsed: 5 });
  });
});
