# 剩余最佳实践清理 - 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把项目最佳实践评分从 3.4 推到 4.0+，清零审计报告剩余 7 个改进点
**Architecture:** 外科手术式重构，不引入新依赖（除 `@tanstack/react-virtual`），不动数据流方向
**Tech Stack:** React 18 + TypeScript + Zustand + Vite + Vitest + @tanstack/react-virtual

**前置规范：** [2026-06-01-remaining-best-practices-cleanup.md](../specs/2026-06-01-remaining-best-practices-cleanup.md)
**前置审计：** [2026-06-01-project-best-practices-audit.md](../specs/2026-06-01-project-best-practices-audit.md)

**用户指令：** 全包干；不在代码级评审上打扰用户

---

## 文件结构

### 改动文件
- `src/services/queueService.ts` — processNext 拆 3 函数
- `src/stores/filesStore.ts` — onRehydrateStorage 纯函数化 + H2 数据迁移
- `src/types/index.ts` — SingleTask 加 entryCount/translatedCount
- `src/services/SubtitleFileManager.ts` — convertTaskToMetadata 简化（不再 filter）
- `src/components/SubtitleEditor.tsx` — 虚拟列表 + 搜索 debounce
- `package.json` — 加 @tanstack/react-virtual 依赖

### 新建文件
- `src/utils/logger.ts` — 统一日志入口
- `src/hooks/useDebouncedValue.ts` — 通用 debounce hook
- `src/services/__tests__/queueService.test.ts` — processNext 单元测试
- `src/utils/__tests__/logger.test.ts` — logger 单元测试
- `src/utils/__tests__/srtParser.test.ts` — srtParser 单元测试
- `src/services/__tests__/SubtitleFileManager.test.ts` — convertTaskToMetadata 单元测试

### 不动文件
- `src/services/TranslationOrchestrator.ts`（M1 已完成）
- `src/contexts/`（H4 已完成，无 Context 残留）
- `src/services/TranslationService.ts`（H5 已完成，单例已删）

---

## Task 1: M6 — onRehydrateStorage 纯函数化

**Files:**
- Modify: `src/stores/filesStore.ts:241-262`

- [ ] **Step 1: 重构 onRehydrateStorage**

把 `:241-262` 整个 `onRehydrateStorage` 替换为：

```ts
onRehydrateStorage: () => (state, error) => {
  if (error || !state) return;
  let mutated = false;
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
```

- [ ] **Step 2: 跑类型检查**

Run: `cd D:\EggTranslate && pnpm exec tsc -b`
Expected: 0 errors

- [ ] **Step 3: 跑 lint**

Run: `cd D:\EggTranslate && pnpm lint`
Expected: 0 errors

- [ ] **Step 4: 提交**

Run:
```bash
git -C D:/EggTranslate add src/stores/filesStore.ts
git -C D:/EggTranslate commit -m "refactor(store): onRehydrateStorage 改为不可变（无 mutation）"
```

---

## Task 2: M4 — processNext 拆分为 3 个内部函数

**Files:**
- Modify: `src/services/queueService.ts:59-110`

- [ ] **Step 1: 重写 queueService.ts**

把整个文件替换为：

```ts
/**
 * 队列 Service
 * 管理任务队列和 processNext 调度逻辑
 */

import { useFilesStore } from '@/stores/filesStore';
import { useQueueStore } from '@/stores/queueStore';
import { useHistoryStore } from '@/stores/historyStore';
import { startTranscription } from './transcriptionService';
import { startTranslation } from './translationService';
import { saveTranslationHistory } from './TranslationOrchestrator';
import type { SubtitleFileMetadata } from '@/types';

function isTaskCompleted(file: SubtitleFileMetadata): boolean {
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
  if (isTaskCompleted(file)) return;

  useQueueStore.getState().setTaskQueue([...queue.taskQueue, fileId]);
  if (useQueueStore.getState().activeTaskId === null) {
    queueMicrotask(() => {
      processNext().catch((err) => console.error('[queueService] processNext failed:', err));
    });
  }
}

export function dequeueTask(fileId: string): void {
  const queue = useQueueStore.getState();
  useQueueStore.getState().setTaskQueue(queue.taskQueue.filter((id) => id !== fileId));

  if (queue.activeTaskId === fileId) {
    useQueueStore.getState().setActiveTaskId(null);
    processNext().catch((err) => console.error('[queueService] processNext failed:', err));
  }
}

export function enqueueAllUncompleted(): void {
  const files = useFilesStore.getState().getAllFiles();
  for (const file of files) {
    if (!isTaskCompleted(file)) {
      enqueueTask(file.id);
    }
  }
}

// 出队 + 取 file；队列空或文件不存在时返回 null
async function startTask(): Promise<string | null> {
  const queue = useQueueStore.getState();
  if (queue.taskQueue.length === 0) {
    useQueueStore.getState().setActiveTaskId(null);
    return null;
  }
  const fileId = queue.taskQueue[0];
  useQueueStore.getState().setTaskQueue(queue.taskQueue.slice(1));
  useQueueStore.getState().setActiveTaskId(fileId);
  return fileId;
}

// 编排转录 + 翻译 + 存历史
async function runTask(file: SubtitleFileMetadata): Promise<void> {
  const fileId = file.id;
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
    await saveTranslationHistory(
      file.taskId,
      file.name,
      result.tokens,
      useHistoryStore.getState().addHistory
    );
  }
}

// 清理 active + 递归下一个
async function finishTask(fileId: string): Promise<void> {
  if (useQueueStore.getState().activeTaskId === fileId) {
    useQueueStore.getState().setActiveTaskId(null);
    await processNext();
  }
}

export async function processNext(): Promise<void> {
  const fileId = await startTask();
  if (!fileId) return;
  try {
    const file = useFilesStore.getState().getFile(fileId);
    if (file) await runTask(file);
  } catch (error) {
    console.error('[queueService] processNext task failed:', error);
  } finally {
    await finishTask(fileId);
  }
}
```

