/**
 * Agent 运行状态 UI 读模型：纯函数，从 pipeline AgentEvent 归约。
 * 任务卡只用 compactBadge；长文案仅供大脑面板。
 */

import type { AgentRunSnapshot } from '@/types';
import type { AgentEvent, AgentStage } from './types';

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
  /** 编辑器顶栏短摘要，例如「术语 · 分析中」 */
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
  styleGuidePreview: string;
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

const MAX_EVENTS = 24;

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
    styleGuidePreview: '',
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

/** 编辑器顶栏短摘要 */
export function formatAgentCompactSummary(s: AgentRunStatus): string {
  if (s.error) return 'Agent 失败';
  if (!s.active) return '';
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
      // QA detail often "窗 x QA"
      if (event.stage === 'qa' && event.detail) {
        const m = event.detail.match(/窗\s*(\d+)/);
        if (m) next.currentWindow = Number(m[1]);
      }
      break;

    case 'terminology_done':
      next.glossaryCount = event.glossary?.length ?? 0;
      next.styleGuidePreview = (event.styleGuide || '').slice(0, 120);
      next.steps = markSteps(next.steps, 'translate', { doneUpTo: 'terminology' });
      next.stage = 'translate';
      next.actionLine = `术语完成：${next.glossaryCount} 条 · 开始分窗翻译`;
      next.recentEvents = pushEvent(
        next,
        `术语完成 ${next.glossaryCount} 条 · tokens ${event.tokensUsed}`
      );
      break;

    case 'window_start':
      next.stage = 'translate';
      next.currentWindow = event.windowIndex + 1;
      next.steps = markSteps(next.steps, 'translate', { doneUpTo: 'terminology' });
      next.actionLine = `第 ${event.windowIndex + 1}/${next.totalWindows || '?'} 窗翻译中…`;
      next.recentEvents = pushEvent(
        next,
        `窗 ${event.windowIndex + 1} 开始（${event.entryIds.length} 行）`
      );
      break;

    case 'window_done':
      if (event.windowIndex >= 0) {
        next.currentWindow = event.windowIndex + 1;
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

    case 'progress':
      next.completedEntries = event.completedEntries;
      next.totalEntries = event.totalEntries || next.totalEntries;
      if (event.statusText) {
        // 进度文案可进大脑面板主句；任务卡仍只用 compactBadge
        next.actionLine = event.statusText;
        // 从 "窗 x/y" 抽当前窗
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
      next.actionLine = 'Agent 流程完成';
      next.recentEvents = pushEvent(next, '流水线结束');
      next.compactBadge = '';
      next.compactSummary = '';
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
      // 不刷长事件，避免刷屏；仅保证 active
      next.active = true;
      break;

    default:
      break;
  }

  next.compactBadge = formatAgentCompactBadge(next);
  next.compactSummary = formatAgentCompactSummary(next);
  // pipeline_end 清空徽章
  if (event.type === 'pipeline_end') {
    next.compactBadge = '';
    next.compactSummary = '';
  }
  return next;
}

/** 长句检测：任务卡禁止出现的多子句模式 */
export function isLongAgentNarrative(text: string): boolean {
  if (!text) return false;
  // 多子句 / 过长
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
    status: (snap.error ? (s.id === 'finalize' ? 'error' : 'done') : 'done') as AgentStageUiStatus,
  }));
  return {
    ...base,
    active: false,
    stage: 'finalize',
    actionLine: snap.lastActionLine || (snap.error ? `失败：${snap.error}` : 'Agent 流程完成'),
    glossaryCount: snap.glossaryCount ?? 0,
    styleGuidePreview: snap.styleGuidePreview || '',
    totalEntries: snap.totalEntries ?? 0,
    totalWindows: snap.totalWindows ?? 0,
    steps,
    error: snap.error ?? null,
    // 终态不刷任务卡运行徽章（避免永远「Agent·译」）；编辑器仍可看过程
    compactBadge: '',
    compactSummary: snap.error ? 'Agent 失败' : 'Agent 已完成',
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
