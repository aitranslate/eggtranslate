# 排队状态 UI 改造设计

## 背景

项目已实现任务队列系统（串行执行），但排队中的文件在 UI 上有两个问题：
1. 右上角徽章仍然显示 "未开始"，用户无法区分排队和未操作的文件
2. 按钮显示 spinner 转圈 + "排队中 #N"，视觉上像是在处理中，且无法取消

## 目标

- 排队中的文件在右上角显示 "排队中 #N" 灰色徽章（带队列位置编号）
- 按钮不转圈，显示 "取消排队"，点击后将文件从队列中移除
- "未开始" 仅在文件真正未被操作时显示

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/utils/badgeHelper.ts` | `getCardBadge` 增加 `isQueued` 和 `queuePosition` 可选参数 |
| `src/components/SubtitleFileList/components/SubtitleFileItem.tsx` | 传入队列状态给 `getCardBadge`，传 `onDequeue` 给按钮 |
| `src/components/SubtitleFileList/components/FileActionButtons.tsx` | 排队时按钮改为 "取消排队"（无 spinner） |

## 设计细节

### 1. badgeHelper.ts

修改 `getCardBadge` 签名：

```typescript
function getCardBadge(
  phases: FilePhases,
  displayPhases: ProgressPhase[],
  isQueued?: boolean,
  queuePosition?: number
): BadgeInfo
```

在现有 phase 判断逻辑**之前**增加队列判断：

```typescript
// 最优先：排队中
if (isQueued && queuePosition != null) {
  return getQueueBadge(queuePosition); // { text: '排队中 #N', color: 'gray' }
}
// 之后是现有的：处理中 → 失败 → 已完成 → XX完成 → 未开始
```

`getQueueBadge` 已存在（line 60），返回 `{ text: '排队中 #N', color: 'gray' }`，此前未被调用，现在复用。

### 2. SubtitleFileItem.tsx

- 已有 `isQueued` 和 `queuePosition` props
- 调用改为：`getCardBadge(file.phases, displayPhases, isQueued, queuePosition)`
- 从父组件接收 `onDequeue` 回调，传给 `FileActionButtons`

### 3. FileActionButtons.tsx

新增 `onDequeue` prop：

```typescript
interface FileActionButtonsProps {
  // ... existing props
  onDequeue?: () => void;
}
```

按钮逻辑改造：

```
if (isActive) → spinner + "处理中..."（保持不变）
else if (isQueued) → 无 spinner，文字 "取消排队"，点击调用 onDequeue()
else → 正常的 "开始翻译" / "一键转译" 按钮
```

"取消排队" 按钮样式：灰色/次要按钮风格，与 "处理中" 的蓝色 spinner 形成视觉区分。

## 验证标准

1. 上传文件后，未点击任何按钮 → 徽章显示 "未开始"（灰色）
2. 点击 "开始翻译" 后，文件进入队列 → 徽章变为 "排队中 #1"（灰色），按钮变为 "取消排队"
3. 再添加一个文件到队列 → 第二个文件徽章显示 "排队中 #2"
4. 点击 "取消排队" → 文件从队列移除，徽章恢复 "未开始"，按钮恢复 "开始翻译"
5. 排队中的文件不会显示 spinner 转圈动画
6. 正在处理中的文件仍然显示 spinner + "处理中..."
