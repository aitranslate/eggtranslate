/**
 * 文件数据 Store
 * 唯一持有任务数据和 phase 状态。
 * 不包含业务编排 —— 编排逻辑在 service 层。
 */

import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { useMemo } from "react";
import {
  SubtitleEntry,
  SubtitleFileMetadata,
  TranslationStatus,
  FilePhases,
  PhaseProgress,
  WorkflowType,
} from "@/types";
import { convertTaskToMetadata } from "@/services/SubtitleFileManager";
import { generateStableFileId } from "@/utils/taskIdGenerator";
import localforage from "localforage";
import type { SingleTask } from "@/types";

/** 快速连续写入时合并 IDB persist（翻译热路径） */
export const FILES_PERSIST_DEBOUNCE_MS = 800;

export type BatchEntryUpdate = {
  id: number;
  text: string;
  translatedText?: string;
  status?: TranslationStatus;
};

/**
 * 将中断的 active phase 标为 failed（刷新恢复用）。
 * 纯函数，便于单测；不替换整个任务列表。
 */
export function recoverInterruptedPhases(task: SingleTask): SingleTask {
  if (!task.phases) return task;
  let taskChanged = false;
  const newPhases = { ...task.phases };
  for (const phase of ["converting", "transcribing", "translating"] as const) {
    if (newPhases[phase]?.status === "active") {
      newPhases[phase] = {
        status: "failed",
        progress: newPhases[phase].progress || 0,
        tokens: newPhases[phase].tokens || 0,
      } as PhaseProgress;
      taskChanged = true;
    }
  }
  return taskChanged ? { ...task, phases: newPhases } : task;
}

interface FilesState {
  tasks: SingleTask[];
  selectedFileId: string | null;

  addTask: (task: SingleTask) => void;
  removeTask: (taskId: string) => void;
  clearAllTasks: () => void;

  setSelectedFileId: (id: string | null) => void;

  updateEntry: (
    fileId: string,
    entryId: number,
    text: string,
    translatedText?: string,
    status?: TranslationStatus,
    startTime?: string,
    endTime?: string,
    words?: SubtitleEntry["words"]
  ) => void;
  deleteEntry: (fileId: string, entryId: number) => void;
  batchUpdateEntries: (fileId: string, updates: BatchEntryUpdate[]) => void;

  updatePhase: (
    fileId: string,
    phase: keyof Omit<FilePhases, "workflow">,
    update: Partial<PhaseProgress>
  ) => void;
  setWorkflow: (fileId: string, workflow: WorkflowType) => void;
  setSelectedKeytermGroupId: (fileId: string, groupId: string | null) => void;

  getFile: (fileId: string) => SubtitleFileMetadata | undefined;
  getAllFiles: () => SubtitleFileMetadata[];
  getTranslationProgress: (fileId: string) => { completed: number; total: number };
  getFileEntries: (fileId: string) => SubtitleEntry[];
}

// ---------- debounced IndexedDB storage ----------

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPersist: { name: string; value: string } | null = null;
let underlyingWriteCount = 0;

/** Test helper: how many times the underlying storage actually wrote */
export function getFilesPersistWriteCount(): number {
  return underlyingWriteCount;
}

/** Test helper */
export function resetFilesPersistWriteCount(): void {
  underlyingWriteCount = 0;
}

export async function flushFilesStorePersist(): Promise<void> {
  if (persistTimer != null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (!pendingPersist) return;
  const { name, value } = pendingPersist;
  pendingPersist = null;
  underlyingWriteCount += 1;
  await localforage.setItem(name, value);
}

const debouncedStateStorage: StateStorage = {
  getItem: async (name) => {
    const value = await localforage.getItem<string>(name);
    return value ?? null;
  },
  setItem: (name, value) => {
    pendingPersist = { name, value };
    if (persistTimer != null) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      void flushFilesStorePersist();
    }, FILES_PERSIST_DEBOUNCE_MS);
  },
  removeItem: async (name) => {
    pendingPersist = null;
    if (persistTimer != null) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    await localforage.removeItem(name);
  },
};

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (pendingPersist) {
      // best-effort sync flush is not available for localforage; fire-and-forget
      void flushFilesStorePersist();
    }
  });
  window.addEventListener("pagehide", () => {
    void flushFilesStorePersist();
  });
}

