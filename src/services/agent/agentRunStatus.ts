/**
 * Agent 运行状态 UI 读模型：纯函数，从 pipeline AgentEvent 归约。
 * 任务卡只用 compactBadge；过程面板读 glossary / tools / windows 全量。
 */

import type { AgentRunSnapshot } from '@/types';
import type {
  AgentEvent,
  AgentStage,
  AgentToolLogEntry,
  AgentWindowUi,
  GlossaryEntry,
} from './types';

export type AgentStageUiStatus = 'pending' | 'active' | 'done' | 'error';

export type AgentStageStep = {
  id: AgentStage;
  label: string;
  status: AgentStageUiStatus;
};

export type AgentRunEventLine = {
  id: string;
  text: string;
  at: number;
};

export type AgentRunStatus = {
  fileId: string;
  taskId: string;
  active: boolean;
  stage: AgentStage | null;
  /** 编辑器顶栏短摘要，例如「术语 · 分析中」/「Agent 已完成」 */
  compactSummary: string;
  /** 任务卡短徽章，例如「Agent·译 2/4」——禁止长句 */
  compactBadge: string;
  /** 大脑面板主句（可稍长，仍应单行可读） */
  actionLine: string;
  totalEntries: number;
  completedEntries: number;
  totalWindows: number;
  currentWindow: number | null;
  glossaryCount: number;
  /** 完整术语表（过程面板） */
  glossary: GlossaryEntry[];
  /** 完整风格指南 */
  styleGuide: string;
  styleGuidePreview: string;
  /** 工具时间线（新在前） */
  toolLog: AgentToolLogEntry[];
  /** 分窗列表 */
  windows: AgentWindowUi[];
  /** 累计 tokens */
  tokensTotal: number;
  steps: AgentStageStep[];
  recentEvents: AgentRunEventLine[];
  error: string | null;
  updatedAt: number;
};

const STAGE_LABEL: Record<AgentStage, string> = {
  terminology: '术语',
  translate: '分窗翻译',
  qa: 'QA 审校',
  finalize: '完成',
};

const MAX_EVENTS = 40;
const MAX_TOOLS = 80;

export function createIdleAgentRunStatus(
  fileId = '',
  taskId = ''
): AgentRunStatus {
  return {
    fileId,
    taskId,
    active: false,
    stage: null,
    compactSummary: '',
    compactBadge: '',
    actionLine: '',
    totalEntries: 0,
    completedEntries: 0,
    totalWindows: 0,
    currentWindow: null,
    glossaryCount: 0,
    glossary: [],
    styleGuide: '',
    styleGuidePreview: '',
    toolLog: [],
    windows: [],
    tokensTotal: 0,
    steps: [
      { id: 'terminology', label: STAGE_LABEL.terminology, status: 'pending' },
      { id: 'translate', label: STAGE_LABEL.translate, status: 'pending' },
      { id: 'qa', label: STAGE_LABEL.qa, status: 'pending' },
      { id: 'finalize', label: STAGE_LABEL.finalize, status: 'pending' },
    ],
    recentEvents: [],
    error: null,
    updatedAt: 0,
  };
}

function pushEvent(prev: AgentRunStatus, text: string): AgentRunEventLine[] {
  const line: AgentRunEventLine = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text,
    at: Date.now(),
  };
  return [line, ...prev.recentEvents].slice(0, MAX_EVENTS);
}

function pushTool(
  prev: AgentRunStatus,
  entry: AgentToolLogEntry
): AgentToolLogEntry[] {
  return [entry, ...prev.toolLog].slice(0, MAX_TOOLS);
}

function markSteps(
  steps: AgentStageStep[],
  active: AgentStage | null,
  opts?: { doneUpTo?: AgentStage; errorOn?: AgentStage }
): AgentStageStep[] {
  const order: AgentStage[] = ['terminology', 'translate', 'qa', 'finalize'];
  const activeIdx = active ? order.indexOf(active) : -1;
  const doneUpToIdx = opts?.doneUpTo != null ? order.indexOf(opts.doneUpTo) : -1;

  return steps.map((s) => {
    const idx = order.indexOf(s.id);
    if (opts?.errorOn === s.id) return { ...s, status: 'error' };
    if (doneUpToIdx >= 0 && idx <= doneUpToIdx) return { ...s, status: 'done' };
    if (idx >= 0 && activeIdx >= 0) {
      if (idx < activeIdx) return { ...s, status: 'done' };
      if (idx === activeIdx) return { ...s, status: 'active' };
      return { ...s, status: 'pending' };
    }
    return s;
  });
}