- [ ] **Step 2: 跑类型检查**

Run: `cd D:\EggTranslate && pnpm exec tsc -b`
Expected: 0 errors

- [ ] **Step 3: 跑现有测试**

Run: `cd D:\EggTranslate && pnpm test --run`
Expected: 全部通过（业务行为没变）

- [ ] **Step 4: 提交**

Run:
```bash
git -C D:/EggTranslate add src/services/queueService.ts
git -C D:/EggTranslate commit -m "refactor(service): processNext 拆为 startTask/runTask/finishTask"
```

---

## Task 3: L4 — 抽象 logger

**Files:**
- Create: `src/utils/logger.ts`
- Modify: 全项目 `console.log` / `console.error` 调用点

- [ ] **Step 1: 创建 logger.ts**

新建 `src/utils/logger.ts`：

```ts
/**
 * 统一日志入口
 * - dev: debug/info/warn/error 全开
 * - prod: 仅 warn/error
 */

const isDev = import.meta.env.DEV;

function prefix(level: string): string {
  return `[${level}]`;
}

export const logger = {
  debug: (...args: unknown[]) => {
    if (isDev) console.log(prefix('debug'), ...args);
  },
  info: (...args: unknown[]) => {
    if (isDev) console.log(prefix('info'), ...args);
  },
  warn: (...args: unknown[]) => {
    console.warn(prefix('warn'), ...args);
  },
  error: (...args: unknown[]) => {
    console.error(prefix('error'), ...args);
  },
};
```

- [ ] **Step 2: 替换字幕 store 和 service 中的 console 调用**

主要目标文件：
- `src/stores/subtitleStore.ts` — 但已拆分为 filesStore/queueStore/transcriptionService/translationService
- `src/services/transcriptionService.ts`
- `src/services/translationService.ts`
- `src/services/queueService.ts`

对每个文件：
- `console.log(...)` → `logger.info(...)` 或 `logger.debug(...)`
- `console.error('[xxx] ...')` → `logger.error('...')`（前缀已在 logger 内）
- `console.warn(...)` → `logger.warn(...)`

**注意：** 保持调用方完全等价的语义。

- [ ] **Step 3: 跑类型检查 + 测试**

Run:
```bash
cd D:\EggTranslate && pnpm exec tsc -b && pnpm test --run
```

Expected: 0 errors, 全部通过

- [ ] **Step 4: 提交**

Run:
```bash
git -C D:/EggTranslate add src/utils/logger.ts src/services/ src/stores/
git -C D:/EggTranslate commit -m "refactor: 抽象 logger 替换散落 console 调用"
```

---

## Task 4: M2 — 死代码清理

**Files:**
- 全项目扫

- [ ] **Step 1: 找未使用 import**

Run: `cd D:\EggTranslate && pnpm exec tsc -b --noEmit`
Expected: 0 errors（TS 已检查）

- [ ] **Step 2: 找未引用导出**

Run:
```bash
cd D:\EggTranslate && grep -r "export" src/ --include="*.ts" --include="*.tsx" -l
```

逐个文件检查导出是否被引用。重点：
- `src/services/SubtitleExporter.ts` — `exportTaskSRT` / `exportTaskTXT` / `exportTaskBilingual`（grep 验证）

