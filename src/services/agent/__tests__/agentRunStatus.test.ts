import { describe, it, expect } from 'vitest';
import {
  agentSnapshotToStatus,
  applyAgentEventToStatus,
  createIdleAgentRunStatus,
  formatAgentCompactBadge,
  isLongAgentNarrative,
} from '../agentRunStatus';
import type { AgentEvent } from '../types';

function fold(events: AgentEvent[], fileId = 'f1', taskId = 't1') {
  let s = createIdleAgentRunStatus(fileId, taskId);
  for (const e of events) {
    s = applyAgentEventToStatus(s, e, { fileId, taskId });
  }
  return s;
}

describe('applyAgentEventToStatus', () => {
  it('maps pipeline to compact summary and stage steps', () => {
    const s = fold([
      { type: 'pipeline_start', totalEntries: 32, totalWindows: 2 },
      { type: 'stage', stage: 'terminology', detail: 'Terminology Agent…' },
      {
        type: 'terminology_done',
        glossary: [
          { source: 'A', target: '甲' },
          { source: 'B', target: '乙' },
        ],
        styleGuide: 'Natural tone.',
        tokensUsed: 10,
      },
      { type: 'window_start', windowIndex: 0, entryIds: [1, 2] },
      {
        type: 'progress',
        completedEntries: 2,
        totalEntries: 32,
        statusText: 'Agent：2/32 · 窗 1/2',
      },
    ]);

    expect(s.active).toBe(true);
    expect(s.stage).toBe('translate');
    expect(s.glossaryCount).toBe(2);
    expect(s.compactBadge).toMatch(/^Agent·/);
    expect(s.compactBadge.length).toBeLessThanOrEqual(28);
    expect(isLongAgentNarrative(s.compactBadge)).toBe(false);
    expect(s.compactSummary).toBeTruthy();
    expect(s.steps.find((x) => x.id === 'terminology')?.status).toBe('done');
    expect(s.steps.find((x) => x.id === 'translate')?.status).toBe('active');
    expect(s.actionLine).toMatch(/2\/32|窗/);
  });

  it('pipeline_end clears compact badge and marks steps done', () => {
    const s = fold([
      { type: 'pipeline_start', totalEntries: 4, totalWindows: 1 },
      { type: 'pipeline_end' },
    ]);
    expect(s.active).toBe(false);
    expect(s.compactBadge).toBe('');
    expect(s.steps.every((x) => x.status === 'done')).toBe(true);
  });

  it('formatAgentCompactBadge stays short for card UI', () => {
    const badge = formatAgentCompactBadge({
      active: true,
      stage: 'translate',
      currentWindow: 2,
      totalWindows: 4,
      error: null,
    });
    expect(badge).toBe('Agent·译 2/4');
    expect(isLongAgentNarrative(badge)).toBe(false);
  });

  it('rejects long multi-clause card copy', () => {
    expect(
      isLongAgentNarrative('术语 Agent：正在核对专名… / 第 2/4 窗已写入 28 行，QA 审校中…')
    ).toBe(true);
  });

  it('agentSnapshotToStatus restores finished UI without running badge', () => {
    const s = agentSnapshotToStatus('f1', 't1', {
      glossaryCount: 3,
      lastActionLine: 'Agent 流程完成',
      completedAt: 1,
      totalEntries: 10,
      totalWindows: 2,
    });
    expect(s.active).toBe(false);
    expect(s.actionLine).toMatch(/完成/);
    expect(s.compactSummary).toBe('Agent 已完成');
    expect(s.compactBadge).toBe('');
    expect(s.glossaryCount).toBe(3);
    expect(s.steps.every((x) => x.status === 'done')).toBe(true);
  });
});