function upsertWindow(
  windows: AgentWindowUi[],
  patch: Partial<AgentWindowUi> & { windowIndex: number }
): AgentWindowUi[] {
  const idx = windows.findIndex((w) => w.windowIndex === patch.windowIndex);
  if (idx < 0) {
    return [
      ...windows,
      {
        windowIndex: patch.windowIndex,
        entryCount: patch.entryCount ?? 0,
        status: patch.status ?? 'pending',
        tokensUsed: patch.tokensUsed ?? 0,
        qaCritical: patch.qaCritical,
        qaTotal: patch.qaTotal,
        qaNote: patch.qaNote,
      },
    ].sort((a, b) => a.windowIndex - b.windowIndex);
  }
  const next = [...windows];
  next[idx] = { ...next[idx], ...patch };
  return next;
}

/** 任务卡徽章：短 token，禁止多子句长句 */
export function formatAgentCompactBadge(s: Pick<
  AgentRunStatus,
  'active' | 'stage' | 'currentWindow' | 'totalWindows' | 'error'
>): string {
  if (s.error) return 'Agent·失败';
  if (!s.active) return '';
  switch (s.stage) {
    case 'terminology':
      return 'Agent·术语';
    case 'translate': {
      if (s.totalWindows > 0 && s.currentWindow != null) {
        return `Agent·译 ${s.currentWindow}/${s.totalWindows}`;
      }
      return 'Agent·译';
    }
    case 'qa':
      return 'Agent·QA';
    case 'finalize':
      return 'Agent·收尾';
    default:
      return 'Agent';
  }
}

/** 编辑器顶栏短摘要（含终态可点开） */
export function formatAgentCompactSummary(s: AgentRunStatus): string {
  if (s.error) return 'Agent 失败';
  if (!s.active) {
    if (s.glossaryCount > 0 || s.actionLine) {
      return s.glossaryCount > 0
        ? `Agent 已完成 · 术语 ${s.glossaryCount}`
        : 'Agent 已完成';
    }
    return '';
  }
  if (s.stage === 'terminology') return '术语 · 分析中';
  if (s.stage === 'translate') {
    if (s.totalWindows > 0 && s.currentWindow != null) {
      return `译 ${s.currentWindow}/${s.totalWindows} · ${s.completedEntries}/${s.totalEntries}`;
    }
    return `翻译 · ${s.completedEntries}/${s.totalEntries}`;
  }
  if (s.stage === 'qa') {
    if (s.currentWindow != null && s.totalWindows > 0) {
      return `QA · 窗 ${s.currentWindow}/${s.totalWindows}`;
    }
    return 'QA · 审校中';
  }
  if (s.stage === 'finalize') return '完成中';
  return 'Agent 运行中';
}

/**
 * 归约单个 AgentEvent。exported for unit tests.
 */
