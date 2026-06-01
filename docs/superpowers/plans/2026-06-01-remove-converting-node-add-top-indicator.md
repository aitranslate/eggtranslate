# 移除视频转码节点 + 顶部转码指示器 - 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除 stepper 里的"视频转码"节点，加一个顶部"正在转码"指示器
**Architecture:** 纯 UI 改动；保留 `phases.converting` 数据模型；新增自包含的 TranscodingIndicator 组件
**Tech Stack:** React 18 + framer-motion + lucide-react + TypeScript

**前置规范：** [2026-06-01-remove-converting-node-add-top-indicator.md](../specs/2026-06-01-remove-converting-node-add-top-indicator.md)

---

## 文件结构

### 改动文件
- `src/components/SubtitleFileList/components/StepperProgress.tsx` — 过滤 `converting` 节点
- `src/components/SubtitleFileList/index.tsx` — 挂载 TranscodingIndicator

### 新建文件
- `src/components/SubtitleFileList/components/TranscodingIndicator.tsx` — 顶部转码指示器
- `src/components/SubtitleFileList/components/__tests__/TranscodingIndicator.test.tsx` — 单元测试

### 不动文件
- `src/types/index.ts` — `phases.converting` 保留
- `src/utils/convertToMP3.ts` — 业务逻辑零变化
- `src/services/assemblyaiService.ts` — 不动
- `src/components/SubtitleFileList/components/FileActionButtons.tsx` — 仍按 `converting.status` 判断 busy

---

## Task 1: StepperProgress 过滤 converting 节点

**Files:**
- Modify: `src/components/SubtitleFileList/components/StepperProgress.tsx:119-124`

- [ ] **Step 1: 替换 displayPhases 逻辑**

把：
```ts
const displayPhases = useMemo(() => {
  if (file?.fileType === 'srt') {
    return ALL_PHASES.filter(p => p !== 'converting' && p !== 'transcribing');
  }
  return ALL_PHASES;
}, [file?.fileType]);
```

替换为：
```ts
const displayPhases = useMemo(() => {
  // converting 节点已从 stepper 移除；由 TranscodingIndicator 在顶部统一展示
  if (file?.fileType === 'srt') {
    return ALL_PHASES.filter(p => p !== 'converting' && p !== 'transcribing');
  }
  return ALL_PHASES.filter(p => p !== 'converting');
}, [file?.fileType]);
```

- [ ] **Step 2: 验证类型 + 测试**

Run: `cd D:\EggTranslate && pnpm exec tsc -b && pnpm test --run`
Expected: 0 errors, 126 tests pass

- [ ] **Step 3: 提交**

Run:
```bash
git -C D:/EggTranslate add src/components/SubtitleFileList/components/StepperProgress.tsx
git -C D:/EggTranslate commit -m "refactor(ui): stepper 过滤 converting 节点（交给 TranscodingIndicator）"
```

---

## Task 2: TranscodingIndicator 组件 (含测试)

**Files:**
- Create: `src/components/SubtitleFileList/components/TranscodingIndicator.tsx`
- Create: `src/components/SubtitleFileList/components/__tests__/TranscodingIndicator.test.tsx`

- [ ] **Step 1: 写测试 (TDD: 先写测试)**

