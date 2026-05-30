# 阶段数据模型持久化重构设计

> **目标：** 将 `phases` 从 Zustand 内存私有改为持久化到 localforage，实现断点续跑和刷新恢复。

---

## 架构分层

```
localforage (SingleTask.phases) ← 唯一数据源，异步持久化（dirty-flag + 1s flush）
         ↑ flush
         ↓ 刷新加载
Zustand (SubtitleFileMetadata.phases) ← 内存主数据源 + 响应式
         ↓ selector 精准订阅
组件（只渲染变化的字段）
```

**原则：**
- 内存是主数据源（高性能）— 所有读写都在 Zustand
- localforage 负责持久化（刷新恢复 + 崩溃恢复）
- 变更时：Zustand 更新 → dirty-flag → 异步写回 localforage

---

## 数据模型

### SingleTask 新增 phases 字段

```typescript
// src/types/index.ts

// PhaseProgress 是唯一阶段数据结构，直接持久化到 localforage
// 注意：当前 src/types/progress.ts 中的 PhaseState { progress: number } 会被此结构替代
export interface PhaseProgress {
  status: 'upcoming' | 'active' | 'completed' | 'failed';
  current: number;    // 已完成数（如翻译 5/20）
  total: number;       // 总数（如翻译共 20 条）
  tokens: number;      // 该阶段消耗的 tokens
}

// 百分比由 current/total 计算得出，不单独存储
// percentage = total > 0 ? Math.round((current / total) * 100) : 0
// 不确定进度（转码/转录）用 total=1, current=0 或 1 表示

export interface FilePhases {
  converting: PhaseProgress;   // 视频转码
  transcribing: PhaseProgress; // AI 转录（AssemblyAI）
  translating: PhaseProgress;  // 字幕翻译
  splitting: PhaseProgress;   // 断句对齐
}

export interface SingleTask {
  taskId: string;
  subtitle_entries: SubtitleEntry[];
  subtitle_filename: string;
  
  // 四个阶段进度，统一结构，直接持久化
  phases: FilePhases;
  
  // 其他元数据
  fileType?: FileType;
  fileSize?: number;
  duration?: number;
  index: number;
}
```

### 进度推导规则（百分比由 current/total 计算，不存储）

| 阶段 | current/total 含义 | progress 计算 |
|------|-------------------|--------------|
| `converting` | 0/1 或 1/1 | `total > 0 ? 100 : 0` |
| `transcribing` | 0/1 或 1/1 | `total > 0 ? 100 : 0` |
| `translating` | 已完成条数/总条数 | `total > 0 ? (current/total)*100 : 0` |
| `splitting` | 已对齐条数/需要对齐条数 | `total > 0 ? (current/total)*100 : 0` |

---

## 持久化策略

### Dirty-flag + 1 秒 flush 抑制

**目标：** 避免每批次都写 localforage，抑制写放大。

```typescript
// src/services/dataManager/modules/PhasePersistence.ts（新增）

interface DirtyState {
  taskId: string;
  dirtyPhases: Set<ProgressPhase>;  // 哪些阶段需要写
  flushTimer: number | null;
}

const dirtyMap = new Map<string, DirtyState>();
const FLUSH_DELAY_MS = 1000;

function markDirty(taskId: string, phase: ProgressPhase): void {
  if (!dirtyMap.has(taskId)) {
    dirtyMap.set(taskId, { taskId, dirtyPhases: new Set(), flushTimer: null });
  }
  const state = dirtyMap.get(taskId)!;
  state.dirtyPhases.add(phase);
  
  // 重置 flush 定时器
  if (state.flushTimer !== null) {
    clearTimeout(state.flushTimer);
  }
  state.flushTimer = setTimeout(() => flushTask(taskId), FLUSH_DELAY_MS);
}

async function flushTask(taskId: string): void {
  const state = dirtyMap.get(taskId);
  if (!state || state.dirtyPhases.size === 0) return;
  
  state.flushTimer = null;
  const dirtyPhases = Array.from(state.dirtyPhases);
  state.dirtyPhases.clear();
  
  // 从内存读取最新 phases，写入 localforage
  const task = dataManager.getTaskById(taskId);
  if (!task) return;
  
  const updatedPhases = { ...task.phases };
  for (const phase of dirtyPhases) {
    // phases 已在内存中更新，这里只做序列化写入
  }
  
  await localforage.setItem(BATCH_TASKS_KEY, dataManager.getBatchTasks());
}
```

### 写入时机