export function applyAgentEventToStatus(
  prev: AgentRunStatus,
  event: AgentEvent,
  meta?: { fileId?: string; taskId?: string }
): AgentRunStatus {
  let next: AgentRunStatus = {
    ...prev,
    fileId: meta?.fileId ?? prev.fileId,
    taskId: meta?.taskId ?? prev.taskId,
    updatedAt: Date.now(),
  };

  switch (event.type) {
    case 'pipeline_start':
      next = {
        ...createIdleAgentRunStatus(next.fileId, next.taskId),
        active: true,
        stage: 'terminology',
        totalEntries: event.totalEntries,
        totalWindows: event.totalWindows,
        steps: markSteps(createIdleAgentRunStatus().steps, 'terminology'),
        recentEvents: [],
        toolLog: [],
        windows: Array.from({ length: event.totalWindows }, (_, i) => ({
          windowIndex: i,
          entryCount: 0,
          status: 'pending' as const,
          tokensUsed: 0,
        })),
        updatedAt: Date.now(),
      };
      next.recentEvents = pushEvent(
        next,
        `开始：${event.totalEntries} 条 · ${event.totalWindows} 窗`
      );
      next.actionLine = '术语 Agent：准备分析字幕…';
      break;

    case 'stage':
      next.active = true;
      next.stage = event.stage;
      next.steps = markSteps(next.steps, event.stage);
      if (event.detail) {
        next.recentEvents = pushEvent(next, event.detail);
        next.actionLine = event.detail;
      } else {
        next.actionLine = `${STAGE_LABEL[event.stage]}进行中…`;
      }
      if (event.stage === 'qa' && event.detail) {
        const m = event.detail.match(/窗\s*(\d+)/);
        if (m) next.currentWindow = Number(m[1]);
      }
      break;

    case 'terminology_done': {
      const glossary = event.glossary ?? [];
      next.glossary = glossary;
      next.glossaryCount = glossary.length;
      next.styleGuide = event.styleGuide || '';
      next.styleGuidePreview = (event.styleGuide || '').slice(0, 200);
      next.tokensTotal += event.tokensUsed || 0;
      next.steps = markSteps(next.steps, 'translate', { doneUpTo: 'terminology' });
      next.stage = 'translate';
      next.actionLine = `术语完成：${next.glossaryCount} 条 · 开始分窗翻译`;
      next.recentEvents = pushEvent(
        next,
        `术语完成 ${next.glossaryCount} 条 · tokens ${event.tokensUsed}`
      );
      break;
    }

    case 'window_start':
      next.stage = 'translate';
      next.currentWindow = event.windowIndex + 1;
      next.steps = markSteps(next.steps, 'translate', { doneUpTo: 'terminology' });
      next.actionLine = `第 ${event.windowIndex + 1}/${next.totalWindows || '?'} 窗翻译中…`;
      next.windows = upsertWindow(next.windows, {
        windowIndex: event.windowIndex,
        entryCount: event.entryIds.length,
        status: 'running',
      });
      next.recentEvents = pushEvent(
        next,
        `窗 ${event.windowIndex + 1} 开始（${event.entryIds.length} 行）`
      );
      break;

    case 'window_done':
      if (event.windowIndex >= 0) {
        next.currentWindow = event.windowIndex + 1;
        next.windows = upsertWindow(next.windows, {
          windowIndex: event.windowIndex,
          entryCount: event.translations.length,
          status: 'done',
          tokensUsed:
            (next.windows.find((w) => w.windowIndex === event.windowIndex)?.tokensUsed ||
              0) + (event.tokensUsed || 0),
        });
        next.tokensTotal += event.tokensUsed || 0;
        // 无 progress 事件时，用已完成窗的 entryCount 累加进度
        const doneCount = next.windows
          .filter((w) => w.status === 'done' || w.status === 'error')
          .reduce((sum, w) => sum + (w.entryCount || 0), 0);
        if (doneCount > next.completedEntries) {
          next.completedEntries = doneCount;
        }
        next.recentEvents = pushEvent(
          next,
          `窗 ${event.windowIndex + 1} 写入 ${event.translations.length} 行`
        );
        next.actionLine = `第 ${event.windowIndex + 1} 窗已写入 ${event.translations.length} 行`;
      } else if (event.translations.length) {
        next.recentEvents = pushEvent(
          next,
          `断点恢复 ${event.translations.length} 行`
        );
      }
      next.steps = markSteps(next.steps, 'translate', { doneUpTo: 'terminology' });
      break;

    case 'qa_result':
      next.windows = upsertWindow(next.windows, {
        windowIndex: event.windowIndex,
        status: event.critical > 0 ? 'error' : 'done',
        qaCritical: event.critical,
        qaTotal: event.total,
        qaNote: event.summary,
      });
      next.recentEvents = pushEvent(
        next,
        event.summary ||
          `窗 ${event.windowIndex + 1} QA：${event.critical}/${event.total} critical`
      );
      break;

    case 'tool_start':
      // 只进「工具」时间线，不刷概览事件（避免 → / ✓ 双行刷屏）
      next.toolLog = pushTool(next, {
        id: event.callId,
        name: event.name,
        argsSummary: event.argsSummary,
        ok: true,
        at: Date.now(),
        stage: event.stage ?? next.stage ?? undefined,
        detail: '进行中…',
      });
      break;

    case 'tool_end': {
      // 优先 callId 关联（并发同名工具安全）；否则回退最早一条同名 pending
      const tools = [...next.toolLog];
      let pendingIdx = tools.findIndex((t) => t.id === event.callId);
      if (pendingIdx < 0) {
        pendingIdx = tools.findIndex(
          (t) => t.name === event.name && t.detail === '进行中…'
        );
      }
      const entry: AgentToolLogEntry = {
        id: event.callId || (pendingIdx >= 0 ? tools[pendingIdx].id : `te-${Date.now()}`),
        name: event.name,
        argsSummary: event.argsSummary,
        ok: event.ok,
        detail: event.detail,
        durationMs: event.durationMs,
        at: Date.now(),
        stage: event.stage ?? next.stage ?? undefined,
      };
      if (pendingIdx >= 0) tools[pendingIdx] = entry;
      else tools.unshift(entry);
      next.toolLog = tools.slice(0, MAX_TOOLS);
      // 概览事件：一条可读摘要；submit_* 更醒目
      const isSubmit = event.name.startsWith('submit_');
      if (isSubmit || !event.ok) {
        next.recentEvents = pushEvent(
          next,
          isSubmit
            ? `${event.ok ? '提交成功' : '提交失败'} · ${event.name}`
            : `工具失败 · ${event.name}`
        );
      }
      break;
    }

    case 'progress':
      next.completedEntries = event.completedEntries;
      next.totalEntries = event.totalEntries || next.totalEntries;
      if (typeof event.tokensDelta === 'number' && event.tokensDelta > 0) {
        next.tokensTotal += event.tokensDelta;
      }
      if (event.statusText) {
        next.actionLine = event.statusText;
        const wm = event.statusText.match(/窗\s*(\d+)\s*\/\s*(\d+)/);
        if (wm) {
          next.currentWindow = Number(wm[1]);
          next.totalWindows = Number(wm[2]) || next.totalWindows;
        }
        if (event.statusText.includes('QA') || event.statusText.includes('审校')) {
          next.stage = 'qa';
          next.steps = markSteps(next.steps, 'qa', { doneUpTo: 'translate' });
        } else if (event.statusText.includes('术语')) {
          next.stage = 'terminology';
          next.steps = markSteps(next.steps, 'terminology');
        } else if (event.statusText.includes('完成') && !event.statusText.includes('术语完成')) {
          /* keep */
        } else {
          next.stage = next.stage === 'qa' ? 'qa' : 'translate';
          next.steps = markSteps(next.steps, next.stage ?? 'translate', {
            doneUpTo: next.stage === 'qa' ? 'translate' : 'terminology',
          });
        }
      }
      break;

    case 'checkpoint':
      next.recentEvents = pushEvent(next, `检查点 ${event.boundary}`);
      if (event.boundary === 'B1') {
        next.steps = markSteps(next.steps, 'translate', { doneUpTo: 'terminology' });
      }
      if (event.boundary === 'B3') {
        next.stage = 'finalize';
        next.steps = markSteps(next.steps, 'finalize', { doneUpTo: 'qa' });
      }
      break;

    case 'pipeline_end':
      next.active = false;
      next.stage = 'finalize';
      next.steps = next.steps.map((s) => ({ ...s, status: 'done' as const }));
      next.completedEntries = next.totalEntries;
      next.currentWindow = next.totalWindows > 0 ? next.totalWindows : next.currentWindow;
      next.actionLine = 'Agent 流程完成';
      next.recentEvents = pushEvent(next, '流水线结束');
      next.compactBadge = '';
      break;

    case 'pipeline_error':
      next.active = false;
      next.error = event.error;
      next.actionLine = `失败：${event.error}`;
      next.steps = markSteps(next.steps, next.stage, {
        errorOn: next.stage ?? undefined,
      });
      next.recentEvents = pushEvent(next, `错误：${event.error}`);
      break;

    case 'translation_partial':
      next.active = true;
      break;

    default:
      break;
  }

  next.compactBadge = formatAgentCompactBadge(next);
  next.compactSummary = formatAgentCompactSummary(next);
  if (event.type === 'pipeline_end') {
    next.compactBadge = '';
    next.compactSummary = formatAgentCompactSummary({ ...next, active: false });
  }
  return next;
}