export const useFilesStore = create<FilesState>()(
  persist(
    (set, get) => ({
      tasks: [],
      selectedFileId: null,

      addTask: (task) => {
        set((state) => ({
          tasks: [
            ...state.tasks,
            {
              ...task,
              entryCount: task.entryCount ?? task.subtitle_entries?.length ?? 0,
              translatedCount:
                task.translatedCount ??
                task.subtitle_entries?.filter((e) => e.translatedText).length ??
                0,
            },
          ],
        }));
        // 新任务立即落盘，避免 debounce 窗口内 rehydrate/刷新丢任务
        void flushFilesStorePersist();
      },

      removeTask: (taskId) => {
        set((state) => ({
          tasks: state.tasks.filter((t) => t.taskId !== taskId),
          selectedFileId: state.selectedFileId === taskId ? null : state.selectedFileId,
        }));
        void flushFilesStorePersist();
      },

      clearAllTasks: () => {
        set({ tasks: [], selectedFileId: null });
        void flushFilesStorePersist();
      },

      setSelectedFileId: (id) => {
        set({ selectedFileId: id });
      },

      updateEntry: (fileId, entryId, text, translatedText, status, startTime, endTime, words) => {
        const file = get().getFile(fileId);
        if (!file) return;
        set((state) => {
          const newTasks = state.tasks.map((t) => {
            if (t.taskId !== file.taskId) return t;
            const oldEntry = t.subtitle_entries?.find((e) => e.id === entryId);
            const wasTranslated = !!oldEntry?.translatedText;
            const willBeTranslated = !!(translatedText ?? oldEntry?.translatedText);
            const delta = wasTranslated === willBeTranslated ? 0 : willBeTranslated ? 1 : -1;
            return {
              ...t,
              subtitle_entries: (t.subtitle_entries || []).map((e) => {
                if (e.id !== entryId) return e;
                return {
                  ...e,
                  text,
                  translatedText: translatedText ?? e.translatedText,
                  translationStatus: status ?? e.translationStatus,
                  startTime: startTime ?? e.startTime,
                  endTime: endTime ?? e.endTime,
                  words: words ?? e.words,
                };
              }),
              translatedCount: t.translatedCount + delta,
            };
          });
          return { tasks: newTasks };
        });
      },

      deleteEntry: (fileId, entryId) => {
        const file = get().getFile(fileId);
        if (!file) return;
        set((state) => {
          const newTasks = state.tasks.map((t) => {
            if (t.taskId !== file.taskId) return t;
            const removed = t.subtitle_entries?.find((e) => e.id === entryId);
            const wasTranslated = !!removed?.translatedText;
            return {
              ...t,
              subtitle_entries: (t.subtitle_entries || []).filter((e) => e.id !== entryId),
              entryCount: Math.max(0, t.entryCount - 1),
              translatedCount: Math.max(0, t.translatedCount - (wasTranslated ? 1 : 0)),
            };
          });
          return { tasks: newTasks };
        });
      },

      batchUpdateEntries: (fileId, updates) => {
        const file = get().getFile(fileId);
        if (!file || updates.length === 0) return;
        set((state) => {
          const newTasks = state.tasks.map((t) => {
            if (t.taskId !== file.taskId) return t;
            const byId = new Map((t.subtitle_entries || []).map((e) => [e.id, e]));
            let delta = 0;
            for (const update of updates) {
              const prev = byId.get(update.id);
              if (!prev) continue;
              const wasTranslated = !!prev.translatedText;
              const nextTranslated =
                update.translatedText !== undefined ? update.translatedText : prev.translatedText;
              const next: SubtitleEntry = {
                ...prev,
                text: update.text,
                translatedText: nextTranslated,
                translationStatus: update.status ?? prev.translationStatus,
              };
              const willBeTranslated = !!next.translatedText;
              if (wasTranslated !== willBeTranslated) {
                delta += willBeTranslated ? 1 : -1;
              }
              byId.set(update.id, next);
            }
            // preserve original order
            const entries = (t.subtitle_entries || []).map((e) => byId.get(e.id) ?? e);
            return {
              ...t,
              subtitle_entries: entries,
              translatedCount: Math.max(0, t.translatedCount + delta),
            };
          });
          return { tasks: newTasks };
        });
      },

      updatePhase: (fileId, phase, update) => {
        const file = get().getFile(fileId);
        if (!file) return;
        if (update.status === "completed") {
          update = { ...update, errorMessage: undefined };
        }
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.taskId === file.taskId
              ? { ...t, phases: { ...t.phases, [phase]: { ...t.phases[phase], ...update } } }
              : t
          ),
        }));
        // terminal phase transitions: flush coalesced persist promptly
        if (update.status === "completed" || update.status === "failed") {
          void flushFilesStorePersist();
        }
      },

      setWorkflow: (fileId, workflow) => {
        const file = get().getFile(fileId);
        if (!file) return;
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.taskId === file.taskId ? { ...t, phases: { ...t.phases, workflow } } : t
          ),
        }));
      },

      setSelectedKeytermGroupId: (fileId, groupId) => {
        const file = get().getFile(fileId);
        if (!file) return;
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.taskId === file.taskId ? { ...t, selectedKeytermGroupId: groupId } : t
          ),
        }));
      },

      getFile: (fileId) => {
        const task = get().tasks.find((t) => generateStableFileId(t.taskId) === fileId);
        return task ? convertTaskToMetadata(task) : undefined;
      },

      getAllFiles: () => {
        return get().tasks.map((t) => convertTaskToMetadata(t));
      },

      getTranslationProgress: (fileId) => {
        const file = get().getFile(fileId);
        if (!file) return { completed: 0, total: 0 };
        return { completed: file.translatedCount || 0, total: file.entryCount || 0 };
      },

      getFileEntries: (fileId) => {
        const file = get().getFile(fileId);
        if (!file) return [];
        const task = get().tasks.find((t) => t.taskId === file.taskId);
        return task?.subtitle_entries || [];
      },
    }),
    {
      name: "subtitle_tasks",
      storage: createJSONStorage(() => debouncedStateStorage),
      partialize: (state) => ({ tasks: state.tasks, selectedFileId: state.selectedFileId }),
      version: 3,
      // 不在 mount 时自动 rehydrate；由 bootstrap.rehydrateAppStores() 在 render 前完成
      skipHydration: true,
      migrate: (persistedState: unknown, version: number) => {
        // 注意：migrate 只在 version 变化时调用，不能依赖它做「每次刷新的中断恢复」
        if (persistedState && typeof persistedState === "object" && "tasks" in persistedState) {
          const state = persistedState as { tasks: SingleTask[]; selectedFileId: string | null };
          if (version < 3) {
            return {
              ...state,
              tasks: state.tasks.map((t) => ({ ...t, selectedKeytermGroupId: null })),
            };
          }
          return state;
        }
        return { tasks: [], selectedFileId: null };
      },
      /**
       * merge 在每一次 rehydrate 都会执行（与 version 无关）。
       * 在写入内存前把 active phase → failed，刷新后可重新处理，而不是卡死在「处理中」。
       * 这是与 bootstrap「先 rehydrate 再 mount」配套的正确位置，不是事后 setState 补丁。
       */
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<{
          tasks: SingleTask[];
          selectedFileId: string | null;
        }>;
        const tasks = (persisted.tasks ?? currentState.tasks ?? []).map(recoverInterruptedPhases);
        return {
          ...currentState,
          ...persisted,
          tasks,
          selectedFileId:
            persisted.selectedFileId !== undefined
              ? persisted.selectedFileId
              : currentState.selectedFileId,
        };
      },
    }
  )
);

// ============================================
// Helper hooks
// ============================================

/** File count only — use when UI only cares about empty vs non-empty list */
export const useFileCount = () => useFilesStore((state) => state.tasks.length);

export const useFiles = () => {
  const tasks = useFilesStore(useShallow((state) => state.tasks));
  return useMemo(() => tasks.map(convertTaskToMetadata), [tasks]);
};

export const useFile = (fileId: string) => {
  const tasks = useFilesStore(useShallow((state) => state.tasks));
  return useMemo(() => {
    const task = tasks.find((t) => generateStableFileId(t.taskId) === fileId);
    return task ? convertTaskToMetadata(task) : undefined;
  }, [tasks, fileId]);
};

export const useSelectedFile = () => {
  const selectedFileId = useFilesStore((state) => state.selectedFileId);
  const tasks = useFilesStore(useShallow((state) => state.tasks));
  return useMemo(() => {
    if (!selectedFileId) return null;
    const task = tasks.find((t) => generateStableFileId(t.taskId) === selectedFileId);
    return task ? convertTaskToMetadata(task) : null;
  }, [tasks, selectedFileId]);
};
