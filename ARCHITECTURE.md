# EggTranslate 架构

> 浏览器端在线应用：音视频转录 + 字幕翻译。状态在 Zustand，业务在 service，UI 只编排展示。

## 分层

```
components / hooks     → 展示、交互、订阅 store selector
        ↓
services               → 编排流程、调外部 API、写回 store（通过 getState 或 deps）
        ↓
stores                 → 持久化配置 / 任务数据 / 会话 UI 态（尽量无副作用）
        ↓
utils / constants      → 纯函数：解析、prompt、限流、错误映射
```

| 层 | 职责 | 反例 |
|----|------|------|
| **Store** | 数据与 UI 会话态；persist；selector | 直接 `fetch` / 流式解析 / 批处理循环 |
| **Service** | 单文件/队列编排、LLM/ASR 调用、进度写回 | 渲染 JSX |
| **Component** | 订阅必要字段、触发 service、本地临时 UI 态 | 复制一整套翻译重试逻辑 |

## Store 一览

| Store | 持久化 | 内容 |
|-------|--------|------|
| `filesStore` | IDB（debounce） | 任务列表、字幕条目、phase |
| `translationConfigStore` | localStorage | LLM 档案 + 语言/批次；会话：`isTranslating` / progress / AbortController |
| `transcriptionStore` | localStorage | AssemblyAI Key、热词组 |
| `termsStore` / `historyStore` | IDB | 术语、历史记录 |
| `queueStore` | 内存 | 队列与 `activeTaskId` |
| `streamingOverlayStore` | 内存 | 流式译文 overlay（不落盘） |
| `workspaceStore` / `themeStore` / `soundStore` | 视情况 | 壳层 UI、主题、音效 |

### `translationConfigStore` 边界（重要）

**负责：**

- `config` / `isConfigured` / `cachedModelLists`
- 会话：`startTranslation` / `stopTranslation` / `updateProgress` / `abortController`

**不负责：**

- `translateBatch`、连接探测里的 HTTP → `services/llmTranslationService.ts`
- 多文件队列 → `queueService`
- 单文件 phase 与条目落库 → `translationService` + `filesStore`

## Service 一览

| 模块 | 作用 |
|------|------|
| `llmTranslationService` | 纯 LLM：批译、流式 partial、连接测试；入参为 `TranslationConfig`，**不 import store** |
| `TranslationOrchestrator` | 批切分、并发批次、`TranslationCallbacks` 注入 |
| `translationService` | 单文件翻译：会话 + orchestrator + phase；支持 `deps` 注入 |
| `transcriptionService` / `transcriptionPipeline` / `assemblyaiService` | 转录链路 |
| `queueService` | 全局串行队列；`setQueueServiceDeps` / `resetQueueServiceDeps` 供测试 |
| `filesService` / `SubtitleFileManager` / `SubtitleExporter` | 导入导出与元数据 |

### 依赖注入约定

运行时默认 `store.getState()`，方便 App 零样板；测试与扩展时注入：

```ts
// 单文件翻译
await startTranslation(fileId, {
  notifyError: vi.fn(),
  translateBatch: mockTranslateBatch,
});

// 队列
setQueueServiceDeps({
  startTranslation: vi.fn(),
  playSound: vi.fn(),
});
// afterEach → resetQueueServiceDeps()
```

新增编排逻辑时：优先 **参数 / callbacks / deps**，避免在 service 深处再绑死第三个 store 单例。

## 主数据流

### 翻译

1. UI：`enqueueTask(fileId)` → `queueService`
2. `runTask` → `startTranslation(fileId)`
3. `translationConfigStore.startTranslation` 打开会话 AbortController
4. `executeTranslation` 按 batch 调用 `llmTranslationService.translateBatch`
5. 流式：`streamingOverlayStore`；定稿：`filesStore.batchUpdateEntries` + phase
6. 结束：`stopTranslation`、可选 `saveTranslationHistory`

### 转录

1. 导入时转 MP3 → IDB（`mp3_data:*`）
2. `startTranscription` 读 blob → pipeline → 写 `subtitle_entries` + phase

## 热路径注意点

- 流式 partial **禁止**写 `filesStore`（会 debounce 刷 IDB 卡 UI）
- 批次结束用 `batchUpdateEntries`，不要逐行 `updateEntry`
- phase `completed` / `failed` 与 `addTask` 会 `flushFilesStorePersist`

## 文档关系

- **本文件**：分层与职责
- **DESIGN.md**：视觉 token、壳层与控件约定（与当前 UI 对齐）
- **README.md**：用户向功能与使用说明
