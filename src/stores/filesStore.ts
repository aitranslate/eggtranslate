/**
 * 文件数据 Store
 * 唯一持有任务数据和 phase 状态。
 * 不包含业务编排 —— 编排逻辑在 service 层。
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { useMemo } from 'react';
import { SubtitleEntry, SubtitleFileMetadata, TranslationStatus, FilePhases, PhaseProgress, WorkflowType, SplitAlignStatus } from '@/types';
import { convertTaskToMetadata } from '@/services/SubtitleFileManager';
import { generateStableFileId } from '@/utils/taskIdGenerator';
import localforage from 'localforage';
import type { SingleTask } from '@/types';

interface FilesState {
  tasks: SingleTask[];
  selectedFileId: string | null;

  // 任务 setter
  addTask: (task: SingleTask) => void;
  removeTask: (taskId: string) => void;
  clearAllTasks: () => void;

  // 选中
  setSelectedFileId: (id: string | null) => void;

  // 条目 setter
  updateEntry: (
    fileId: string,
    entryId: number,
    text: string,
    translatedText?: string,
    status?: TranslationStatus,
    startTime?: string,
    endTime?: string,
    words?: SubtitleEntry['words']
  ) => void;
  deleteEntry: (fileId: string, entryId: number) => void;
  batchUpdateEntries: (
    fileId: string,
    updates: Array<{ id: number; text: string; translatedText?: string }>
  ) => void;
  updateEntrySplitStatus: (fileId: string, entryId: number, status: SplitAlignStatus) => void;

  // Phase setter
  updatePhase: (fileId: string, phase: keyof Omit<FilePhases, 'workflow'>, update: Partial<PhaseProgress>) => void;
  setWorkflow: (fileId: string, workflow: WorkflowType) => void;
  setSelectedKeytermGroupId: (fileId: string, groupId: string | null) => void;

  // Getters
  getFile: (fileId: string) => SubtitleFileMetadata | undefined;
  getAllFiles: () => SubtitleFileMetadata[];
  getTranslationProgress: (fileId: string) => { completed: number; total: number };
  getFileEntries: (fileId: string) => SubtitleEntry[];
}

export const useFilesStore = create<FilesState>()(
  persist(
    (set, get) => ({
      tasks: [],
      selectedFileId: null,

      addTask: (task) => {
        set((state) => ({ tasks: [...state.tasks, task] }));
      },

      removeTask: (taskId) => {
        set((state) => ({
          tasks: state.tasks.filter((t) => t.taskId !== taskId),
          selectedFileId: state.selectedFileId === taskId ? null : state.selectedFileId,
        }));
      },

      clearAllTasks: () => {
        set({ tasks: [], selectedFileId: null });
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
            return {
              ...t,
              subtitle_entries: (t.subtitle_entries || []).filter((e) => e.id !== entryId),
            };
          });
          return { tasks: newTasks };
        });
      },

      batchUpdateEntries: (fileId, updates) => {
        const file = get().getFile(fileId);
        if (!file) return;
        set((state) => {
          const newTasks = state.tasks.map((t) => {
            if (t.taskId !== file.taskId) return t;
            const entries = [...(t.subtitle_entries || [])];
            for (const update of updates) {
              const idx = entries.findIndex((e) => e.id === update.id);
              if (idx !== -1) {
                entries[idx] = {
                  ...entries[idx],
                  text: update.text,
                  translatedText: update.translatedText ?? entries[idx].translatedText,
                };
              }
            }
            return { ...t, subtitle_entries: entries };
          });
          return { tasks: newTasks };
        });
      },

      updateEntrySplitStatus: (fileId, entryId, status) => {
        const file = get().getFile(fileId);
        if (!file) return;
        set((state) => {
          const newTasks = state.tasks.map((t) => {
            if (t.taskId !== file.taskId) return t;
            return {
              ...t,
              subtitle_entries: (t.subtitle_entries || []).map((e) =>
                e.id === entryId ? { ...e, splitAlignStatus: status } : e
              ),
            };
          });
          return { tasks: newTasks };
        });
      },

      updatePhase: (fileId, phase, update) => {
        const file = get().getFile(fileId);
        if (!file) return;
        if (update.status === 'completed') {
          update.errorMessage = undefined;
        }
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.taskId === file.taskId
              ? { ...t, phases: { ...t.phases, [phase]: { ...t.phases[phase], ...update } } }
              : t
          ),
        }));
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
      name: 'subtitle_tasks',
      storage: createJSONStorage(() => localforage),
      partialize: (state) => ({ tasks: state.tasks, selectedFileId: state.selectedFileId }),
      version: 3,
      migrate: (persistedState: unknown, version: number) => {
        if (persistedState && typeof persistedState === 'object' && 'tasks' in persistedState) {
          const state = persistedState as { tasks: SingleTask[]; selectedFileId: string | null };
          if (version < 3) {
            // 旧任务没有 selectedKeytermGroupId 字段，默认为 null
            return {
              ...state,
              tasks: state.tasks.map((t) => ({ ...t, selectedKeytermGroupId: null })),
            };
          }
          return state;
        }
        return { tasks: [], selectedFileId: null };
      },
      onRehydrateStorage: () => (state, error) => {
        if (error || !state) return;
        // 检测中断：active → failed。构造新对象，不直接 mutation 传入的 state
        const recoveredTasks = state.tasks.map((task) => {
          if (!task.phases) return task;
          let taskChanged = false;
          const newPhases = { ...task.phases };
          for (const phase of ['converting', 'transcribing', 'translating', 'splitting'] as const) {
            if (newPhases[phase]?.status === 'active') {
              newPhases[phase] = {
                status: 'failed',
                progress: newPhases[phase].progress || 0,
                tokens: newPhases[phase].tokens || 0,
              } as PhaseProgress;
              taskChanged = true;
            }
          }
          return taskChanged ? { ...task, phases: newPhases } : task;
        });
        if (recoveredTasks.some((t, i) => t !== state.tasks[i])) {
          useFilesStore.setState({ tasks: recoveredTasks });
        }
      },
    }
  )
);

// ============================================
// Helper hooks
// ============================================

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