- [ ] **Step 3: 删除确认未引用的导出**

对每个确认未引用的导出：
- 若是函数：从文件中删除
- 若是类型：保留（外部可能用）

- [ ] **Step 4: 跑测试 + 提交**

Run:
```bash
cd D:\EggTranslate && pnpm test --run
cd D:\EggTranslate && pnpm lint
git -C D:/EggTranslate add -A
git -C D:/EggTranslate commit -m "refactor: 清理未引用导出与残留死代码"
```

---

## Task 5: H2 — 派生状态缓存 (entryCount / translatedCount)

**Files:**
- Modify: `src/types/index.ts` — SingleTask 加字段
- Modify: `src/stores/filesStore.ts` — 维护这两个字段 + 持久化版本升级 v3 → v4
- Modify: `src/services/SubtitleFileManager.ts` — `convertTaskToMetadata` 直接读字段

- [ ] **Step 1: 修改 SingleTask 类型**

在 `src/types/index.ts` 找到 `SingleTask` 接口，加：

```ts
export interface SingleTask {
  // ... 已有字段 ...
  entryCount: number;
  translatedCount: number;
}
```

- [ ] **Step 2: 修改 convertTaskToMetadata**

在 `src/services/SubtitleFileManager.ts` 找到 `convertTaskToMetadata` 函数：

```ts
// 之前
const entryCount = entries.length;
const translatedCount = entries.filter(e => e.translatedText).length;

// 之后
const entryCount = task.entryCount;
const translatedCount = task.translatedCount;
```

- [ ] **Step 3: 在 filesStore.ts 维护两个字段**

找到 `addTask`、`updateEntry`、`deleteEntry`、`batchUpdateEntries`，在每个 `set` 回调里同步维护 `entryCount` 和 `translatedCount`：

```ts
// addTask 例子
addTask: (task) => {
  set((state) => ({
    tasks: [...state.tasks, {
      ...task,
      entryCount: task.subtitle_entries?.length ?? 0,
      translatedCount: task.subtitle_entries?.filter(e => e.translatedText).length ?? 0,
    }],
  }));
},
```

```ts
// updateEntry 例子
updateEntry: (fileId, entryId, text, translatedText, status, startTime, endTime, words) => {
  const file = get().getFile(fileId);
  if (!file) return;
  set((state) => {
    const newTasks = state.tasks.map((t) => {
      if (t.taskId !== file.taskId) return t;
      const oldEntry = t.subtitle_entries?.find(e => e.id === entryId);
      const oldTranslated = oldEntry?.translatedText ? 1 : 0;
      const newTranslated = (translatedText ?? oldEntry?.translatedText) ? 1 : 0;
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
        entryCount: t.subtitle_entries?.length ?? 0,
        translatedCount: (t.translatedCount ?? 0) - oldTranslated + newTranslated,
      };
    });
    return { tasks: newTasks };
  });
},
```

对 `deleteEntry` / `batchUpdateEntries` / `removeTask` / `clearAllTasks` 做类似维护。

- [ ] **Step 4: 升级 persist 版本 + migrate**

把 `version: 3` 改为 `version: 4`，并扩展 `migrate`：

```ts
version: 4,
migrate: (persistedState: unknown, version: number) => {
  if (persistedState && typeof persistedState === 'object' && 'tasks' in persistedState) {
    const state = persistedState as { tasks: SingleTask[]; selectedFileId: string | null };
    let migrated = state;
    if (version < 3) {
      migrated = {
        ...migrated,
        tasks: migrated.tasks.map((t) => ({ ...t, selectedKeytermGroupId: null })),
      };
    }
    if (version < 4) {
      migrated = {
        ...migrated,
        tasks: migrated.tasks.map((t) => ({
          ...t,
          entryCount: t.subtitle_entries?.length ?? 0,
          translatedCount: t.subtitle_entries?.filter((e) => e.translatedText).length ?? 0,
        })),
      };
    }
    return migrated;
  }
  return { tasks: [], selectedFileId: null };
},
```

- [ ] **Step 5: 跑测试**

Run: `cd D:\EggTranslate && pnpm test --run`
Expected: 全部通过

- [ ] **Step 6: 提交**

Run:
```bash
git -C D:/EggTranslate add src/types/ src/stores/filesStore.ts src/services/SubtitleFileManager.ts
git -C D:/EggTranslate commit -m "perf(store): entryCount/translatedCount 持久化进 task 本身"
```

---

## Task 6: H3 — SubtitleEditor 虚拟列表 + 搜索 debounce

