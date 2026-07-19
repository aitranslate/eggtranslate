/**
 * Agent 过程控制：顶栏摘要 + 右侧抽屉（概览 / 术语 / 工具 / 分窗）
 * 观测性优先：阶段、术语全表、工具时间线、分窗 QA；交互动画克制。
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Brain,
  Check,
  Copy,
  ListTree,
  Wrench,
  X,
  BookOpen,
  LayoutGrid,
} from 'lucide-react';
import type { AgentRunStatus } from '@/services/agent/agentRunStatus';

export interface AgentProcessControlProps {
  status: AgentRunStatus;
  /** 是否显示（调用方：有 active / error / actionLine） */
  visible: boolean;
}

type TabId = 'overview' | 'glossary' | 'tools' | 'windows';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: '概览', icon: <LayoutGrid className="h-3.5 w-3.5" /> },
  { id: 'glossary', label: '术语', icon: <BookOpen className="h-3.5 w-3.5" /> },
  { id: 'tools', label: '工具', icon: <Wrench className="h-3.5 w-3.5" /> },
  { id: 'windows', label: '分窗', icon: <ListTree className="h-3.5 w-3.5" /> },
];

const TOOL_LABEL: Record<string, string> = {
  search_transcript: '搜索字幕',
  count_transcript: '统计词频',
  verify_term: '校验术语',
  web_search: '联网搜索',
  update_todo: '更新待办',
  submit_result: '提交术语结果',
  submit_translation: '提交译文',
  submit_qa_report: '提交 QA 报告',
};

function stageLabel(s?: string | null) {
  if (s === 'terminology') return '术语';
  if (s === 'translate') return '翻译';
  if (s === 'qa') return 'QA';
  if (s === 'finalize') return '完成';
  return s || '—';
}

function toolLabel(name: string) {
  return TOOL_LABEL[name] || name;
}

