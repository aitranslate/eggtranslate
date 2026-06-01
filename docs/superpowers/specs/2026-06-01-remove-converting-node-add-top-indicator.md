# 移除"视频转码"stepper 节点 + 顶部转码指示器

**日期：** 2026-06-01
**类型：** UX 改进（移除冗余节点 + 替代指示器）

---

## 背景

当前 `StepperProgress` 显示 4 个节点：**视频转码 → 语音识别 → 字幕翻译 → 断句对齐**。

**问题：**
- "视频转码" 是内部步骤（MP3 编码），用户无需决策
- 它已经在上传后**自动触发**，显示成 stepper 节点会让用户误以为需要等转码完才能下一步
- 4 个节点视觉上太密，挤占主要流程（转录/翻译/断句）的空间

**解决：**
- stepper 简化为 3 节点：语音识别 → 字幕翻译 → 断句对齐
- 顶部加一条贴顶的"正在转码"指示器，多任务汇总
- 保留数据模型 `phases.converting`（其他模块仍依赖它判断按钮 busy 状态）

---

## UX 设计

### 触发与消失

| 状态 | 指示器 |
|------|--------|
| 0 个文件转码中 | 隐藏 |
| 1+ 个文件 `converting.status === 'active'` | 显示 |
| 所有文件转码完成（completed 或 failed）| 淡出消失（300ms） |

### 显示形态

**收起状态：**
```
┌─────────────────────────────────────────────────────────┐
│  ⟳  正在转码 2 个文件                          [展开 ▼] │
└─────────────────────────────────────────────────────────┘
```

**展开状态：**
```
┌─────────────────────────────────────────────────────────┐
│  ⟳  正在转码 2 个文件                          [收起 ▲] │
├─────────────────────────────────────────────────────────┤
│  • video1.mp4    转码中                                 │
│  • audio2.m4a    转码中                                 │
└─────────────────────────────────────────────────────────┘
```

### 动画

- **进入**：`opacity 0 → 1` + `y -8px → 0`（300ms spring，stiffness 280 damping 24）
- **退出**：`opacity 1 → 0` + `y 0 → -8px`（200ms ease-in）
- **展开/收起**：高度 `auto` 动画（framer-motion `AnimatePresence` + `height: 'auto'`）
- **旋转指示器**：CSS `animation: spin 0.8s linear infinite`
- **背景色**：浅蓝渐变 `linear-gradient(135deg, #EFF6FF 0%, #F0F9FF 100%)`
- **边框**：`1px solid rgba(0, 102, 255, 0.15)`
- **hover**：背景稍深 + 阴影 `0 4px 12px rgba(0,102,255,0.08)`

### 进度（MVP）

**不显示百分比。** 用 indeterminate spinner。

**理由：**
- `convertToMP3` 的 `onProgress` 回调当前**没有接到 UI**（assemblyaiService.ts:109 直接 `await convertToMP3(mediaFile)`，不传 onProgress）
- 接到 UI 需要改：assemblyaiService → transcriptionService → indicator 三层链路
- 风险与工作量都比 UI 重
- 转码通常 5-30 秒（10 分钟视频），用户对"转码中"语义足够清楚
- 后续要加百分比可单独开 spec

---

## 组件设计

### 新增：`src/components/SubtitleFileList/components/TranscodingIndicator.tsx`

```tsx
<TranscodingIndicator />
```

- 内部订阅 `useFilesStore` 的所有 tasks
- 计算 `transcodingFiles = tasks.filter(t => t.phases.converting.status === 'active')`
- 数量 0 → 渲染 `null`（不占空间）
- 数量 > 0 → 渲染展开/收起的 pill
- 内部 state `isExpanded` 控制展开

**Props：** 无（自包含的 dumb component）

**依赖：**
- `useFilesStore` from `@/stores/filesStore`
- `framer-motion` 动画
- `lucide-react` 图标（Loader2 / ChevronDown）

### 改动：`src/components/SubtitleFileList/components/StepperProgress.tsx`

**filter `converting` from displayPhases：**

```ts
// 之前
const displayPhases = useMemo(() => {
  if (file?.fileType === 'srt') {
    return ALL_PHASES.filter(p => p !== 'converting' && p !== 'transcribing');
  }
  return ALL_PHASES;
}, [file?.fileType]);

// 之后
const displayPhases = useMemo(() => {
  // 永远过滤掉 converting（UI 改由 TranscodingIndicator 负责）
  const basePhases = file?.fileType === 'srt'
    ? ALL_PHASES.filter(p => p !== 'converting' && p !== 'transcribing')
    : ALL_PHASES.filter(p => p !== 'converting');
  return basePhases;
}, [file?.fileType]);
```

**保留：** `phases.converting` 在数据模型中。`FileActionButtons` 的 `isTranscribing` 仍引用它（控制按钮 busy 状态）。

### 改动：`src/components/SubtitleFileList/index.tsx`

在 `handleStartAll` 按钮**下方、文件列表上方**挂载 `<TranscodingIndicator />`。

```tsx
<div className="flex items-center gap-2">
  <button onClick={handleStartAll} ...>全部开始</button>
</div>
{/* ↓ 新增 */}
<TranscodingIndicator />
{/* ↓ 文件列表 */}
{files.map(...)}
```

---

## 不在本次范围

- 把 `convertToMP3` 进度接到 UI（要做可单独开 spec）
- 重新设计整个 stepper 视觉
- 把"视频转码"完全从代码里删掉（数据模型保留，因为其他地方依赖）
- i18n（先中文）

---

## 验收标准

- [ ] 0 个文件转码中 → 指示器不可见
- [ ] 1 个文件转码中 → 指示器淡入，显示"正在转码 1 个文件"
- [ ] 多文件转码中 → 指示器显示正确数量
- [ ] 展开/收起按钮工作正常
- [ ] 展开后显示每个文件的名字
- [ ] 转码完成后（所有文件）→ 指示器淡出消失
- [ ] stepper 不再显示"视频转码"节点
- [ ] SRT 文件 stepper 仍正常（之前就只显示翻译/断句）
- [ ] 按钮 disabled 状态正常（FileActionButtons 仍按 converting 判断）
- [ ] 动画流畅，进入/退出有 spring 感
- [ ] 移动端也好看（窄屏折叠到单列）

---

## 风险

- **极低**：纯 UI 改动，业务逻辑零变化
- 测试：现有 126 个测试应全过（不涉及 phase 状态变化）
