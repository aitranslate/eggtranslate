import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useHistoryStore, HISTORY_MAX_ENTRIES } from '../historyStore';
import type { FilePhases } from '@/types';

vi.mock('localforage', () => ({
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(undefined),
    removeItem: () => Promise.resolve(undefined),
  },
}));

const phases = {
  workflow: 'translate',
  converting: { status: 'completed', progress: 100, tokens: 0 },
  transcribing: { status: 'completed', progress: 100, tokens: 0 },
  translating: { status: 'completed', progress: 100, tokens: 0 },
} as FilePhases;

describe('historyStore addHistory cap', () => {
  beforeEach(() => {
    useHistoryStore.setState({ history: [] });
  });

  it('keeps at most HISTORY_MAX_ENTRIES and retains newest', async () => {
    for (let i = 0; i < HISTORY_MAX_ENTRIES + 3; i++) {
      await useHistoryStore.getState().addHistory({
        taskId: `task-${i}`,
        filename: `f-${i}.srt`,
        completedCount: 1,
        totalTokens: i,
        phases,
        subtitle_entries: [],
      });
    }

    const { history } = useHistoryStore.getState();
    expect(history.length).toBe(HISTORY_MAX_ENTRIES);
    // newest first
    expect(history[0].taskId).toBe(`task-${HISTORY_MAX_ENTRIES + 2}`);
    expect(history.some((h) => h.taskId === 'task-0')).toBe(false);
  });
});