**Files:**
- Modify: `package.json` — 加 @tanstack/react-virtual
- Create: `src/hooks/useDebouncedValue.ts`
- Modify: `src/components/SubtitleEditor.tsx`

- [ ] **Step 1: 安装依赖**

Run: `cd D:\EggTranslate && pnpm add @tanstack/react-virtual`
Expected: package.json + pnpm-lock.yaml 更新

- [ ] **Step 2: 创建 useDebouncedValue hook**

新建 `src/hooks/useDebouncedValue.ts`：

```ts
import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs: number = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
```

- [ ] **Step 3: 修改 SubtitleEditor**

读 `src/components/SubtitleEditor.tsx` 完整文件。改造点：

```tsx
import { useVirtualizer } from '@tanstack/react-virtual';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

// 搜索框：把 setSearchQuery 改为 debounced
const [searchInput, setSearchInput] = useState('');
const debouncedSearch = useDebouncedValue(searchInput, 300);
const filteredEntries = useMemo(() => {
  return entries.filter(/* 用 debouncedSearch */);
}, [entries, debouncedSearch]);

// 渲染：用 useVirtualizer 替代直接 map
const parentRef = useRef<HTMLDivElement>(null);
const virtualizer = useVirtualizer({
  count: filteredEntries.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 60,
  overscan: 10,
});

return (
  <div ref={parentRef} style={{ height: '500px', overflow: 'auto' }}>
    <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
      {virtualizer.getVirtualItems().map((vItem) => {
        const entry = filteredEntries[vItem.index];
        return (
          <div
            key={entry.id}
            data-index={vItem.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${vItem.start}px)`,
            }}
          >
            {/* 原来的 entry 渲染 */}
          </div>
        );
      })}
    </div>
  </div>
);
```

**注意：** 实际实施时需要保留：
- 编辑行（被点击进入编辑的）的高亮
- 选中行的滚动定位
- 现有的 framer-motion 动画（如果与虚拟化冲突，删掉 enter/exit 动画保留 hover/click）

- [ ] **Step 4: 跑测试 + lint**

Run: `cd D:\EggTranslate && pnpm test --run && pnpm lint`
Expected: 全部通过

- [ ] **Step 5: 提交**

Run:
```bash
git -C D:/EggTranslate add package.json pnpm-lock.yaml src/hooks/useDebouncedValue.ts src/components/SubtitleEditor.tsx
git -C D:/EggTranslate commit -m "perf(ui): SubtitleEditor 虚拟列表 + 搜索 debounce 300ms"
```

---

## Task 7: 测试覆盖 — TranslationOrchestrator 纯函数

**Files:**
- Create: `src/services/__tests__/TranslationOrchestrator.test.ts`
- Existing: `src/services/TranslationOrchestrator.ts`

- [ ] **Step 1: 读 TranslationOrchestrator 找纯函数**

读 `src/services/TranslationOrchestrator.ts` 全部内容。

目标函数（按依赖从少到多排序）：
- `createTranslationBatches(entries, settings)` — 纯
- `processBatch(batch, config, deps)` — 接受 deps 注入，易测
- `saveTranslationHistory(...)` — 副作用大，mock 后测

- [ ] **Step 2: 写 createTranslationBatches 测试**

新建 `src/services/__tests__/TranslationOrchestrator.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { createTranslationBatches } from '../TranslationOrchestrator';

describe('createTranslationBatches', () => {
  it('空数组返回空', () => {
    expect(createTranslationBatches([], { maxBatchSize: 10 })).toEqual([]);
  });

  it('条目数 ≤ maxBatchSize 时返回单批', () => {
    const entries = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(createTranslationBatches(entries, { maxBatchSize: 5 })).toEqual([entries]);
  });

  it('条目数 > maxBatchSize 时按批拆分', () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({ id: i }));
    const batches = createTranslationBatches(entries, { maxBatchSize: 5 });
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(5);
    expect(batches[1]).toHaveLength(5);
    expect(batches[2]).toHaveLength(2);
  });

  it('maxBatchSize = 0 时不分割', () => {
    const entries = Array.from({ length: 3 }, (_, i) => ({ id: i }));
    const batches = createTranslationBatches(entries, { maxBatchSize: 0 });
    expect(batches).toEqual([entries]);
  });
});
```

- [ ] **Step 3: 跑测试确认通过**

Run: `cd D:\EggTranslate && pnpm test --run TranslationOrchestrator`
Expected: 4 通过

**注意：** `createTranslationBatches` 的实际签名可能与上面不同。读文件后调整。

- [ ] **Step 4: 提交**

Run:
```bash
git -C D:/EggTranslate add src/services/__tests__/TranslationOrchestrator.test.ts
git -C D:/EggTranslate commit -m "test: TranslationOrchestrator.createTranslationBatches 单元测试"
```

---

## Task 8: 测试覆盖 — convertTaskToMetadata

**Files:**
- Create: `src/services/__tests__/SubtitleFileManager.test.ts`

- [ ] **Step 1: 写 convertTaskToMetadata 测试**

```ts
import { describe, it, expect } from 'vitest';
import { convertTaskToMetadata } from '../SubtitleFileManager';