新建 `src/components/SubtitleFileList/components/__tests__/TranscodingIndicator.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useFilesStore } from '@/stores/filesStore';
import { TranscodingIndicator } from '../TranscodingIndicator';
import type { SingleTask } from '@/types';

const makeTask = (overrides: Partial<SingleTask> = {}): SingleTask => ({
  taskId: 't1',
  subtitle_filename: 'video1.mp4',
  subtitle_entries: [],
  phases: {
    workflow: 'transcribe',
    converting: { status: 'upcoming', progress: 0, tokens: 0 },
    transcribing: { status: 'upcoming', progress: 0, tokens: 0 },
    translating: { status: 'upcoming', progress: 0, tokens: 0 },
    splitting: { status: 'upcoming', progress: 0, tokens: 0 },
  },
  index: 0,
  fileType: 'video',
  fileSize: 1024,
  selectedKeytermGroupId: null,
  entryCount: 0,
  translatedCount: 0,
  ...overrides,
});

describe('TranscodingIndicator', () => {
  beforeEach(() => {
    useFilesStore.setState({ tasks: [], selectedFileId: null });
  });

  it('没有转码中文件时不渲染', () => {
    useFilesStore.setState({ tasks: [makeTask()] });
    const { container } = render(<TranscodingIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it('1 个文件转码中：显示"正在转码 1 个文件"', () => {
    useFilesStore.setState({
      tasks: [makeTask({
        taskId: 't1',
        phases: {
          workflow: 'transcribe',
          converting: { status: 'active', progress: 0, tokens: 0 },
          transcribing: { status: 'upcoming', progress: 0, tokens: 0 },
          translating: { status: 'upcoming', progress: 0, tokens: 0 },
          splitting: { status: 'upcoming', progress: 0, tokens: 0 },
        },
      })],
    });
    render(<TranscodingIndicator />);
    expect(screen.getByText(/正在转码 1 个文件/)).toBeTruthy();
  });

  it('多文件转码中：显示正确数量', () => {
    useFilesStore.setState({
      tasks: [
        makeTask({ taskId: 't1' }),
        makeTask({
          taskId: 't2',
          phases: {
            workflow: 'transcribe',
            converting: { status: 'active', progress: 0, tokens: 0 },
            transcribing: { status: 'upcoming', progress: 0, tokens: 0 },
            translating: { status: 'upcoming', progress: 0, tokens: 0 },
            splitting: { status: 'upcoming', progress: 0, tokens: 0 },
          },
        }),
        makeTask({
          taskId: 't3',
          phases: {
            workflow: 'transcribe',
            converting: { status: 'active', progress: 0, tokens: 0 },
            transcribing: { status: 'upcoming', progress: 0, tokens: 0 },
            translating: { status: 'upcoming', progress: 0, tokens: 0 },
            splitting: { status: 'upcoming', progress: 0, tokens: 0 },
          },
        }),
      ],
    });
    render(<TranscodingIndicator />);
    expect(screen.getByText(/正在转码 2 个文件/)).toBeTruthy();
  });

  it('SRT 文件不计入转码中（因为 SRT 无转码阶段）', () => {
    useFilesStore.setState({
      tasks: [makeTask({ fileType: 'srt' })],
    });
    const { container } = render(<TranscodingIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it('展开后显示每个转码中文件的名字', () => {
    useFilesStore.setState({
      tasks: [
        makeTask({
          taskId: 't1',
          subtitle_filename: 'myvideo.mp4',
          phases: {
            workflow: 'transcribe',
            converting: { status: 'active', progress: 0, tokens: 0 },
            transcribing: { status: 'upcoming', progress: 0, tokens: 0 },
            translating: { status: 'upcoming', progress: 0, tokens: 0 },
            splitting: { status: 'upcoming', progress: 0, tokens: 0 },
          },
        }),
      ],
    });
    const { getByText } = render(<TranscodingIndicator />);
    // 默认收起，点开按钮展开
    const expandBtn = getByText('展开');
    expandBtn.click();
    expect(screen.getByText('myvideo.mp4')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd D:\EggTranslate && pnpm test --run TranscodingIndicator`
Expected: FAIL — module not found (组件还没创建)

- [ ] **Step 3: 创建 TranscodingIndicator.tsx**

新建 `src/components/SubtitleFileList/components/TranscodingIndicator.tsx`：

```tsx
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { useFilesStore } from '@/stores/filesStore';

export const TranscodingIndicator: React.FC = () => {
  const tasks = useFilesStore((s) => s.tasks);
  const [isExpanded, setIsExpanded] = useState(false);

  const transcodingFiles = useMemo(
    () => tasks.filter((t) => t.phases.converting.status === 'active'),
    [tasks]
  );

  const count = transcodingFiles.length;

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -8, height: 0 }}
          transition={{
            type: 'spring',
            stiffness: 280,
            damping: 24,
            opacity: { duration: 0.2 },
          }}
          style={{
            background: 'linear-gradient(135deg, #EFF6FF 0%, #F0F9FF 100%)',
            border: '1px solid rgba(0, 102, 255, 0.15)',
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: '0 2px 8px rgba(0, 102, 255, 0.04)',
          }}
        >
          <button
            onClick={() => setIsExpanded((v) => !v)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#1D1D1F',
              transition: 'background 200ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(0, 102, 255, 0.04)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Loader2
                size={16}
                style={{
                  color: '#0066FF',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <span style={{ fontSize: 14, fontWeight: 500 }}>
                正在转码 {count} 个文件
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#86868B' }}>
              <span style={{ fontSize: 12 }}>{isExpanded ? '收起' : '展开'}</span>
              <motion.div
                animate={{ rotate: isExpanded ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronDown size={16} />
              </motion.div>
            </div>
          </button>

          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                style={{ overflow: 'hidden' }}
              >
                <div
                  style={{
                    padding: '8px 16px 12px 42px',
                    borderTop: '1px solid rgba(0, 102, 255, 0.08)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  {transcodingFiles.map((file) => (
                    <div
                      key={file.taskId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 13,
                        color: '#1D1D1F',
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: '#0066FF',
                        }}
                      />
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: 280,
                        }}
                        title={file.subtitle_filename}
                      >
                        {file.subtitle_filename}
                      </span>
                      <span style={{ color: '#86868B' }}>转码中</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd D:\EggTranslate && pnpm test --run TranscodingIndicator`
