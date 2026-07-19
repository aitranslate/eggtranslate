import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFilesStore } from '@/stores/filesStore';
import { useTranslationConfigStore } from '@/stores/translationConfigStore';
import { useAgentRunStore } from '@/stores/agentRunStore';
import { startTranslation } from '../translationService';
import type { SingleTask, SubtitleEntry } from '@/types';
import { generateStableFileId } from '@/utils/taskIdGenerator';

vi.mock('localforage', () => {
  const api = {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(undefined),
    removeItem: () => Promise.resolve(undefined),
  };
  return {
    default: {
      ...api,
      createInstance: () => api,
    },
  };
});

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const runAgentTranslation = vi.fn();
const executeTranslation = vi.fn();

vi.mock('../agent', () => ({
  runAgentTranslation: (...args: unknown[]) => runAgentTranslation(...args),
}));

vi.mock('../TranslationOrchestrator', () => ({
  executeTranslation: (...args: unknown[]) => executeTranslation(...args),
}));

const entry = (id: number): SubtitleEntry => ({
  id,
  startTime: '00:00:00,000',
  endTime: '00:00:01,000',
  text: `t${id}`,
  translatedText: '',
  translationStatus: 'pending',
});

const makeFile = (
  taskId: string,
  translating: 'completed' | 'upcoming' | 'active' = 'upcoming',
  overrides: Partial<SingleTask> = {}
): SingleTask => ({
  taskId,
  subtitle_filename: `${taskId}.srt`,
  fileType: 'srt',
  fileSize: 100,
  subtitle_entries: [entry(1), entry(2)],
  index: 0,
  selectedKeytermGroupId: null,
  entryCount: 2,
  translatedCount: 0,
  phases: {
    workflow: 'translate',
    converting: { status: 'completed', progress: 100, tokens: 0 },
    transcribing: { status: 'completed', progress: 100, tokens: 0 },
    translating: {
      status: translating,
      progress: translating === 'completed' ? 100 : 0,
      tokens: 0,
    },
  },
  ...overrides,
});

function configuredState(agent: boolean) {
  useTranslationConfigStore.setState({
    isConfigured: true,
    isTranslating: false,
    config: {
      profiles: [
        {
          id: 'custom',
          name: '自定义',
          baseURL: 'https://x',
          apiKey: 'k',
          model: 'm',
          presetId: 'custom',
        },
      ],
      activeProfileId: 'custom',
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      batchSize: 20,
      contextBefore: 5,
      contextAfter: 3,
      threadCount: 4,
      agentTranslationEnabled: agent,
    },
  });
}

