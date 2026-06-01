# 阶段 2：状态管理瘦身 - 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 Context/Store 双重状态、删除 `TranslationService` 单例、统一持久化路径（全部 zustand/persist），使状态管理成为单一可信数据源。

**Architecture:**
- 删除两个 Context 文件，直接使用 zustand store
- 把 `getRelevantTerms` / `formatTermsForPrompt` 等纯函数提取到 `utils/`，让 store 和组件共享
- 把 `TranslationService` 类的 `translateBatch` / `testConnection` 等方法内联到 `translationConfigStore`
- 三个 store 改用 zustand/persist 中间件统一持久化
- **每步独立提交、独立可回滚**

**Tech Stack:** Zustand 5, React 18, TypeScript 5.6, zustand/middleware/persist, localforage

**预计工作量：** 3-5 天

**前置依赖：** 阶段 1 全部完成（特别是 L3 修了 any 类型，H4 才不会被任何 类型错误干扰）

---

## 文件清单

### 删除的文件
| 文件 | 任务 | 原因 |
|------|------|------|
| `src/contexts/TermsContext.tsx` | H4c | 与 TermsStore 重复 |
| `src/contexts/HistoryContext.tsx` | H4f | 与 HistoryStore 重复 |
| `src/services/TranslationService.ts` | H5b | 已被 store 替代 |

### 新建的文件
| 文件 | 任务 | 内容 |
|------|------|------|
| `src/utils/termsHelpers.ts` | H4a | `getRelevantTerms` + `formatTermsForPrompt` + `cleanText` |
| `src/utils/historyHelpers.ts` | H4d | `loadHistoryEntry` + `getHistoryStats` |

### 修改的文件
| 文件 | 任务 | 改动 |
|------|------|------|
| `src/stores/subtitleStore.ts` | H4a | 引用 `termsHelpers.getRelevantTerms` 而非内部实现 |
| `src/components/TermsManager.tsx` | H4b | 改用 `useTermsStore` 而非 `useTerms` |
| `src/components/MainApp.tsx` | H4b | 改用 `useTermsStore` 和 `useHistoryStore` |
| `src/components/TranslationControls.tsx` | H4b | 改用 `useTermsStore` 和 `useHistoryStore` |
| `src/components/HistoryModal.tsx` | H4e | 改用 `useHistoryStore` |
| `src/App.tsx` | H4c, H4f | 删除 `<HistoryProvider>` `<TermsProvider>` |
| `src/main.tsx` | M5a, M5b | 删除 `loadTerms` / `loadHistory` 显式调用 |
| `src/stores/translationConfigStore.ts` | H5a | 合并 `translateBatch` / `testConnection` 等逻辑 |
| `src/stores/termsStore.ts` | M5a | 改用 zustand/persist |
| `src/stores/historyStore.ts` | M5b | 改用 zustand/persist |
| `src/stores/transcriptionStore.ts` | M5c | 删除 `updateKeytermGroups` 中冗余的 localforage 写入 |

---

## 任务列表

### Task 1: H4a - 创建 termsHelpers.ts 并更新 subtitleStore

**Files:**
- Create: `src/utils/termsHelpers.ts`
- Modify: `src/stores/subtitleStore.ts:631-654`

**目的：** 提取 `getRelevantTerms` / `formatTermsForPrompt` / `cleanText` 到 utils，让 Context 和 Store 共享。

- [ ] **Step 1: 读取 subtitleStore.ts L631-654 确认当前实现**

读取以确认两份实现的差异：
- subtitleStore 版本: 参数都是必填，返回类型 `Term[]`
- TermsContext 版本: 参数可选，函数相同

两份实现的功能和清理逻辑**应当相同**。

- [ ] **Step 2: 创建新文件 `src/utils/termsHelpers.ts`**

