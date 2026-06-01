# 阶段 1：低风险高收益清理 - 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过死代码删除、类型严格化、构建优化、命名去重，提升代码可读性、构建产物合理性和类型安全，不改变任何业务行为。

**Architecture:** 纯重构任务。每一步都通过 typecheck + lint + build 三重验证保证不破坏现有功能。任务之间无强依赖，但建议按顺序执行（先 L1-L3 基础环境，再 M2-M3 业务代码清理）。

**Tech Stack:** Vite 6, React 18, TypeScript 5.6, Zustand 5, ESLint 9, Tailwind 3

**预计工作量：** 1-2 天

---

## 文件清单

### 修改的文件
| 文件 | 任务 | 改动说明 |
|------|------|----------|
| `package.json` | L1 | 修复 scripts 中的 `&` 链，移除 `pnpm install` 前置 |
| `vite.config.ts` | L2 | 添加 `manualChunks` 函数拆分 vendor |
| `eslint.config.js` | L3a | 重新开启 `no-explicit-any` |
| `src/services/TranslationOrchestrator.ts` | L3b | 替换 `any` 类型（5 处） |
| `src/services/TranslationService.ts` | L3c | 替换 `any` 类型（3 处） |
| `src/components/SettingsModal/ApiTestForm.tsx` | L3d | 替换 `any` 类型（1 处） |
| `src/components/SettingsModal/TranslationSettings.tsx` | L3d | 替换 `any` 类型（1 处） |
| `src/utils/convertToMP3.ts` | L3e | 替换 `as any`（1 处） |
| `src/stores/subtitleStore.ts` | L3f | 替换 `any` 类型（1 处 `migrate` 函数） |
| `src/services/TranslationService.ts` | M2a | 删除 4 个空方法 |
| `src/hooks/useErrorHandler.ts` | M2b | 删除 `createSafeHandler` 和 `handleBatchErrors` |
| `src/App.tsx` | M2c | 删除空的 `onError` 回调 |
| `src/components/SubtitleFileList/components/StepperProgress.tsx` | M3a | 删除重复的 `ALL_PHASES` |
| `src/components/SubtitleFileList/index.tsx` | M3b | 删除未使用的 `formatTime` 函数 |
| `package.json` | M4 | 移除 `@types/react-router-dom` |

### 不需要新建文件

---

## 任务列表

### Task 1: L1 - 修复 package.json scripts 的 `&` 链

**Files:**
- Modify: `package.json` (scripts 部分)

**问题分析：**
- 当前 `dev` / `build` / `build:prod` / `lint` / `preview` 都有 `echo y | pnpm install &` 前缀
- 在 bash 中 `&` 是后台执行符，`pnpm install` 永远不阻塞后续命令
- 在 Windows cmd 中 `&` 是命令分隔符（行为不一致）
- 每次 `npm run dev` 都会触发后台 install，浪费时间且可能导致基于过期依赖启动

- [ ] **Step 1: 读取 package.json 当前内容**

运行：`cat package.json` 或 `Read` 工具

- [ ] **Step 2: 修改 scripts 块**

**Before：**
```json
"scripts": {
  "dev": "echo y | pnpm install & vite",
  "build": "echo y | pnpm install & rmdir /s /q node_modules\\.vite-temp & tsc -b & vite build",
  "build:prod": "echo y | pnpm install & rmdir /s /q node_modules\\.vite-temp & tsc -b & set BUILD_MODE=prod & vite build",
  "lint": "echo y | pnpm install & eslint .",
  "preview": "echo y | pnpm install & vite preview"
}
```

**After：**
```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "build:prod": "tsc -b && cross-env BUILD_MODE=prod vite build",
  "lint": "eslint .",
  "preview": "vite preview"
}
```

**注意：**
- `build:prod` 用了 `cross-env` 跨平台设置环境变量。如果不想引入新依赖，可以保留 `set BUILD_MODE=prod &` 但仅在 Windows 下工作
- 已删除 `rmdir /s /q node_modules\\.vite-temp` —— Vite 6 自动管理缓存目录
- 提示用户：依赖需手动 `pnpm install` 一次（已存在于 `node_modules` 时无需重复）

- [ ] **Step 3: 验证修改**

```bash
cat package.json
```

预期：scripts 块如上所示。

- [ ] **Step 4: 验证命令可执行**

```bash
pnpm run lint
```

