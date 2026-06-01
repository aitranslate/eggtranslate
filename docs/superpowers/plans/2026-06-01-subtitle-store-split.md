# subtitleStore.ts 拆分 - 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 1132 行单 store 拆为 3 个聚焦模块（filesStore + queueStore + 4 个 service），零行为变更，建立 Store/Service/Hook 三层职责。

**Architecture:** 数据 (Store) / 用例 (Service) / 视图 (Hook) 三层分离。Store 退化为纯数据 setter；业务编排（特别是 463 行 `startTranslation`）抽到 service；hooks 组合两者暴露给 UI。

**Tech Stack:** Zustand 5, TypeScript 5.6, React 18, Vitest

**预计工作量：** 1-2 周

**前置依赖：** 阶段 1、2 已完成；项目 28 个单测通过；build 绿色

---

## 文件清单

### 新建文件（6 个）
- `src/stores/filesStore.ts` - 数据 + setter + getter + helper hooks
- `src/stores/queueStore.ts` - 队列状态 + setter
- `src/services/filesService.ts` - 文件/条目业务
- `src/services/transcriptionService.ts` - 转录流水线
- `src/services/translationService.ts` - 翻译+拆分流水线
- `src/services/queueService.ts` - 队列管理

### 修改文件（9 个）
- `src/stores/index.ts` - 更新导出
- `src/components/BatchFileUpload.tsx`
- `src/components/FileUpload.tsx`
- `src/components/MainApp.tsx`
- `src/components/SubtitleEditor.tsx`
- `src/components/SubtitleFileList/index.tsx`
- `src/components/SubtitleFileList/components/StepperProgress.tsx`
- `src/components/TranslationControls.tsx`
- `src/services/SubtitleExporter.ts`
- `src/services/TranslationOrchestrator.ts`

### 新建测试（3 个）
- `src/services/__tests__/queueService.test.ts`
- `src/services/__tests__/filesService.test.ts`
- `src/services/__tests__/translationService.test.ts` (basic)

### 删除文件（1 个）
- `src/stores/subtitleStore.ts`

---

## 任务列表

### Task 1: 创建 filesStore

**Files:**
- Create: `D:\EggTranslate\src\stores\filesStore.ts`

**目的：** 拆分后持有任务数据的 store。提供原子 setter，无业务编排。

- [ ] **Step 1: 创建新文件**

文件内容：

```ts
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
import { useTranscriptionStore } from './transcriptionStore';
import { removeMp3Data, convertTaskToMetadata } from '@/services/SubtitleFileManager';
import { generateStableFileId } from '@/utils/taskIdGenerator';
import { toAppError } from '@/utils/errors';
import toast from 'react-hot-toast';
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
      version: 2,
      migrate: (persistedState: unknown, version: number) => {
        if (persistedState && typeof persistedState === 'object' && 'tasks' in persistedState) {
          return persistedState as { tasks: SingleTask[]; selectedFileId: string | null };
        }
        return { tasks: [], selectedFileId: null };
      },
      onRehydrateStorage: () => (state, error) => {
        if (error || !state) return;
        // 检测中断：active → failed
        let mutated = false;
        for (const task of state.tasks) {
          if (task.phases) {
            for (const phase of ['converting', 'transcribing', 'translating', 'splitting'] as const) {
              if (task.phases[phase]?.status === 'active') {
                task.phases[phase] = {
                  status: 'failed',
                  progress: task.phases[phase].progress || 0,
                  tokens: task.phases[phase].tokens || 0,
                } as PhaseProgress;
                mutated = true;
              }
            }
          }
        }
        if (mutated) {
          useFilesStore.setState({ tasks: [...state.tasks] });
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
```

- [ ] **Step 2: 验证**

```bash
cd /d/EggTranslate && pnpm run lint 2>&1 | grep filesStore | head -5
```

预期：无输出（新文件未在任何 lint 路径中失败）

```bash
cd /d/EggTranslate && pnpm run build 2>&1 | tail -3
```

预期：build 成功

- [ ] **Step 3: 提交**

```bash
git add src/stores/filesStore.ts
git commit -m "refactor(store): 创建 useFilesStore 持有任务数据和 phase 状态"
```

---

### Task 2: 创建 queueStore

**Files:**
- Create: `D:\EggTranslate\src\stores\queueStore.ts`

- [ ] **Step 1: 创建新文件**

```ts
/**
 * 队列状态 Store
 * 内存状态，不持久化。刷新页面后队列清空，需要用户重新触发。
 */

import { create } from 'zustand';

interface QueueState {
  taskQueue: string[];
  activeTaskId: string | null;

  setTaskQueue: (queue: string[]) => void;
  setActiveTaskId: (id: string | null) => void;
}

export const useQueueStore = create<QueueState>((set) => ({
  taskQueue: [],
  activeTaskId: null,

  setTaskQueue: (queue) => {
    set({ taskQueue: queue });
  },

  setActiveTaskId: (id) => {
    set({ activeTaskId: id });
  },
}));
```

- [ ] **Step 2: 验证**

```bash
cd /d/EggTranslate && pnpm run build 2>&1 | tail -3
```

预期：build 成功

- [ ] **Step 3: 提交**

```bash
git add src/stores/queueStore.ts
git commit -m "refactor(store): 创建 useQueueStore 持有队列运行时状态"
```

---

### Task 3: 更新 stores/index.ts 导出新模块

**Files:**
- Modify: `D:\EggTranslate\src\stores\index.ts`

- [ ] **Step 1: 读取当前内容**

预期：

```ts
export { useSubtitleStore, useFiles, useSelectedFile, useFile } from './subtitleStore';
// ... 等等
```

- [ ] **Step 2: 添加新导出（不删除旧导出）**

**Before：**
```ts
// ============================================
// SubtitleStore
// ============================================

export {
  useSubtitleStore,
  useFiles,
  useSelectedFile,
  useFile
} from './subtitleStore';
```

