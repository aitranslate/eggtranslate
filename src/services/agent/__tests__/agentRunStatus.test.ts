import { describe, it, expect } from 'vitest';
import {
  agentSnapshotToStatus,
  applyAgentEventToStatus,
  createIdleAgentRunStatus,
  formatAgentCompactBadge,
  isLongAgentNarrative,
  statusToAgentSnapshot,
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
  it('maps pipeline to compact summary and keeps full glossary', () => {
    const s = fold([
      { type: 'pipeline_start', totalEntries: 32, totalWindows: 2 },
      { type: 'stage', stage: 'terminology', detail: 'Terminology Agent…' },
      {
        type: 'tool_start',
        name: 'web_search',
        argsSummary: '{"query":"TBR"}',
        callId: 'call-ws-1',
        stage: 'terminology',
      },
      {
        type: 'tool_end',
        name: 'web_search',
        argsSummary: '{"query":"TBR"}',
        callId: 'call-ws-1',
        ok: true,
        detail: 'ok result',
        durationMs: 120,
        stage: 'terminology',
      },
      {
        type: 'terminology_done',
        glossary: [
          { source: 'A', target: '甲', note: 'n1' },
          { source: 'B', target: '乙' },
        ],
        styleGuide: 'Natural tone. Keep terms consistent.',
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
    expect(s.glossary).toHaveLength(2);
    expect(s.glossary[0].source).toBe('A');
    expect(s.styleGuide).toMatch(/Natural/);
    expect(s.toolLog.length).toBeGreaterThanOrEqual(1);
    expect(s.toolLog.some((t) => t.name === 'web_search' && t.ok)).toBe(true);
    // 普通工具成功不刷概览事件（去噪）；细节在「工具」Tab
    expect(s.recentEvents.some((e) => e.text.includes('web_search'))).toBe(false);
    expect(s.windows[0]?.status).toBe('running');
    expect(s.tokensTotal).toBeGreaterThanOrEqual(10);
    expect(s.compactBadge).toMatch(/^Agent·/);
    expect(s.compactBadge.length).toBeLessThanOrEqual(28);
    expect(isLongAgentNarrative(s.compactBadge)).toBe(false);
    expect(s.steps.find((x) => x.id === 'terminology')?.status).toBe('done');
    expect(s.steps.find((x) => x.id === 'translate')?.status).toBe('active');
  });

  it('pipeline_end keeps finished summary for reopen', () => {
    const s = fold([
      { type: 'pipeline_start', totalEntries: 4, totalWindows: 1 },
      {
        type: 'terminology_done',
        glossary: [{ source: 'X', target: '叉' }],
        styleGuide: 'sg',
        tokensUsed: 1,
      },
      { type: 'pipeline_end' },
    ]);
    expect(s.active).toBe(false);
    expect(s.compactBadge).toBe('');
    expect(s.compactSummary).toMatch(/已完成/);
    expect(s.glossary).toHaveLength(1);
    expect(s.steps.every((x) => x.status === 'done')).toBe(true);
    expect(s.completedEntries).toBe(4);
    expect(s.totalEntries).toBe(4);
    expect(s.currentWindow).toBe(1);
  });

  it('statusToAgentSnapshot round-trips completedEntries', () => {
    const live = fold([
      { type: 'pipeline_start', totalEntries: 10, totalWindows: 2 },
      {
        type: 'progress',
        completedEntries: 10,
        totalEntries: 10,
        statusText: 'Agent：完成',
      },
      { type: 'pipeline_end' },
    ]);
    const snap = statusToAgentSnapshot(live, 'success');
    expect(snap.completedEntries).toBe(10);
    expect(snap.totalEntries).toBe(10);
    const restored = agentSnapshotToStatus('f1', 't1', snap);
    expect(restored.completedEntries).toBe(10);
    expect(restored.currentWindow).toBe(2);
  });

  it('tool_end correlates concurrent same-name tools by callId', () => {
    const s = fold([
      { type: 'pipeline_start', totalEntries: 4, totalWindows: 2 },
      {
        type: 'tool_start',
        name: 'web_search',
        argsSummary: '{"q":"a"}',
        callId: 'c-a',
        stage: 'terminology',
      },
      {
        type: 'tool_start',
        name: 'web_search',
        argsSummary: '{"q":"b"}',
        callId: 'c-b',
        stage: 'terminology',
      },
      {
        type: 'tool_end',
        name: 'web_search',
        argsSummary: '{"q":"b"}',
        callId: 'c-b',
        ok: true,
        detail: 'result-b',
        durationMs: 50,
        stage: 'terminology',
      },
      {
        type: 'tool_end',
        name: 'web_search',
        argsSummary: '{"q":"a"}',
        callId: 'c-a',
        ok: false,
        detail: 'result-a-fail',
        durationMs: 80,
        stage: 'terminology',
      },
    ]);
    const byId = Object.fromEntries(s.toolLog.map((t) => [t.id, t]));
    expect(byId['c-a']?.detail).toBe('result-a-fail');
    expect(byId['c-a']?.ok).toBe(false);
    expect(byId['c-b']?.detail).toBe('result-b');
    expect(byId['c-b']?.ok).toBe(true);
  });

  it('qa_result updates window meta', () => {
    const s = fold([
      { type: 'pipeline_start', totalEntries: 10, totalWindows: 1 },
      { type: 'window_start', windowIndex: 0, entryIds: [1, 2, 3] },
      {
        type: 'window_done',
        windowIndex: 0,
        translations: [
          { entryId: 1, text: 'a' },
          { entryId: 2, text: 'b' },
        ],
        tokensUsed: 5,
      },
      {
        type: 'qa_result',
        windowIndex: 0,
        critical: 1,
        total: 2,
        summary: 'need rerun',
      },
    ]);
    expect(s.windows[0]?.qaCritical).toBe(1);
    expect(s.windows[0]?.qaNote).toMatch(/need/);
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

  it('agentSnapshotToStatus restores full glossary and tools', () => {
    const s = agentSnapshotToStatus('f1', 't1', {
      glossaryCount: 2,
      glossary: [
        { source: 'A', target: '甲' },
        { source: 'B', target: '乙' },
      ],
      styleGuide: 'Full style guide text',
      toolLog: [
        {
          id: 't1',
          name: 'submit_result',
          argsSummary: '{}',
          ok: true,
          at: 1,
          stage: 'terminology',
        },
      ],
      windows: [{ windowIndex: 0, entryCount: 5, status: 'done', tokensUsed: 9 }],
      tokensTotal: 42,
      lastActionLine: 'Agent 流程完成',
      completedAt: 1,
      totalEntries: 10,
      totalWindows: 1,
    });
    expect(s.active).toBe(false);
    expect(s.glossary).toHaveLength(2);
    expect(s.styleGuide).toMatch(/Full style/);
    expect(s.toolLog).toHaveLength(1);
    expect(s.windows[0]?.entryCount).toBe(5);
    expect(s.tokensTotal).toBe(42);
    expect(s.compactSummary).toMatch(/术语 2/);
    expect(s.compactBadge).toBe('');
  });

  it('statusToAgentSnapshot round-trips essentials', () => {
    const live = fold([
      { type: 'pipeline_start', totalEntries: 3, totalWindows: 1 },
      {
        type: 'terminology_done',
        glossary: [{ source: 'Hi', target: '嗨' }],
        styleGuide: 'guide',
        tokensUsed: 7,
      },
      { type: 'pipeline_end' },
    ]);
    const snap = statusToAgentSnapshot(live, 'success');
    expect(snap.glossary?.[0].target).toBe('嗨');
    expect(snap.styleGuide).toBe('guide');
    expect(snap.tokensTotal).toBeGreaterThanOrEqual(7);
    expect(snap.error).toBeNull();
  });
});