预期：lint 正常完成（即使有警告也 OK，但应该有结果输出而不是立即退出）

- [ ] **Step 5: 提交**

```bash
git add package.json
git commit -m "fix(package): 移除 scripts 中的 pnpm install 前置，修复 & 链错误"
```

---

### Task 2: L2 - 在 vite.config.ts 拆分 vendor chunks

**Files:**
- Modify: `vite.config.ts` (rollupOptions 部分)

- [ ] **Step 1: 读取当前 vite.config.ts**

使用 Read 工具。预期看到：
```ts
build: {
  outDir: 'dist',
  emptyOutDir: true,
  rollupOptions: {
    output: {
      manualChunks: undefined,
      entryFileNames: 'assets/[name]-[hash].js',
      chunkFileNames: 'assets/[name]-[hash].js',
      assetFileNames: 'assets/[name]-[hash].[ext]'
    }
  }
}
```

- [ ] **Step 2: 添加 manualChunks 函数**

**修改 rollupOptions.output：**

**Before：**
```ts
output: {
  manualChunks: undefined,
  entryFileNames: 'assets/[name]-[hash].js',
  chunkFileNames: 'assets/[name]-[hash].js',
  assetFileNames: 'assets/[name]-[hash].[ext]'
}
```

**After：**
```ts
output: {
  manualChunks: (id) => {
    if (id.includes('node_modules')) {
      if (id.includes('framer-motion')) return 'vendor-framer-motion';
      if (id.includes('@radix-ui')) return 'vendor-radix';
      if (id.includes('react-router')) return 'vendor-react-router';
      if (id.includes('lucide-react')) return 'vendor-lucide';
      if (id.includes('react') || id.includes('react-dom')) return 'vendor-react';
      return 'vendor';
    }
  },
  entryFileNames: 'assets/[name]-[hash].js',
  chunkFileNames: 'assets/[name]-[hash].js',
  assetFileNames: 'assets/[name]-[hash].[ext]'
}
```

**为什么这样分：**
- `vendor-react` + `vendor-react-dom` → 核心运行时
- `vendor-framer-motion` → 动画（首屏加载后用）
- `vendor-radix` → Radix UI 多个包共享
- `vendor-react-router` → 路由（路由变化时不影响业务代码）
- `vendor-lucide` → 图标库
- 其他 `vendor` → 兜底

- [ ] **Step 3: 构建验证**

```bash
pnpm run build
```

预期：构建成功，`dist/assets/` 下有多个 `vendor-*.js` 文件

- [ ] **Step 4: 验证分块数量**

```bash
ls dist/assets/vendor-*.js
```

预期：至少看到 4-6 个 vendor 文件

- [ ] **Step 5: 提交**

```bash
git add vite.config.ts
git commit -m "perf(build): 拆分 vendor chunks 优化首屏加载"
```

---

### Task 3: L3a - 重新开启 eslint no-explicit-any

**Files:**
- Modify: `eslint.config.js`

- [ ] **Step 1: 读取当前 eslint.config.js**

预期看到 `'@typescript-eslint/no-explicit-any': 'off'`

- [ ] **Step 2: 修改规则**

**修改：**
```js
'@typescript-eslint/no-explicit-any': 'off',
```

**改为：**
```js
'@typescript-eslint/no-explicit-any': 'error',
```

- [ ] **Step 3: 运行 lint 列出所有错误**

```bash
pnpm run lint 2>&1 | tee /tmp/lint-output.txt
```

预期：列出一系列错误位置（将在 Task 4-9 中逐个修复）

- [ ] **Step 4: 统计错误数量**

```bash
grep -c "error" /tmp/lint-output.txt
```

记录这个数字。**不要在 lint 通过前提交！**

- [ ] **Step 5: 暂不提交**

继续 Task 4-9 修复后，lint 应该会通过。**这个 Task 不单独提交**，而是与后续修复 any 的任务一起分批提交。

---

### Task 4: L3b - 修复 TranslationOrchestrator.ts 中的 `any`

**Files:**
- Modify: `src/services/TranslationOrchestrator.ts`

**当前 `any` 位置：**
- L18: `relevantTerms: any[]`
- L35: `translations: Record<string, any>`
- L50: `getRelevantTerms: (...) => any[]`
- L51: `formatTermsForPrompt: (terms: any[]) => string`
- L140: `formatTermsForPrompt: (terms: any[]) => string`
- L205: `catch (error: any)`
- L305: `addHistoryEntry: (entry: any)`