**After（添加新模块，保留旧）：**
```ts
// ============================================
// FilesStore (新)
// ============================================

export {
  useFilesStore,
  useFiles,
  useFile,
  useSelectedFile
} from './filesStore';

// ============================================
// QueueStore (新)
// ============================================

export { useQueueStore } from './queueStore';

// ============================================
// SubtitleStore (旧 - 拆分完成后将删除)
// ============================================

export {
  useSubtitleStore,
  useFiles as useFilesLegacy,
  useSelectedFile as useSelectedFileLegacy,
  useFile as useFileLegacy
} from './subtitleStore';
```

- [ ] **Step 3: 验证**

```bash
cd /d/EggTranslate && pnpm run build 2>&1 | tail -3
```

预期：build 成功（因为旧导出仍存在）

- [ ] **Step 4: 提交**

```bash
git add src/stores/index.ts
git commit -m "refactor(store): index.ts 添加 useFilesStore 和 useQueueStore 导出"
```

---

### Task 4: 创建 filesService

**Files:**
- Create: `D:\EggTranslate\src\services\filesService.ts`
- Create: `D:\EggTranslate\src\services\__tests__\filesService.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/services/__tests__/filesService.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useFilesStore } from '@/stores/filesStore';
import { addFile, removeFile, selectFile, clearAll } from '../filesService';
import { loadFromFile } from '@/services/SubtitleFileManager';
import { removeMp3Data } from '@/services/SubtitleFileManager';

vi.mock('@/services/SubtitleFileManager', async () => {
  const actual = await vi.importActual<typeof import('@/services/SubtitleFileManager')>(
    '@/services/SubtitleFileManager'
  );
  return {
    ...actual,
    loadFromFile: vi.fn(),
    removeMp3Data: vi.fn(),
  };
});

vi.mock('localforage', () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('filesService', () => {
  beforeEach(() => {
    useFilesStore.setState({ tasks: [], selectedFileId: null });
    vi.clearAllMocks();
  });

  it('addFile calls SubtitleFileManager and adds task', async () => {
    const mockTask = { taskId: 't1', subtitle_filename: 'test.srt', subtitle_entries: [] } as any;
    vi.mocked(loadFromFile).mockResolvedValue({
      metadata: { id: 'file-1', taskId: 't1', name: 'test.srt' } as any,
      task: mockTask,
    });

    const fakeFile = new File(['test'], 'test.srt', { type: 'text/plain' });
    const id = await addFile(fakeFile);

    expect(id).toBe('file-1');
    expect(useFilesStore.getState().tasks).toHaveLength(1);
    expect(useFilesStore.getState().tasks[0].taskId).toBe('t1');
  });

  it('removeFile cleans MP3 data and removes task', async () => {
    useFilesStore.setState({
      tasks: [{ taskId: 't1', subtitle_filename: 'a.srt', subtitle_entries: [] } as any],
    });

    const fakeFile = new File(['test'], 'a.srt', { type: 'text/plain' });
    await removeFile('file-1', fakeFile);

    expect(removeMp3Data).toHaveBeenCalledWith('t1');
    expect(useFilesStore.getState().tasks).toHaveLength(0);
  });

  it('selectFile updates selectedFileId', () => {
    selectFile('file-1');
    expect(useFilesStore.getState().selectedFileId).toBe('file-1');
  });

  it('clearAll empties tasks', () => {
    useFilesStore.setState({ tasks: [{ taskId: 't1' }] as any });
    clearAll();
    expect(useFilesStore.getState().tasks).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 写实现**

```ts
// src/services/filesService.ts
/**
 * 文件业务 Service
 * 封装文件 CRUD 的业务规则：
 * - 加载：解析文件 + 转换 + 加入队列
 * - 删除：清理 MP3 数据 + 停止相关任务
 * - 选中：记录用户当前选择
 */

import { useFilesStore } from '@/stores/filesStore';
import { useQueueStore } from '@/stores/queueStore';
import { useTranslationConfigStore } from '@/stores/translationConfigStore';
import { loadFromFile, removeMp3Data } from './SubtitleFileManager';
import { toAppError } from '@/utils/errors';
import toast from 'react-hot-toast';

export async function addFile(file: File): Promise<string> {
  try {
    const result = await loadFromFile(file, { existingFilesCount: useFilesStore.getState().tasks.length });
    const taskWithRef = { ...result.task, fileRef: file };
    useFilesStore.getState().addTask(taskWithRef);
    return result.metadata.id;
  } catch (error) {
    const appError = toAppError(error, '文件加载失败');
    console.error('[filesService]', appError.message, appError);
    toast.error(`文件加载失败: ${appError.message}`);
    throw error;
  }
}

export async function removeFile(fileId: string, file?: File): Promise<void> {
  const state = useFilesStore.getState();
  const file_ = state.getFile(fileId);
  if (!file_) return;

  // 从队列移除
  const queue = useQueueStore.getState();
  if (queue.taskQueue.includes(fileId)) {
    useQueueStore.getState().setTaskQueue(queue.taskQueue.filter((id) => id !== fileId));
  }

  // 停止相关翻译
  const translationStore = useTranslationConfigStore.getState();
  if (translationStore.isTranslating && translationStore.currentTaskId === file_.taskId) {
    translationStore.stopTranslation();
  }

  try {
    state.removeTask(file_.taskId);
    await removeMp3Data(file_.taskId);
    toast.success('文件已删除');
  } catch (error) {
    const appError = toAppError(error, '删除文件失败');
    console.error('[filesService]', appError.message, appError);
    toast.error('删除文件失败');
  }
}

export function selectFile(fileId: string | null): void {
  useFilesStore.getState().setSelectedFileId(fileId);
}

