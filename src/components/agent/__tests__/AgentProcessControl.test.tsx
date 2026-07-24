/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { AgentProcessControl } from '../AgentProcessControl';
import {
  applyAgentEventToStatus,
  createIdleAgentRunStatus,
} from '@/services/agent/agentRunStatus';

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  const motionTag = (tag: string) =>
    React.forwardRef(({ children, ...rest }: Record<string, unknown>, ref) => {
      const {
        initial: _i,
        animate: _a,
        exit: _e,
        transition: _t,
        ...dom
      } = rest;
      return React.createElement(tag, { ...dom, ref }, children as React.ReactNode);
    });
  return {
    AnimatePresence: passthrough,
    motion: {
      div: motionTag('div'),
      aside: motionTag('aside'),
      button: motionTag('button'),
    },
    useReducedMotion: () => true,
  };
});

afterEach(() => cleanup());

function runningStatus() {
  let s = createIdleAgentRunStatus('f1', 't1');
  s = applyAgentEventToStatus(s, {
    type: 'pipeline_start',
    totalEntries: 10,
    totalWindows: 2,
  });
  s = applyAgentEventToStatus(s, {
    type: 'stage',
    stage: 'terminology',
    detail: 'Terminology Agent…',
  });
  return s;
}

describe('AgentProcessControl', () => {
  it('renders compact stage summary and opens drawer with tabs + steps', () => {
    const status = runningStatus();
    render(<AgentProcessControl status={status} visible />);

    const summary = screen.getByTestId('agent-stage-summary');
    expect(summary.textContent).toBeTruthy();
    expect(summary.textContent!.length).toBeLessThan(40);

    expect(screen.queryByTestId('agent-brain-panel')).toBeNull();

    fireEvent.click(screen.getByTestId('agent-brain-trigger'));
    const panel = screen.getByTestId('agent-brain-panel');
    expect(panel).toBeTruthy();
    expect(screen.getByTestId('agent-tab-overview')).toBeTruthy();
    expect(screen.getByTestId('agent-tab-glossary')).toBeTruthy();
    expect(screen.getByTestId('agent-tab-tools')).toBeTruthy();
    expect(screen.getByTestId('agent-tab-windows')).toBeTruthy();
    expect(screen.getByTestId('agent-brain-steps').querySelectorAll('[data-stage]').length).toBe(
      4
    );
    expect(screen.getByTestId('agent-brain-action').textContent).toMatch(/术语|Terminology|分析/);

    fireEvent.click(screen.getByTestId('agent-tab-glossary'));
    expect(screen.getByTestId('agent-glossary-tab')).toBeTruthy();
  });

  it('does not render when visible=false (batch path)', () => {
    const status = runningStatus();
    const { container } = render(
      <AgentProcessControl status={status} visible={false} />
    );
    expect(container.querySelector('[data-testid="agent-process-control"]')).toBeNull();
  });

  it('closes panel via close button', async () => {
    const status = runningStatus();
    render(<AgentProcessControl status={status} visible />);
    fireEvent.click(screen.getByTestId('agent-brain-trigger'));
    expect(screen.getByTestId('agent-brain-panel')).toBeTruthy();
    fireEvent.click(screen.getByTestId('agent-brain-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('agent-brain-panel')).toBeNull();
    });
  });

  it('shows progress track, soft tool status, term issues, web chip', () => {
    let s = runningStatus();
    s = applyAgentEventToStatus(s, {
      type: 'briefing_progress',
      current: 1,
      total: 2,
      detail: '术语分析 1/2…',
    });
    s = applyAgentEventToStatus(s, { type: 'web_usage', count: 1, max: 3 });
    s = applyAgentEventToStatus(s, {
      type: 'tool_end',
      name: 'submit_result',
      argsSummary: '{}',
      callId: 'soft1',
      ok: false,
      kind: 'submit_reject',
      nudge: 'web_soft',
      detail: 'Soft check once',
      stage: 'terminology',
    });
    s = applyAgentEventToStatus(s, {
      type: 'terminology_issues',
      issues: [
        {
          index: 3,
          source: 'Acme',
          canonicalTarget: '艾克米',
          foundTarget: 'Acme here',
        },
      ],
    });
    render(<AgentProcessControl status={s} visible />);
    fireEvent.click(screen.getByTestId('agent-brain-trigger'));
    expect(screen.getByTestId('agent-progress-track')).toBeTruthy();
    expect(screen.getByTestId('agent-briefing-chip').textContent).toMatch(/1/);
    expect(screen.getByTestId('agent-web-chip').textContent).toMatch(/搜索 1\/3/);
    expect(screen.getByTestId('agent-term-issues').textContent).toMatch(/艾克米/);
    fireEvent.click(screen.getByTestId('agent-tab-tools'));
    expect(screen.getByTestId('agent-tools-tab').textContent).toMatch(/软提示/);
  });

  it('shows stage token breakdown and QA skip chips after run_stats', () => {
    let s = runningStatus();
    s = applyAgentEventToStatus(s, {
      type: 'run_stats',
      tokensTerminology: 12,
      tokensTranslate: 34,
      tokensQa: 5,
      tokensTotal: 51,
      qaWindowsRun: 1,
      qaWindowsSkipped: 2,
      totalWindows: 3,
    });
    render(<AgentProcessControl status={s} visible />);
    fireEvent.click(screen.getByTestId('agent-brain-trigger'));
    expect(screen.getByTestId('agent-token-breakdown-chip').textContent).toMatch(
      /12\/34\/5/
    );
    expect(screen.getByTestId('agent-qa-skip-chip').textContent).toMatch(
      /1跑\/2跳/
    );
  });
});