- [ ] **Step 1: 添加 Term 类型 import**

在文件顶部 import 中找到 `import type { SubtitleEntry, TranslationStatus } from '@/types';` 并修改为：

```ts
import type { SubtitleEntry, Term, TranslationStatus, TranslationHistoryEntry } from '@/types';
```

- [ ] **Step 2: 修复 BatchInfo 接口（L18）**

**Before：**
```ts
relevantTerms: any[];  // 改为传递术语数组
```

**After：**
```ts
relevantTerms: Term[];
```

- [ ] **Step 3: 修复 TranslationCallbacks 接口（L35, L50, L51, L305）**

**Before：**
```ts
translateBatch: (
  texts: string[],
  signal?: AbortSignal,
  contextBefore?: string,
  contextAfter?: string,
  terms?: string
) => Promise<{ translations: Record<string, any>; tokensUsed: number }>;
```

**After：**
```ts
translateBatch: (
  texts: string[],
  signal?: AbortSignal,
  contextBefore?: string,
  contextAfter?: string,
  terms?: string
) => Promise<{ translations: Record<string, { direct: string }>; tokensUsed: number }>;
```

- [ ] **Step 4: 继续修复 L50, L51**

**Before：**
```ts
getRelevantTerms: (batchText: string, before: string, after: string) => any[];
formatTermsForPrompt: (terms: any[]) => string;
```

**After：**
```ts
getRelevantTerms: (batchText: string, before: string, after: string) => Term[];
formatTermsForPrompt: (terms: Term[]) => string;
```

- [ ] **Step 5: 修复 L140 函数参数**

**Before：**
```ts
formatTermsForPrompt: (terms: any[]) => string,
```

**After：**
```ts
formatTermsForPrompt: (terms: Term[]) => string,
```

- [ ] **Step 6: 修复 L205 错误类型**

**Before：**
```ts
} catch (error: any) {
```

**After：**
```ts
} catch (error) {
  const appError = toAppError(error);
  console.error(`[TranslationOrchestrator] 批次 ${batch.batchIndex + 1} 翻译失败:`, appError.message);
```

**注意：** `error: any` 在 `catch` 子句中默认就是 `unknown`，可以去掉类型注解。但如果想显式标注：

```ts
} catch (error) {
```

（不需要 `: any`，TS 4.4+ 默认 catch 类型是 `unknown`）

- [ ] **Step 7: 修复 L305 addHistoryEntry 参数**

**Before：**
```ts
addHistoryEntry: (entry: any) => Promise<void>
```

**After：**
```ts
addHistoryEntry: (entry: Omit<TranslationHistoryEntry, 'timestamp'>) => Promise<void>
```

- [ ] **Step 8: 验证**

```bash
pnpm run lint 2>&1 | grep "TranslationOrchestrator" | head -10
```

预期：无输出（无 lint 错误来自该文件）

- [ ] **Step 9: 提交**

```bash
git add src/services/TranslationOrchestrator.ts
git commit -m "refactor(types): 替换 TranslationOrchestrator 中的 any 类型为精确类型"
```

---

### Task 5: L3c - 修复 TranslationService.ts 中的 `any`

**Files:**
- Modify: `src/services/TranslationService.ts`

**当前 `any` 位置：**
- L98: `translations: Record<string, any>`
- L115: `let directResult: any;`
- L222: `result: Record<string, any>`

- [ ] **Step 1: 修复 L98 方法签名**

**Before：**
```ts
async translateBatch(
  texts: string[],
  signal?: AbortSignal,
  contextBefore = '',
  contextAfter = '',
  terms = ''
): Promise<{ translations: Record<string, any>; tokensUsed: number }> {
```

**After：**
```ts
async translateBatch(
  texts: string[],
  signal?: AbortSignal,
  contextBefore = '',
  contextAfter = '',
  terms = ''
): Promise<{ translations: Record<string, { direct: string }>; tokensUsed: number }> {
```

- [ ] **Step 2: 修复 L115 directResult 类型**

**Before：**
```ts
let directResult: any;
```

**After：**
```ts
let directResult: Record<string, { direct: string }>;
```

- [ ] **Step 3: 修复 L222 validateTranslationResult 签名**

**Before：**
```ts
private validateTranslationResult(
  result: Record<string, any>,
  originalTexts: string[]
): void {
```

