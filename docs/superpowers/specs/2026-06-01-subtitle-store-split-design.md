# subtitleStore.ts 拆分设计

**日期：** 2026-06-01
**重构深度：** 结构性拆分 + 三层职责划分
**预期影响：** 1132 行单 store → 6 个聚焦模块；零行为变更

---

## 目标

1. 把 `src/stores/subtitleStore.ts`（1132 行、19 actions、7 职责）拆为聚焦的多个模块
2. 建立清晰的**三层职责**：数据 (Store) / 用例 (Service) / 视图 (Hook)
3. 业务编排（特别是 463 行 `startTranslation`）从 store 抽到 service，便于独立测试
4. 零行为变更；本地开发，不需要兼容层

## 非目标

- 不引入 XState 等状态机库
- 不修改数据模型（`SingleTask`、`SubtitleEntry`、`FilePhases` 等保持不变）
- 不改持久化方案（仍用 zustand/persist + localforage）
- 不改 UI 表现
- 不保留旧的 `useSubtitleStore` facade

## 架构

### 三层职责

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: 数据 (Stores)                                       │
│   useFilesStore  — tasks, selectedFileId, phase (持久化)     │
│   useQueueStore  — taskQueue, activeTaskId (内存)            │
│   暴露: 简单 setter + getter                                  │
│   不知道有 service，不知道有 UI                              │
└─────────────────────────────────────────────────────────────┘
                          ↑ 写入 (set/get state)
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: 用例 (Services) — 纯函数模块                         │
│   filesService         — addFile, removeFile, clearAll,      │
│                          updateEntry, deleteEntry, ...        │
│   transcriptionService — startTranscription                  │
│   translationService   — startTranslation (463 行在这里)     │
│   queueService         — enqueueTask, dequeueTask,           │
│                          enqueueAllUncompleted, processNext   │
│   知道 store，通过 getState()/setState() 操作                 │
│   不知道有 UI                                                  │
└─────────────────────────────────────────────────────────────┘
                          ↑ 调用
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: 视图 (Hooks)                                        │
│   useFiles() / useFile(id) / useSelectedFile()              │
│   useStartTranscription() / useStartTranslation()            │
│   useQueue() / useFileQueue()                                │
│   知道 service 和 store，不直接组合业务逻辑                  │
└─────────────────────────────────────────────────────────────┘
```

### 依赖方向

```
Components → Hooks → Services → Stores
                          ↓
              other stores (transcriptionStore, translationConfigStore)
                          ↓
              external (AssemblyAI, LLM API, localforage)