| 场景 | 何时 flush |
|------|-----------|
| `converting`/`transcribing` 完成 | 立即标记 dirty，1s 后 flush |
| `translating` 每批次完成 | 立即标记 dirty，1s 后 flush |
| `splitting` 每 chunk 完成 | 立即标记 dirty，1s 后 flush |
| 翻译/断句失败 | 立即 flush（避免状态丢失） |

---

## 阶段状态流转

### 转录阶段（AssemblyAI）

```
startTranscription
  → phases.converting = { status: 'active', current: 0, total: 1, tokens: 0 }
  → onConverting → phases.converting = { status: 'active', current: 0, total: 1, tokens: 0 }
  → onTranscribing → phases.converting = { status: 'completed', current: 1, total: 1, tokens: 0 }
                     phases.transcribing = { status: 'active', current: 0, total: 1, tokens: 0 }
  → AssemblyAI 轮询完成 → phases.transcribing = { status: 'completed', current: 1, total: 1, tokens: 0 }
```

### 翻译阶段

```
startTranslation
  → phases.translating = { status: 'active', current: 0, total: entries.length, tokens: 0 }
  
每批次完成
  → phases.translating.current += batchSize
  → markDirty(taskId, 'translating')
  
完成
  → phases.translating = { status: 'completed', current: total, total, tokens }
  → flush 立即执行（避免状态丢失）
```

### 断句阶段

```
splitting 开始
  → phases.splitting = { status: 'active', current: 0, total: alignTasks.length, tokens: 0 }

每 chunk 完成
  → phases.splitting.current += chunk.length
  → markDirty(taskId, 'splitting')

完成/失败
  → phases.splitting = { status: 'completed'/'failed', current: total, total, tokens }
  → flush 立即执行
```

---

## 崩溃恢复

**刷新时：** 从 localforage 读取 `SingleTask.phases`，恢复 Zustand。

```typescript
// src/services/SubtitleFileManager.ts convertTaskToMetadata
export function convertTaskToMetadata(task: SingleTask): SubtitleFileMetadata {
  return {
    id: generateStableFileId(task.taskId),
    taskId: task.taskId,
    name: task.subtitle_filename,
    phases: task.phases,  // 直接从 localforage 恢复
    // ...
  };
}
```

---

## 文件修改清单

### 1. `src/types/index.ts`
- 删除 `translation_progress` 字段（被 `phases.translating` 替代）
- `PhaseProgress` / `FilePhases` 合并到此文件

### 2. `src/types/progress.ts` → 删除
- 所有类型合并到 `src/types/index.ts`

### 3. `src/services/dataManager/modules/PhasePersistence.ts`（新增）
- `markDirty(taskId, phase)` — 标记脏
- `flushTask(taskId)` — 批量写入
- `flushAll()` — 应用关闭时调用

### 4. `src/services/dataManager/modules/TaskManager.ts`
- `updateTaskPhases(taskId, phases)` — 更新指定阶段到 localforage
- `createNewTask` 时初始化 `phases`

### 5. `src/stores/subtitleStore.ts`
- `updatePhase` 改为更新 Zustand + 标记 dirty（不直接写 localforage）
- `startTranscription`/`startTranslation` 流程不变（只在内存更新 phases）
- 新增 `flushPhasesToPersistence()` — 应用关闭时调用

### 6. `src/components/SubtitleFileList/components/StepperProgress.tsx`
- 进度计算：`progress = phaseState.total > 0 ? Math.round((phaseState.current / phaseState.total) * 100) : 0`
- 不确定进度（total=0 或 -1）时显示 spinner
- `isIndeterminate` 改为：`phaseState.total === 0 && phaseState.status === 'active'`

### 7. `src/components/SubtitleFileList/components/SubtitleFileItem.tsx`
- `cardStatus` 逻辑不变（依赖 `phases` 状态）

---

## 验证方式

1. `npx tsc --noEmit` 无类型错误
2. 上传音频文件 → 转录完成 → 所有节点 completed
3. 翻译进行到 5/20 → 刷新页面 → `phases.translating.current = 5` 恢复，UI 显示 25%
4. 点击"继续翻译" → 从第 6 条开始，不重复翻译已完成条目
5. 断句进行到 3/10 → 刷新页面 → 恢复进度，继续断句
6. 翻译失败 → 刷新页面 → 显示 failed 状态，不丢失

---

## 迁移计划

本地开发阶段，直接迁移，不保留旧字段。

- `translation_progress` 字段直接移除（被 `phases.translating` 替代）
- 旧 `PhaseState`/`PhaseStatus` 类型删除
- `convertTaskToMetadata` 直接从 `task.phases` 恢复，无 fallback 逻辑