**After：**
```ts
private validateTranslationResult(
  result: Record<string, { direct: string }>,
  originalTexts: string[]
): void {
```

- [ ] **Step 4: 检查并修复调用方类型冲突**

`subtitleStore.ts` 中 `translateBatch` 回调签名（搜索 `translateBatch:`）：
```ts
translateBatch: translationConfigStore.translateBatch,
```

`translationConfigStore.translateBatch` 也返回 `Record<string, any>`，需要在 Task 4-5 完成后一并修复。继续到 Step 5。

- [ ] **Step 5: 验证**

```bash
pnpm run lint 2>&1 | grep "TranslationService" | head -10
```

预期：无输出

- [ ] **Step 6: 提交**

```bash
git add src/services/TranslationService.ts
git commit -m "refactor(types): 替换 TranslationService 中的 any 类型"
```

---

### Task 6: L3d - 修复 SettingsModal 子组件中的 `any`

**Files:**
- Modify: `src/components/SettingsModal/ApiTestForm.tsx`
- Modify: `src/components/SettingsModal/TranslationSettings.tsx`

- [ ] **Step 1: 检查 ApiTestForm.tsx**

读取 `src/components/SettingsModal/ApiTestForm.tsx:1-20`

预期找到：
```ts
onConfigChange: (field: keyof TranslationConfig, value: any) => void;
```

- [ ] **Step 2: 修改 ApiTestForm.tsx**

需要 `value` 的精确类型。TranslationConfig 的字段类型有：`string | number | undefined` 等

**修改：**
```ts
onConfigChange: (field: keyof TranslationConfig, value: string | number | undefined) => void;
```

如果存在更具体的类型需求，查看 TranslationConfig 定义调整。

- [ ] **Step 3: 检查 TranslationSettings.tsx**

读取 `src/components/SettingsModal/TranslationSettings.tsx:1-20`

预期同样位置有 `value: any`

- [ ] **Step 4: 修改 TranslationSettings.tsx（同 ApiTestForm）**

- [ ] **Step 5: 验证**

```bash
pnpm run lint 2>&1 | grep "SettingsModal" | head -10
```

预期：无输出

- [ ] **Step 6: 提交**

```bash
git add src/components/SettingsModal/ApiTestForm.tsx src/components/SettingsModal/TranslationSettings.tsx
git commit -m "refactor(types): 替换 SettingsModal 子组件中的 any 类型"
```

---

### Task 7: L3e - 修复 convertToMP3.ts 中的 `as any`

**Files:**
- Modify: `src/utils/convertToMP3.ts`

- [ ] **Step 1: 读取 L12**

```ts
const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
```

- [ ] **Step 2: 替换为正确的类型断言**

**Before：**
```ts
const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
```

**After：**
```ts
type AudioContextCtor = typeof AudioContext;
interface AudioContextWindow {
  AudioContext: AudioContextCtor;
  webkitAudioContext: AudioContextCtor;
}
const w = window as unknown as AudioContextWindow;
const AudioContextCtor = w.AudioContext || w.webkitAudioContext;
const audioCtx = new AudioContextCtor();
```

- [ ] **Step 3: 验证**

```bash
pnpm run lint 2>&1 | grep "convertToMP3" | head -10
pnpm run build 2>&1 | tail -5
```

预期：lint 无错，build 成功

- [ ] **Step 4: 提交**

```bash
git add src/utils/convertToMP3.ts
git commit -m "refactor(types): 替换 convertToMP3 中的 as any 为精确类型"
```

---

### Task 8: L3f - 修复 subtitleStore.ts 中 migrate 函数的 `any`

**Files:**
- Modify: `src/stores/subtitleStore.ts`

- [ ] **Step 1: 读取 L1076 附近的 migrate 函数**

```ts
migrate: (persistedState: any, version: number) => {
  if (persistedState && typeof persistedState === 'object' && Array.isArray(persistedState.tasks)) {
    return persistedState as { tasks: SingleTask[] };
  }
  return { tasks: [] };
},
```

- [ ] **Step 2: 替换类型**

**Before：**
```ts
migrate: (persistedState: any, version: number) => {
```

**After：**
```ts
migrate: (persistedState: unknown, version: number) => {
  if (
    persistedState &&
    typeof persistedState === 'object' &&
    Array.isArray((persistedState as { tasks?: unknown }).tasks)
  ) {
    return persistedState as { tasks: SingleTask[] };
  }
  return { tasks: [] };
},
```