describe('translationService', () => {
  beforeEach(() => {
    runAgentTranslation.mockReset();
    executeTranslation.mockReset();
    useFilesStore.setState({ tasks: [], selectedFileId: null });
    useAgentRunStore.setState({ byFileId: {} });
    useTranslationConfigStore.setState({
      isConfigured: false,
      isTranslating: false,
      config: {
        profiles: [
          {
            id: 'custom',
            name: '自定义',
            baseURL: '',
            apiKey: '',
            model: '',
            presetId: 'custom',
          },
        ],
        activeProfileId: 'custom',
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        batchSize: 20,
        contextBefore: 5,
        contextAfter: 3,
        threadCount: 4,
        agentTranslationEnabled: false,
      },
    });
  });

  it('returns null when file not found', async () => {
    const result = await startTranslation('non-existent');
    expect(result).toBeNull();
  });

  it('returns null when translation not configured', async () => {
    useFilesStore.setState({ tasks: [makeFile('t1')] });
    const result = await startTranslation(generateStableFileId('t1'));
    expect(result).toBeNull();
  });

  it('returns null when translation already completed', async () => {
    useFilesStore.setState({
      tasks: [makeFile('t1', 'completed')],
    });
    configuredState(false);

    const result = await startTranslation(generateStableFileId('t1'));
    expect(result).toBeNull();
    expect(runAgentTranslation).not.toHaveBeenCalled();
    expect(executeTranslation).not.toHaveBeenCalled();
  });

  it('agent path: sets translationPath agent and calls runAgentTranslation', async () => {
    useFilesStore.setState({ tasks: [makeFile('t-agent')] });
    configuredState(true);
    runAgentTranslation.mockImplementation(async (_entries, input) => {
      await input.onEvent({ type: 'pipeline_start', totalEntries: 2, totalWindows: 1 });
      await input.onEvent({ type: 'pipeline_end' });
      return { tokensUsed: 1 };
    });

    const fileId = generateStableFileId('t-agent');
    const result = await startTranslation(fileId);

    expect(runAgentTranslation).toHaveBeenCalled();
    expect(executeTranslation).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    const task = useFilesStore.getState().tasks.find((t) => t.taskId === 't-agent');
    expect(task?.translationPath).toBe('agent');
    expect(task?.agentSnapshot?.error).toBeNull();
    expect(task?.agentSnapshot?.lastActionLine).toBeTruthy();
  });

  it('batch path: sets translationPath batch and calls executeTranslation', async () => {
    useFilesStore.setState({ tasks: [makeFile('t-batch')] });
    configuredState(false);
    executeTranslation.mockResolvedValue(undefined);

    const fileId = generateStableFileId('t-batch');
    const result = await startTranslation(fileId);

    expect(executeTranslation).toHaveBeenCalled();
    expect(runAgentTranslation).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    const task = useFilesStore.getState().tasks.find((t) => t.taskId === 't-batch');
    expect(task?.translationPath).toBe('batch');
  });

  it('agent path: prefers task source/target languages over global config', async () => {
    useFilesStore.setState({
      tasks: [
        makeFile('t-lang', 'upcoming', {
          sourceLanguage: 'Japanese',
          targetLanguage: 'Korean',
        }),
      ],
    });
    configuredState(true); // global still en/zh
    runAgentTranslation.mockImplementation(async (_entries, input) => {
      expect(input.config.sourceLanguage).toBe('Japanese');
      expect(input.config.targetLanguage).toBe('Korean');
      await input.onEvent({ type: 'pipeline_start', totalEntries: 2, totalWindows: 1 });
      await input.onEvent({ type: 'pipeline_end' });
      return { tokensUsed: 1 };
    });

    await startTranslation(generateStableFileId('t-lang'));
    expect(runAgentTranslation).toHaveBeenCalled();
  });

  it('agent throw: emits pipeline_error via mock path + marks failed + snapshot', async () => {
    useFilesStore.setState({ tasks: [makeFile('t-fail')] });
    configuredState(true);
    // Simulate pipeline wrapper: on failure the real pipeline emits pipeline_error then throws.
    // Here the service onEvent is only invoked if runAgentTranslation calls it — mock does that.
    runAgentTranslation.mockImplementation(async (_entries, input) => {
      await input.onEvent({ type: 'pipeline_start', totalEntries: 2, totalWindows: 1 });
      await input.onEvent({
        type: 'terminology_done',
        glossary: [{ source: 'Hi', target: '嗨', note: 'n' }],
        styleGuide: 'Keep short.',
        tokensUsed: 3,
      });
      await input.onEvent({
        type: 'tool_start',
        name: 'web_search',
        argsSummary: '{}',
        callId: 'fail-ws',
        stage: 'terminology',
      });
      await input.onEvent({
        type: 'tool_end',
        name: 'web_search',
        argsSummary: '{}',
        callId: 'fail-ws',
        ok: true,
        detail: 'ok',
        durationMs: 10,
        stage: 'terminology',
      });
      await input.onEvent({ type: 'pipeline_error', error: 'boom' });
      throw new Error('boom');
    });

    const fileId = generateStableFileId('t-fail');
    const result = await startTranslation(fileId);

    expect(result).toBeNull();
    const task = useFilesStore.getState().tasks.find((t) => t.taskId === 't-fail');
    expect(task?.phases.translating.status).toBe('failed');
    expect(task?.phases.translating.errorMessage).toMatch(/boom/);
    expect(task?.agentSnapshot?.error).toMatch(/boom/);
    // ensureAgentFailureSnapshot 不得把富快照冲成薄结构
    expect(task?.agentSnapshot?.glossary).toEqual([
      { source: 'Hi', target: '嗨', note: 'n' },
    ]);
    expect(task?.agentSnapshot?.styleGuide).toMatch(/Keep short/);
    expect(task?.agentSnapshot?.toolLog?.some((t) => t.id === 'fail-ws')).toBe(true);
    expect(task?.agentSnapshot?.totalEntries).toBe(2);
    const run = useAgentRunStore.getState().byFileId[fileId];
    expect(run?.active).toBe(false);
    expect(run?.error).toMatch(/boom/);
  });

  it('agent AbortError: does not mark failed', async () => {
    useFilesStore.setState({ tasks: [makeFile('t-abort')] });
    configuredState(true);
    const err = new Error('翻译已取消');
    err.name = 'AbortError';
    runAgentTranslation.mockImplementation(async (_entries, input) => {
      await input.onEvent({ type: 'pipeline_start', totalEntries: 2, totalWindows: 1 });
      throw err;
    });

    const fileId = generateStableFileId('t-abort');
    const result = await startTranslation(fileId);

    expect(result).toBeNull();
    const task = useFilesStore.getState().tasks.find((t) => t.taskId === 't-abort');
    expect(task?.phases.translating.status).not.toBe('failed');
    // still active from start; abort deactivates agent UI without failed snapshot
    const run = useAgentRunStore.getState().byFileId[fileId];
    expect(run?.active).toBe(false);
  });
});
