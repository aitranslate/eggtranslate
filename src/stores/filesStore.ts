/**
 * 文件数据 Store
 * 唯一持有任务数据和 phase 状态。
 * 不包含业务编排 —— 编排逻辑在 service 层。
 */

import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { useMemo, useSyncExternalStore } from "react";
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
import { maybeSimplifyChinese } from "@/utils/chineseScript";
import localforage from "localforage";
import type { SingleTask } from "@/types";
import { useTranslationConfigStore } from "@/stores/translationConfigStore";
import {
  clearAllTaskEntries,
  clearEntriesLifecycle,
  flushDirtyTaskEntries,
  forcePersistTaskEntriesFromTasks,
  isEntriesHydrated,
  isEntriesLoading,
  loadTaskEntries,
  markEntriesDirty,
  markEntriesHydrated,
  markEntriesLoading,
  removeTaskEntries,
  stripSubtitleWords,
  subscribeEntriesLifecycle,
} from "@/stores/taskEntriesStorage";

/** 任务目标语言：任务级优先，否则全局配置 */
function resolveTaskTargetLanguage(task: SingleTask): string {
  const own = task.targetLanguage?.trim();
  if (own) return own;
  return useTranslationConfigStore.getState().config.targetLanguage;
}

/** 写入译文时：目标为简体中文则 OpenCC 繁→简 */
function normalizeTranslatedText(
  text: string | undefined,
  targetLanguage: string
): string | undefined {
  if (text === undefined) return undefined;
  return maybeSimplifyChinese(text, targetLanguage);
}

/**
 * 内存条目被用户/流水线改写后：登记 hydrate + dirty。
 * 空壳（未 load 且 entryCount>0）不得冒充权威，否则会脏写空数组。
 */
function touchTaskEntriesDirty(taskId: string): void {
  if (isEntriesHydrated(taskId)) {
    markEntriesDirty(taskId);
    return;
  }
  const task = useFilesStore.getState().tasks.find((t) => t.taskId === taskId);
  if (!task) return;
  const len = task.subtitle_entries?.length ?? 0;
  if (len === 0 && (task.entryCount ?? 0) > 0) return;
  markEntriesHydrated(taskId, { dirty: true });
}

/** 快速连续写入时合并 IDB persist（翻译热路径） */
export const FILES_PERSIST_DEBOUNCE_MS = 800;

/** active 阶段仅 progress 变化时的 store 写入节流（流畅性） */
export const PHASE_PROGRESS_THROTTLE_MS = 250;

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
  for (const phase of ["converting", "transcribing", "segmenting", "translating"] as const) {
    if (newPhases[phase]?.status === "active") {
      newPhases[phase] = {
        status: "failed",
        progress: newPhases[phase].progress || 0,
        tokens: newPhases[phase].tokens || 0,
      } as PhaseProgress;
      taskChanged = true;
    }
  }
  // 断句中刷新：识别已标完成但字幕未入库 → 识别一并失败，才能重转录
  const noEntries =
    (task.entryCount ?? 0) === 0 && (task.subtitle_entries?.length ?? 0) === 0;
  if (
    newPhases.segmenting?.status === "failed" &&
    newPhases.transcribing?.status === "completed" &&
    noEntries
  ) {
    newPhases.transcribing = {
      ...newPhases.transcribing,
      status: "failed",
    };
    taskChanged = true;
  }
  return taskChanged ? { ...task, phases: newPhases } : task;
}

/**
 * PhaseProgress 固定字段比较。
 * missing 与 undefined 视为相同，避免 `errorMessage: undefined` 扩散后误判「有变化」。
 */
const PHASE_PROGRESS_KEYS = [
  'status',
  'progress',
  'tokens',
  'language',
  'errorMessage',
  'entryCount',
  'totalEntries',
  'keytermGroupName',
] as const satisfies readonly (keyof PhaseProgress)[];

