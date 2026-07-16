/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AgentProcessControl } from '../AgentProcessControl';
import {
  applyAgentEventToStatus,
  createIdleAgentRunStatus,
} from '@/services/agent/agentRunStatus';

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
  it('renders compact stage summary and opens brain panel with steps', () => {
    const status = runningStatus();
    render(<AgentProcessControl status={status} visible />);

    const summary = screen.getByTestId('agent-stage-summary');
    expect(summary.textContent).toBeTruthy();
    expect(summary.textContent!.length).toBeLessThan(40);

    expect(screen.queryByTestId('agent-brain-panel')).toBeNull();

    fireEvent.click(screen.getByTestId('agent-brain-trigger'));
    const panel = screen.getByTestId('agent-brain-panel');
    expect(panel).toBeTruthy();
    expect(screen.getByTestId('agent-brain-steps').querySelectorAll('[data-stage]').length).toBe(
      4
    );
    expect(screen.getByTestId('agent-brain-action').textContent).toMatch(/术语|Terminology|分析/);
  });

  it('does not render when visible=false (batch path)', () => {
    const status = runningStatus();
    const { container } = render(
      <AgentProcessControl status={status} visible={false} />
    );
    expect(container.querySelector('[data-testid="agent-process-control"]')).toBeNull();
  });

  it('closes panel via close button', () => {
    const status = runningStatus();
    render(<AgentProcessControl status={status} visible />);
    fireEvent.click(screen.getByTestId('agent-brain-trigger'));
    expect(screen.getByTestId('agent-brain-panel')).toBeTruthy();
    fireEvent.click(screen.getByTestId('agent-brain-close'));
    expect(screen.queryByTestId('agent-brain-panel')).toBeNull();
  });
});
