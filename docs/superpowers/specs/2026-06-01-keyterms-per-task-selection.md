# 任务级热词选择 - 设计

**日期：** 2026-06-01  
**类型：** 行为修正 + UI 增强  
**风险：** 中（涉及持久化 schema 升级）

---

## 目标

修正热词功能的实际行为，使其符合产品设计意图：

1. **当前 bug：** `transcriptionService` 把所有分组的术语 `flatMap` 合并后发给 AssemblyAI，违反了"选哪个用哪个"的语义
2. **当前缺失：** UI 没有"为这个文件选哪个分组"的选择器
3. **新增：** 在任务卡片头部加下拉选择器，按文件选择热词分组
4. **保留：** 全局 `keytermsEnabled` 主开关，作为"熔断器"

## 非目标

- 不改变 `KeytermGroup` 数据模型
- 不改变设置页的 CRUD UI
- 不改变 AssemblyAI 调用方式
- 不引入新的持久化 key

## 数据模型变化

### 新增字段：`SubtitleFileMetadata.selectedKeytermGroupId`

```ts
export interface SubtitleFileMetadata {
  // ... 现有字段保持不变
  
  /** 该文件要使用的热词分组 ID；null 表示不使用热词 */
  selectedKeytermGroupId: string | null;
}
```

### 持久化 Schema 升级

`useFilesStore` 当前是 `version: 2`（P3 重构时设置）。升级到 `version: 3` + 新增 `migrate` 函数：

```ts
migrate: (persistedState, version) => {
  if (version < 3) {
    // 老格式直接接受，selectedKeytermGroupId 默认为 null
    return {
      ...persistedState,
      tasks: persistedState.tasks.map(t => ({ ...t, selectedKeytermGroupId: null }))
    };
  }
  return persistedState;
}
```

## 行为变化

### `transcriptionService.startTranscription` 修正

**Before (L46):**
```ts
const allKeyterms = keytermsEnabled
  ? keytermGroups.flatMap((g) => g.keyterms)
  : [];
```

**After:**
```ts
const task = useFilesStore.getState().tasks.find(t => t.taskId === file.taskId);
const groupId = task?.selectedKeytermGroupId;
const allKeyterms = (() => {
  if (!keytermsEnabled) return [];
  if (!groupId) return [];
  const group = keytermGroups.find(g => g.id === groupId);
  return group?.keyterms ?? [];
})();
```

### 新增 `useFilesStore` action

```ts
setSelectedKeytermGroupId: (fileId: string, groupId: string | null) => void;
```

实现：找到 task，更新 `selectedKeytermGroupId` 字段。

## UI 变化

### 任务卡片头部（SubtitleFileItem）

在文件头部信息行新增热词下拉选择器，**与状态/类型同行**：

```
┌──────────────────────────────────────┐
│ 📄 电影.srt  🔵 处理中  [热词: 通用▾] │  ← 新增
│ 48.2 MB · 00:03:58 ⚡ 26,060            │
├──────────────────────────────────────┤
│ [============ 步骤条 ===============]  │
│ ●━━━━●━━━━●━━━━○                       │
├──────────────────────────────────────┤
│ [编辑] [导出] [删除]      [转译/翻译] │
└──────────────────────────────────────┘
```

**下拉内容：**
- "不使用"（默认）
- 所有现有 `keytermGroups`（按名称显示，带术语数）

**禁用状态：** 当全局 `keytermsEnabled = false` 时：
- 下拉显示当前选择的分组名但**灰色禁用**
- hover 时显示 tooltip：「请到设置中开启热词功能」
- 点击无效

### 紧凑设计

- 标签：「热词:」
- 显示文本：所选分组名（或「不使用」）
- 高度：与文件名/状态行一致
- 图标可选：可省略，保持文本简洁

## 持久化兼容

- `name: 'subtitle_tasks'` 不变
- `version: 2` → `version: 3`
- `migrate` 函数处理 v2 → v3 升级
- 旧数据 `selectedKeytermGroupId` 默认 `null`（即"不使用热词"）

## 测试

### 新增测试（`transcriptionService.test.ts` 扩展）

- 当 `selectedKeytermGroupId` 设置为某组时，发送的 keyterms 只包含该组
- 当 `selectedKeytermGroupId` 为 `null` 时，发送空数组
- 当 `keytermsEnabled = false` 时，忽略选择
- 当 `selectedKeytermGroupId` 指向不存在的组时，发送空数组（防御性）

### 手动验证

- 上传文件后，下拉显示「不使用」
- 设置中添加一个新分组
- 任务卡片下拉应能选择新分组
- 转录完成后检查 AssemblyAI 调用日志，确认只发送所选分组的术语

## 风险

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| 旧数据迁移失败 | 中 | 简单的 migrate 函数，null 默认值 |
| 改变了热词发送行为（影响转录结果） | 中 | 这是修正 bug；记录在 commit message |
| 下拉位置打破现有布局 | 低 | 紧凑设计，复用现有间距 |

## 实施步骤

1. 数据模型：在 `SubtitleFileMetadata` 加 `selectedKeytermGroupId`
2. Store 升级：`useFilesStore` → version 3 + migrate + 新增 setter
3. Service 修正：`transcriptionService` 改用单组查询
4. 组件更新：`SubtitleFileItem` 加下拉
5. 测试更新：`transcriptionService.test.ts` 新增 case
6. 验证：build + lint + test + 手动跑流程