- [ ] **Step 3: 验证**

```bash
pnpm run lint 2>&1 | grep "subtitleStore" | head -10
pnpm run build 2>&1 | tail -5
```

预期：无 lint 错误，build 成功

- [ ] **Step 4: 提交**

```bash
git add src/stores/subtitleStore.ts
git commit -m "refactor(types): 替换 subtitleStore migrate 函数中的 any"
```

---

### Task 9: L3-final - 验证 lint 全部通过

- [ ] **Step 1: 运行完整 lint**

```bash
pnpm run lint 2>&1 | tee /tmp/lint-final.txt
```

- [ ] **Step 2: 检查无 `any` 错误**

```bash
grep -c "no-explicit-any" /tmp/lint-final.txt
```

预期：0（之前 Task 3 Step 4 记录的数字已减少到 0）

- [ ] **Step 3: 检查总体 lint 状态**

```bash
grep -E "✖|error|warning" /tmp/lint-final.txt | tail -20
```

预期：仅看到其他类型的警告或错误（不应包含 `no-explicit-any`）。如果有，记录到下一个任务

- [ ] **Step 4: 验证构建**

```bash
pnpm run build 2>&1 | tail -10
```

预期：构建成功

---

### Task 10: M2a - 删除 TranslationService 中 4 个空方法

**Files:**
- Modify: `src/services/TranslationService.ts`

**要删除的方法（L179-213）：**
- `updateProgress` (L179-189) - 空实现
- `resetProgress` (L195-197) - 空实现
- `completeTranslation` (L203-205) - 空实现
- `clearTask` (L211-213) - 空实现

- [ ] **Step 1: 读取 TranslationService.ts L170-220**

确认要删除的代码块

- [ ] **Step 2: 删除 4 个方法**

**删除以下 4 段代码：**

```ts
  /**
   * 更新翻译进度
   * 注意：phase 持久化已由 subtitleStore 的 persist 中间件自动处理，
   * 此方法仅保留接口兼容性。
   */
  async updateProgress(
    current: number,
    total: number,
    phase: 'direct' | 'splitting' | 'completed',
    status: string,
    taskId?: string,
    newTokens?: number
  ): Promise<void> {
    // subtitleStore.updatePhase 已通过 persist 中间件自动处理 localforage
    // 无需额外的 localforage 操作
  }

  /**
   * 重置翻译进度
   * 注意：phase 持久化已由 subtitleStore 的 persist 中间件自动处理
   */
  async resetProgress(): Promise<void> {
    // subtitleStore 的 persist 中间件自动处理持久化
  }

  /**
   * 完成翻译任务
   * 注意：phase 持久化已由 subtitleStore 的 persist 中间件自动处理
   */
  async completeTranslation(taskId: string): Promise<void> {
    // subtitleStore 的 persist 中间件自动处理持久化
  }

  /**
   * 清空当前任务
   * 注意：数据管理已由 subtitleStore 统一处理
   */
  async clearTask(): Promise<void> {
    // subtitleStore.clearAll 已处理所有数据清理
  }
```

- [ ] **Step 3: 验证**

```bash
pnpm run lint 2>&1 | grep "TranslationService" | head -5
pnpm run build 2>&1 | tail -5
```

预期：lint 无新错误（这些方法本就被 lint 识别为无副作用），build 成功

- [ ] **Step 4: 提交**

```bash
git add src/services/TranslationService.ts
git commit -m "refactor: 删除 TranslationService 中 4 个空实现方法"
```

---

### Task 11: M2b - 删除 useErrorHandler 中的 createSafeHandler 和 handleBatchErrors

**Files:**
- Modify: `src/hooks/useErrorHandler.ts`

**要删除的代码：**
- L204-212: `createSafeHandler` 函数
- L227-270: `handleBatchErrors` 函数
- return 语句中的引用（L274-276）

- [ ] **Step 1: 验证无外部使用**

```bash
grep -rn "createSafeHandler\|handleBatchErrors" /d/EggTranslate/src --include="*.ts" --include="*.tsx"
```

预期：仅在 `useErrorHandler.ts` 内部出现

- [ ] **Step 2: 删除 createSafeHandler**

