import { describe, it, expect } from 'vitest';
import {
  findHistoryEntry,
  calculateHistoryStats,
  capHistoryEntries,
  HISTORY_MAX_ENTRIES,
} from '../historyHelpers';
import type { FilePhases, TranslationHistoryEntry } from '@/types';

const makeEntry = (overrides: Partial<TranslationHistoryEntry> = {}): TranslationHistoryEntry => ({
  taskId: 'task-default',
  filename: 'movie.srt',
  completedCount: 10,
  totalTokens: 100,
  timestamp: 1000,
  phases: {} as FilePhases,
  subtitle_entries: [],
  ...overrides,
});

describe('findHistoryEntry', () => {
  it('returns null when history is empty', () => {
    expect(findHistoryEntry([], 'task-1')).toBeNull();
  });

  it('returns null when taskId not found', () => {
    const entries = [makeEntry({ taskId: 'task-1' })];
    expect(findHistoryEntry(entries, 'task-2')).toBeNull();
  });

  it('returns the matching entry', () => {
    const entry1 = makeEntry({ taskId: 'task-1', filename: 'a.srt' });
    const entry2 = makeEntry({ taskId: 'task-2', filename: 'b.srt' });
    const result = findHistoryEntry([entry1, entry2], 'task-2');
    expect(result).toBe(entry2);
  });

  it('returns first match when there are duplicates (should not happen but be defensive)', () => {
    const entry1 = makeEntry({ taskId: 'task-1', filename: 'first.srt' });
    const entry2 = makeEntry({ taskId: 'task-1', filename: 'second.srt' });
    const result = findHistoryEntry([entry1, entry2], 'task-1');
    expect(result?.filename).toBe('first.srt');
  });
});

describe('calculateHistoryStats', () => {
  it('returns zeros for empty history', () => {
    expect(calculateHistoryStats([])).toEqual({ total: 0, totalTokens: 0 });
  });

  it('counts entries', () => {
    const entries = [
      makeEntry({ taskId: 'a', totalTokens: 100 }),
      makeEntry({ taskId: 'b', totalTokens: 200 }),
      makeEntry({ taskId: 'c', totalTokens: 300 }),
    ];
    const stats = calculateHistoryStats(entries);
    expect(stats.total).toBe(3);
    expect(stats.totalTokens).toBe(600);
  });

  it('handles single entry', () => {
    const entries = [makeEntry({ totalTokens: 500 })];
    expect(calculateHistoryStats(entries)).toEqual({ total: 1, totalTokens: 500 });
  });

  it('sums large token counts without overflow concerns', () => {
    const entries = Array.from({ length: 100 }, (_, i) =>
      makeEntry({ taskId: `t-${i}`, totalTokens: 1000 })
    );
    expect(calculateHistoryStats(entries)).toEqual({ total: 100, totalTokens: 100000 });
  });
});

describe('capHistoryEntries', () => {
  it('exports a positive documented cap', () => {
    expect(HISTORY_MAX_ENTRIES).toBeGreaterThan(0);
  });

  it('keeps list unchanged when under cap', () => {
    const entries = [makeEntry({ taskId: 'a' }), makeEntry({ taskId: 'b' })];
    expect(capHistoryEntries(entries, 10)).toEqual(entries);
  });

  it('drops oldest when newest-first list exceeds cap', () => {
    // store 约定：新在前 [newest, ..., oldest]
    const entries = Array.from({ length: HISTORY_MAX_ENTRIES + 5 }, (_, i) =>
      makeEntry({ taskId: `t-${i}`, timestamp: 10_000 - i })
    );
    const capped = capHistoryEntries(entries, HISTORY_MAX_ENTRIES);
    expect(capped).toHaveLength(HISTORY_MAX_ENTRIES);
    expect(capped[0].taskId).toBe('t-0'); // newest retained
    expect(capped[capped.length - 1].taskId).toBe(`t-${HISTORY_MAX_ENTRIES - 1}`);
    expect(capped.some((e) => e.taskId === `t-${HISTORY_MAX_ENTRIES + 4}`)).toBe(false);
  });

  it('returns empty for non-positive max', () => {
    expect(capHistoryEntries([makeEntry()], 0)).toEqual([]);
  });
});