function isSamePhaseProgress(a: PhaseProgress, b: PhaseProgress): boolean {
  if (a === b) return true;
  for (const k of PHASE_PROGRESS_KEYS) {
    if (!Object.is(a[k], b[k])) return false;
  }
  return true;
}

/** taskId:phase → 上次 progress 写入时刻 */
const phaseProgressThrottle = new Map<string, number>();
/** 节流窗口内合并的 progress patch */
const phaseProgressPending = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; patch: Partial<PhaseProgress> }
>();

function applyPhasePatch(
  get: () => FilesState,
  set: (partial: Partial<FilesState> | ((s: FilesState) => Partial<FilesState>)) => void,
  taskId: string,
  phase: keyof Omit<FilePhases, "workflow">,
  patch: Partial<PhaseProgress>,
  tokensDelta: number | undefined
): void {
  const { tasks } = get();
  let changed = false;
  const newTasks = tasks.map((t) => {
    if (t.taskId !== taskId) return t;
    const prev = t.phases[phase];
    const next: PhaseProgress = { ...prev, ...patch };
    if (typeof tokensDelta === "number" && tokensDelta !== 0) {
      next.tokens = Math.max(0, (prev?.tokens || 0) + tokensDelta);
    }
    if (
      typeof patch.progress === "number" &&
      typeof prev.progress === "number" &&
      patch.progress < prev.progress &&
      patch.status !== "failed" &&
      patch.status !== "completed"
    ) {
      next.progress = prev.progress;
    }
    if (prev && isSamePhaseProgress(prev, next)) return t;
    changed = true;
    return { ...t, phases: { ...t.phases, [phase]: next } };
  });
  if (!changed) return;
  set({ tasks: newTasks });
  if (patch.status === "completed" || patch.status === "failed") {
    void flushFilesStorePersist();
  }
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
  /**
   * 整表替换字幕（转录完成等）。权威写入：hydrate + dirty + strip words。
   */
  replaceTaskEntries: (taskId: string, entries: SubtitleEntry[]) => void;

  updatePhase: (
    fileId: string,
    phase: keyof Omit<FilePhases, "workflow">,
    /**
     * tokensDelta：在单次 set 内原子累加 tokens（并发 batch 安全）。
     * 与 tokens 同时传时以 tokensDelta 为准。
     */
    update: Partial<PhaseProgress> & { tokensDelta?: number }
  ) => void;
  setWorkflow: (fileId: string, workflow: WorkflowType) => void;
  setSelectedKeytermGroupId: (fileId: string, groupId: string | null) => void;
  /** 任务级源/目标语言（编辑器修改；不影响全局设置） */
  setTaskLanguages: (
    fileId: string,
    languages: { sourceLanguage: string; targetLanguage: string }
  ) => void;

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
  // 先落 dirty entries，再写主表（主表 partialize 后不含 entries）
  try {
    await flushDirtyTaskEntries(useFilesStore.getState().tasks);
  } catch {
    /* best-effort */
  }
  if (!pendingPersist) return;
  const { name, value } = pendingPersist;
  pendingPersist = null;
  underlyingWriteCount += 1;
  await localforage.setItem(name, value);
}

/** 打开任务 / 导出 / 开译前：确保 entries 已从 IDB 载入内存 */
const entriesLoadInflight = new Map<string, Promise<void>>();

/**
 * 任务字幕是否可展示：无条目、已 hydrate、或 entryCount 为 0。
 */
export function isTaskEntriesReady(taskId: string | undefined | null): boolean {
  if (!taskId) return true;
  if (isEntriesHydrated(taskId)) return true;
  const task = useFilesStore.getState().tasks.find((t) => t.taskId === taskId);
  if (!task) return true;
  if ((task.entryCount ?? 0) <= 0) return true;
  // 内存里已有全文（旁路 setState / 同会话未丢）
  if ((task.subtitle_entries?.length ?? 0) > 0) return true;
  return false;
}

export function isTaskEntriesLoading(taskId: string | undefined | null): boolean {
  if (!taskId) return false;
  return isEntriesLoading(taskId);
}