```

**关键约束：**
- Store 不调用 service（单向）
- Service 通过 `useXxxStore.getState()` 访问 store（避免 hook 调用）
- Hook 调用 service，订阅 store
- 无循环依赖

## 文件结构

### 新建（6 个）

| 文件 | 职责 | 估计行数 |
|------|------|---------|
| `src/stores/filesStore.ts` | 数据 + setter + getter | ~200 |
| `src/stores/queueStore.ts` | 队列状态 setter | ~50 |
| `src/services/filesService.ts` | 文件/条目 CRUD 业务 | ~150 |
| `src/services/transcriptionService.ts` | 转录流水线 | ~100 |
| `src/services/translationService.ts` | 翻译+拆分流水线 | ~500 |
| `src/services/queueService.ts` | 队列管理 + 调度 | ~100 |

### 修改（5-6 个）

| 文件 | 改动 |
|------|------|
| `src/stores/index.ts` | 替换导出 |
| `src/components/MainApp.tsx` | 改用 `useQueue()` / `useFiles()` |
| `src/components/SubtitleFileList/index.tsx` | 改用新 hooks |
| `src/components/SubtitleFileList/components/SubtitleFileItem.tsx` | 改用新 hooks |
| `src/components/SubtitleEditor.tsx` | 改用 service |
| `src/components/TranslationControls.tsx` | 改用 service |

### 删除（1 个）

| 文件 | 原因 |
|------|------|
| `src/stores/subtitleStore.ts` | 整个文件被拆分替换 |

## 模块设计

### useFilesStore

**职责：** 唯一持有任务数据和 phase 状态。提供原子 setter。

**状态：**
```ts
interface FilesState {
  tasks: SingleTask[];              // 持久化
  selectedFileId: string | null;    // 持久化
}
```

**Actions（全部为简单 setter，无业务编排）：**
- 任务：`addTask`, `removeTask`, `clearAllTasks`
- 选中：`setSelectedFileId`
- 条目：`updateEntry`, `deleteEntry`, `batchUpdateEntries`, `updateEntrySplitStatus`
- Phase：`updatePhase`, `setWorkflow`
- Getters：`getFile`, `getAllFiles`, `getTranslationProgress`, `getFileEntries`

**持久化：**
- `name: 'subtitle_tasks'` (复用旧 key, 兼容持久化)
- `version: 2` (因为数据结构调整过)
- `migrate`: 处理从 v1 (旧 subtitleStore) 升级
- `partialize`: 排除 `fileRef`（File 对象不能 JSON 化）

### useQueueStore

**职责：** 持有队列运行时状态。仅内存，不持久化。

**状态：**
```ts
interface QueueState {
  taskQueue: string[];
  activeTaskId: string | null;
}
```

**Actions（全部为简单 setter）：**
- `setTaskQueue(queue: string[])`
- `setActiveTaskId(id: string | null)`
- `enqueue(fileId)` — 内部去重 + 检查重复
- `dequeue(fileId)` — 内部过滤
- `shiftQueue()` — 取出队首

> **设计要点：** `enqueueTask` / `dequeueTask` / `enqueueAllUncompleted` 包含业务规则（检查活跃、查文件元数据等），应该在 service 层。但简单的 `enqueue(fileId)` / `dequeue(fileId)` 纯数组操作可以在 store。

### filesService

**职责：** 文件和条目的业务规则。

**导出函数：**
```ts
export async function addFile(file: File): Promise<string>;
export async function removeFile(fileId: string): Promise<void>;
export async function clearAll(): Promise<void>;
export async function selectFile(fileId: string): void;
export async function updateEntry(fileId, entryId, ...): Promise<void>;
export async function deleteEntry(fileId, entryId): Promise<void>;
export async function batchUpdateEntries(fileId, updates): Promise<void>;
export async function updateEntrySplitStatus(fileId, entryId, status): Promise<void>;
```

**实现：**
- 读取 `useFilesStore.getState()`
- 验证、副作用（如 removeFile 清理 MP3 localforage）
- 写入 store

### transcriptionService

**职责：** 转录编排。包含 75 行的 `startTranscription` 逻辑。

**导出函数：**
```ts
export async function startTranscription(fileId: string): Promise<void>;
```

**实现：**
- 读 `useFilesStore.getState().getFile(fileId)`
- 检查状态跳过逻辑
- 调 `AssemblyAI` 跑转录
- 写入 entries 和 phase
- 处理 MP3 转换（`convertToMP3` 工具）

### translationService

**职责：** 翻译编排。**包含 463 行的 `startTranslation` 逻辑**（这是本次重构最大的收益点）。

**导出函数：**
```ts
export async function startTranslation(fileId: string): Promise<{...} | null>;
```

**实现：**
- 协调 `translationConfigStore.translateBatch` 调用 LLM
- 复合条目向后兼容迁移（旧 `id > 999999` 的 entries）
- 原子 split+align 循环
- Phase 状态更新

### queueService

**职责：** 任务队列管理与调度。

**导出函数：**
```ts
export function enqueueTask(fileId: string): void;
export function dequeueTask(fileId: string): void;
export function enqueueAllUncompleted(): void;
export async function processNext(): Promise<void>;
```

**实现：**
- 读 `useFilesStore.getState()` 和 `useQueueStore.getState()`
- 调 `transcriptionService.startTranscription` / `translationService.startTranslation`
- 更新队列状态

### Hooks (Layer 3)

放在 `src/hooks/stores/` 或 `src/stores/hooks/`，与对应的 service 同目录。

```ts
// src/stores/filesStore.ts（同文件导出）
export const useFiles = () => {
  const tasks = useFilesStore((state) => state.tasks, useShallow);
  return useMemo(() => tasks.map(convertTaskToMetadata), [tasks]);
};

export const useFile = (fileId: string) => {
  const tasks = useFilesStore((state) => state.tasks, useShallow);
  return useMemo(() => {
    const task = tasks.find(t => generateStableFileId(t.taskId) === fileId);
    return task ? convertTaskToMetadata(task) : undefined;
  }, [tasks, fileId]);
};

