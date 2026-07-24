/**
 * Agent 运行状态 UI 读模型：纯函数，从 pipeline AgentEvent 归约。
 * 过程面板用 compactSummary / compactBadge 与 glossary / tools / windows；
 * 侧栏任务卡不展示 Agent 徽章（避免挤掉文件大小/时长）。
 */

import type { AgentRunSnapshot } from '@/types';
import type {
  AgentEvent,
  AgentStage,
  AgentTermIssueUi,
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
  /** 过程面板备用短徽章，例如「Agent·译 2/4」——禁止长句 */
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
  /** 阶段 token 分解（run_stats） */
  tokensTerminology: number;
  tokensTranslate: number;
  tokensQa: number;
  tokensExpand: number;
  /** LLM QA 窗计数 */
  qaWindowsRun: number;
  qaWindowsSkipped: number;
  /** 术语阶段 web_search 用量 */
  webSearchCount: number;
  webSearchMax: number;
  /** 术语 briefing 分窗进度（长片） */
  briefingWindowCurrent: number | null;
  briefingWindowTotal: number;
  /** 全局术语一致性问题 */
  termIssues: AgentTermIssueUi[];
  steps: AgentStageStep[];
  recentEvents: AgentRunEventLine[];
  error: string | null;
  updatedAt: number;
};

/**
 * 过程条进度：按**阶段模型**映射，不用 entry 计数抢先盖掉术语阶段。
 *
 * | stage        | 区间   | 信号 |
 * |--------------|--------|------|
 * | terminology  | 0–25%  | briefing 窗 / glossary |
 * | translate/qa | 25–99% | completedEntries（单调）|
 * | finalize/done| 100%   | 终态 |
 */
export function agentProgressPercent(st: AgentRunStatus): number {
  const allStepsDone = st.steps.length > 0 && st.steps.every((s) => s.status === 'done');
  if (!st.active && (st.stage === 'finalize' || allStepsDone) && !st.error) {
    return 100;
  }

  // 术语阶段：即使 pipeline_start 已写入 totalEntries，仍用 briefing 窗进度
  if (st.stage === 'terminology' || (st.active && st.stage === null)) {
    if (st.briefingWindowTotal > 0 && st.briefingWindowCurrent != null) {
      const ratio = Math.min(
        1,
        Math.max(0, st.briefingWindowCurrent / st.briefingWindowTotal)
      );
      return Math.min(25, Math.max(5, Math.round(ratio * 25)));
    }
    return st.glossaryCount > 0 ? 18 : 8;
  }

  if (st.totalEntries > 0) {
    const ratio = Math.min(1, Math.max(0, st.completedEntries / st.totalEntries));
    // 译/QA 落在 25–99，避免与术语带重叠、终态留给 finalize
    const mapped = Math.round(25 + ratio * 74);
    if (st.stage === 'qa') return Math.min(99, Math.max(40, mapped));
    if (st.stage === 'finalize') return st.active ? Math.min(99, Math.max(mapped, 95)) : 100;
    return Math.min(99, Math.max(25, mapped));
  }

  if (st.error && !st.active) return 0;
  return st.active ? 10 : 0;
}

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
    tokensTerminology: 0,
    tokensTranslate: 0,
    tokensQa: 0,
    tokensExpand: 0,
    qaWindowsRun: 0,
    qaWindowsSkipped: 0,
    webSearchCount: 0,
    webSearchMax: 3,
    briefingWindowCurrent: null,
    briefingWindowTotal: 0,
    termIssues: [],
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