/** 编辑器：订阅 entries 是否就绪（loading → ready） */
export function useTaskEntriesReady(taskId: string | undefined | null): boolean {
  return useSyncExternalStore(
    subscribeEntriesLifecycle,
    () => isTaskEntriesReady(taskId),
    () => true
  );
}

export function useTaskEntriesLoading(taskId: string | undefined | null): boolean {
  return useSyncExternalStore(
    subscribeEntriesLifecycle,
    () => isTaskEntriesLoading(taskId),
    () => false
  );
}

export async function ensureTaskEntriesLoaded(taskId: string): Promise<void> {
  const existing = useFilesStore
    .getState()
    .tasks.find((t) => t.taskId === taskId);
  if (!existing) return;

  // 已 hydrate 或内存已有权威全文
  if (isEntriesHydrated(taskId)) return;
  if ((existing.subtitle_entries?.length ?? 0) > 0) {
    markEntriesHydrated(taskId, { dirty: false });
    return;
  }
  // 无字幕任务：空即权威
  if ((existing.entryCount ?? 0) <= 0) {
    markEntriesHydrated(taskId, { dirty: false });
    return;
  }

  let p = entriesLoadInflight.get(taskId);
  if (!p) {
    p = (async () => {
      markEntriesLoading(taskId, true);
      try {
        const entries = (await loadTaskEntries(taskId)) ?? [];
        useFilesStore.setState((state) => ({
          tasks: state.tasks.map((t) =>
            t.taskId === taskId
              ? {
                  ...t,
                  subtitle_entries: entries,
                  entryCount: entries.length || t.entryCount,
                  translatedCount:
                    entries.filter((e) => e.translatedText?.trim()).length ||
                    t.translatedCount,
                }
              : t
          ),
        }));
        markEntriesHydrated(taskId, { dirty: false });
      } finally {
        markEntriesLoading(taskId, false);
        entriesLoadInflight.delete(taskId);
      }
    })();
    entriesLoadInflight.set(taskId, p);
  }
  await p;
}