Expected: 5 passed

**注意：** 上面测试里的"展开"按钮文本匹配可能要按实际渲染文字调整。展开按钮里 `getByText('展开')` 实际渲染的是 span 里的"展开"文字，DOM 树是 `<button><span>展开</span><motion.div><ChevronDown/></motion.div></button>`，应该能匹配到。

如果 getByText 失败，改成 `screen.getByRole('button', { name: /展开/ })`。

- [ ] **Step 5: 跑全部测试确认无回归**

Run: `cd D:\EggTranslate && pnpm test --run && pnpm lint`
Expected: 131 tests pass (126 + 5), lint 0 errors

- [ ] **Step 6: 提交**

Run:
```bash
git -C D:/EggTranslate add src/components/SubtitleFileList/components/TranscodingIndicator.tsx src/components/SubtitleFileList/components/__tests__/TranscodingIndicator.test.tsx
git -C D:/EggTranslate commit -m "feat(ui): TranscodingIndicator 顶部转码指示器"
```

---

## Task 3: SubtitleFileList 挂载 TranscodingIndicator

**Files:**
- Modify: `src/components/SubtitleFileList/index.tsx`

- [ ] **Step 1: 添加 import + 挂载**

读 `src/components/SubtitleFileList/index.tsx`，找：
```ts
import { SubtitleFileItemMemo as SubtitleFileItem } from './components/SubtitleFileItem';
```

在它下面加：
```ts
import { TranscodingIndicator } from './components/TranscodingIndicator';
```

然后找"全部开始"按钮所在区块（`handleStartAll` 对应的 JSX），在该按钮**之后、文件列表映射之前**插入：

```tsx
<TranscodingIndicator />
```

具体定位：找到 `<Stagger>` 包装（应该就是文件列表的根），在它内部最前面、Control Bar 之后插入。

实际读文件后调整位置（保证视觉上是"按钮下方、文件列表上方"）。

- [ ] **Step 2: 验证**

Run: `cd D:\EggTranslate && pnpm exec tsc -b && pnpm test --run && pnpm lint`
Expected: 0 errors, 131 tests pass, lint clean

- [ ] **Step 3: 提交**

Run:
```bash
git -C D:/EggTranslate add src/components/SubtitleFileList/index.tsx
git -C D:/EggTranslate commit -m "feat(ui): SubtitleFileList 挂载 TranscodingIndicator"
```

---

## Task 4: 手动 UI 验证

**Files:** 无（验证步骤）

- [ ] **Step 1: 打开 dev server**

Run: `cd D:\EggTranslate && pnpm dev` (后台运行)
Expected: 浏览器打开 http://localhost:5173

- [ ] **Step 2: 验证正常状态**

操作：清空 IndexedDB，上传 1 个 SRT 文件
期望：
- stepper 只显示"字幕翻译"节点（无"视频转码"）
- 顶部不显示转码指示器（SRT 不转码）
- 正常显示文件卡

- [ ] **Step 3: 验证转码中状态**

操作：上传 1 个音视频文件（mp4/m4a），点「全部开始」
期望：
- 步骤约 100-300ms 后，顶部淡入"正在转码 1 个文件"
- stepper 只显示"语音识别"节点在转
- 鼠标移到指示器上无明显延迟
- 点"展开"，显示文件名列表

- [ ] **Step 4: 验证自动消失**

操作：等转码完成
期望：指示器淡出消失（200-300ms）

- [ ] **Step 5: 验证多文件**

操作：上传 2 个音视频文件，全部开始
期望：
- 指示器显示"正在转码 2 个文件"
- 展开后显示两个文件名
- 文件 1 转码完，文件 2 仍在转，指示器继续显示"正在转码 1 个文件"
- 文件 2 转码完，指示器淡出

- [ ] **Step 6: 报告**

向用户报告 4 步验证结果。如有问题修复后重测。

---

## 验收清单

- [ ] Task 1-3 全部完成
- [ ] 131 测试全过
- [ ] 0 lint 错误
- [ ] 0 type 错误
- [ ] UI 验证 4 步全过
- [ ] 现有 5 提交全部干净，无残留调试代码

---

## 不在本次范围

- 转码进度百分比（已说明：MVP 用 indeterminate）
- i18n（保持中文）
- stepper 视觉重设计
- `phases.converting` 数据模型删除