describe('convertTaskToMetadata', () => {
  it('空 entries 时 entryCount=0, translatedCount=0', () => {
    const meta = convertTaskToMetadata({
      taskId: 't1',
      subtitle_entries: [],
    } as any);
    expect(meta.entryCount).toBe(0);
    expect(meta.translatedCount).toBe(0);
  });

  it('H2 实施后：直接读 task.entryCount / translatedCount', () => {
    const meta = convertTaskToMetadata({
      taskId: 't1',
      entryCount: 100,
      translatedCount: 50,
      subtitle_entries: [],
    } as any);
    expect(meta.entryCount).toBe(100);
    expect(meta.translatedCount).toBe(50);
  });
});
```

**注意：** 实际 API 调整后这里要对应改。

- [ ] **Step 2: 跑测试**

Run: `cd D:\EggTranslate && pnpm test --run SubtitleFileManager`
Expected: 通过

- [ ] **Step 3: 提交**

Run:
```bash
git -C D:/EggTranslate add src/services/__tests__/SubtitleFileManager.test.ts
git -C D:/EggTranslate commit -m "test: convertTaskToMetadata 单元测试"
```

---

## Task 9: 测试覆盖 — srtParser

**Files:**
- Create: `src/utils/__tests__/srtParser.test.ts`

- [ ] **Step 1: 写 srtParser 测试**

读 `src/utils/srtParser.ts` 找出主要导出函数（parseSrt、serializeSrt 等），按以下模式写 3-5 个 case。

```ts
import { describe, it, expect } from 'vitest';
import { parseSrt, serializeSrt } from '../srtParser';

describe('parseSrt', () => {
  it('合法 SRT 解析为 entries', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000
Hello world`;
    const entries = parseSrt(srt);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe('Hello world');
  });

  it('空字符串返回空数组', () => {
    expect(parseSrt('')).toEqual([]);
  });

  it('多行文本保留换行', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000
Line 1
Line 2`;
    const entries = parseSrt(srt);
    expect(entries[0].text).toContain('Line 1');
    expect(entries[0].text).toContain('Line 2');
  });
});

describe('serializeSrt', () => {
  it('entries 序列化为 SRT 字符串', () => {
    const srt = serializeSrt([{ id: 1, text: 'Hello', startTime: '00:00:01,000', endTime: '00:00:02,000' }]);
    expect(srt).toContain('Hello');
    expect(srt).toContain('00:00:01,000 --> 00:00:02,000');
  });
});
```

- [ ] **Step 2: 跑测试 + 提交**

Run:
```bash
cd D:\EggTranslate && pnpm test --run srtParser
git -C D:/EggTranslate add src/utils/__tests__/srtParser.test.ts
git -C D:/EggTranslate commit -m "test: srtParser 单元测试"
```

---

## Task 10: 测试覆盖 — logger

**Files:**
- Create: `src/utils/__tests__/logger.test.ts`

- [ ] **Step 1: 写 logger 测试**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../logger';

describe('logger', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logger.error 始终输出到 console.error', () => {
    logger.error('test');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('logger.warn 始终输出到 console.warn', () => {
    logger.warn('test');
    expect(consoleWarnSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试 + 提交**

Run:
```bash
cd D:\EggTranslate && pnpm test --run logger
git -C D:/EggTranslate add src/utils/__tests__/logger.test.ts
git -C D:/EggTranslate commit -m "test: logger 单元测试"
```

---

## 验收清单

全部 task 完成后：

- [ ] `pnpm test --run` 全部通过
- [ ] `pnpm lint` 无 error
- [ ] `pnpm build` 成功
- [ ] 1000 字幕时 SubtitleEditor 输入搜索无明显延迟（手动验证）
- [ ] 审计报告 7 个剩余项全部清零
- [ ] 全项目无 `console.log` 残留（仅 `console.error` 用于 logger）

---

## 不在本次范围（明确划线）

- 引入 XState
- 重写为完整状态机
- E2E 测试（playwright / cypress）
- 重新设计 API 层
- 大规模 UI 改版