/** 过程面板短徽章：短 token，禁止多子句长句 */
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
        briefingWindowTotal: event.briefingWindows ?? 0,
        briefingWindowCurrent: event.briefingWindows ? 1 : null,
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
      {
        const bw = event.briefingWindows ?? 0;
        next.recentEvents = pushEvent(
          next,
          bw > 1
            ? `开始：${event.totalEntries} 条 · 译 ${event.totalWindows} 窗 · 术语分析 ${bw} 段`
            : `开始：${event.totalEntries} 条 · ${event.totalWindows} 窗`
        );
      }
      next.actionLine = '术语 Agent：准备分析字幕…';
      break;

    case 'briefing_progress':
      next.active = true;
      next.stage = 'terminology';
      next.steps = markSteps(next.steps, 'terminology');
      next.briefingWindowCurrent = event.current;
      next.briefingWindowTotal = event.total;
      next.actionLine =
        event.detail ||
        (event.total > 1
          ? `术语分析 ${event.current}/${event.total}…`
          : '术语分析中…');
      if (event.total > 1) {
        next.recentEvents = pushEvent(
          next,
          event.detail || `术语窗 ${event.current}/${event.total}`
        );
      }
      break;

    case 'web_usage':
      next.webSearchCount = event.count;
      next.webSearchMax = event.max;
      break;

    case 'terminology_issues':
      next.termIssues = event.issues || [];
      if (next.termIssues.length) {
        next.recentEvents = pushEvent(
          next,
          `术语一致性：${next.termIssues.length} 处待关注`
        );
      }
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
      // tokens 只在 progress.tokensDelta 累加（与 window_done 同批会重复，勿在此加）
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
          // 窗级明细；全量 tokensTotal 只信 progress.tokensDelta，避免与 progress 双计
          tokensUsed:
            (next.windows.find((w) => w.windowIndex === event.windowIndex)?.tokensUsed ||
              0) + (event.tokensUsed || 0),
        });
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
        kind: 'pending',
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
          (t) => t.name === event.name && t.kind === 'pending'
        );
      }
      const kind =
        event.kind ||
        (event.ok ? 'tool_ok' : event.nudge ? 'submit_reject' : 'tool_error');
      const entry: AgentToolLogEntry = {
        id: event.callId || (pendingIdx >= 0 ? tools[pendingIdx].id : `te-${Date.now()}`),
        name: event.name,
        argsSummary: event.argsSummary,
        ok: event.ok,
        kind,
        nudge: event.nudge ?? null,
        detail: event.detail,
        durationMs: event.durationMs,
        at: Date.now(),
        stage: event.stage ?? next.stage ?? undefined,
      };
      if (pendingIdx >= 0) tools[pendingIdx] = entry;
      else tools.unshift(entry);
      next.toolLog = tools.slice(0, MAX_TOOLS);
      // 概览：结构化文案（软提示 ≠ 失败）
      const isSubmit = event.name.startsWith('submit_');
      if (isSubmit || !event.ok) {
        let line: string;
        if (event.nudge === 'web_soft') {
          line = '软提示 · 可再提交或先联网搜索';
        } else if (event.nudge === 'web_require') {
          line = '需联网搜索后再提交术语';
        } else if (event.nudge === 'todo') {
          line = '待办未清 · 请更新 todo 后再提交';
        } else if (isSubmit) {
          line = event.ok ? `提交成功 · ${event.name}` : `提交未接受 · ${event.name}`;
        } else {
          line = `工具失败 · ${event.name}`;
        }
        next.recentEvents = pushEvent(next, line);
      }
      break;
    }

    case 'progress':
      // 并发分窗 progress 可能乱序到达：完成数只升不降（与 window_done 一致）
      next.completedEntries = Math.max(
        next.completedEntries,
        Math.max(0, event.completedEntries || 0)
      );
      if (event.totalEntries > 0) {
        next.totalEntries = Math.max(next.totalEntries, event.totalEntries);
      }
      if (typeof event.tokensDelta === 'number' && event.tokensDelta > 0) {
        next.tokensTotal += event.tokensDelta;
      }
      // statusText = display only. Stage / window from structured fields only.
      if (event.statusText) {
        next.actionLine = event.statusText;
      }
      if (typeof event.currentWindow === 'number' && event.currentWindow > 0) {
        next.currentWindow = event.currentWindow;
      }
      if (typeof event.totalWindows === 'number' && event.totalWindows > 0) {
        next.totalWindows = Math.max(next.totalWindows, event.totalWindows);
      }
      if (event.stage) {
        next.stage = event.stage;
        const doneUpTo: AgentStage | undefined =
          event.stage === 'translate'
            ? 'terminology'
            : event.stage === 'qa'
              ? 'translate'
              : event.stage === 'finalize'
                ? 'qa'
                : undefined;
        next.steps = markSteps(next.steps, event.stage, {
          doneUpTo,
        });
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

    case 'run_stats':
      next.tokensTerminology = event.tokensTerminology ?? 0;
      next.tokensTranslate = event.tokensTranslate ?? 0;
      next.tokensQa = event.tokensQa ?? 0;
      next.tokensExpand = event.tokensExpand ?? 0;
      next.qaWindowsRun = event.qaWindowsRun ?? 0;
      next.qaWindowsSkipped = event.qaWindowsSkipped ?? 0;
      if (typeof event.tokensTotal === 'number' && event.tokensTotal > 0) {
        // Prefer structured total when larger (progress may already have summed)
        next.tokensTotal = Math.max(next.tokensTotal, event.tokensTotal);
      }
      if (event.totalWindows > 0) {
        next.totalWindows = Math.max(next.totalWindows, event.totalWindows);
      }
      next.recentEvents = pushEvent(
        next,
        `统计：术语 ${next.tokensTerminology} · 译 ${next.tokensTranslate} · QA ${next.tokensQa} token · QA窗 ${next.qaWindowsRun}跑/${next.qaWindowsSkipped}跳`
      );
      next.actionLine =
        next.qaWindowsSkipped > 0
          ? `完成统计：QA 跳过 ${next.qaWindowsSkipped} 窗 · 共 ${next.tokensTotal} tokens`
          : next.actionLine;
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

/** 长句检测：短徽章禁止出现的多子句模式 */
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
      kind: t.kind as AgentToolLogEntry['kind'],
      nudge: (t.nudge as AgentToolLogEntry['nudge']) ?? null,
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
    tokensTerminology: snap.tokensTerminology ?? 0,
    tokensTranslate: snap.tokensTranslate ?? 0,
    tokensQa: snap.tokensQa ?? 0,
    tokensExpand: snap.tokensExpand ?? 0,
    qaWindowsRun: snap.qaWindowsRun ?? 0,
    qaWindowsSkipped: snap.qaWindowsSkipped ?? 0,
    webSearchCount: snap.webSearchCount ?? 0,
    webSearchMax: snap.webSearchMax ?? 3,
    briefingWindowTotal: snap.briefingWindowTotal ?? 0,
    briefingWindowCurrent: null,
    termIssues: snap.termIssues ?? [],
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
      kind: t.kind,
      nudge: t.nudge ?? undefined,
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
    tokensTerminology: st.tokensTerminology,
    tokensTranslate: st.tokensTranslate,
    tokensQa: st.tokensQa,
    tokensExpand: st.tokensExpand,
    qaWindowsRun: st.qaWindowsRun,
    qaWindowsSkipped: st.qaWindowsSkipped,
    webSearchCount: st.webSearchCount,
    webSearchMax: st.webSearchMax,
    briefingWindowTotal: st.briefingWindowTotal,
    termIssues: st.termIssues.slice(0, 40),
    lastActionLine:
      st.actionLine || (error ? `失败：${error}` : 'Agent 流程完成'),
    completedAt: Date.now(),
    error,
    totalEntries: st.totalEntries,
    completedEntries: st.completedEntries,
    totalWindows: st.totalWindows,
  };
}