```ts
/**
 * 术语相关工具函数
 * 提供术语匹配、清理、格式化等纯函数
 */

import type { Term } from '@/types';

/**
 * 清洗文本，移除所有空格和符号，转为小写
 */
export function cleanText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * 从术语列表中筛选出与给定文本相关的术语
 * @param terms 术语列表
 * @param text 主文本
 * @param contextBefore 前文上下文
 * @param contextAfter 后文上下文
 * @returns 匹配到的术语（不含内部 cleanedOriginal 字段）
 */
export function getRelevantTerms(
  terms: Term[],
  text: string,
  contextBefore: string = '',
  contextAfter: string = ''
): Term[] {
  if (terms.length === 0) return [];

  const fullText = `${contextBefore} ${text} ${contextAfter}`;
  const cleanedFullText = cleanText(fullText);

  const processedTerms = terms.map(term => ({
    ...term,
    cleanedOriginal: cleanText(term.original)
  }));

  return processedTerms
    .filter(term => term.cleanedOriginal && cleanedFullText.includes(term.cleanedOriginal))
    .map(({ original, translation, notes }) => ({ original, translation, notes }));
}

/**
 * 格式化术语为 LLM prompt 格式
 * 有 notes: "原文 -> 译文 // notes"
 * 无 notes: "原文 -> 译文"
 */
export function formatTermsForPrompt(terms: Term[]): string {
  return terms.map(term => {
    if (term.notes) {
      return `${term.original} -> ${term.translation} // ${term.notes}`;
    }
    return `${term.original} -> ${term.translation}`;
  }).join('\n');
}
```

- [ ] **Step 3: 修改 subtitleStore.ts**

**3a.** 在文件顶部添加 import（与其他 import 一起）：

```ts
import { getRelevantTerms, formatTermsForPrompt } from '@/utils/termsHelpers';
```

**3b.** 修改 L631-654 的 callbacks 实现：

**Before：**
```ts
getRelevantTerms: (batchText: string, before: string, after: string): Term[] => {
  const allTerms = useTermsStore.getState().terms;
  if (allTerms.length === 0) return [];

  const fullText = `${before} ${batchText} ${after}`;
  const cleanedFullText = fullText.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

  const processedTerms = allTerms.map((term: Term) => ({
    ...term,
    cleanedOriginal: term.original.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  }));

  return processedTerms
    .filter(term => term.cleanedOriginal && cleanedFullText.includes(term.cleanedOriginal))
    .map(({ original, translation, notes }) => ({ original, translation, notes }));
},
formatTermsForPrompt: (terms: Term[]): string => {
  return terms.map(term => {
    if (term.notes) {
      return `${term.original} -> ${term.translation} // ${term.notes}`;
    }
    return `${term.original} -> ${term.translation}`;
  }).join('\n');
}
```

**After：**
```ts
getRelevantTerms: (batchText: string, before: string, after: string): Term[] => {
  const allTerms = useTermsStore.getState().terms;
  return getRelevantTermsUtil(allTerms, batchText, before, after);
},
formatTermsForPrompt: (terms: Term[]): string => formatTermsForPromptUtil(terms)
```

**注意：** 这里有命名冲突。`getRelevantTerms` 是 callback 字段名，工具函数也叫 `getRelevantTerms`。重命名 import：

**3c.** 修正 import 别名：

```ts
import {
  getRelevantTerms as getRelevantTermsUtil,
  formatTermsForPrompt as formatTermsForPromptUtil
} from '@/utils/termsHelpers';
```

- [ ] **Step 4: 验证**

```bash
pnpm run lint 2>&1 | grep -E "subtitleStore|termsHelpers" | head -10
pnpm run build 2>&1 | tail -5
```

预期：无错误

- [ ] **Step 5: 提交**

```bash
git add src/utils/termsHelpers.ts src/stores/subtitleStore.ts
git commit -m "refactor: 提取 getRelevantTerms/formatTermsForPrompt 到 utils/termsHelpers"
```

---

### Task 2: H4b - 转换 TermsContext 消费者到 useTermsStore

**Files:**
- Modify: `src/components/TermsManager.tsx`
- Modify: `src/components/MainApp.tsx`
- Modify: `src/components/TranslationControls.tsx`

- [ ] **Step 1: 读取 TermsContext.tsx 完整内容**

回顾 L60-220 的 Context 实现。Context 暴露的方法：
- `terms` (state)
- `addTerm(original, translation, notes?)`
- `removeTerm(index)`
- `updateTerm(index, original, translation, notes?)`
- `clearTerms()`
- `importTerms(text)`
- `exportTerms()` (sync, returns string)
- `getRelevantTerms(...)` (从 utils 取)
- `formatTermsForPrompt(...)` (从 utils 取)

- [ ] **Step 2: 修改 TermsManager.tsx**

**Before：**
```ts
import { useTerms } from '@/contexts/TermsContext';
...
export const TermsManager: React.FC<...> = ({ isOpen, onClose }) => {
  const {
    terms,
    addTerm,
    removeTerm,
    updateTerm,
    clearTerms,
    importTerms,
    exportTerms
  } = useTerms();
```

**After：**
```ts
import { useTermsStore } from '@/stores/termsStore';
import { getRelevantTerms as getRelevantTermsUtil, formatTermsForPrompt } from '@/utils/termsHelpers';
...
export const TermsManager: React.FC<...> = ({ isOpen, onClose }) => {
  const terms = useTermsStore((state) => state.terms);
  const addTerm = useTermsStore((state) => state.addTerm);
  const removeTerm = useTermsStore((state) => state.deleteTerm);
  const updateTerm = useTermsStore((state) => state.updateTerm);
  const clearTerms = useTermsStore((state) => state.clearTerms);
  const saveTerms = useTermsStore((state) => state.saveTerms);

  // 派生方法（之前由 Context 提供）
  const importTerms = useCallback(async (termsText: string) => {
    const lines = termsText.split('\n').filter(line => line.trim());
    const newTerms: Term[] = [];
    const lineRegex = /^(.+?):\s*(.+?)(?:\s*\[(.+)\])?$/;

    for (const line of lines) {
      const match = line.match(lineRegex);
      if (match) {
        newTerms.push({
          original: match[1].trim(),
          translation: match[2].trim(),
          notes: match[3]?.trim()
        });
      }
    }

    await saveTerms(newTerms);
    toast.success('术语导入成功');
  }, [saveTerms]);

  const exportTerms = useCallback(() => {
    return terms.map(term => {
      if (term.notes) {
        return `${term.original}: ${term.translation} [${term.notes}]`;
      }
      return `${term.original}: ${term.translation}`;
    }).join('\n');
  }, [terms]);

  // getRelevantTerms / formatTermsForPrompt 来自 utils
  const getRelevantTerms = (text: string, before?: string, after?: string) =>
    getRelevantTermsUtil(terms, text, before, after);
```

**注意：**
- `deleteTerm` 在 store 中叫 `deleteTerm`，与 Context 中的 `removeTerm` 行为一致
- `saveTerms` 用于 `importTerms` 替换全量术语
- 不再需要 `isLoading` 和 `error` 状态字段

- [ ] **Step 3: 添加 Term 类型 import**

```ts
import type { Term } from '@/types';
```

- [ ] **Step 4: 修改 MainApp.tsx**

**Before：**
```ts
import { useHistory } from '@/contexts/HistoryContext';
import { useTerms } from '@/contexts/TermsContext';
...
const { history } = useHistory();
const { terms } = useTerms();
```

**After：**
```ts
import { useHistoryStore } from '@/stores/historyStore';
import { useTermsStore } from '@/stores/termsStore';
...
const history = useHistoryStore((state) => state.history);
const terms = useTermsStore((state) => state.terms);
```

- [ ] **Step 5: 修改 TranslationControls.tsx**

**Before：**
```ts
import { useTerms } from '@/contexts/TermsContext';
import { useHistory } from '@/contexts/HistoryContext';
...
const { getRelevantTerms, formatTermsForPrompt } = useTerms();
const { addHistoryEntry } = useHistory();
```

**After：**
```ts
import { useTermsStore } from '@/stores/termsStore';
import { useHistoryStore } from '@/stores/historyStore';
import { getRelevantTerms, formatTermsForPrompt } from '@/utils/termsHelpers';
...
const terms = useTermsStore((state) => state.terms);
const addHistory = useHistoryStore((state) => state.addHistory);
```

- [ ] **Step 6: 检查 `getRelevantTerms` 在 TranslationControls 的使用**

读取 TranslationControls.tsx 找到 `getRelevantTerms` 的调用点，传入 `terms` 参数：

```ts
const relevantTerms = getRelevantTerms(terms, batchText, contextBefore, contextAfter);
```

（之前是 `getRelevantTerms(batchText, contextBefore, contextAfter)`，现在 utils 版本需要 `terms` 作为第一参数）

- [ ] **Step 7: 检查 `addHistoryEntry` 的使用**

读取 TranslationControls.tsx 找到 `addHistoryEntry` 的调用点，改为 `addHistory`：

```ts
await addHistory({ ... });
```

`addHistory` 接受 `Omit<TranslationHistoryEntry, 'timestamp'>`（store 内部加 timestamp）

- [ ] **Step 8: 验证**

```bash
pnpm run lint 2>&1 | grep -E "TermsManager|MainApp|TranslationControls" | head -10
pnpm run build 2>&1 | tail -5
```

预期：无错误

- [ ] **Step 9: 提交**

```bash
git add src/components/TermsManager.tsx src/components/MainApp.tsx src/components/TranslationControls.tsx
git commit -m "refactor: 移除 TermsContext/HistoryContext 依赖，组件改用 zustand store"
```

---

### Task 3: H4c - 删除 TermsContext.tsx 和相关 Provider

**Files:**
- Modify: `src/App.tsx`
- Delete: `src/contexts/TermsContext.tsx`

- [ ] **Step 1: 验证无 TermsContext 引用**

```bash
grep -rn "TermsContext" /d/EggTranslate/src --include="*.ts" --include="*.tsx"
```

预期：仅在 `App.tsx` 中找到 `TermsProvider` 和 `termsStore` 等无关引用

- [ ] **Step 2: 修改 App.tsx**

**Before：**
```ts
import { TermsProvider } from '@/contexts/TermsContext';
import { HistoryProvider } from '@/contexts/HistoryContext';
...
<HistoryProvider>
  <TermsProvider>
    <MainApp />
    ...
  </TermsProvider>
</HistoryProvider>
```

**After（仅修改本 Task 范围）：**
```ts
import { HistoryProvider } from '@/contexts/HistoryContext';
...
<HistoryProvider>
  <MainApp />
  ...
</HistoryProvider>
```

**注意：** 此 Task 暂保留 HistoryProvider，下个 Task 再处理

- [ ] **Step 3: 删除 TermsContext.tsx**

```bash
git rm src/contexts/TermsContext.tsx
```

- [ ] **Step 4: 验证**

```bash
pnpm run lint 2>&1 | grep -E "TermsContext|TermsProvider" | head -10
pnpm run build 2>&1 | tail -5
```

预期：无错误（仅 HistoryContext 仍存在）

- [ ] **Step 5: 提交**

```bash
git add -A src/App.tsx src/contexts/TermsContext.tsx
git commit -m "refactor: 删除 TermsContext.tsx，直接使用 TermsStore"
```

---

### Task 4: H4d - 创建 historyHelpers.ts

**Files:**
- Create: `src/utils/historyHelpers.ts`

- [ ] **Step 1: 创建文件**

```ts
/**
 * 翻译历史相关工具函数
 * 提供历史记录查询、统计等纯函数
 */

import type { TranslationHistoryEntry } from '@/types';

export interface HistoryStats {
  total: number;
  totalTokens: number;
}

/**
 * 根据 taskId 查找历史记录
 * O(n) 查找，如果频繁使用请在外层建立 Map 索引
 */
export function findHistoryEntry(
  history: TranslationHistoryEntry[],
  taskId: string
): TranslationHistoryEntry | null {
  return history.find(e => e.taskId === taskId) ?? null;
}

/**
 * 计算历史记录统计信息
 */
export function calculateHistoryStats(history: TranslationHistoryEntry[]): HistoryStats {
  return {
    total: history.length,
    totalTokens: history.reduce((sum, e) => sum + e.totalTokens, 0)
  };
}
```

- [ ] **Step 2: 提交**

```bash
git add src/utils/historyHelpers.ts
git commit -m "feat: 添加 historyHelpers 工具函数"
```

---

### Task 5: H4e - 转换 HistoryContext 消费者

**Files:**
- Modify: `src/components/HistoryModal.tsx`
- Modify: `src/components/TranslationControls.tsx`

- [ ] **Step 1: 修改 HistoryModal.tsx**

**Before：**
```ts
import { useHistory } from '@/contexts/HistoryContext';
...
const {
  history,
  deleteHistoryEntry,
  clearHistory,
  getHistoryStats
} = useHistory();
...
const stats = getHistoryStats();
```

**After：**
```ts
import { useHistoryStore } from '@/stores/historyStore';
import { calculateHistoryStats } from '@/utils/historyHelpers';
...
const history = useHistoryStore((state) => state.history);
const deleteHistory = useHistoryStore((state) => state.removeHistory);
const clearHistory = useHistoryStore((state) => state.clearHistory);
...
const stats = calculateHistoryStats(history);
```

注意：Context 中 `deleteHistoryEntry` 对应 store 中 `removeHistory`

- [ ] **Step 2: 检查 HistoryModal 中其他 Context 方法**

读取 HistoryModal.tsx 完整内容，寻找 `loadHistoryEntry` 等其他引用。改为 `findHistoryEntry(history, taskId)`（来自 utils）

- [ ] **Step 3: 验证**

```bash
pnpm run lint 2>&1 | grep "HistoryModal" | head -10
pnpm run build 2>&1 | tail -5
```

预期：无错误

- [ ] **Step 4: 提交**

```bash
git add src/components/HistoryModal.tsx
git commit -m "refactor: HistoryModal 改用 useHistoryStore + historyHelpers"
```

---

### Task 6: H4f - 删除 HistoryContext.tsx 和相关 Provider

**Files:**
- Modify: `src/App.tsx`
- Delete: `src/contexts/HistoryContext.tsx`

- [ ] **Step 1: 验证无 HistoryContext 引用**

```bash
grep -rn "HistoryContext" /d/EggTranslate/src --include="*.ts" --include="*.tsx"
```

预期：仅在 `App.tsx` 中找到 `HistoryProvider` 引用

- [ ] **Step 2: 修改 App.tsx**

**Before：**
```ts
import { HistoryProvider } from '@/contexts/HistoryContext';
...
<ErrorBoundary>
  <HistoryProvider>
    <TermsProvider>  // 上一 Task 已删除
      <MainApp />
      <Toaster ... />
    </TermsProvider>
  </HistoryProvider>
</ErrorBoundary>
```

**After：**
```ts
<ErrorBoundary>
  <MainApp />
  <Toaster ... />
</ErrorBoundary>
```

同时删除 `import { HistoryProvider }` 和 `import { TermsProvider }`（如果还在）

- [ ] **Step 3: 删除 HistoryContext.tsx**

```bash
git rm src/contexts/HistoryContext.tsx
```

- [ ] **Step 4: 验证**

```bash
pnpm run lint 2>&1 | grep -E "HistoryContext|HistoryProvider" | head -10
pnpm run build 2>&1 | tail -5
```

预期：无错误

- [ ] **Step 5: 检查 contexts 目录**

```bash
ls /d/EggTranslate/src/contexts/
```

预期：目录为空（可以保留也可以删除）。建议保留以备未来使用。

- [ ] **Step 6: 提交**

```bash
git add -A src/App.tsx src/contexts/HistoryContext.tsx
git commit -m "refactor: 删除 HistoryContext.tsx，直接使用 HistoryStore"
```

---

### Task 7: H5a - 把 translateBatch 和 testConnection 合并到 translationConfigStore

**Files:**
- Modify: `src/stores/translationConfigStore.ts`

**目的：** 把 `TranslationService` 中真正有用的逻辑（`translateBatch` / `testConnection` / 调 LLM 的工具）搬到 store。

- [ ] **Step 1: 读取 TranslationService.ts L60-90 了解 testConnection 实现**

```ts
async testConnection(): Promise<boolean> {
  if (!this.config.apiKey) {
    throw new Error('请先配置API密钥');
  }

  try {
    await callLLM(
      { baseURL: this.config.baseURL, apiKey: this.config.apiKey, model: this.config.model },
      [{ role: 'user', content: 'Hello' }],
      { maxRetries: 1 }
    );
    return true;
  } catch (error) {
    const appError = toAppError(error, '连接测试失败');
    console.error('[TranslationService]', appError.message, appError);
    throw appError;
  }
}
```

- [ ] **Step 2: 读取 TranslationService.ts L90-172 了解 translateBatch 实现**

包含重试逻辑、jsonrepair、validateTranslationResult

- [ ] **Step 3: 修改 translationConfigStore.ts**

**3a.** 添加 imports：

```ts
import { callLLM } from '@/utils/llmApi';
import { jsonrepair } from 'jsonrepair';
import { generateSharedPrompt, generateDirectPrompt } from '@/utils/translationPrompts';
```

**3b.** 把 `testConnection` action 改为内联实现：

**Before：**
```ts
testConnection: async () => {
  try {
    const result = await translationService.testConnection();
    if (result) {
      toast.success('连接测试成功！');
    } else {
      toast.error('连接测试失败');
    }
    return result;
  } catch (error) {
    const appError = toAppError(error, '连接测试失败');
    console.error('[translationConfigStore]', appError.message, appError);
    toast.error(`连接测试失败: ${appError.message}`);
    return false;
  }
},
```

**After：**
```ts
testConnection: async () => {
  const config = get().config;
  if (!config.apiKey) {
    toast.error('请先配置API密钥');
    return false;
  }
  try {
    await callLLM(
      { baseURL: config.baseURL, apiKey: config.apiKey, model: config.model },
      [{ role: 'user', content: 'Hello' }],
      { maxRetries: 1 }
    );
    toast.success('连接测试成功！');
    return true;
  } catch (error) {
    const appError = toAppError(error, '连接测试失败');
    console.error('[translationConfigStore]', appError.message, appError);
    toast.error(`连接测试失败: ${appError.message}`);
    return false;
  }
},
```

**3c.** 把 `translateBatch` 改为内联实现（直接调用 callLLM）：

**Before：**
```ts
translateBatch: async (
  texts: string[],
  signal?: AbortSignal,
  contextBefore = '',
  contextAfter = '',
  terms = ''
) => {
  // 同步配置到 TranslationService（确保单例的 config 是最新的）
  const currentConfig = get().config;
  const serviceConfig = translationService.getConfig();

  // 只在配置不同时才更新（避免不必要的写入）
  if (serviceConfig.apiKey !== currentConfig.apiKey ||
      serviceConfig.baseURL !== currentConfig.baseURL ||
      serviceConfig.model !== currentConfig.model) {
    await translationService.updateConfig(currentConfig);
  }

  return translationService.translateBatch(texts, signal, contextBefore, contextAfter, terms);
},
```

**After：**
```ts
translateBatch: async (
  texts: string[],
  signal?: AbortSignal,
  contextBefore = '',
  contextAfter = '',
  terms = ''
) => {
  const config = get().config;
  if (!config.apiKey) {
    throw new Error('请先配置API密钥');
  }

  const textToTranslate = texts.join('\n');
  const sharedPrompt = generateSharedPrompt(contextBefore, contextAfter, terms);
  const directPrompt = generateDirectPrompt(
    textToTranslate,
    sharedPrompt,
    config.sourceLanguage,
    config.targetLanguage
  );

  // 重试策略：逐次提高温度 + 强调格式要求
  const retryTemperatures = [0.3, 0.6, 0.9];
  const formatEmphasis = [
    '',
    '\n\nIMPORTANT: Ensure your response is valid JSON with "direct" field for EVERY entry.',
    '\n\nCRITICAL: You MUST return valid JSON with "direct" field for EVERY single line. Do NOT skip any entries.'
  ];

  for (let attempt = 1; attempt <= 3; attempt++) {
    const promptWithEmphasis = directPrompt + formatEmphasis[attempt - 1];

    const llmResult = await callLLM(
      {
        baseURL: config.baseURL,
        apiKey: config.apiKey,
        model: config.model,
        rpm: config.rpm
      },
      [{ role: 'user', content: promptWithEmphasis }],
      {
        signal,
        temperature: retryTemperatures[attempt - 1],
        maxRetries: 1
      }
    );

    const directContent = llmResult.content;
    const directTokensUsed = llmResult.tokensUsed;
    const repairedDirectJson = jsonrepair(directContent);
    const directResult: Record<string, { direct: string }> = JSON.parse(repairedDirectJson);

    try {
      validateTranslationResult(directResult, texts);
      return { translations: directResult, tokensUsed: directTokensUsed };
    } catch (error) {
      console.error(`[translationConfigStore] 批次翻译失败（第${attempt}次尝试）:`, error);
      if (attempt === 3) throw error;
    }
  }
  throw new Error('翻译失败');
},
```

**3d.** 在 store 文件底部添加 `validateTranslationResult` 私有函数：

```ts
function validateTranslationResult(
  result: Record<string, { direct: string }>,
  originalTexts: string[]
): void {
  const expectedKeys = originalTexts.map((_, i) => String(i + 1));
  const actualKeys = Object.keys(result);

  for (const key of expectedKeys) {
    if (!actualKeys.includes(key)) {
      throw new Error(`翻译结果缺少键 "${key}"`);
    }
    const entry = result[key];
    if (!entry || typeof entry !== 'object' || !('direct' in entry)) {
      throw new Error(`翻译结果 "${key}" 格式无效`);
    }
  }
}
```

**3e.** 删除 `import translationService from '@/services/TranslationService';`（如果还有引用）

- [ ] **Step 4: 验证**

```bash
pnpm run lint 2>&1 | grep "translationConfigStore" | head -10
pnpm run build 2>&1 | tail -5
```

预期：无错误

- [ ] **Step 5: 提交**

```bash
git add src/stores/translationConfigStore.ts
git commit -m "refactor: 把 translateBatch/testConnection 逻辑从 TranslationService 合并到 store"
```

---

### Task 8: H5b - 删除 TranslationService.ts

**Files:**
- Modify: `src/stores/translationConfigStore.ts` (清理残留 import)
- Delete: `src/services/TranslationService.ts`

- [ ] **Step 1: 验证无外部引用**

```bash
grep -rn "TranslationService" /d/EggTranslate/src --include="*.ts" --include="*.tsx"
```

预期：仅在 `translationConfigStore.ts` 中。如果还有，修复。

- [ ] **Step 2: 检查 translationConfigStore.ts 残留**

```bash
grep -n "translationService" /d/EggTranslate/src/stores/translationConfigStore.ts
```

预期：无输出

- [ ] **Step 3: 删除文件**

```bash
git rm src/services/TranslationService.ts
```

- [ ] **Step 4: 验证**

```bash
pnpm run lint 2>&1 | grep -E "TranslationService" | head -5
pnpm run build 2>&1 | tail -5
```

预期：无错误

- [ ] **Step 5: 提交**

```bash
git add -A src/services/TranslationService.ts
git commit -m "refactor: 删除 TranslationService 单例"
```

---

### Task 9: M5a - 转换 termsStore 为 zustand/persist

**Files:**
- Modify: `src/stores/termsStore.ts`
- Modify: `src/main.tsx`

- [ ] **Step 1: 读取当前 termsStore.ts**

确认当前实现（已在前面读过）：
- 状态：`terms: Term[]`
- actions: `loadTerms`, `addTerm`, `updateTerm`, `deleteTerm`, `saveTerms`, `clearTerms`
- 全部手写 `localforage.getItem/setItem('terms_list', ...)`

- [ ] **Step 2: 重写 termsStore.ts**

```ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Term } from '@/types';
import localforage from 'localforage';

interface TermsState {
  terms: Term[];
  addTerm: (term: Term) => Promise<void>;
  updateTerm: (index: number, term: Term) => Promise<void>;
  deleteTerm: (index: number) => Promise<void>;
  saveTerms: (terms: Term[]) => Promise<void>;
  clearTerms: () => Promise<void>;
}

export const useTermsStore = create<TermsState>()(
  persist(
    (set, get) => ({
      terms: [],

      addTerm: async (term) => {
        set({ terms: [...get().terms, term] });
      },

      updateTerm: async (index, term) => {
        const newTerms = [...get().terms];
        newTerms[index] = term;
        set({ terms: newTerms });
      },

      deleteTerm: async (index) => {
        set({ terms: get().terms.filter((_, i) => i !== index) });
      },

      saveTerms: async (terms) => {
        set({ terms });
      },

      clearTerms: async () => {
        set({ terms: [] });
      },
    }),
    {
      name: 'terms_list',
      storage: createJSONStorage(() => localforage),
      version: 1,
      // 迁移：旧格式是 Term[] 直接存储，新格式是 {state: {terms: Term[]}}
      migrate: (persistedState: unknown, version: number) => {
        if (version === 0 && Array.isArray(persistedState)) {
          return { terms: persistedState as Term[] };
        }
        if (persistedState && typeof persistedState === 'object' && 'terms' in persistedState) {
          return persistedState as { terms: Term[] };
        }
        return { terms: [] };
      },
    }
  )
);
```

**注意：**
- 删除了 `loadTerms` action（persist 中间件自动加载）
- actions 现在是同步的（`set` 是同步的），但保留 `async` 以兼容调用方
- 添加 `version: 1` 和 `migrate` 函数，兼容旧格式 `Term[]`（之前的代码直接 `localforage.setItem('terms_list', terms)`）

- [ ] **Step 3: 修改 main.tsx 删除 loadTerms 调用**

读取 `src/main.tsx` 当前内容：

```ts
async function initializeApp() {
  await Promise.all([
    useTermsStore.getState().loadTerms(),
    useHistoryStore.getState().loadHistory(),
  ]);
}
```

**After（删除 useTermsStore.loadTerms）：**
```ts
async function initializeApp() {
  // zustand/persist 中间件自动加载 terms 和 history
  // 此函数保留以便未来添加其他初始化逻辑
  await Promise.resolve();
}
```

- [ ] **Step 4: 验证 build 不会破坏**

`loadTerms` 在 TermsContext 中曾被调用（已被 Task 3 删除）。检查其他位置：

```bash
grep -rn "loadTerms" /d/EggTranslate/src --include="*.ts" --include="*.tsx"
```

预期：无输出

- [ ] **Step 5: 验证**

```bash
pnpm run lint 2>&1 | grep -E "termsStore|main.tsx" | head -5
pnpm run build 2>&1 | tail -5
```

预期：无错误

- [ ] **Step 6: 提交**

```bash
git add src/stores/termsStore.ts src/main.tsx
git commit -m "refactor(persist): termsStore 改用 zustand/persist 中间件"
```

---

### Task 10: M5b - 转换 historyStore 为 zustand/persist

**Files:**
- Modify: `src/stores/historyStore.ts`
- Modify: `src/main.tsx`

- [ ] **Step 1: 读取当前 historyStore.ts**

当前实现手写 `localforage.getItem/setItem('translation_history', ...)`

- [ ] **Step 2: 重写 historyStore.ts**

```ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { TranslationHistoryEntry } from '@/types';
import localforage from 'localforage';

interface HistoryState {
  history: TranslationHistoryEntry[];
  addHistory: (entry: Omit<TranslationHistoryEntry, 'timestamp'>) => Promise<void>;
  removeHistory: (taskId: string) => Promise<void>;
  clearHistory: () => Promise<void>;
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      history: [],

      addHistory: async (entry) => {
        const fullEntry: TranslationHistoryEntry = { ...entry, timestamp: Date.now() };
        set({ history: [fullEntry, ...get().history] });
      },

      removeHistory: async (taskId) => {
        set({ history: get().history.filter((e) => e.taskId !== taskId) });
      },

      clearHistory: async () => {
        set({ history: [] });
      },
    }),
    {
      name: 'translation_history',
      storage: createJSONStorage(() => localforage),
      version: 1,
      // 迁移：旧格式是 TranslationHistoryEntry[]，新格式是 {state: {history: [...]}}
      migrate: (persistedState: unknown, version: number) => {
        if (version === 0 && Array.isArray(persistedState)) {
          return { history: persistedState as TranslationHistoryEntry[] };
        }
        if (persistedState && typeof persistedState === 'object' && 'history' in persistedState) {
          return persistedState as { history: TranslationHistoryEntry[] };
        }
        return { history: [] };
      },
    }
  )
);
```

- [ ] **Step 3: 修改 main.tsx 删除 loadHistory 调用**

main.tsx 已在上个 Task 调整。如果还残留 `loadHistory`：

**Before：**
```ts
async function initializeApp() {
  await Promise.all([
    useTermsStore.getState().loadTerms(),
    useHistoryStore.getState().loadHistory(),
  ]);
}
```

**After：**
```ts
// zustand/persist 中间件自动加载，initializeApp 保留为未来扩展
async function initializeApp() {
  await Promise.resolve();
}
```

- [ ] **Step 4: 验证 build 不破坏**

```bash
grep -rn "loadHistory" /d/EggTranslate/src --include="*.ts" --include="*.tsx"
```

预期：无输出

- [ ] **Step 5: 验证**

```bash
pnpm run lint 2>&1 | grep "historyStore" | head -5
pnpm run build 2>&1 | tail -5
```

预期：无错误

- [ ] **Step 6: 提交**

```bash
git add src/stores/historyStore.ts src/main.tsx
git commit -m "refactor(persist): historyStore 改用 zustand/persist 中间件"
```

---

### Task 11: M5c - 删除 transcriptionStore 中冗余的 localforage 写入

**Files:**
- Modify: `src/stores/transcriptionStore.ts`

- [ ] **Step 1: 读取 L37-40**

```ts
updateKeytermGroups: async (groups) => {
  set({ keytermGroups: groups });
  await localforage.setItem('transcription_config', { keytermGroups: groups });
},
```

- [ ] **Step 2: 删除 manual localforage.setItem**

**Before：**
```ts
updateKeytermGroups: async (groups) => {
  set({ keytermGroups: groups });
  await localforage.setItem('transcription_config', { keytermGroups: groups });
},
```

**After：**
```ts
updateKeytermGroups: async (groups) => {
  set({ keytermGroups: groups });
  // zustand/persist 中间件已自动持久化到 'transcription-storage'
},
```

- [ ] **Step 3: 删除未使用的 import**

```ts
import localforage from 'localforage';
```

如果 `localforage` 不再被此文件其他位置使用，删除该 import。

```bash
grep -n "localforage" /d/EggTranslate/src/stores/transcriptionStore.ts
```

如果仅在 updateKeytermGroups 中使用，删除 import。

- [ ] **Step 4: 验证**

```bash
pnpm run lint 2>&1 | grep "transcriptionStore" | head -5
pnpm run build 2>&1 | tail -5
```

预期：无错误

- [ ] **Step 5: 提交**

```bash
git add src/stores/transcriptionStore.ts
git commit -m "refactor(persist): 删除 transcriptionStore 中冗余的 localforage 写入"
```

---

### Task 12: 最终验证

- [ ] **Step 1: 完整 lint**

```bash
pnpm run lint 2>&1 | tail -10
```

预期：无错误（或仅原有非关键警告）

- [ ] **Step 2: 完整 build**

```bash
pnpm run build 2>&1 | tail -15
```

预期：构建成功，vendor chunks 正常生成

- [ ] **Step 3: 检查文件删除**

```bash
ls /d/EggTranslate/src/contexts/ 2>/dev/null
ls /d/EggTranslate/src/services/TranslationService.ts 2>/dev/null
```

预期：contexts 目录可能为空；TranslationService.ts 不存在

- [ ] **Step 4: 启动 dev server 验证可启动**

```bash
timeout 10 pnpm run dev 2>&1 | head -20
```

预期：dev server 启动成功，无模块解析错误

- [ ] **Step 5: 检查术语和历史功能**

手动验证（如可能）：
- 打开设置，导入术语，刷新页面，术语应持久化
- 翻译一个文件，完成后查看历史，刷新页面，历史应保留

（这一步在自动化测试缺失时是重要的 smoke test）

- [ ] **Step 6: 总结**

阶段 2 全部完成。预期：~12 个 commits，删除 3 个文件，新增 2 个工具文件。

---

## 验证清单（执行后对照）

- [ ] `src/contexts/TermsContext.tsx` 不存在
- [ ] `src/contexts/HistoryContext.tsx` 不存在
- [ ] `src/services/TranslationService.ts` 不存在
- [ ] `src/utils/termsHelpers.ts` 存在并被 subtitleStore + TermsManager + TranslationControls 引用
- [ ] `src/utils/historyHelpers.ts` 存在并被 HistoryModal 引用
- [ ] `src/App.tsx` 中无 `<HistoryProvider>` `<TermsProvider>`
- [ ] `termsStore` 使用 zustand/persist，无手写 localforage
- [ ] `historyStore` 使用 zustand/persist，无手写 localforage
- [ ] `transcriptionStore` 中 `updateKeytermGroups` 不再写 localforage
- [ ] `translationConfigStore` 包含 `translateBatch` 和 `testConnection` 的实现
- [ ] `pnpm run build` 成功
- [ ] `pnpm run lint` 仅有原有警告

---

## 风险与回滚

每步独立 commit。回滚单个 Task：

```bash
git revert <commit-hash>
```

## 后续阶段

阶段 3（核心架构拆分）建议在阶段 1+2 充分稳定后再启动。详见审计报告。