**删除 L189-212：**
```ts
  /**
   * 创建带错误处理的异步函数
   *
   * @param asyncFn - 异步函数
   * @param options - 处理选项
   * @returns 包装后的函数
   *
   * @example
   * const safeTranslate = createSafeHandler(
   *   (file) => translateFile(file),
   *   { operation: '翻译文件' }
   * );
   * // 使用时无需 try-catch
   * await safeTranslate(file);
   */
  const createSafeHandler = useCallback(<T extends any[], R>(
    asyncFn: (...args: T) => Promise<R>,
    options: ErrorHandlerOptions = {}
  ) => {
    return async (...args: T): Promise<R | null> => {
      const result = await handleAsync(() => asyncFn(...args), options);
      return result.success ? result.data! : null;
    };
  }, [handleAsync]);
```

- [ ] **Step 3: 删除 handleBatchErrors**

**删除 L214-270：**
```ts
  /**
   * 批量错误处理
   *
   * @param errors - 错误数组
   * @param options - 处理选项
   *
   * @example
   * const errors = [error1, error2, error3];
   * handleBatchErrors(errors, {
   *   operation: '批量翻译',
   *   showToast: false // 只显示汇总
   * });
   */
  const handleBatchErrors = useCallback((
    errors: unknown[],
    options: ErrorHandlerOptions = {}
  ) => {
    // ... 整个函数体
  }, [logError]);
```

- [ ] **Step 4: 更新 return 语句**

**Before：**
```ts
  return {
    handleError,
    handleAsync,
    createSafeHandler,
    handleBatchErrors,
    isAbortError,
    toAppError,
    getUserMessage
  };
```

**After：**
```ts
  return {
    handleError,
    handleAsync,
    isAbortError,
    toAppError,
    getUserMessage
  };
```

- [ ] **Step 5: 验证**

```bash
pnpm run lint 2>&1 | grep "useErrorHandler" | head -5
pnpm run build 2>&1 | tail -5
```

预期：无错误

- [ ] **Step 6: 提交**

```bash
git add src/hooks/useErrorHandler.ts
git commit -m "refactor: 删除未使用的 createSafeHandler 和 handleBatchErrors"
```

---

### Task 12: M2c - 删除 App.tsx 中空的 onError 回调

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 读取 App.tsx L10-16**

预期看到：
```tsx
<ErrorBoundary
  onError={(error, errorInfo) => {
    // 错误已经被 ErrorBoundary 记录
  }}
>
```

- [ ] **Step 2: 删除 onError prop**

**Before：**
```tsx
    <ErrorBoundary
      onError={(error, errorInfo) => {
        // 错误已经被 ErrorBoundary 记录
      }}
    >
      <HistoryProvider>
```

**After：**
```tsx
    <ErrorBoundary>
      <HistoryProvider>
```

- [ ] **Step 3: 验证**

```bash
pnpm run lint 2>&1 | grep "App.tsx" | head -5
pnpm run build 2>&1 | tail -5
```

预期：无错误

- [ ] **Step 4: 提交**

```bash
git add src/App.tsx
git commit -m "refactor: 删除 App.tsx 中空的 onError 回调"
```

---

### Task 13: M3a - 删除 StepperProgress.tsx 中重复的 ALL_PHASES

**Files:**
- Modify: `src/components/SubtitleFileList/components/StepperProgress.tsx`

- [ ] **Step 1: 读取 L26**

预期看到：
```ts
const ALL_PHASES: ProgressPhase[] = ['converting', 'transcribing', 'translating', 'splitting'];
```

- [ ] **Step 2: 修改 import**

**Before：**
```ts
import type { ProgressPhase, PhaseProgress, FilePhases } from '@/types';
```

**After：**
```ts
import { ALL_PHASES, type ProgressPhase, type PhaseProgress, type FilePhases } from '@/types';
```

- [ ] **Step 3: 删除 L26 的本地定义**

**删除：**
```ts
const ALL_PHASES: ProgressPhase[] = ['converting', 'transcribing', 'translating', 'splitting'];
```

- [ ] **Step 4: 验证**

```bash
pnpm run lint 2>&1 | grep "StepperProgress" | head -5
pnpm run build 2>&1 | tail -5
```

预期：无错误

- [ ] **Step 5: 提交**

```bash
git add src/components/SubtitleFileList/components/StepperProgress.tsx
git commit -m "refactor: 删除 StepperProgress 中重复的 ALL_PHASES，使用 types 导出"
```

---

### Task 14: M3b - 删除 SubtitleFileList/index.tsx 中未使用的 formatTime