/** 长句检测：任务卡禁止出现的多子句模式 */
export function isLongAgentNarrative(text: string): boolean {
  if (!text) return false;
  if (text.length > 28) return true;
  if ((text.match(/[·|，,；;]/g) || []).length >= 2) return true;
  if (text.includes('正在') && text.length > 16) return true;
  return false;
}

/** 从任务上持久化的 Agent 快照恢复 UI 读模型（非 active） */
export function agentSnapshotToStatus(
  fileId: string,
  taskId: string,
  snap: AgentRunSnapshot
): AgentRunStatus {
  const base = createIdleAgentRunStatus(fileId, taskId);
  const steps = base.steps.map((s) => ({
    ...s,
    status: (snap.error
      ? s.id === 'finalize'
        ? 'error'
        : 'done'
      : 'done') as AgentStageUiStatus,
  }));
  const glossary = snap.glossary ?? [];
  const styleGuide = snap.styleGuide || snap.styleGuidePreview || '';
  const totalEntries = snap.totalEntries ?? 0;
  const completedEntries = snap.completedEntries ?? 0;
  const totalWindows = snap.totalWindows ?? 0;
  return {
    ...base,
    active: false,
    stage: 'finalize',
    actionLine: snap.lastActionLine || (snap.error ? `失败：${snap.error}` : 'Agent 流程完成'),
    glossaryCount: snap.glossaryCount ?? glossary.length,
    glossary,
    styleGuide,
    styleGuidePreview: (styleGuide || '').slice(0, 200),
    toolLog: (snap.toolLog || []).map((t) => ({
      ...t,
      stage: t.stage as AgentStage | undefined,
    })),
    windows: (snap.windows || []).map((w) => ({
      windowIndex: w.windowIndex,
      entryCount: w.entryCount,
      status: (w.status as AgentWindowUi['status']) || 'done',
      tokensUsed: w.tokensUsed,
      qaCritical: w.qaCritical,
      qaTotal: w.qaTotal,
      qaNote: w.qaNote,
    })),
    tokensTotal: snap.tokensTotal ?? 0,
    totalEntries,
    completedEntries,
    totalWindows,
    currentWindow: totalWindows > 0 ? totalWindows : null,
    steps,
    error: snap.error ?? null,
    compactBadge: '',
    compactSummary: snap.error
      ? 'Agent 失败'
      : glossary.length > 0
        ? `Agent 已完成 · 术语 ${glossary.length}`
        : 'Agent 已完成',
    updatedAt: snap.completedAt || Date.now(),
    recentEvents: [
      {
        id: `snap-${snap.completedAt || 0}`,
        text: snap.lastActionLine || 'Agent 流程完成',
        at: snap.completedAt || Date.now(),
      },
    ],
  };
}