export const useStartTranscription = () => {
  const start = useCallback((fileId: string) => transcriptionService.start(fileId), []);
  return { start };
};
```

## 数据流示例

### 场景 1：用户上传文件

```
User → FileUpload component
  → addFile(file)         [filesService]
    → SubtitleFileManager.loadFromFile()  [已有工具]
    → useFilesStore.addTask(task)
    → 返回 fileId
```

### 场景 2：用户点"开始翻译"

```
User → SubtitleFileItem component
  → enqueueTask(fileId)   [queueService]
    → useQueueStore.enqueue(fileId)  [如果是队首]
    → processNext()       [queueService]
      → useQueueStore.shiftQueue() / setActiveTaskId
      → translationService.start(fileId)  [translationService]
        → useFilesStore.updatePhase(...)  [多次]
        → translationConfigStore.translateBatch(...)
        → useFilesStore.updateEntry(...)  [多次]
        → useFilesStore.updatePhase('completed')
      → useQueueStore.setActiveTaskId(null)
      → processNext() (递归)
```

### 场景 3：刷新页面后恢复

```
App start
  → useFilesStore 自动从 localforage 恢复 (zustand/persist)
  → useQueueStore 是空 (不持久化)
  → 用户手动重新点"全部开始"
```

## 迁移步骤

每步独立 commit，build 始终 green。

1. **建新 store** - 创建 `filesStore.ts` 和 `queueStore.ts`（不动旧代码）
2. **建新 service** - 创建 4 个 service（不接旧 store，只接新 store）
3. **建新 hooks** - 移到 `filesStore.ts` 同文件，新增 `useStartTranscription` / `useStartTranslation` / `useQueue` / `useFileQueue`
4. **更新 stores/index.ts** - 导出新模块
5. **更新消费者** - 改 `MainApp.tsx`、`SubtitleFileList/index.tsx`、`SubtitleFileItem.tsx`、`SubtitleEditor.tsx`、`TranslationControls.tsx`（按依赖顺序，从叶子到根）
6. **删除旧 subtitleStore.ts** - 移除 import 和文件
7. **运行测试 + 手动验证** - 跑 `pnpm test`、`pnpm run build`、启动 dev 跑完整流程

## 持久化兼容

- `useFilesStore` 用 `name: 'subtitle_tasks'` 复用旧 localforage key
- `version: 2` 标识新结构
- `migrate` 函数处理 v1 → v2：旧结构 `{ tasks: [...] }` 可直接兼容（结构相同）
- 用户数据无需手动迁移

> 注：旧 `subtitleStore` 用 `name: 'batch_tasks'`。**为了一致性，复用旧 key**。如果旧 key 不存在，会创建新的。

## 测试

### Service 单元测试（Vitest）

新增测试覆盖：

- `filesService`：
  - `addFile` 正常路径
  - `addFile` 失败路径
  - `removeFile` 清理 MP3
- `queueService`：
  - `enqueueTask` 去重
  - `processNext` 调度逻辑（mock service）
  - `processNext` race condition（activeTaskId 检查）

**预估：** 5-8 个测试

### Hook 单元测试（可选）

如果时间允许：

- `useFiles()` 返回正确数据
- `useFile(id)` 过滤正确

**预估：** 2-3 个测试

### 手动验证清单

拆分后手动跑一遍：

- [ ] 上传 SRT 文件
- [ ] 上传音频文件，转录完成
- [ ] 点"开始翻译"，翻译完成
- [ ] 编辑字幕，保存
- [ ] 导出 ZIP
- [ ] 删除文件
- [ ] 队列化多文件
- [ ] 关闭浏览器重开，数据恢复

## 风险与缓解

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| 463 行翻译逻辑迁移时引入 bug | 高 | 1:1 移动原代码，单独 commit，独立测试 |
| 持久化数据格式破坏 | 中 | 复用旧 key + version + migrate |
| 队列状态机 race condition | 中 | processNext 单独可测 |
| 消费者散落多文件 | 低 | 集中 commit，所有消费者一起改 |
| 编译/类型错误 | 低 | 增量编译检查 |

## 预期收益

- **可读性：** 1132 行 → 6 个 < 500 行文件
- **可测性：** 业务编排独立可测（特别是 queueService.processNext）
- **可演进性：** 未来要加新阶段（如"校对"），只需在 service 层加一个
- **关注点分离：** 数据、编排、视图清晰分层
