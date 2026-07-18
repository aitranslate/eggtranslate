/**
 * Agent 分窗：按段数切窗，前后重叠上下文仅作 prompt，不重复提交翻译。
 */

import type { SubtitleEntry } from '@/types';
import type { AgentWindowSpec } from './types';

export function splitAgentWindows(
  entries: SubtitleEntry[],
  windowSize = 30,
  overlap = 5
): AgentWindowSpec[] {
  const n = entries.length;
  if (n === 0) return [];
  const size = Math.max(1, windowSize);
  const ov = Math.max(0, Math.min(overlap, size - 1));
  const windows: AgentWindowSpec[] = [];

  for (let start = 0, wi = 0; start < n; start += size, wi++) {
    const end = Math.min(n, start + size);
    const entryIndices: number[] = [];
    for (let i = start; i < end; i++) entryIndices.push(i);

    const contextBeforeIndices: number[] = [];
    for (let i = Math.max(0, start - ov); i < start; i++) {
      contextBeforeIndices.push(i);
    }
    const contextAfterIndices: number[] = [];
    for (let i = end; i < Math.min(n, end + ov); i++) {
      contextAfterIndices.push(i);
    }

    windows.push({
      windowIndex: wi,
      entryIndices,
      contextBeforeIndices,
      contextAfterIndices,
    });
  }

  return windows;
}
