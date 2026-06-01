import { describe, it, expect } from 'vitest';
import { findHistoryEntry, calculateHistoryStats } from '../historyHelpers';
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