**Files:**
- Modify: `src/components/SubtitleFileList/index.tsx`

- [ ] **Step 1: 验证确实未使用**

```bash
grep -n "formatTime" /d/EggTranslate/src/components/SubtitleFileList/index.tsx
```

预期：仅在 L198 看到 `function formatTime(ms: number): string {`（无其他引用）

- [ ] **Step 2: 删除 L198-205**

**删除：**
```ts
function formatTime(ms: number): string {
  const date = new Date(ms);
  const hours = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  const milliseconds = String(date.getUTCMilliseconds()).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}
```

- [ ] **Step 3: 验证**

```bash
pnpm run lint 2>&1 | grep "SubtitleFileList/index" | head -5
pnpm run build 2>&1 | tail -5
```

预期：无错误

- [ ] **Step 4: 提交**

```bash
git add src/components/SubtitleFileList/index.tsx
git commit -m "refactor: 删除 SubtitleFileList 中未使用的 formatTime 函数"
```

---

### Task 15: M4 - 移除 package.json 中错误的 @types/react-router-dom

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 验证依赖**

```bash
grep "react-router-dom" /d/EggTranslate/package.json
```

预期：dependencies 中是 `"react-router-dom": "^6"`（运行时包），devDependencies 中是 `"@types/react-router-dom": "^5"`

- [ ] **Step 2: 删除 devDependency**

从 devDependencies 中删除 `@types/react-router-dom` 整行。

**Before：**
```json
"@types/react": "^18.3.12",
"@types/react-dom": "^18.3.1",
"@types/react-router-dom": "^5",
```

**After：**
```json
"@types/react": "^18.3.12",
"@types/react-dom": "^18.3.1",
```

**为什么：** `react-router-dom@6` 自带 TypeScript 类型，不需要单独的 `@types` 包

- [ ] **Step 3: 验证**

```bash
pnpm run build 2>&1 | tail -10
```

预期：构建成功，无类型错误（v6 类型正常工作）

- [ ] **Step 4: 提交**

```bash
git add package.json
git commit -m "fix(deps): 移除过时的 @types/react-router-dom@5（v6 自带类型）"
```

---

### Task 16: 最终验证

- [ ] **Step 1: 运行完整 lint**

```bash
pnpm run lint 2>&1 | tail -10
```

预期：除原有 `no-unused-vars` 等规则外，无 `no-explicit-any` 错误

- [ ] **Step 2: 运行完整构建**

```bash
pnpm run build 2>&1 | tail -20
```

预期：构建成功，分块后有多个 vendor 文件

- [ ] **Step 3: 检查 vendor 分块**

```bash
ls -la dist/assets/ | grep vendor
```

预期：至少 4-5 个 vendor-*.js 文件

- [ ] **Step 4: 检查 dist 大小**

```bash
du -sh dist/
```

记录本次构建大小

- [ ] **Step 5: 启动 dev server 验证可启动**

```bash
timeout 10 pnpm run dev 2>&1 | head -20
```

预期：dev server 正常启动（10s 后会被 timeout 杀掉，无关紧要）

- [ ] **Step 6: 总结**

阶段 1 全部完成。预期提交次数：~13 个 commits。

---

## 验证清单（执行后对照）

- [ ] `package.json` 不再有 `echo y | pnpm install` 前缀
- [ ] `vite.config.ts` 包含 `manualChunks` 函数
- [ ] `eslint.config.js` 中 `no-explicit-any` 为 `error`
- [ ] `pnpm run lint` 无 `no-explicit-any` 错误
- [ ] `pnpm run build` 成功
- [ ] `dist/assets/` 至少 4 个 vendor chunk
- [ ] TranslationService.ts 4 个空方法已删除
- [ ] useErrorHandler.ts 中无 `createSafeHandler` 和 `handleBatchErrors`
- [ ] App.tsx 中无 `onError` 回调
- [ ] StepperProgress.tsx 使用 `@/types` 的 `ALL_PHASES`
- [ ] SubtitleFileList/index.tsx 中无 `formatTime` 函数
- [ ] `package.json` 中无 `@types/react-router-dom`

---

## 风险与回滚

每一步都是独立 commit。如需回滚：

```bash
# 查看最近提交
git log --oneline -20

# 回滚单个 commit
git revert <commit-hash>

# 或回滚到阶段 1 之前
git reset --hard <阶段1开始前的commit>
```
