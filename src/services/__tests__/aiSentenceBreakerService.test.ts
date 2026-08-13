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

  it('未配置 LLM → 不调用直接 null', async () => {
    mockGetState.mockReturnValue({
      config: {
        profiles: [{ id: 'p1', name: 'p1', baseURL: '', apiKey: '', model: '' }],
        activeProfileId: 'p1',
        rpm: 0,
      },
    });
    const breaker = createAiSentenceBreaker();
    await expect(breaker('some prompt')).resolves.toBeNull();
    expect(mockedCallLLM).not.toHaveBeenCalled();
  });

  it('成功 → 返回去围栏内容；同 prompt 命中缓存', async () => {
    mockedCallLLM.mockResolvedValue({
      content: '```text\nhello [BR] world\n```',
      tokensUsed: 10,
    });
    const breaker = createAiSentenceBreaker();
    await expect(breaker('prompt A')).resolves.toBe('hello [BR] world');
    await expect(breaker('prompt A')).resolves.toBe('hello [BR] world');
    expect(mockedCallLLM).toHaveBeenCalledTimes(1);
  });

  it('调用失败 → null（上层回退规则断句）', async () => {
    mockedCallLLM.mockRejectedValue(new Error('network down'));
    const breaker = createAiSentenceBreaker();
    await expect(breaker('prompt B')).resolves.toBeNull();
  });

  it('空内容 → null', async () => {
    mockedCallLLM.mockResolvedValue({ content: '', tokensUsed: 0 });
    const breaker = createAiSentenceBreaker();
    await expect(breaker('prompt C')).resolves.toBeNull();
  });
});
