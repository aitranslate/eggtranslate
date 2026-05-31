# 串行任务队列设计

## 目标

将任务执行改为严格串行：同一时刻只有一个任务在处理（转录或翻译），其余已启动的任务显示"排队中"状态。队列为内存临时状态，不持久化。

## 状态模型

### 新增字段（subtitleStore）

```typescript
taskQueue: string[];         // 排队的 fileId 列表（有序），内存中，不持久化
activeTaskId: string | null; // 当前正在执行的 fileId，内存中，不持久化
```

### 任务状态（派生，不存储）

任务卡片的显示状态由 `taskQueue`、`activeTaskId`、`phases` 共同决定：

| 条件 | 显示状态 | 按钮行为 |
|------|----------|----------|
| `fileId === activeTaskId` | 处理中 | 禁用，显示阶段进度 |
| `taskQueue` 中有，且不是 active | 排队中 | 禁用，显示排队位置 |
| phases 有 `completed` | 已完成 | 可点击（重新翻译等） |
| phases 有 `failed` | 失败 | 可点击（重试） |
| 以上都不满足 | 待开始 | 可点击 |

"排队中"不是 `FilePhases` 的新 status，而是从队列位置派生的 UI 状态。`FilePhases` 的四种 status（upcoming/active/completed/failed）不变。

### partialize

```typescript
partialize: (state) => ({
  tasks: state.tasks.map(({ fileRef, ...task }) => task),
  // taskQueue 和 activeTaskId 不持久化
}),
```

## 队列 Actions

### enqueueTask(fileId: string)

```
1. 如果 fileId 已在 taskQueue 中或已全部完成，忽略
2. 加入 taskQueue 末尾
3. 如果 activeTaskId === null，立即调用 processNext()
```

空闲时点击 → 直接 active，不会出现"排队中"闪烁。
有任务在跑时点击 → 进入队列，显示"排队中"。

### processNext() （内部方法）

```
1. 从 taskQueue 头部取出 fileId，设为 activeTaskId
2. 如果 taskQueue 为空，结束
3. 根据文件类型和 phases 决定执行策略：
   - 音视频 + 未转录 → startTranscription → startTranslation
   - 音视频 + 已转录 → startTranslation
   - SRT → startTranslation
4. 无论成功或失败，完成后：
   - 清空 activeTaskId
   - 调用 processNext() 处理下一个
```

### dequeueTask(fileId: string)

```
1. 从 taskQueue 中移除 fileId
2. 如果删除的是 activeTaskId：
   - 调用 AbortController.abort() 中止当前任务
   - 清空 activeTaskId
   - 调用 processNext()
3. 如果删除的是排队中的任务：仅从数组移除
```

## UI 变化

### 任务卡片（SubtitleFileItem / StepperProgress）

根据派生状态显示：

- **待开始**：现有 idle 样式不变
- **排队中**：灰色徽章 `排队中 #N`，按钮禁用
- **处理中**：现有阶段进度样式不变
- **已完成/失败**：现有样式不变

按钮点击调用 `enqueueTask(fileId)` 而不是直接调用 `startTranscription`/`startTranslation`。

### "全部开始"按钮

改为 `enqueueAllUncompleted()`：
- 过滤未完成的文件
- 全部加入 taskQueue
- processNext() 自动串行处理

删除 `isTranslatingGloballyState` 本地 state，队列机制替代。

### 删除文件

`removeFile` 中自动调用 `dequeueTask(fileId)`。

## 页面刷新行为

- `taskQueue` 和 `activeTaskId` 不持久化，刷新后为空
- `onRehydrateStorage` 中检测中断的 active 任务（phases 中有 `active` 状态），设为 `failed`
- 用户看到的就是：之前在跑的显示"失败"，其余显示"待开始"

## 异常处理

| 场景 | 处理方式 |
|------|----------|
| 任务失败 | 视为完成，自动 processNext() 取下一个 |
| 任务中止（用户取消） | 同失败，继续队列 |
| 删除当前任务 | abort + processNext() |
| 删除排队任务 | 从队列移除 |
| 页面刷新 | 队列清空，中断任务标记 failed |
| 转录+翻译串行 | processNext 内部对单文件先转录再翻译，都完成后才 activeTaskId = null |

## 不变的部分

- `FilePhases` 类型和 `updatePhase` 逻辑不变
- `startTranscription` / `startTranslation` 内部逻辑不变
- `TranslationConfigStore.isTranslating` 继续作为翻译锁
- `checkOngoingTasks` 继续用于 beforeunload 警告
- intra-file 并发（split+align 的 Promise.all + threadCount）不变

## 验证

1. `npx tsc --noEmit` — 无类型错误
2. 上传 3 个 SRT → 点击全部开始 → 第一个处理中，后两个排队中
3. 第一个完成 → 第二个自动变处理中，第三个仍排队中
4. 删除排队中的第三个 → 队列只剩第二个
5. 删除正在处理的第二个 → abort，队列清空
6. 点击单个任务 → 直接处理中（不闪排队中）
7. 刷新页面 → 所有待开始，无排队状态
