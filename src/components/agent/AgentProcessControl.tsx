/**
 * Agent 紧凑阶段条 + 可打开的「大脑」过程面板
 * 仅在 Agent 运行（或刚结束有摘要）时显示；批译路径不挂载。
 *
 * 面板用 fixed + portal：躲开全局 max-width:100% 与编辑器 overflow 裁切。
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Brain, X } from 'lucide-react';
import type { AgentRunStatus } from '@/services/agent/agentRunStatus';

export interface AgentProcessControlProps {
  status: AgentRunStatus;
  /** 是否显示（调用方：agent 开且有 active/error 状态） */
  visible: boolean;
}

const PANEL_W = 380;

export const AgentProcessControl: React.FC<AgentProcessControlProps> = ({
  status,
  visible,
}) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: PANEL_W });
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const close = useCallback(() => setOpen(false), []);

  const placePanel = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(PANEL_W, Math.max(280, window.innerWidth - 24));
    let left = r.left;
    if (left + width > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - 12 - width);
    }
    if (left < 12) left = 12;
    setPos({ top: Math.round(r.bottom + 8), left: Math.round(left), width });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    placePanel();
    window.addEventListener('resize', placePanel);
    // 捕获滚动：编辑器/侧栏滚动时跟位
    window.addEventListener('scroll', placePanel, true);
    return () => {
      window.removeEventListener('resize', placePanel);
      window.removeEventListener('scroll', placePanel, true);
    };
  }, [open, placePanel]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open, close]);

  // 运行结束自动收起面板
  useEffect(() => {
    if (!status.active && !status.error) setOpen(false);
  }, [status.active, status.error]);

  if (!visible) return null;

  const summary = status.compactSummary || status.compactBadge || 'Agent';

  const panel =
    open &&
    createPortal(
      <div
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-label="Agent 处理过程"
        className="agent-brain-panel"
        data-testid="agent-brain-panel"
        style={{ top: pos.top, left: pos.left, width: pos.width }}
      >
        <header className="agent-brain-head">
          <div className="agent-brain-title">
            <Brain className="h-4 w-4 flex-shrink-0" aria-hidden />
            <span>Agent 过程</span>
          </div>
          <button
            type="button"
            className="agent-brain-close"
            aria-label="关闭"
            data-testid="agent-brain-close"
            onClick={close}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        <p className="agent-brain-action" data-testid="agent-brain-action">
          {status.actionLine || summary}
        </p>

        <ol className="agent-brain-steps" data-testid="agent-brain-steps">
          {status.steps.map((step) => (
            <li
              key={step.id}
              className={`agent-brain-step is-${step.status}`}
              data-stage={step.id}
              data-status={step.status}
            >
              <span className="agent-brain-step-dot" aria-hidden />
              <span className="agent-brain-step-label">{step.label}</span>
              <span className="agent-brain-step-meta">
                {step.status === 'active'
                  ? '进行中'
                  : step.status === 'done'
                    ? '完成'
                    : step.status === 'error'
                      ? '失败'
                      : '等待'}
              </span>
            </li>
          ))}
        </ol>

        {(status.glossaryCount > 0 || status.styleGuidePreview) && (
          <div className="agent-brain-meta" data-testid="agent-brain-terminology">
            {status.glossaryCount > 0 ? (
              <div>术语 {status.glossaryCount} 条</div>
            ) : null}
            {status.styleGuidePreview ? (
              <div className="agent-brain-style" title={status.styleGuidePreview}>
                {status.styleGuidePreview}
              </div>
            ) : null}
          </div>
        )}

        {status.recentEvents.length > 0 && (
          <ul className="agent-brain-events" data-testid="agent-brain-events">
            {status.recentEvents.slice(0, 8).map((ev) => (
              <li key={ev.id}>{ev.text}</li>
            ))}
          </ul>
        )}

        {status.error ? (
          <div className="agent-brain-error" data-testid="agent-brain-error">
            {status.error}
          </div>
        ) : null}
      </div>,
      document.body
    );

  return (
    <div className="agent-proc" ref={rootRef} data-testid="agent-process-control">
      <button
        type="button"
        className={`agent-proc-trigger${open ? ' is-open' : ''}${status.active ? ' is-active' : ''}`}
        data-testid="agent-brain-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        title="查看 Agent 处理过程"
        onClick={() => {
          // 只负责打开；关闭走关闭按钮 / Esc / 点外部
          // （避免悬停已打开时 click 再 toggle 误关）
          setOpen(true);
        }}
        onMouseEnter={() => {
          // 桌面：悬停也可打开（触控仍靠 click）
          if (window.matchMedia('(hover: hover)').matches) setOpen(true);
        }}
      >
        <Brain className="agent-proc-ico" aria-hidden />
        <span className="agent-proc-summary" data-testid="agent-stage-summary">
          {summary}
        </span>
        {status.active ? <span className="agent-proc-pulse" aria-hidden /> : null}
      </button>
      {panel}
    </div>
  );
};
