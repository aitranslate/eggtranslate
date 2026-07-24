/**
 * Agent 翻译管线类型与事件契约。
 * 仅在 agentTranslationEnabled 时使用；旧批译路径不依赖本模块。
 *
 * 可视化与 harness 共用同一事件模型：UI 只读结构化字段，禁止靠英文文案猜状态。
 */

import type { Term, TranslationConfig } from '@/types';

export type AgentStage =
  | 'terminology'
  | 'translate'
  | 'qa'
  | 'finalize';

export type GlossaryEntry = {
  source: string;
  target: string;
  note?: string;
};

/** Tool outcome kinds (aligned with toolTypes / AsrAgent) */
export type AgentToolKind =
  | 'tool_ok'
  | 'tool_error'
  | 'submit_ok'
  | 'submit_reject'
  | 'pending';

export type AgentToolNudge = 'todo' | 'web_require' | 'web_soft' | null;

export type AgentWindowSpec = {
  windowIndex: number;
  /** 本窗在全局 entries 中的下标（0-based） */
  entryIndices: number[];
  contextBeforeIndices: number[];
  contextAfterIndices: number[];
};

/** 过程面板「工具」时间线条目 */
export type AgentToolLogEntry = {
  id: string;
  name: string;
  argsSummary: string;
  /** true = 成功；soft reject 也是 false，但 kind/nudge 区分 */
  ok: boolean;
  kind?: AgentToolKind;
  nudge?: AgentToolNudge;
  detail?: string;
  durationMs?: number;
  at: number;
  stage?: AgentStage;
};

/** 过程面板「分窗」列表 */
export type AgentWindowUi = {
  windowIndex: number;
  entryCount: number;
  status: 'pending' | 'running' | 'done' | 'error';
  tokensUsed: number;
  qaCritical?: number;
  qaTotal?: number;
  qaNote?: string;
};

/** 全局术语一致性问题（UI 列表） */
export type AgentTermIssueUi = {
  index: number;
  source: string;
  canonicalTarget: string;
  foundTarget: string;
};

export type AgentEvent =
  | {
      type: 'pipeline_start';
      totalEntries: number;
      totalWindows: number;
      /** 术语 briefing 分窗数（长片 >1） */
      briefingWindows?: number;
    }
  | { type: 'stage'; stage: AgentStage; detail?: string }
  | {
      type: 'briefing_progress';
      current: number;
      total: number;
      detail?: string;
    }
  | {
      type: 'terminology_done';
      glossary: GlossaryEntry[];
      styleGuide: string;
      tokensUsed: number;
    }
  | {
      type: 'terminology_issues';
      issues: AgentTermIssueUi[];
    }
  | {
      type: 'web_usage';
      count: number;
      max: number;
    }
  | { type: 'window_start'; windowIndex: number; entryIds: number[] }
  | {
      type: 'translation_partial';
      updates: Array<{ entryId: number; text: string }>;
    }
  | {
      type: 'window_done';
      windowIndex: number;
      translations: Array<{ entryId: number; text: string }>;
      tokensUsed: number;
    }
  | {
      type: 'progress';
      completedEntries: number;
      totalEntries: number;
      tokensDelta?: number;
      /** Human-facing line only — never used to infer stage */
      statusText?: string;
      /**
       * Control plane: explicit stage for UI stepper/progress.
       * Prefer this over free-text; omit to leave stage unchanged.
       */
      stage?: AgentStage;
      /** 1-based window index for UI (optional) */
      currentWindow?: number;
      totalWindows?: number;
    }
  | {
      type: 'tool_start';
      name: string;
      argsSummary: string;
      /** 与 tool_end 关联；并发同名工具时必需 */
      callId: string;
      stage?: AgentStage;
    }
  | {
      type: 'tool_end';
      name: string;
      argsSummary: string;
      callId: string;
      ok: boolean;
      kind?: AgentToolKind;
      nudge?: AgentToolNudge;
      detail?: string;
      durationMs?: number;
      stage?: AgentStage;
    }
  | {
      type: 'qa_result';
      windowIndex: number;
      critical: number;
      total: number;
      summary?: string;
    }
  | { type: 'checkpoint'; boundary: 'B1' | 'B2' | 'B3' }
  | {
      type: 'run_stats';
      tokensTerminology: number;
      tokensTranslate: number;
      tokensQa: number;
      tokensExpand?: number;
      tokensTotal: number;
      qaWindowsRun: number;
      qaWindowsSkipped: number;
      totalWindows: number;
    }
  | { type: 'pipeline_end' }
  | { type: 'pipeline_error'; error: string };

export type AgentEventHandler = (event: AgentEvent) => void | Promise<void>;

/** B0–B3 持久化 job（IndexedDB） */
export type AgentJob = {
  schemaVersion: 1;
  taskId: string;
  fileId: string;
  fingerprint: string;
  stage: 'terminology' | 'translate' | 'done';
  glossary: GlossaryEntry[];
  styleGuide: string;
  /** windowIndex → 已完成的 entryId → 译文 */
  windowResults: Record<string, Record<number, string>>;
  updatedAt: number;
};

export type RunAgentTranslationInput = {
  fileId: string;
  taskId: string;
  filename: string;
  config: TranslationConfig;
  signal: AbortSignal;
  userTerms: Term[];
  onEvent: AgentEventHandler;
  /**
   * 可选：遗留批译注入（当前全 tool-loop 管线可不使用）。
   * 保留以便测试/回退实验。
   */
  translateBatch?: (
    config: TranslationConfig,
    texts: string[],
    options: {
      signal?: AbortSignal;
      contextBefore?: string;
      contextAfter?: string;
      terms?: string;
      onPartial?: (t: Record<string, { direct: string }>) => void;
      onAttemptStart?: (attempt: number) => void;
    }
  ) => Promise<{
    translations: Record<string, { direct: string }>;
    tokensUsed: number;
    partial?: boolean;
  }>;
  /** 术语单次抽取兜底（tool loop 失败时） */
  callLlmForTerminology?: (
    system: string,
    user: string,
    signal: AbortSignal
  ) => Promise<{ content: string; tokensUsed: number }>;
};