/** 按稳定 fileId 加载 entries */
export async function ensureFileEntriesLoaded(fileId: string): Promise<void> {
  const file = useFilesStore.getState().getFile(fileId);
  if (!file) return;
  await ensureTaskEntriesLoaded(file.taskId);
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
        const entries = stripSubtitleWords(
          Array.isArray(task.subtitle_entries) ? task.subtitle_entries : []
        );
        const entryCount = task.entryCount ?? entries.length;
        const translatedCount =
          task.translatedCount ??
          entries.filter((e) => e.translatedText).length;
        set((state) => ({
          tasks: [
            ...state.tasks,
            {
              ...task,
              subtitle_entries: entries,
              entryCount,
              translatedCount,
            },
          ],
        }));
        // 新任务内存即为权威；有正文则 dirty 立刻落盘
        markEntriesHydrated(task.taskId, { dirty: entries.length > 0 });
        // 新任务立即落盘，避免 debounce 窗口内 rehydrate/刷新丢任务
        void flushFilesStorePersist();
      },

      removeTask: (taskId) => {
        const fileId = generateStableFileId(taskId);
        void removeTaskEntries(taskId);
        set((state) => ({
          tasks: state.tasks.filter((t) => t.taskId !== taskId),
          // selectedFileId 存的是 fileId（稳定 id），兼容旧数据里可能写过 taskId
          selectedFileId:
            state.selectedFileId === fileId || state.selectedFileId === taskId
              ? null
              : state.selectedFileId,
        }));
        void flushFilesStorePersist();
      },

      clearAllTasks: () => {
        void clearAllTaskEntries();
        set({ tasks: [], selectedFileId: null });
        void flushFilesStorePersist();
      },

      setSelectedFileId: (id) => {
        set({ selectedFileId: id });
      },

      updateEntry: (fileId, entryId, text, translatedText, status, startTime, endTime, words) => {
        const file = get().getFile(fileId);
        if (!file) return;
        let changed = false;
        set((state) => {
          const newTasks = state.tasks.map((t) => {
            if (t.taskId !== file.taskId) return t;
            const oldEntry = t.subtitle_entries?.find((e) => e.id === entryId);
            if (!oldEntry) return t;
            const nextStatus = status ?? oldEntry?.translationStatus ?? 'pending';
            // 仅 completed 计入已译（streaming 部分文本不推高计数）
            const wasTranslated = oldEntry?.translationStatus === 'completed';
            const willBeTranslated = nextStatus === 'completed';
            const delta = wasTranslated === willBeTranslated ? 0 : willBeTranslated ? 1 : -1;
            const targetLang = resolveTaskTargetLanguage(t);
            const nextTranslated =
              translatedText !== undefined
                ? normalizeTranslatedText(translatedText, targetLang) ?? ''
                : oldEntry.translatedText;
            changed = true;
            return {
              ...t,
              subtitle_entries: (t.subtitle_entries || []).map((e) => {
                if (e.id !== entryId) return e;
                // 编辑路径不保留词级时间戳（words 参数忽略）
                void words;
                const { words: _drop, ...base } = e;
                return {
                  ...base,
                  text,
                  translatedText: nextTranslated,
                  translationStatus: nextStatus,
                  startTime: startTime ?? e.startTime,
                  endTime: endTime ?? e.endTime,
                };
              }),
              translatedCount: t.translatedCount + delta,
            };
          });
          return changed ? { tasks: newTasks } : state;
        });
        if (changed) touchTaskEntriesDirty(file.taskId);
      },

      deleteEntry: (fileId, entryId) => {
        const file = get().getFile(fileId);
        if (!file) return;
        let changed = false;
        set((state) => {
          const newTasks = state.tasks.map((t) => {
            if (t.taskId !== file.taskId) return t;
            const removed = t.subtitle_entries?.find((e) => e.id === entryId);
            if (!removed) return t;
            const wasTranslated = removed?.translationStatus === 'completed';
            changed = true;
            return {
              ...t,
              subtitle_entries: (t.subtitle_entries || []).filter((e) => e.id !== entryId),
              entryCount: Math.max(0, t.entryCount - 1),
              translatedCount: Math.max(0, t.translatedCount - (wasTranslated ? 1 : 0)),
            };
          });
          return changed ? { tasks: newTasks } : state;
        });
        if (changed) touchTaskEntriesDirty(file.taskId);
      },

      batchUpdateEntries: (fileId, updates) => {
        const file = get().getFile(fileId);
        if (!file || updates.length === 0) return;
        // 先算再 set：无变化时不调用 set，避免 zustand persist 仍走 setItem/序列化
        const { tasks } = get();
        let changed = false;
        const newTasks = tasks.map((t) => {
          if (t.taskId !== file.taskId) return t;
          const byId = new Map((t.subtitle_entries || []).map((e) => [e.id, e]));
          const targetLang = resolveTaskTargetLanguage(t);
          let delta = 0;
          let taskChanged = false;
          for (const update of updates) {
            const prev = byId.get(update.id);
            if (!prev) continue;
            const nextTranslated =
              update.translatedText !== undefined
                ? normalizeTranslatedText(update.translatedText, targetLang) ?? ''
                : prev.translatedText;
            const nextStatus = update.status ?? prev.translationStatus;
            // 值未变：跳过该条目（重试/重复回调）
            if (
              prev.text === update.text &&
              prev.translatedText === nextTranslated &&
              prev.translationStatus === nextStatus
            ) {
              continue;
            }
            const wasTranslated = prev.translationStatus === 'completed';
            const next: SubtitleEntry = {
              ...prev,
              text: update.text,
              translatedText: nextTranslated,
              translationStatus: nextStatus,
            };
            // 翻译定稿不保留词级时间戳
            if ('words' in next) delete next.words;
            const willBeTranslated = next.translationStatus === 'completed';
            if (wasTranslated !== willBeTranslated) {
              delta += willBeTranslated ? 1 : -1;
            }
            byId.set(update.id, next);
            taskChanged = true;
          }
          if (!taskChanged) return t;
          changed = true;
          // preserve original order
          const entries = (t.subtitle_entries || []).map((e) => byId.get(e.id) ?? e);
          return {
            ...t,
            subtitle_entries: entries,
            translatedCount: Math.max(0, t.translatedCount + delta),
          };
        });
        if (!changed) return;
        set({ tasks: newTasks });
        touchTaskEntriesDirty(file.taskId);
      },

      replaceTaskEntries: (taskId, entries) => {
        const clean = stripSubtitleWords(entries);
        const translatedCount = clean.filter((e) => e.translatedText?.trim()).length;
        let found = false;
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.taskId !== taskId) return t;
            found = true;
            return {
              ...t,
              subtitle_entries: clean,
              entryCount: clean.length,
              translatedCount,
            };
          }),
        }));
        if (!found) return;
        markEntriesHydrated(taskId, { dirty: true });
        void flushFilesStorePersist();
      },

      updatePhase: (fileId, phase, update) => {
        const file = get().getFile(fileId);
        if (!file) return;
        const { tokensDelta, ...rest } = update;
        let patch: Partial<PhaseProgress> = { ...rest };
        if (patch.status === "completed") {
          patch = { ...patch, errorMessage: undefined };
        }

        // 仅 progress 抖动且仍 active：节流写 store，减少侧栏/编辑器重渲
        const prevPhase = get().tasks.find((t) => t.taskId === file.taskId)?.phases[
          phase
        ];
        const statusAfter = patch.status ?? prevPhase?.status;
        const progressOnly =
          typeof patch.progress === "number" &&
          patch.status === undefined &&
          tokensDelta === undefined &&
          patch.errorMessage === undefined &&
          patch.language === undefined &&
          patch.entryCount === undefined &&
          patch.totalEntries === undefined &&
          patch.keytermGroupName === undefined &&
          (statusAfter === "active" || prevPhase?.status === "active");

        if (progressOnly) {
          const throttleKey = `${file.taskId}:${phase}`;
          const now = Date.now();
          const last = phaseProgressThrottle.get(throttleKey) ?? 0;
          if (now - last < PHASE_PROGRESS_THROTTLE_MS) {
            const pending = phaseProgressPending.get(throttleKey);
            if (pending?.timer) clearTimeout(pending.timer);
            const wait = PHASE_PROGRESS_THROTTLE_MS - (now - last);
            const timer = setTimeout(() => {
              phaseProgressPending.delete(throttleKey);
              phaseProgressThrottle.set(throttleKey, Date.now());
              // 直接应用合并后的 progress，避免再次进入节流
              applyPhasePatch(get, set, file.taskId, phase, patch, undefined);
            }, wait);
            phaseProgressPending.set(throttleKey, { timer, patch });
            return;
          }
          phaseProgressThrottle.set(throttleKey, now);
          const pending = phaseProgressPending.get(throttleKey);
          if (pending?.timer) clearTimeout(pending.timer);
          phaseProgressPending.delete(throttleKey);
        } else {
          // 终态/非进度：取消该 phase 未发出的 progress 节流
          const throttleKey = `${file.taskId}:${phase}`;
          const pending = phaseProgressPending.get(throttleKey);
          if (pending?.timer) clearTimeout(pending.timer);
          phaseProgressPending.delete(throttleKey);
        }

        applyPhasePatch(get, set, file.taskId, phase, patch, tokensDelta);
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

      setTaskLanguages: (fileId, languages) => {
        const file = get().getFile(fileId);
        if (!file) return;
        const sourceLanguage = languages.sourceLanguage.trim();
        const targetLanguage = languages.targetLanguage.trim();
        if (!sourceLanguage || !targetLanguage) return;
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.taskId === file.taskId
              ? { ...t, sourceLanguage, targetLanguage }
              : t
          ),
        }));
        void flushFilesStorePersist();
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
      // 主表不落大 entries，减轻启动 parse；entries 见 taskEntriesStorage
      partialize: (state) => ({
        selectedFileId: state.selectedFileId,
        tasks: state.tasks.map((t) => ({
          ...t,
          subtitle_entries: [],
        })),
      }),
      version: 4,
      // 不在 mount 时自动 rehydrate；由 bootstrap.rehydrateAppStores() 在 render 前完成
      skipHydration: true,
      migrate: (persistedState: unknown, version: number) => {
        // 注意：migrate 只在 version 变化时调用，不能依赖它做「每次刷新的中断恢复」
        if (persistedState && typeof persistedState === "object" && "tasks" in persistedState) {
          const state = persistedState as { tasks: SingleTask[]; selectedFileId: string | null };
          let tasks = state.tasks;
          if (version < 3) {
            tasks = tasks.map((t) => ({ ...t, selectedKeytermGroupId: null }));
          }
          if (version < 4) {
            // 旧版 entries 嵌在主表：异步拆到独立 key，内存本会话仍保留
            void forcePersistTaskEntriesFromTasks(tasks);
          }
          return { ...state, tasks };
        }
        return { tasks: [], selectedFileId: null };
      },
      /**
       * merge 在每一次 rehydrate 都会执行（与 version 无关）。
       * 在写入内存前把 active phase → failed，刷新后可重新处理，而不是卡死在「处理中」。
       * v4+：主表 entries 为空，点开任务时 ensureTaskEntriesLoaded。
       * 会话 lifecycle 清空：未打开任务不 hydrate，flush 不会写空壳覆盖 IDB。
       */
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<{
          tasks: SingleTask[];
          selectedFileId: string | null;
        }>;
        const raw = persisted.tasks ?? currentState.tasks ?? [];
        // 若 rehydrate 仍带嵌套 entries（旧数据未 migrate 完），先拆 key 再清空内存以统一懒加载
        const hasInline = raw.some((t) => (t.subtitle_entries?.length ?? 0) > 0);
        if (hasInline) {
          void forcePersistTaskEntriesFromTasks(raw);
        }
        clearEntriesLifecycle();
        const tasks = raw
          .map((t) => ({
            ...t,
            subtitle_entries: [] as SubtitleEntry[],
          }))
          .map(recoverInterruptedPhases);
        // entryCount===0 的任务空即权威，无需再 load
        for (const t of tasks) {
          if ((t.entryCount ?? 0) <= 0) {
            markEntriesHydrated(t.taskId, { dirty: false });
          }
        }
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