export async function clearAll(): Promise<void> {
  try {
    const tasks = useFilesStore.getState().tasks;
    useFilesStore.getState().clearAllTasks();
    useQueueStore.getState().setTaskQueue([]);
    useQueueStore.getState().setActiveTaskId(null);
    for (const task of tasks) {
      await removeMp3Data(task.taskId);
    }
    window.dispatchEvent(new CustomEvent('taskCleared'));
  } catch (error) {
    const appError = toAppError(error, '清空数据失败');
    console.error('[filesService]', appError.message, appError);
    toast.error('清空数据失败');
  }
}
```

- [ ] **Step 3: 运行测试**

```bash
cd /d/EggTranslate && pnpm test src/services/__tests__/filesService.test.ts
```

预期：4 个测试通过

- [ ] **Step 4: 验证**

```bash
cd /d/EggTranslate && pnpm run build 2>&1 | tail -3
```

预期：build 成功

- [ ] **Step 5: 提交**

```bash
git add src/services/filesService.ts src/services/__tests__/filesService.test.ts
git commit -m "refactor(service): 创建 filesService 封装文件 CRUD 业务规则"
```

---

### Task 5: 创建 transcriptionService

**Files:**
- Create: `D:\EggTranslate\src\services\transcriptionService.ts`

**目的：** 把 75 行的 `startTranscription` 从旧 store 抽到 service。

- [ ] **Step 1: 读取旧逻辑**

读取 `D:\EggTranslate\src\stores\subtitleStore.ts:384-526`（startTranscription 完整函数）

- [ ] **Step 2: 创建新文件**

```ts
// src/services/transcriptionService.ts
/**
 * 转录 Service
 * 编排音视频 → MP3 → AssemblyAI 转录 → 字幕条目
 */

import { useFilesStore } from '@/stores/filesStore';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { runTranscriptionPipeline } from './transcriptionPipeline';
import { convertToMP3 } from '@/utils/convertToMP3';
import { toAppError } from '@/utils/errors';
import toast from 'react-hot-toast';
import localforage from 'localforage';

export async function startTranscription(fileId: string): Promise<void> {
  const file = useFilesStore.getState().getFile(fileId);
  if (!file || file.fileType === 'srt') return;

  if (file.phases.transcribing.status === 'completed') {
    console.log('[transcriptionService] 转录已完成，跳过');
    return;
  }

  try {
    let mediaFile: File | undefined = file.fileRef;

    if (!mediaFile) {
      const savedMp3 = await localforage.getItem<Blob>(`mp3_data:${file.taskId}`);
      if (savedMp3) {
        mediaFile = new File([savedMp3], 'audio.mp3', { type: 'audio/mpeg' });
        console.log('[transcriptionService] 从 IndexedDB 恢复 MP3 用于转录');
      }
    }

    if (!mediaFile) {
      toast.error('文件引用丢失，请重新上传');
      return;
    }

    const { apiKeys } = useTranscriptionStore.getState();
    if (!apiKeys.trim()) {
      toast.error('请先在设置中配置 AssemblyAI API Key');
      return;
    }

    const { keytermGroups, keytermsEnabled } = useTranscriptionStore.getState();
    const allKeyterms = keytermsEnabled ? keytermGroups.flatMap((g) => g.keyterms) : [];

    useFilesStore.getState().setWorkflow(fileId, 'transcribe');

    let mp3Blob: Blob;

    if (file.phases.converting.status === 'completed') {
      console.log('[transcriptionService] 转码已完成，使用已保存的 MP3');
      mp3Blob = await localforage.getItem<Blob>(`mp3_data:${file.taskId}`);
      if (!mp3Blob) {
        toast.error('MP3 数据丢失，请重新上传');
        return;
      }
    } else {
      useFilesStore.getState().updatePhase(fileId, 'converting', { status: 'active', progress: -1, tokens: 0 });
      try {
        mp3Blob = await convertToMP3(mediaFile);
      } catch (error) {
        const appError = toAppError(error, '音频转码失败');
        console.error('[transcriptionService]', appError.message, appError);
        toast.error(`转码失败: ${appError.message}`);
        useFilesStore.getState().updatePhase(fileId, 'converting', { status: 'failed', progress: 0 });
        return;
      }
      await localforage.setItem(`mp3_data:${file.taskId}`, mp3Blob);
    }

    const mp3File = new File([mp3Blob], 'audio.mp3', { type: 'audio/mpeg' });

    const result = await runTranscriptionPipeline(
      mp3File,
      allKeyterms,
      {
        onConverting: () => {
          const phases = useFilesStore.getState().getFile(fileId)?.phases;
          if (phases?.converting.status !== 'completed') {
            useFilesStore.getState().updatePhase(fileId, 'converting', { status: 'active', progress: -1 });
          }
        },
        onUploading: () => {
          const phases = useFilesStore.getState().getFile(fileId)?.phases;
          if (phases?.converting.status !== 'completed') {
            useFilesStore.getState().updatePhase(fileId, 'converting', { status: 'active', progress: -1 });
          }
        },
        onTranscribing: () => {
          const phases = useFilesStore.getState().getFile(fileId)?.phases;
          if (phases?.converting.status !== 'completed') {
            useFilesStore.getState().updatePhase(fileId, 'converting', { status: 'completed', progress: 100 });
          }
          useFilesStore.getState().updatePhase(fileId, 'transcribing', { status: 'active', progress: -1, tokens: 0 });
        },
        onProgress: (percent) => {
          useFilesStore.getState().updatePhase(fileId, 'transcribing', { progress: percent });
        },
        onCompleted: () => {},
        onError: () => {
          const phases = useFilesStore.getState().getFile(fileId)?.phases;
          if (phases?.converting.status === 'active') {
            useFilesStore.getState().updatePhase(fileId, 'converting', { status: 'failed', progress: 0 });
          }
          if (phases?.transcribing.status === 'active') {
            useFilesStore.getState().updatePhase(fileId, 'transcribing', { status: 'failed', progress: 0 });
          }
        }
      }
    );

    // 写入结果
    useFilesStore.setState((state) => ({
      tasks: state.tasks.map((t) =>
        t.taskId === file.taskId
          ? {
              ...t,
              subtitle_entries: result.entries,
              phases: {
                ...t.phases,
                converting: { status: 'completed', progress: 100, tokens: 0 },
                transcribing: {
                  status: 'completed',
                  progress: 100,
                  tokens: 0,
                  language: result.language,
                  entryCount: result.entries.length,
                  totalEntries: result.entries.length,
                },
              },
            }
          : t
      ),
    }));

    toast.success(`转录完成！生成 ${result.entries.length} 条字幕`);
  } catch (error) {
    const appError = toAppError(error, '转录失败');
    console.error('[transcriptionService]', appError.message, appError);
    toast.error(`转录失败: ${appError.message}`);

    const phases = useFilesStore.getState().getFile(fileId)?.phases;
    if (phases?.converting.status === 'active') {
      useFilesStore.getState().updatePhase(fileId, 'converting', { status: 'failed', progress: 0 });
    }
    if (phases?.transcribing.status === 'active') {
      useFilesStore.getState().updatePhase(fileId, 'transcribing', { status: 'failed', progress: 0 });
    }
  }
}
```

- [ ] **Step 3: 验证**

```bash
cd /d/EggTranslate && pnpm run build 2>&1 | tail -3
```

预期：build 成功

- [ ] **Step 4: 提交**

```bash
git add src/services/transcriptionService.ts
git commit -m "refactor(service): 创建 transcriptionService 封装转录流水线"
```

---

### Task 6: 创建 translationService

**Files:**
- Create: `D:\EggTranslate\src\services\translationService.ts`
- Create: `D:\EggTranslate\src\services\__tests__\translationService.test.ts`

**目的：** 把 463 行的 `startTranslation` 抽到 service。

- [ ] **Step 1: 读取旧逻辑**

读取 `D:\EggTranslate\src\stores\subtitleStore.ts:565-1037`（startTranslation 完整函数，463 行）

- [ ] **Step 2: 写基础测试（只测 skip 逻辑）**

```ts
// src/services/__tests__/translationService.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useFilesStore } from '@/stores/filesStore';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { useTranslationConfigStore } from '@/stores/translationConfigStore';
import { startTranslation } from '../translationService';