/** 从 live status 生成可持久化快照（裁剪工具日志） */
export function statusToAgentSnapshot(
  st: AgentRunStatus,
  outcome: 'success' | 'error',
  errorMessage?: string
): AgentRunSnapshot {
  const error =
    outcome === 'success' ? null : (errorMessage ?? st.error ?? '未知错误');
  return {
    glossaryCount: st.glossaryCount || st.glossary.length,
    glossary: st.glossary.slice(0, 200),
    styleGuide: st.styleGuide || undefined,
    styleGuidePreview: (st.styleGuide || st.styleGuidePreview || '').slice(0, 200) || undefined,
    toolLog: st.toolLog.slice(0, 60).map((t) => ({
      id: t.id,
      name: t.name,
      argsSummary: t.argsSummary.slice(0, 200),
      ok: t.ok,
      detail: t.detail?.slice(0, 300),
      durationMs: t.durationMs,
      at: t.at,
      stage: t.stage,
    })),
    windows: st.windows.map((w) => ({
      windowIndex: w.windowIndex,
      entryCount: w.entryCount,
      status: w.status,
      tokensUsed: w.tokensUsed,
      qaCritical: w.qaCritical,
      qaTotal: w.qaTotal,
      qaNote: w.qaNote?.slice(0, 200),
    })),
    tokensTotal: st.tokensTotal,
    lastActionLine:
      st.actionLine || (error ? `失败：${error}` : 'Agent 流程完成'),
    completedAt: Date.now(),
    error,
    totalEntries: st.totalEntries,
    completedEntries: st.completedEntries,
    totalWindows: st.totalWindows,
  };
}
