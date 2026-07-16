/**
 * Agent 翻译管线类型与事件契约。
 * 仅在 agentTranslationEnabled 时使用；旧批译路径不依赖本模块。
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

export type AgentWindowSpec = {
  windowIndex: number;
  /** 本窗在全局 entries 中的下标（0-based） */
  entryIndices: number[];
  contextBeforeIndices: number[];
  contextAfterIndices: number[];
};

export type AgentEvent =
  | { type: 'pipeline_start'; totalEntries: number; totalWindows: number }
  | { type: 'stage'; stage: AgentStage; detail?: string }
  | {
      type: 'terminology_done';
      glossary: GlossaryEntry[];
      styleGuide: string;
      tokensUsed: number;
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
      statusText?: string;
    }
  | { type: 'checkpoint'; boundary: 'B1' | 'B2' | 'B3' }
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