export const AgentProcessControl: React.FC<AgentProcessControlProps> = ({
  status,
  visible,
}) => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabId>('overview');
  const [glossaryQ, setGlossaryQ] = useState('');
  const [copied, setCopied] = useState(false);
  const panelId = useId();
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // 运行中概览：新事件自动滚到底（jsdom 无 scrollIntoView 时跳过）
  useEffect(() => {
    if (!open || tab !== 'overview' || !status.active) return;
    const el = eventsEndRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  }, [status.recentEvents.length, status.toolLog.length, open, tab, status.active, reduceMotion]);

  const filteredGlossary = useMemo(() => {
    const q = glossaryQ.trim().toLowerCase();
    if (!q) return status.glossary;
    return status.glossary.filter(
      (g) =>
        g.source.toLowerCase().includes(q) ||
        g.target.toLowerCase().includes(q) ||
        (g.note || '').toLowerCase().includes(q)
    );
  }, [status.glossary, glossaryQ]);

  const copyGlossary = useCallback(async () => {
    const text = status.glossary
      .map((g) =>
        g.note
          ? `${g.source}\t${g.target}\t${g.note}`
          : `${g.source}\t${g.target}`
      )
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }, [status.glossary]);

  if (!visible) return null;

  const summary = status.compactSummary || status.compactBadge || 'Agent';
  // 测试环境 / 减弱动效：瞬间完成，避免 AnimatePresence 残留 DOM
  const dur =
    reduceMotion || import.meta.env.MODE === 'test' ? 0 : 0.22;
  const ease = [0.4, 0, 0.2, 1] as const;

  const drawer = (
    <AnimatePresence>
      {open ? (
        <div className="agent-drawer-root" data-testid="agent-brain-panel">
          <motion.button
            type="button"
            className="agent-drawer-backdrop"
            aria-label="关闭 Agent 过程"
            onClick={close}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: dur }}
          />
          <motion.aside
            className="agent-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Agent 处理过程"
            id={panelId}
            initial={reduceMotion ? false : { x: '100%' }}
            animate={{ x: 0 }}
            exit={reduceMotion ? undefined : { x: '100%' }}
            transition={{ duration: dur, ease }}
          >
            <header className="agent-drawer-head">
              <div className="agent-drawer-title">
                <Brain className="h-4 w-4 flex-shrink-0" aria-hidden />
                <span>Agent 过程</span>
                {status.active ? (
                  <span className="agent-drawer-live">运行中</span>
                ) : status.error ? (
                  <span className="agent-drawer-err-badge">失败</span>
                ) : (
                  <span className="agent-drawer-done-badge">已完成</span>
                )}
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

            <div className="agent-drawer-stats" data-testid="agent-drawer-stats">
              <span className="agent-stat-chip">术语 {status.glossaryCount}</span>
              <span className="agent-stat-chip">
                进度 {status.completedEntries}/{status.totalEntries || '—'}
              </span>
              <span className="agent-stat-chip">
                窗 {status.currentWindow ?? '—'}/{status.totalWindows || '—'}
              </span>
              <span className="agent-stat-chip">tokens {status.tokensTotal || 0}</span>
            </div>

            <nav className="agent-drawer-tabs" role="tablist" aria-label="过程分区">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`agent-drawer-tab${tab === t.id ? ' is-active' : ''}`}
                  data-testid={`agent-tab-${t.id}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.icon}
                  <span>
                    {t.label}
                    {t.id === 'glossary' && status.glossaryCount > 0
                      ? ` ${status.glossaryCount}`
                      : ''}
                    {t.id === 'tools' && status.toolLog.length > 0
                      ? ` ${status.toolLog.length}`
                      : ''}
                    {t.id === 'windows' && status.windows.length > 0
                      ? ` ${status.windows.length}`
                      : ''}
                  </span>
                </button>
              ))}
            </nav>

            <div className="agent-drawer-body" data-testid="agent-drawer-body">
              <AnimatePresence mode="wait">
                <motion.div
                  key={tab}
                  className="agent-drawer-section"
                  initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
                  transition={{ duration: dur * 0.85, ease }}
                >
                  {tab === 'overview' && (
                    <>
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

                      {status.styleGuide ? (
                        <div className="agent-drawer-block">
                          <div className="agent-drawer-block-title">风格指南</div>
                          <pre className="agent-drawer-style">{status.styleGuide}</pre>
                        </div>
                      ) : null}

                      {status.recentEvents.length > 0 ? (
                        <div className="agent-drawer-block is-fill">
                          <div className="agent-drawer-block-title">事件</div>
                          <ul className="agent-brain-events" data-testid="agent-brain-events">
                            {status.recentEvents.map((ev) => (
                              <li key={ev.id}>{ev.text}</li>
                            ))}
                            <div ref={eventsEndRef} />
                          </ul>
                        </div>
                      ) : (
                        <div className="agent-drawer-empty is-soft">
                          {status.active ? '等待阶段事件…' : '暂无事件'}
                        </div>
                      )}

                      {status.error ? (
                        <div className="agent-brain-error" data-testid="agent-brain-error">
                          {status.error}
                        </div>
                      ) : null}
                    </>
                  )}

                  {tab === 'glossary' && (
                    <div data-testid="agent-glossary-tab" className="agent-drawer-section-inner">
                      <div className="agent-drawer-toolbar">
                        <input
                          type="search"
                          className="agent-drawer-search"
                          placeholder="筛选原文 / 译文…"
                          value={glossaryQ}
                          onChange={(e) => setGlossaryQ(e.target.value)}
                          aria-label="筛选术语"
                        />
                        <button
                          type="button"
                          className="wb-tool"
                          disabled={status.glossary.length === 0}
                          onClick={() => void copyGlossary()}
                          title="复制为 TSV"
                        >
                          {copied ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                          {copied ? '已复制' : '复制'}
                        </button>
                      </div>
                      {filteredGlossary.length === 0 ? (
                        <div className="agent-drawer-empty">
                          {status.active && status.stage === 'terminology'
                            ? '术语分析中…'
                            : '暂无术语'}
                        </div>
                      ) : (
                        <div className="agent-glossary-table-wrap">
                          <table className="agent-glossary-table">
                            <thead>
                              <tr>
                                <th>原文</th>
                                <th>译文</th>
                                <th>备注</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredGlossary.map((g, i) => (
                                <tr key={`${g.source}-${i}`}>
                                  <td>{g.source}</td>
                                  <td>{g.target}</td>
                                  <td className="is-muted" title={g.note || undefined}>
                                    <span className="agent-glossary-note">
                                      {g.note || '—'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {tab === 'tools' && (
                    <div data-testid="agent-tools-tab" className="agent-drawer-section-inner">
                      {status.toolLog.length === 0 ? (
                        <div className="agent-drawer-empty">
                          {status.active ? '等待工具调用…' : '本次无工具记录'}
                        </div>
                      ) : (
                        <ul className="agent-tool-list">
                          {status.toolLog.map((t) => (
                            <li
                              key={t.id}
                              className={`agent-tool-item${t.ok ? '' : ' is-err'}${
                                t.detail === '进行中…' ? ' is-pending' : ''
                              }`}
                            >
                              <div className="agent-tool-row">
                                <span className="agent-tool-name" title={t.name}>
                                  {toolLabel(t.name)}
                                </span>
                                <span className="agent-tool-meta">
                                  {stageLabel(t.stage)}
                                  {t.durationMs != null ? ` · ${t.durationMs}ms` : ''}
                                  {t.detail === '进行中…'
                                    ? ' · 进行中'
                                    : t.ok
                                      ? ''
                                      : ' · 失败'}
                                </span>
                              </div>
                              {t.argsSummary ? (
                                <div className="agent-tool-args" title={t.argsSummary}>
                                  {t.argsSummary}
                                </div>
                              ) : null}
                              {t.detail && t.detail !== '进行中…' ? (
                                <div className="agent-tool-detail" title={t.detail}>
                                  {t.detail}
                                </div>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {tab === 'windows' && (
                    <div data-testid="agent-windows-tab" className="agent-drawer-section-inner">
                      {status.windows.length === 0 ? (
                        <div className="agent-drawer-empty">分窗尚未开始</div>
                      ) : (
                        <ul className="agent-window-list">
                          {status.windows.map((w) => (
                            <li
                              key={w.windowIndex}
                              className={`agent-window-item is-${w.status}`}
                            >
                              <div className="agent-window-row">
                                <span className="agent-window-title">
                                  窗 {w.windowIndex + 1}
                                  {status.totalWindows
                                    ? ` / ${status.totalWindows}`
                                    : ''}
                                </span>
                                <span className="agent-window-status">
                                  {w.status === 'running'
                                    ? '进行中'
                                    : w.status === 'done'
                                      ? '完成'
                                      : w.status === 'error'
                                        ? '需关注'
                                        : '等待'}
                                </span>
                              </div>
                              <div className="agent-window-meta">
                                {w.entryCount > 0 ? `${w.entryCount} 行` : '—'}
                                {w.tokensUsed > 0 ? ` · ${w.tokensUsed} tokens` : ''}
                                {w.qaTotal != null
                                  ? ` · QA ${w.qaCritical ?? 0}/${w.qaTotal} critical`
                                  : ''}
                              </div>
                              {w.qaNote ? (
                                <div className="agent-window-note">{w.qaNote}</div>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>
  );

  return (
    <div className="agent-proc" data-testid="agent-process-control">
      <button
        type="button"
        className={`agent-proc-trigger${open ? ' is-open' : ''}${status.active ? ' is-active' : ''}`}
        data-testid="agent-brain-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        title="查看 Agent 完整过程（术语 / 工具 / 分窗）"
        onClick={() => setOpen(true)}
      >
        <Brain className="agent-proc-ico" aria-hidden />
        <span className="agent-proc-summary" data-testid="agent-stage-summary">
          {summary}
        </span>
        {status.active ? <span className="agent-proc-pulse" aria-hidden /> : null}
      </button>
      {createPortal(drawer, document.body)}
    </div>
  );
};