vi.mock('localforage', () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('translationService', () => {
  beforeEach(() => {
    useFilesStore.setState({ tasks: [] });
    useTranslationConfigStore.setState({
      isConfigured: false,
      isTranslating: false,
      config: {
        baseURL: '',
        apiKey: '',
        model: '',
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        batchSize: 20,
        contextBefore: 5,
        contextAfter: 3,
        threadCount: 4,
      },
    });
  });

  it('returns null when file not found', async () => {
    const result = await startTranslation('non-existent');
    expect(result).toBeNull();
  });

  it('returns null when translation not configured', async () => {
    useFilesStore.setState({
      tasks: [{
        taskId: 't1',
        subtitle_filename: 'test.srt',
        subtitle_entries: [],
        phases: {
          workflow: 'translate',
          converting: { status: 'upcoming', progress: 0, tokens: 0 },
          transcribing: { status: 'upcoming', progress: 0, tokens: 0 },
          translating: { status: 'upcoming', progress: 0, tokens: 0 },
          splitting: { status: 'upcoming', progress: 0, tokens: 0 },
        },
      }] as any,
    });

    const result = await startTranslation('file-1');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: 写实现（1:1 移动 463 行逻辑）**

把原 `subtitleStore.ts:565-1037` 完整复制为 `translationService.ts` 的 `startTranslation` 函数，**但把所有 `get().` 调用替换为 `useFilesStore.getState().`**

具体替换模式：
- `get().updateEntry(fileId, ...)` → `useFilesStore.getState().updateEntry(fileId, ...)`
- `get().updatePhase(fileId, ...)` → `useFilesStore.getState().updatePhase(fileId, ...)`
- `get().setWorkflow(fileId, ...)` → `useFilesStore.getState().setWorkflow(fileId, ...)`
- `get().tasks` → `useFilesStore.getState().tasks`
- `get().getFile(fileId)` → `useFilesStore.getState().getFile(fileId)`

```ts
// src/services/translationService.ts
/**
 * 翻译 Service
 * 编排翻译 + 断句对齐流水线（463 行核心逻辑）
 */

import { useFilesStore } from '@/stores/filesStore';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { useTranslationConfigStore } from '@/stores/translationConfigStore';
import { executeTranslation, saveTranslationHistory } from './TranslationOrchestrator';
import { useHistoryStore } from '@/stores/historyStore';
import { SubtitleEntry, FilePhases } from '@/types';
import { formatTime, parseTime } from '@/utils/timeUtils';
import { countUnits } from '@/utils/textUnitCounter';
import { getSourceLimit, getTargetLimit } from '@/utils/subtitleLengthPresets';
import { mapSourcePartsToBoundaries, boundariesToRanges } from '@/utils/sourceSplitBoundaries';
import { toAppError } from '@/utils/errors';
import toast from 'react-hot-toast';

export async function startTranslation(
  fileId: string
): Promise<{ tokens: number; entries: SubtitleEntry[]; phases: FilePhases } | null> {
  const file = useFilesStore.getState().getFile(fileId);
  if (!file) return null;

  if (file.phases.translating.status === 'completed' && file.phases.splitting.status === 'completed') {
    console.log('[translationService] 翻译和断句对齐都已完成，跳过');
    return null;
  }

  const translationConfigStore = useTranslationConfigStore.getState();
  const config = translationConfigStore.config;
  if (!translationConfigStore.isConfigured) {
    toast.error('请先配置翻译 API');
    return null;
  }

  try {
    const controller = await translationConfigStore.startTranslation(file.taskId);

    const task = useFilesStore.getState().tasks.find((t) => t.taskId === file.taskId);
    const entries = task?.subtitle_entries || [];

    const restoredProgress = file.phases.translating.progress > 0 ? file.phases.translating.progress : 0;
    const restoredTokens = file.phases.translating.tokens || 0;

    if (file.phases.translating.status !== 'completed') {
      useFilesStore.getState().updatePhase(fileId, 'translating', {
        status: 'active',
        progress: restoredProgress,
        tokens: restoredTokens,
      });
    }
    if (file.phases.splitting.status !== 'completed') {
      useFilesStore.getState().updatePhase(fileId, 'splitting', { status: 'upcoming', progress: 0, tokens: 0 });
    }

    // 接下来的 400+ 行从旧 startTranslation 1:1 复制
    // 包括：executeTranslation 调用、复合条目迁移、原子 split+align 循环
    // 所有 get().X 替换为 useFilesStore.getState().X
    // 完整代码在执行时从 subtitleStore.ts:601-1037 复制粘贴

    // ... (省略中间 ~400 行，与原代码 1:1 一致)

    // 完成后：
    const finalTokens = useFilesStore.getState().getFile(fileId)?.tokensUsed || 0;
    const finalTask = useFilesStore.getState().tasks.find((t) => t.taskId === file.taskId);
    const lastEntries = finalTask?.subtitle_entries || entries;
    const finalPhases = useFilesStore.getState().getFile(fileId)?.phases;
    console.log(`[translationService] 任务完成，总消耗 ${finalTokens} tokens`);
    return { tokens: finalTokens, entries: lastEntries, phases: finalPhases! };
  } catch (error) {
    const appError = toAppError(error, '翻译失败');
    console.error('[translationService]', appError.message, appError);
    toast.error(`翻译失败: ${appError.message}`);

    const phases = useFilesStore.getState().getFile(fileId)?.phases;
    if (phases?.translating.status === 'active') {
      useFilesStore.getState().updatePhase(fileId, 'translating', {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
    if (phases?.splitting.status === 'active') {
      useFilesStore.getState().updatePhase(fileId, 'splitting', {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    useTranslationConfigStore.getState().stopTranslation();
  }
  return null;
}
```

> **重要：** 中间省略的 ~400 行代码需要执行时**完整复制**自 `subtitleStore.ts:601-1037`。请勿省略任何逻辑。

- [ ] **Step 4: 运行测试**

```bash
cd /d/EggTranslate && pnpm test src/services/__tests__/translationService.test.ts
```

预期：2 个测试通过

- [ ] **Step 5: 验证 build**

```bash
cd /d/EggTranslate && pnpm run build 2>&1 | tail -3
```

预期：build 成功

- [ ] **Step 6: 提交**

```bash
git add src/services/translationService.ts src/services/__tests__/translationService.test.ts
git commit -m "refactor(service): 创建 translationService 封装 463 行翻译+断句编排"
```

---

### Task 7: 创建 queueService（含 processNext）

**Files:**
- Create: `D:\EggTranslate\src\services\queueService.ts`
- Create: `D:\EggTranslate\src\services\__tests__\queueService.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/services/__tests__/queueService.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFilesStore } from '@/stores/filesStore';
import { useQueueStore } from '@/stores/queueStore';
import { enqueueTask, dequeueTask, enqueueAllUncompleted, processNext } from '../queueService';

vi.mock('../transcriptionService', () => ({
  startTranscription: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../translationService', () => ({
  startTranslation: vi.fn().mockResolvedValue({ tokens: 0, entries: [], phases: {} as any }),
}));

const makeFile = (id: string, taskId: string, translated: boolean = false) => ({
  id,
  taskId,
  name: `${id}.srt`,
  fileType: 'srt' as const,
  fileSize: 100,
  lastModified: 0,
  entryCount: 10,
  translatedCount: translated ? 10 : 0,
  tokensUsed: 0,
  entriesVersion: 0,
  phases: {
    workflow: 'translate' as const,
    converting: { status: 'completed', progress: 100, tokens: 0 },
    transcribing: { status: 'completed', progress: 100, tokens: 0 },
    translating: translated
      ? { status: 'completed', progress: 100, tokens: 0 }
      : { status: 'upcoming', progress: 0, tokens: 0 },
    splitting: translated
      ? { status: 'completed', progress: 100, tokens: 0 }
      : { status: 'upcoming', progress: 0, tokens: 0 },
  },
});

describe('queueService', () => {
  beforeEach(() => {
    useFilesStore.setState({ tasks: [] });
    useQueueStore.setState({ taskQueue: [], activeTaskId: null });
    vi.clearAllMocks();
  });

  it('enqueueTask adds fileId to queue', () => {
    useFilesStore.setState({ tasks: [makeFile('f1', 't1')] as any });
    enqueueTask('f1');
    expect(useQueueStore.getState().taskQueue).toEqual(['f1']);
  });

  it('enqueueTask skips already queued or active', () => {
    useFilesStore.setState({ tasks: [makeFile('f1', 't1')] as any });
    enqueueTask('f1');
    enqueueTask('f1');
    expect(useQueueStore.getState().taskQueue).toEqual(['f1']);
  });

  it('enqueueTask skips completed tasks', () => {
    useFilesStore.setState({ tasks: [makeFile('f1', 't1', true)] as any });
    enqueueTask('f1');
    expect(useQueueStore.getState().taskQueue).toEqual([]);
  });

  it('dequeueTask removes from queue', () => {
    useFilesStore.setState({ tasks: [makeFile('f1', 't1')] as any });
    enqueueTask('f1');
    dequeueTask('f1');
    expect(useQueueStore.getState().taskQueue).toEqual([]);
  });

  it('enqueueAllUncompleted adds all incomplete files', () => {
    useFilesStore.setState({ tasks: [
      makeFile('f1', 't1', false),
      makeFile('f2', 't2', true),
      makeFile('f3', 't3', false),
    ] as any });
    enqueueAllUncompleted();
    expect(useQueueStore.getState().taskQueue).toEqual(['f1', 'f3']);
  });

  it('processNext calls translationService for SRT file', async () => {
    const { startTranslation } = await import('../translationService');
    useFilesStore.setState({ tasks: [makeFile('f1', 't1')] as any });
    useQueueStore.setState({ taskQueue: ['f1'], activeTaskId: null });

    await processNext();

    expect(startTranslation).toHaveBeenCalledWith('f1');
  });

  it('processNext sets activeTaskId to null after completion', async () => {
    useFilesStore.setState({ tasks: [makeFile('f1', 't1')] as any });
    useQueueStore.setState({ taskQueue: ['f1'], activeTaskId: null });

    await processNext();

    expect(useQueueStore.getState().activeTaskId).toBeNull();
  });
});
```

- [ ] **Step 2: 写实现**

```ts
// src/services/queueService.ts
/**
 * 队列 Service
 * 管理任务队列和 processNext 调度逻辑
 */

import { useFilesStore } from '@/stores/filesStore';
import { useQueueStore } from '@/stores/queueStore';
import { startTranscription } from './transcriptionService';
import { startTranslation } from './translationService';

function isTaskCompleted(file: { phases: { translating: { status: string }, splitting: { status: string }, transcribing: { status: string } }, fileType?: string }): boolean {
  const isSrt = file.fileType === 'srt' || !file.fileType;
  return (
    file.phases.translating.status === 'completed' &&
    file.phases.splitting.status !== 'failed' &&
    (isSrt || file.phases.transcribing.status === 'completed')
  );
}

export function enqueueTask(fileId: string): void {
  const queue = useQueueStore.getState();
  if (queue.taskQueue.includes(fileId) || queue.activeTaskId === fileId) return;
  const file = useFilesStore.getState().getFile(fileId);
  if (!file) return;
  if (isTaskCompleted(file as any)) return;

  useQueueStore.getState().setTaskQueue([...queue.taskQueue, fileId]);
  if (useQueueStore.getState().activeTaskId === null) {
    processNext().catch((err) => console.error('[queueService] processNext failed:', err));
  }
}

export function dequeueTask(fileId: string): void {
  const queue = useQueueStore.getState();
  useQueueStore.getState().setTaskQueue(queue.taskQueue.filter((id) => id !== fileId));

  if (queue.activeTaskId === fileId) {
    // 停止正在进行的翻译（如果有）
    useQueueStore.getState().setActiveTaskId(null);
    processNext().catch((err) => console.error('[queueService] processNext failed:', err));
  }
}

export function enqueueAllUncompleted(): void {
  const files = useFilesStore.getState().getAllFiles();
  for (const file of files) {
    if (!isTaskCompleted(file as any)) {
      enqueueTask(file.id);
    }
  }
}

export async function processNext(): Promise<void> {
  const queue = useQueueStore.getState();
  if (queue.taskQueue.length === 0) {
    useQueueStore.getState().setActiveTaskId(null);
    return;
  }

  const fileId = queue.taskQueue[0];
  useQueueStore.getState().setTaskQueue(queue.taskQueue.slice(1));
  useQueueStore.getState().setActiveTaskId(fileId);

  const file = useFilesStore.getState().getFile(fileId);
  if (!file) {
    processNext().catch((err) => console.error('[queueService] processNext failed:', err));
    return;
  }

  try {
    const isAudioVideo = file.fileType === 'audio' || file.fileType === 'video';
    const needsTranscription = isAudioVideo && file.phases.transcribing.status !== 'completed';

    if (needsTranscription) {
      useFilesStore.getState().setWorkflow(fileId, 'full');
      await startTranscription(fileId);

      const afterTranscribe = useFilesStore.getState().getFile(fileId);
      if (!afterTranscribe || afterTranscribe.phases.transcribing.status !== 'completed') {
        return;
      }
    }

    if (file.fileType === 'srt') {
      useFilesStore.getState().setWorkflow(fileId, 'translate');
    }
    const result = await startTranslation(fileId);
    if (result) {
      const { saveTranslationHistory } = await import('./TranslationOrchestrator');
      await saveTranslationHistory(
        file.taskId,
        file.name,
        result.tokens,
        useHistoryStore.getState().addHistory
      );
    }
  } catch (error) {
    console.error('[queueService] processNext task failed:', error);
  } finally {
    if (useQueueStore.getState().activeTaskId === fileId) {
      useQueueStore.getState().setActiveTaskId(null);
      processNext().catch((err) => console.error('[queueService] processNext failed:', err));
    }
  }
}
```

- [ ] **Step 3: 添加 import（顶部）**

```ts
import { useHistoryStore } from '@/stores/historyStore';
```

- [ ] **Step 4: 运行测试**

```bash
cd /d/EggTranslate && pnpm test src/services/__tests__/queueService.test.ts
```

预期：7 个测试通过

- [ ] **Step 5: 验证 build**

```bash
cd /d/EggTranslate && pnpm run build 2>&1 | tail -3
```

预期：build 成功

- [ ] **Step 6: 提交**

```bash
git add src/services/queueService.ts src/services/__tests__/queueService.test.ts
git commit -m "refactor(service): 创建 queueService 封装队列调度和 processNext"
```

---

### Task 8: 更新 stores/index.ts 导出新 service

**Files:**
- Modify: `D:\EggTranslate\src\stores\index.ts`

- [ ] **Step 1: 添加 service 导出**

**Before：**
```ts
// ============================================
// FilesStore (新)
// ============================================

export {
  useFilesStore,
  useFiles,
  useFile,
  useSelectedFile
} from './filesStore';
```

**After（在 FilesStore 之后添加 services 块）：**
```ts
// ============================================
// FilesStore
// ============================================

export {
  useFilesStore,
  useFiles,
  useFile,
  useSelectedFile
} from './filesStore';

// ============================================
// QueueStore
// ============================================

export { useQueueStore } from './queueStore';

// ============================================
// Services
// ============================================

export { addFile, removeFile, selectFile, clearAll } from '@/services/filesService';
export { startTranscription } from '@/services/transcriptionService';
export { startTranslation } from '@/services/translationService';
export { enqueueTask, dequeueTask, enqueueAllUncompleted, processNext } from '@/services/queueService';
```

- [ ] **Step 2: 验证**

```bash
cd /d/EggTranslate && pnpm run build 2>&1 | tail -3
```

预期：build 成功

- [ ] **Step 3: 提交**

```bash
git add src/stores/index.ts
git commit -m "refactor(stores): index.ts 导出新 services"
```

---

### Task 9: 更新 BatchFileUpload 和 FileUpload

**Files:**
- Modify: `D:\EggTranslate\src\components\BatchFileUpload.tsx`
- Modify: `D:\EggTranslate\src\components\FileUpload.tsx`

- [ ] **Step 1: 更新 BatchFileUpload.tsx**

**Before（L1-15）：**
```ts
import { useSubtitleStore } from '@/stores/subtitleStore';
...
const addFile = useSubtitleStore((state) => state.addFile);
```

**After：**
```ts
import { addFile as addFileService } from '@/services/filesService';
import { useErrorHandler } from '@/hooks/useErrorHandler';
...
const { handleError } = useErrorHandler();

const handleFile = useCallback(async (file: File) => {
  ...
  try {
    setIsUploading(true);
    await addFileService(file);
    toast.success(`成功加载 ${file.name}`);
  } catch (err) {
    handleError(err, { context: { operation: '加载文件', fileName: file.name } });
  } finally {
    setIsUploading(false);
  }
}, [handleError]);
```

- [ ] **Step 2: 更新 FileUpload.tsx**

类似的修改（这个文件结构简单）

- [ ] **Step 3: 验证**

```bash
cd /d/EggTranslate && pnpm run lint 2>&1 | grep -E "BatchFileUpload|FileUpload" | head -5
cd /d/EggTranslate && pnpm run build 2>&1 | tail -3
```

预期：lint 无新错误，build 成功

- [ ] **Step 4: 提交**

```bash
git add src/components/BatchFileUpload.tsx src/components/FileUpload.tsx
git commit -m "refactor(components): BatchFileUpload/FileUpload 改用 filesService.addFile"
```

---

### Task 10: 更新 SubtitleFileList/index.tsx

**Files:**
- Modify: `D:\EggTranslate\src\components\SubtitleFileList\index.tsx`

- [ ] **Step 1: 读取当前文件**

- [ ] **Step 2: 替换 import**

**Before（L1-30）：**
```ts
import { useSubtitleStore, useFiles, useQueueState } from '@/stores/subtitleStore';
...
const removeFile = useSubtitleStore((state) => state.removeFile);
const clearAllData = useSubtitleStore((state) => state.clearAll);
const { taskQueue, activeTaskId } = useQueueState();
const enqueueTask = useSubtitleStore((state) => state.enqueueTask);
const dequeueTask = useSubtitleStore((state) => state.dequeueTask);
const enqueueAllUncompleted = useSubtitleStore((state) => state.enqueueAllUncompleted);
```

**After：**
```ts
import { useFiles, useFilesStore } from '@/stores/filesStore';
import { useQueueStore } from '@/stores/queueStore';
import { removeFile, clearAll } from '@/services/filesService';
import { enqueueTask, dequeueTask, enqueueAllUncompleted } from '@/services/queueService';
...
const removeFileAction = useFilesStore((state) => state.removeTask);
const clearAllAction = useFilesStore((state) => state.clearAllTasks);
const taskQueue = useQueueStore((state) => state.taskQueue);
const activeTaskId = useQueueStore((state) => state.activeTaskId);
```

- [ ] **Step 3: 更新函数调用**

在 handler 中：
- `removeFile(file.id)` → `removeFile(file.id, file.fileRef)` (service 函数)
- `clearAllData()` → `clearAll()` (service 函数)
- `enqueueTask(file.id)` → `enqueueTask(file.id)` (从 service 来的)
- 等等

- [ ] **Step 4: 验证**

```bash
cd /d/EggTranslate && pnpm run lint 2>&1 | grep "SubtitleFileList/index" | head -5
cd /d/EggTranslate && pnpm run build 2>&1 | tail -3
```

预期：lint 无新错误，build 成功

- [ ] **Step 5: 提交**

```bash
git add src/components/SubtitleFileList/index.tsx
git commit -m "refactor(components): SubtitleFileList 改用新 stores + services"
```

---

### Task 11: 更新 SubtitleFileItem 和 StepperProgress

**Files:**
- Modify: `D:\EggTranslate\src\components\SubtitleFileList\components\SubtitleFileItem.tsx`
- Modify: `D:\EggTranslate\src\components\SubtitleFileList\components\StepperProgress.tsx`

- [ ] **Step 1: 更新 SubtitleFileItem.tsx**

**Before：**
```ts
import { useTranscriptionStore } from '@/stores/transcriptionStore';
```

（这个组件可能不直接用 subtitleStore —— 确认后改）

- [ ] **Step 2: 更新 StepperProgress.tsx**

**Before：**
```ts
import { useSubtitleStore, useFile } from '@/stores/subtitleStore';
...
const file = useFile(fileId);
```

**After：**
```ts
import { useFile } from '@/stores/filesStore';
...
const file = useFile(fileId);
```

- [ ] **Step 3: 验证**

```bash
cd /d/EggTranslate && pnpm run lint 2>&1 | grep -E "SubtitleFileItem|StepperProgress" | head -5
cd /d/EggTranslate && pnpm run build 2>&1 | tail -3
```

预期：build 成功

- [ ] **Step 4: 提交**

```bash
git add src/components/SubtitleFileList/components/SubtitleFileItem.tsx src/components/SubtitleFileList/components/StepperProgress.tsx
git commit -m "refactor(components): SubtitleFileItem/StepperProgress 改用 useFile hook"
```

---

### Task 12: 更新 SubtitleEditor 和 TranslationControls

**Files:**
- Modify: `D:\EggTranslate\src\components\SubtitleEditor.tsx`
- Modify: `D:\EggTranslate\src\components\TranslationControls.tsx`

- [ ] **Step 1: 更新 SubtitleEditor.tsx**

**Before：**
```ts
import { useSubtitleStore, useFile } from '@/stores/subtitleStore';
...
const updateEntry = useSubtitleStore((state) => state.updateEntry);
const deleteEntry = useSubtitleStore((state) => state.deleteEntry);
const fileEntries = useSubtitleStore((state) => {...});
```

**After：**
```ts
import { useFilesStore, useFile } from '@/stores/filesStore';
...
const updateEntry = useFilesStore((state) => state.updateEntry);
const deleteEntry = useFilesStore((state) => state.deleteEntry);
const fileEntries = useFilesStore((state) => {
  if (!taskId) return EMPTY_ENTRIES;
  const task = state.tasks.find((t) => t.taskId === taskId);
  return task?.subtitle_entries ?? EMPTY_ENTRIES;
});
```

- [ ] **Step 2: 更新 TranslationControls.tsx**

**Before：**
```ts
import { useTranslationConfigStore, useSubtitleStore } from '@/stores';
...
const { updateEntry: updateEntryInStore } = useSubtitleStore();
```

**After：**
```ts
import { useTranslationConfigStore, useFilesStore } from '@/stores';
...
const updateEntryInStore = useFilesStore((state) => state.updateEntry);
```

- [ ] **Step 3: 验证**

```bash
cd /d/EggTranslate && pnpm run lint 2>&1 | grep -E "SubtitleEditor|TranslationControls" | head -5
cd /d/EggTranslate && pnpm run build 2>&1 | tail -3
```

预期：build 成功

- [ ] **Step 4: 提交**

```bash
git add src/components/SubtitleEditor.tsx src/components/TranslationControls.tsx
git commit -m "refactor(components): SubtitleEditor/TranslationControls 改用 useFilesStore"
```

---

### Task 13: 更新 MainApp 和 services (SubtitleExporter, TranslationOrchestrator)

**Files:**
- Modify: `D:\EggTranslate\src\components\MainApp.tsx`
- Modify: `D:\EggTranslate\src\services\SubtitleExporter.ts`
- Modify: `D:\EggTranslate\src\services\TranslationOrchestrator.ts`

- [ ] **Step 1: 更新 MainApp.tsx**

**Before：**
```ts
import { useFiles } from '@/stores/subtitleStore';
```

**After：**
```ts
import { useFiles } from '@/stores/filesStore';
```

- [ ] **Step 2: 更新 SubtitleExporter.ts**

**Before：**
```ts
import { useSubtitleStore } from '@/stores/subtitleStore';
...
const task = useSubtitleStore.getState().tasks.find(t => t.taskId === taskId);
```

**After：**
```ts
import { useFilesStore } from '@/stores/filesStore';
...
const task = useFilesStore.getState().tasks.find((t) => t.taskId === taskId);
```

- [ ] **Step 3: 更新 TranslationOrchestrator.ts**

类似替换 `useSubtitleStore` → `useFilesStore`

- [ ] **Step 4: 验证**

```bash
cd /d/EggTranslate && pnpm run lint 2>&1 | grep -E "MainApp|SubtitleExporter|TranslationOrchestrator" | head -5
cd /d/EggTranslate && pnpm run build 2>&1 | tail -3
```

预期：build 成功

- [ ] **Step 5: 提交**

```bash
git add src/components/MainApp.tsx src/services/SubtitleExporter.ts src/services/TranslationOrchestrator.ts
git commit -m "refactor: MainApp/SubtitleExporter/TranslationOrchestrator 改用 useFilesStore"
```

---

### Task 14: 删除旧 subtitleStore.ts 和相关 legacy 导出

**Files:**
- Delete: `D:\EggTranslate\src\stores\subtitleStore.ts`
- Modify: `D:\EggTranslate\src\stores\index.ts`

- [ ] **Step 1: 验证无残留引用**

```bash
grep -rn "useSubtitleStore\|from.*subtitleStore" /d/EggTranslate/src --include="*.ts" --include="*.tsx"
```

预期：无输出

- [ ] **Step 2: 删除文件**

```bash
git rm /d/EggTranslate/src/stores/subtitleStore.ts
```

- [ ] **Step 3: 清理 stores/index.ts**

删除 `SubtitleStore (旧)` 块（包括 `useSubtitleStore` 和 `useFiles as useFilesLegacy` 等所有 legacy 导出）。

- [ ] **Step 4: 验证**

```bash
cd /d/EggTranslate && pnpm run lint 2>&1 | tail -5
cd /d/EggTranslate && pnpm run build 2>&1 | tail -3
cd /d/EggTranslate && pnpm test
```

预期：所有测试通过，build 成功，0 lint 错误

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "refactor: 删除旧 useSubtitleStore，subtitleStore.ts 拆分完成"
```

---

### Task 15: 最终验证

**Files:** None

- [ ] **Step 1: 完整 lint**

```bash
cd /d/EggTranslate && pnpm run lint 2>&1 | tail -5
```

预期：0 errors

- [ ] **Step 2: 完整 build**

```bash
cd /d/EggTranslate && pnpm run build 2>&1 | tail -10
```

预期：build 成功，vendor chunks 生成

- [ ] **Step 3: 完整测试**

```bash
cd /d/EggTranslate && pnpm test
```

预期：所有测试通过（28 + 4 + 2 + 7 = 41 个）

- [ ] **Step 4: 检查文件结构**

```bash
ls /d/EggTranslate/src/stores/
ls /d/EggTranslate/src/services/ | grep -E "filesService|transcriptionService|translationService|queueService"
```

预期：subtitleStore.ts 不在 stores 目录；4 个新 service 存在

- [ ] **Step 5: 手动验证清单（开发者执行）**

- [ ] 上传 SRT 文件
- [ ] 上传音频文件，转录完成
- [ ] 点"开始翻译"，翻译完成
- [ ] 编辑字幕，保存
- [ ] 导出 ZIP
- [ ] 删除文件
- [ ] 队列化多文件
- [ ] 关闭浏览器重开，数据恢复

- [ ] **Step 6: 总结**

阶段 3 全部完成。预期 15+ 个 commits，删除 1 个文件，新建 6 个，新增 13 个测试。

---

## 验证清单（执行后对照）

- [ ] `src/stores/subtitleStore.ts` 不存在
- [ ] `src/stores/filesStore.ts` 和 `queueStore.ts` 存在
- [ ] 4 个 service 文件存在
- [ ] 41 个测试通过（28 旧 + 13 新）
- [ ] lint 0 errors
- [ ] build 成功
- [ ] 手动验证清单全部通过

---

## 风险与回滚

每步独立 commit。如需回滚：

```bash
# 查看最近提交
git log --oneline -20

# 回滚单个 commit
git revert <commit-hash>

# 或回滚到阶段 3 之前
git reset --hard <阶段3开始前的commit>
```

---

## 预计收益

- **可读性：** 1132 行 → 6 个 < 500 行文件
- **可测性：** queueService 和 filesService 独立可测
- **可演进性：** 加新阶段只需加一个 service
- **关注点分离：** Store/Service/Hook 三层清晰
