/**
 * Agent 运行态（内存 only，不持久化）
 * 供编辑器顶栏摘要 + 大脑面板 + 任务卡短徽章订阅
 */

import { create } from 'zustand';
import type { AgentEvent } from '@/services/agent/types';
import type { AgentRunSnapshot } from '@/types';
import {
  agentSnapshotToStatus,
  applyAgentEventToStatus,
  createIdleAgentRunStatus,
  type AgentRunStatus,
} from '@/services/agent/agentRunStatus';

interface AgentRunState {
  /** fileId → status */
  byFileId: Record<string, AgentRunStatus>;
  applyEvent: (
    fileId: string,
    taskId: string,
    event: AgentEvent
  ) => void;
  /** 仅当内存无 active 运行时，用任务快照回填终态 UI */
  hydrateFromSnapshot: (
    fileId: string,
    taskId: string,
    snapshot: AgentRunSnapshot | null | undefined
  ) => void;
  clearFile: (fileId: string) => void;
  getStatus: (fileId: string) => AgentRunStatus | undefined;
}

export const useAgentRunStore = create<AgentRunState>((set, get) => ({
  byFileId: {},

  applyEvent: (fileId, taskId, event) => {
    set((state) => {
      const prev =
        state.byFileId[fileId] ?? createIdleAgentRunStatus(fileId, taskId);
      const next = applyAgentEventToStatus(prev, event, { fileId, taskId });
      return {
        byFileId: {
          ...state.byFileId,
          [fileId]: next,
        },
      };
    });
  },

  hydrateFromSnapshot: (fileId, taskId, snapshot) => {
    if (!snapshot) return;
    set((state) => {
      const cur = state.byFileId[fileId];
      // 正在跑的 live 状态不被快照覆盖
      if (cur?.active) return state;
      return {
        byFileId: {
          ...state.byFileId,
          [fileId]: agentSnapshotToStatus(fileId, taskId, snapshot),
        },
      };
    });
  },

  clearFile: (fileId) => {
    set((state) => {
      if (!(fileId in state.byFileId)) return state;
      const byFileId = { ...state.byFileId };
      delete byFileId[fileId];
      return { byFileId };
    });
  },

  getStatus: (fileId) => get().byFileId[fileId],
}));

/** DEV：agent-browser / 本地探针注入 Agent 运行态 */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __eggAgentRunStore?: typeof useAgentRunStore }).__eggAgentRunStore =
    useAgentRunStore;
}