/**
 * 按稳定 fileId 定位任务（引用级订阅）。
 * find 返回任务引用，用 zustand 默认 Object.is 即可精准订阅：
 * 只有该任务被替换时才重渲染；其余任务 / 选中态变化都不触发。
 * 无需 useShallow —— 浅比较反而会把「结构相同的新对象」误判为未变化。
 */
const selectTaskByFileId = (fileId: string) => (state: FilesState) =>
  state.tasks.find((t) => generateStableFileId(t.taskId) === fileId) ?? null;

/** 选中任务选择器：selectedFileId 为空时返回 null */
const selectSelectedTask = (state: FilesState) => {
  const id = state.selectedFileId;
  if (!id) return null;
  return state.tasks.find((t) => generateStableFileId(t.taskId) === id) ?? null;
};

export const useFile = (fileId: string) => {
  const task = useFilesStore(selectTaskByFileId(fileId));
  // task 已完全由 fileId 决定：fileId 变化必然换 task 引用，故只依赖 task。
  return useMemo(() => (task ? convertTaskToMetadata(task) : undefined), [task]);
};

export const useSelectedFile = () => {
  const task = useFilesStore(selectSelectedTask);
  return useMemo(() => (task ? convertTaskToMetadata(task) : null), [task]);
};

/** DEV：agent-browser 读取选中文件 */
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __eggFilesStore?: typeof useFilesStore }).__eggFilesStore =
    useFilesStore;
}
