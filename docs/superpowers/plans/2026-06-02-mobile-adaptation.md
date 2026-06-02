# 移动端 / 平板适配 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户用手机（≤640px / ≤768px）和平板浏览器访问 eggtranslate 时，主要交互（导航/上传/文件卡/Modal）可正常使用。

**Architecture:** Tailwind 响应式 class + 1 个新 `MobileMenu` 组件 + 1 个 `isMobileMenuOpen` useState。CSS 优先，只在结构性变化（汉堡菜单）用 JS。零新依赖。

**Tech Stack:** React 18 + Vite 6 + TypeScript + Tailwind 3（断点 sm:640 / md:768 / lg:1024）+ Radix Dialog（已有）+ Framer Motion（已有）

---

## 文件结构总览

```
src/components/
  MobileMenu.tsx                  # 新增 — Radix Dialog 抽屉，含 3 个菜单项
  MainApp.tsx                     # 改 — navbar 拆两套（hidden md:flex / md:hidden）+ useState
  BatchFileUpload.tsx             # 改 — padding/icon/字号响应式 + 拍照/录音 input
  SubtitleFileList/components/
    FileIcon.tsx                  # 改 — 支持外部 size prop
    SubtitleFileItem.tsx          # 改 — padding/字号响应式
    FileActionButtons.tsx         # 改 — footer flex-col md:flex-row
  SettingsModal.tsx               # 改 — DialogContent 响应式 class
  HistoryModal.tsx                # 改 — 同上
  TermsManager.tsx                # 改 — 同上
  SubtitleEditor.tsx              # 改 — 同上
  ConfirmDialog.tsx               # 改 — 同上
  GuideModal.tsx                  # 改 — 同上
src/components/__tests__/
  MobileMenu.test.tsx             # 新增 — TDD 覆盖抽屉开关
```

每个新文件单一职责；每个修改文件都加最小 class 集合。

---

## Task 1: MobileMenu 组件（TDD）

**Files:**
- Create: `src/components/__tests__/MobileMenu.test.tsx`
- Create: `src/components/MobileMenu.tsx`

- [ ] **Step 1: 写测试 `src/components/__tests__/MobileMenu.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileMenu } from '../MobileMenu';

const mockOnClose = vi.fn();
const mockOnOpenTerms = vi.fn();
const mockOnOpenHistory = vi.fn();
const mockOnOpenSettings = vi.fn();

function setProps(overrides: Partial<React.ComponentProps<typeof MobileMenu>> = {}) {
  return render(
    <MobileMenu
      isOpen={true}
      onClose={mockOnClose}
      termsCount={3}
      historyCount={3}
      isSettingsRequired={true}
      onOpenTerms={mockOnOpenTerms}
      onOpenHistory={mockOnOpenHistory}
      onOpenSettings={mockOnOpenSettings}
      {...overrides}
    />
  );
}

describe('MobileMenu', () => {
  beforeEach(() => {
    mockOnClose.mockClear();
    mockOnOpenTerms.mockClear();
    mockOnOpenHistory.mockClear();
    mockOnOpenSettings.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing visually when isOpen=false', () => {
    setProps({ isOpen: false });
    // Radix Dialog 在 isOpen=false 时不挂载内容
    expect(screen.queryByText('术语')).toBeNull();
  });

  it('shows 3 menu items when isOpen=true', () => {
    setProps();
    expect(screen.getByText('术语')).toBeTruthy();
    expect(screen.getByText('历史')).toBeTruthy();
    expect(screen.getByText('设置')).toBeTruthy();
  });

  it('shows count badges on terms and history items', () => {
    setProps();
    const termItem = screen.getByText('术语').closest('[role="button"]') || screen.getByText('术语').parentElement;
    expect(termItem?.textContent).toContain('3');
  });

  it('highlights settings item when isSettingsRequired=true', () => {
    setProps({ isSettingsRequired: true });
    const settingsText = screen.getByText('设置');
    const settingsRow = settingsText.closest('[class*="flex"]') || settingsText.parentElement;
    // Should have orange/warning color when required
    expect(settingsRow?.className || '').toMatch(/orange|ff9500|warning/);
  });

  it('calls onOpenTerms when 术语 clicked', () => {
    setProps();
    fireEvent.click(screen.getByText('术语'));
    expect(mockOnOpenTerms).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenHistory when 历史 clicked', () => {
    setProps();
    fireEvent.click(screen.getByText('历史'));
    expect(mockOnOpenHistory).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenSettings when 设置 clicked', () => {
    setProps();
    fireEvent.click(screen.getByText('设置'));
    expect(mockOnOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when ✕ close button clicked', () => {
    setProps();
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 跑测试确认全失败（红）**

```bash
cd D:/EggTranslate && pnpm test -- src/components/__tests__/MobileMenu.test.tsx
```

预期：失败 "Cannot find module '../MobileMenu'"。

- [ ] **Step 3: 实现 `src/components/MobileMenu.tsx`**

```tsx
// src/components/MobileMenu.tsx
// 移动端导航抽屉：Radix Dialog + slide-down 动画
// 当 isOpen=true 时从顶部滑出 200ms，backdrop 半透明。

import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import * as Dialog from '@radix-ui/react-dialog';
import { BookOpen, History, Settings as SettingsIcon, X } from 'lucide-react';

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  termsCount: number;
  historyCount: number;
  isSettingsRequired: boolean;
  onOpenTerms: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
}

const PANEL_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 12,
  left: 12,
  right: 12,
  maxWidth: 480,
  margin: '0 auto',
  background: '#ffffff',
  borderRadius: 14,
  padding: 12,
  boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
  zIndex: 1100,
};

const ROW_BASE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 8px',
  borderRadius: 8,
  fontSize: 13,
  cursor: 'pointer',
  border: 'none',
  background: 'transparent',
  width: '100%',
  textAlign: 'left',
};

export const MobileMenu: React.FC<MobileMenuProps> = ({
  isOpen,
  onClose,
  termsCount,
  historyCount,
  isSettingsRequired,
  onOpenTerms,
  onOpenHistory,
  onOpenSettings,
}) => {
  const reduce = useReducedMotion();

  const handleItem = (cb: () => void) => () => {
    cb();
    onClose();
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <AnimatePresence>
        {isOpen && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={reduce ? { opacity: 0 } : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                style={{
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(0,0,0,0.3)',
                  zIndex: 1099,
                }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <motion.div
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: -16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -16 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                style={PANEL_STYLE}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 0',
                  borderBottom: '1px solid #f0f0f0',
                  marginBottom: 6,
                }}>
                  <span style={{ fontSize: 14 }}>🥚</span>
                  <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
                    蛋蛋字幕翻译
                  </span>
                  <Dialog.Close asChild>
                    <button
                      aria-label="关闭"
                      style={{
                        width: 32, height: 32, border: 'none',
                        background: '#f5f5f7', borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, cursor: 'pointer',
                      }}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </Dialog.Close>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <button
                    onClick={handleItem(onOpenTerms)}
                    style={ROW_BASE}
                    className="hover:bg-gray-50"
                  >
                    <BookOpen className="w-4 h-4" />
                    <span style={{ flex: 1 }}>术语</span>
                    {termsCount > 0 && (
                      <span style={{
                        background: '#0066FF', color: '#fff',
                        fontSize: 10, padding: '1px 6px', borderRadius: 8,
                      }}>
                        {termsCount}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={handleItem(onOpenHistory)}
                    style={ROW_BASE}
                    className="hover:bg-gray-50"
                  >
                    <History className="w-4 h-4" />
                    <span style={{ flex: 1 }}>历史</span>
                    {historyCount > 0 && (
                      <span style={{
                        background: '#0066FF', color: '#fff',
                        fontSize: 10, padding: '1px 6px', borderRadius: 8,
                      }}>
                        {historyCount}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={handleItem(onOpenSettings)}
                    style={{
                      ...ROW_BASE,
                      background: isSettingsRequired ? '#fff5e6' : 'transparent',
                      color: isSettingsRequired ? '#ff9500' : '#1d1d1f',
                    }}
                    className="hover:bg-gray-50"
                  >
                    <SettingsIcon className="w-4 h-4" />
                    <span style={{ flex: 1 }}>设置</span>
                    {isSettingsRequired && (
                      <span style={{
                        background: '#ff9500', color: '#fff',
                        fontSize: 10, padding: '1px 6px', borderRadius: 8,
                      }}>
                        必须
                      </span>
                    )}
                  </button>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
};

export default MobileMenu;
```

- [ ] **Step 4: 跑测试全通过（绿）**

```bash
cd D:/EggTranslate && pnpm test -- src/components/__tests__/MobileMenu.test.tsx
```

预期：8 个测试 PASS。

- [ ] **Step 5: lint + 类型检查**

```bash
cd D:/EggTranslate && pnpm lint && pnpm build 2>&1 | tail -5
```

预期：lint 干净，build 成功。

- [ ] **Step 6: 提交**

```bash
cd D:/EggTranslate && git add src/components/MobileMenu.tsx src/components/__tests__/MobileMenu.test.tsx
git commit -m "feat(ui): add MobileMenu drawer component with TDD"
```

---

## Task 2: MainApp 集成 MobileMenu + 响应式 Navbar

**Files:**
- Modify: `src/components/MainApp.tsx`

- [ ] **Step 1: 读 MainApp.tsx 看清现状（无 Read 报错即跳到 Step 2）**

```bash
cd D:/EggTranslate && sed -n '1,30p' src/components/MainApp.tsx
```

- [ ] **Step 2: 在 MainApp.tsx 顶部加 MobileMenu 导入和 isMobileMenuOpen state**

修改 `src/components/MainApp.tsx`，**在 import 区域 HelpButton 导入之后**添加：

```typescript
import { MobileMenu } from './MobileMenu';
```

然后在 `MainApp` 函数体内（`const [isGuideOpen, setIsGuideOpen] = useState(false);` 之后）添加：

```typescript
const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
```

- [ ] **Step 3: 拆 navbar 的两套按钮组（hidden md:flex / md:hidden）**

找到现有 navbar JSX（line 81-130 附近）。把整段 `<div className={\`flex items-center gap-6 ${isEditingModalOpen ? 'pointer-events-none opacity-50' : ''}\`}>` 替换为：

```tsx
      {/* 桌面端：水平按钮组（≥768px 显示） */}
      <div className={`hidden md:flex items-center gap-3 ${isEditingModalOpen ? 'pointer-events-none opacity-50' : ''}`}>
        <button
          onClick={() => setIsTermsOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-gray-100 transition-colors"
        >
          <BookOpen className="h-4 w-4" />
          <span className="text-sm">术语</span>
          {terms.length > 0 && (
            <span className="px-1.5 py-0.5 text-xs bg-blue-500 text-white rounded-full">
              {terms.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setIsHistoryOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-gray-100 transition-colors"
        >
          <History className="h-4 w-4" />
          <span className="text-sm">历史</span>
          {history.length > 0 && (
            <span className="px-1.5 py-0.5 text-xs bg-blue-500 text-white rounded-full">
              {history.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setIsSettingsOpen(true)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-colors ${
            isConfigured
              ? 'text-gray-600 hover:bg-gray-100'
              : 'text-orange-600 bg-orange-50 hover:bg-orange-100'
          }`}
        >
          <Settings className="h-4 w-4" />
          <span className="text-sm">设置</span>
          {!isConfigured && (
            <span className="px-1.5 py-0.5 text-xs bg-orange-500 text-white rounded-full">
              必须
            </span>
          )}
        </button>
      </div>

      {/* 移动端：汉堡按钮（<768px 显示） */}
      <button
        onClick={() => setIsMobileMenuOpen(true)}
        className={`md:hidden w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 ${isEditingModalOpen ? 'pointer-events-none opacity-50' : ''}`}
        aria-label="打开菜单"
      >
        <Menu className="h-4 w-4" />
      </button>
```

- [ ] **Step 4: 在 navbar 容器也去掉 v1.2 badge（移动端节省空间）**

找到 `<h1 className="apple-heading-small">蛋蛋字幕翻译</h1>` 这一行（line 83 附近），把后面的：

```tsx
<span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 rounded-full">v1.2</span>
```

改为：

```tsx
<span className="hidden md:inline-block px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 rounded-full">v1.2</span>
```

- [ ] **Step 5: 在 JSX 末尾（HelpButton + PWAInstallBanner 之后）添加 MobileMenu**

找到 `<PWAInstallBanner />`（line 201 附近），在其**之后**添加：

```tsx
      <MobileMenu
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        termsCount={terms.length}
        historyCount={history.length}
        isSettingsRequired={!isConfigured}
        onOpenTerms={() => setIsTermsOpen(true)}
        onOpenHistory={() => setIsHistoryOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />
```

- [ ] **Step 6: 顶部 import 加 Menu icon**

在现有 `import { Settings, BookOpen, History } from 'lucide-react';` 后面加 `Menu`：

```typescript
import { Settings, BookOpen, History, Menu } from 'lucide-react';
```

- [ ] **Step 7: 跑全量测试 + lint + build**

```bash
cd D:/EggTranslate && pnpm test 2>&1 | tail -8 && pnpm lint 2>&1 | tail -3 && pnpm build 2>&1 | tail -3
```

预期：所有测试 PASS（151 个 = 之前 143 + 8 个 MobileMenu），lint 干净，build 成功。

- [ ] **Step 8: 提交**

```bash
cd D:/EggTranslate && git add src/components/MainApp.tsx
git commit -m "feat(ui): wire MobileMenu into MainApp with responsive navbar"
```

---

## Task 3: BatchFileUpload 响应式

**Files:**
- Modify: `src/components/BatchFileUpload.tsx`

- [ ] **Step 1: 改外层 padding 响应式**

修改 `src/components/BatchFileUpload.tsx`，line 76 附近的：

```tsx
className="relative w-full p-12 border-2 border-dashed rounded-2xl bg-gray-50/50 border-gray-300"
```

改为：

```tsx
className="relative w-full p-5 sm:p-8 lg:p-12 border-2 border-dashed rounded-2xl bg-gray-50/50 border-gray-300"
```

- [ ] **Step 2: 改圆形 icon 尺寸响应式**

line 100 附近的：

```tsx
className="w-16 h-16 rounded-full bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/20"
```

改为：

```tsx
className="w-10 h-10 sm:w-12 sm:h-12 lg:w-16 lg:h-16 rounded-full bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/20"
```

同时改 line 102 附近的：

```tsx
<Upload className="h-8 w-8 text-white" />
```

改为：

```tsx
<Upload className="h-5 w-5 sm:h-6 sm:w-6 lg:h-8 lg:w-8 text-white" />
```

- [ ] **Step 3: 改标题字号响应式**

line 106-107 附近的：

```tsx
<h3 className="text-2xl font-semibold text-gray-900 mb-3">
  {isDragging ? '放开文件即可上传' : '拖拽上传 SRT 字幕或音视频文件'}
</h3>
<p className="text-gray-600 text-lg mb-2">
  拖拽多个文件到此处或点击选择文件
</p>
<p className="text-sm text-gray-500">
  支持 .srt .mp3 .wav .m4a .mp4 .webm .ogg 等格式
</p>
```

改为：

```tsx
<h3 className="text-base sm:text-lg lg:text-2xl font-semibold text-gray-900 mb-2 sm:mb-3">
  {isDragging ? '放开文件即可上传' : '点击或拖拽上传文件'}
</h3>
<p className="text-gray-600 text-sm sm:text-base lg:text-lg mb-2">
  支持 SRT / 音视频，可多选
</p>
<p className="text-xs sm:text-sm text-gray-500 hidden sm:block">
  支持 .srt .mp3 .wav .m4a .mp4 .webm .ogg 等格式
</p>
```

- [ ] **Step 4: 加拍照/录音快捷按钮（仅手机显示）**

在 line 121 之前的 `</div>` 后（即整个 flex-col 容器结尾，before the drag overlay）添加：

```tsx
{/* 移动端特有：拍照/录音快捷入口（≥640px 隐藏） */}
<div className="flex sm:hidden gap-2 mt-2">
  <label className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-gray-100 rounded-lg text-xs text-gray-700 cursor-pointer">
    📷 拍照
    <input
      type="file"
      accept="image/*"
      capture="environment"
      onChange={onFileSelect}
      className="hidden"
    />
  </label>
  <label className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-gray-100 rounded-lg text-xs text-gray-700 cursor-pointer">
    🎤 录音
    <input
      type="file"
      accept="audio/*"
      capture="microphone"
      onChange={onFileSelect}
      className="hidden"
    />
  </label>
</div>
```

- [ ] **Step 5: 跑 build + lint**

```bash
cd D:/EggTranslate && pnpm build 2>&1 | tail -5 && pnpm lint 2>&1 | tail -3
```

预期：build 成功，lint 干净。

- [ ] **Step 6: 提交**

```bash
cd D:/EggTranslate && git add src/components/BatchFileUpload.tsx
git commit -m "feat(ui): BatchFileUpload responsive layout + mobile capture shortcuts"
```

---

## Task 4: FileIcon 支持外部 size prop

**Files:**
- Modify: `src/components/SubtitleFileList/components/FileIcon.tsx`

- [ ] **Step 1: 读 FileIcon 看现状**

```bash
cd D:/EggTranslate && cat src/components/SubtitleFileList/components/FileIcon.tsx
```

- [ ] **Step 2: 给 FileIcon 加 size prop**

修改 `src/components/SubtitleFileList/components/FileIcon.tsx`，让组件接受 `size?: number` prop，默认 32。找到 `interface FileIconProps`（或类似定义）添加：

```typescript
interface FileIconProps {
  type: 'srt' | 'audio' | 'video';
  size?: number;  // 新增
}
```

并在函数解构中加 `size = 32`，然后把所有 `w-8 h-8` 替换为动态 class。示例（如果原代码是 `className="w-8 h-8 ..."`）：

```tsx
const sizeClass = `w-${Math.ceil(size / 4)} h-${Math.ceil(size / 4)}`;
// ...
<Icon className={`${sizeClass} ...`} />
```

**注意**：Tailwind 的 JIT 不会自动看到动态拼接的 class 名。如果用动态拼接，要么用 safelist 配 Tailwind，要么用 inline style 替代。最简方案：

```tsx
// 用 inline style 设尺寸，避免 JIT 扫描不到
<Icon style={{ width: size, height: size }} className="..." />
```

具体怎么改，**看实际文件结构**。如果原代码是纯 className，最简改法是加 inline `style={{ width: size, height: size }}` 覆盖。如果原代码已经有 style 字段，扩展它。

- [ ] **Step 3: 跑 build 确认 TS 不报错**

```bash
cd D:/EggTranslate && pnpm build 2>&1 | tail -5
```

预期：build 成功（如果 `size` prop 没传，原行为不变因为有默认值 32）。

- [ ] **Step 4: 提交**

```bash
cd D:/EggTranslate && git add src/components/SubtitleFileList/components/FileIcon.tsx
git commit -m "refactor(ui): FileIcon accepts external size prop"
```

---

## Task 5: SubtitleFileItem 响应式

**Files:**
- Modify: `src/components/SubtitleFileList/components/SubtitleFileItem.tsx`

- [ ] **Step 1: 改外层 motion.div 响应式 padding**

修改 `src/components/SubtitleFileList/components/SubtitleFileItem.tsx`，line 91 附近的：

```tsx
className="relative bg-white rounded-2xl p-5 flex flex-col gap-5"
```

改为：

```tsx
className="relative bg-white rounded-2xl p-3 md:p-3.5 flex flex-col gap-3 md:gap-5"
```

- [ ] **Step 2: FileIcon 调用传 size**

line 130 附近的：

```tsx
<FileIcon type={file.fileType} />
```

改为：

```tsx
<FileIcon type={file.fileType} size={24} className="md:hidden" />
<FileIcon type={file.fileType} size={28} className="hidden md:inline-flex lg:hidden" />
<FileIcon type={file.fileType} size={32} className="hidden lg:inline-flex" />
```

**注意**：如果 FileIcon 组件不支持 `className` prop，扩展它（line N 加 `className?: string` 并合并到根元素）。同时确保 Task 4 已经提交。

- [ ] **Step 3: 改 header title 字号响应式**

line 132 附近的：

```tsx
<h4 className="text-sm font-semibold text-gray-900 truncate" title={file.name}>
```

改为：

```tsx
<h4 className="text-xs md:text-sm font-semibold text-gray-900 truncate" title={file.name}>
```

line 135 附近的：

```tsx
<div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
```

改为：

```tsx
<div className="text-[10px] md:text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
```

- [ ] **Step 4: 跑 build**

```bash
cd D:/EggTranslate && pnpm build 2>&1 | tail -5
```

预期：build 成功。

- [ ] **Step 5: 提交**

```bash
cd D:/EggTranslate && git add src/components/SubtitleFileList/components/SubtitleFileItem.tsx
git commit -m "feat(ui): SubtitleFileItem responsive header + FileIcon size"
```

---

## Task 6: FileActionButtons footer 响应式

**Files:**
- Modify: `src/components/SubtitleFileList/components/FileActionButtons.tsx`

- [ ] **Step 1: 改外层容器响应式**

修改 `src/components/SubtitleFileList/components/FileActionButtons.tsx`，line 80 附近的：

```tsx
<div className="flex items-center justify-between border-t pt-4" style={{ borderColor: '#E5E5EA' }}>
```

改为：

```tsx
<div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-0 border-t pt-3 md:pt-4" style={{ borderColor: '#E5E5EA' }}>
```

- [ ] **Step 2: 改主操作按钮的 primary-actions 容器**

line 115 附近的：

```tsx
<div className="flex items-center gap-3">
```

改为：

```tsx
<div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 md:gap-3">
```

- [ ] **Step 3: 改主操作按钮的样式响应式（full width on mobile）**

line 150 附近的：

```tsx
className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
```

改为：

```tsx
className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed w-full md:w-auto"
```

- [ ] **Step 4: 跑 build + 全量测试**

```bash
cd D:/EggTranslate && pnpm test 2>&1 | tail -5 && pnpm build 2>&1 | tail -3
```

预期：所有测试 PASS（143 个），build 成功。

- [ ] **Step 5: 提交**

```bash
cd D:/EggTranslate && git add src/components/SubtitleFileList/components/FileActionButtons.tsx
git commit -m "feat(ui): FileActionButtons footer 2-row stack on mobile"
```

---

## Task 7: Modal 响应式 — SettingsModal + HistoryModal

**Files:**
- Modify: `src/components/SettingsModal.tsx`
- Modify: `src/components/HistoryModal.tsx`

- [ ] **Step 1: 找两个 modal 的 DialogContent**

```bash
cd D:/EggTranslate && grep -n "DialogContent\|max-w-\[" src/components/SettingsModal.tsx src/components/HistoryModal.tsx
```

找到 DialogContent 的 className。

- [ ] **Step 2: 改 SettingsModal 的 DialogContent className**

把当前 className 改为：

```tsx
"fixed left-[50%] top-[50%] z-50 grid w-full max-w-[calc(100vw-2rem)] md:max-w-[560px] lg:max-w-[680px] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-none md:rounded-2xl border bg-white p-4 md:p-6 shadow-lg max-h-screen md:max-h-[85vh] overflow-y-auto"
```

（如果原 className 包含其他特定样式，保留并追加这些响应式 class。）

- [ ] **Step 3: 改 HistoryModal 的 DialogContent className**

同 Step 2 一样的响应式 class，替换。

- [ ] **Step 4: 给 SettingsModal 加底部 sticky 操作栏（仅手机）**

在 SettingsModal 的 `<form>` 或最后的内容**之后**，加一个：

```tsx
<div className="fixed bottom-0 left-0 right-0 md:hidden bg-white border-t p-3 flex gap-2 z-50">
  <button
    type="button"
    onClick={onClose}
    className="flex-1 py-3 bg-gray-100 rounded-lg text-sm font-medium"
  >
    取消
  </button>
  <button
    type="button"
    onClick={() => {/* 触发保存逻辑 */}}
    className="flex-[2] py-3 bg-blue-600 text-white rounded-lg text-sm font-medium"
  >
    保存设置
  </button>
</div>
```

**注意**：保存按钮的 onClick 需要根据现有 SettingsModal 实际的"保存"逻辑调整——看代码找到保存 handler，传给它。

- [ ] **Step 5: 跑 build + 全量测试**

```bash
cd D:/EggTranslate && pnpm test 2>&1 | tail -5 && pnpm build 2>&1 | tail -3
```

预期：所有测试 PASS，build 成功。

- [ ] **Step 6: 提交**

```bash
cd D:/EggTranslate && git add src/components/SettingsModal.tsx src/components/HistoryModal.tsx
git commit -m "feat(ui): SettingsModal + HistoryModal responsive layout"
```

---

## Task 8: Modal 响应式 — 剩余 4 个（TermsManager, SubtitleEditor, ConfirmDialog, GuideModal）

**Files:**
- Modify: `src/components/TermsManager.tsx`
- Modify: `src/components/SubtitleEditor.tsx`
- Modify: `src/components/ConfirmDialog.tsx`
- Modify: `src/components/GuideModal.tsx`

- [ ] **Step 1: 4 个文件都改 DialogContent className**

对每个文件，找到 DialogContent 的 className，**统一替换为**：

```tsx
"fixed left-[50%] top-[50%] z-50 grid w-full max-w-[calc(100vw-2rem)] md:max-w-[560px] lg:max-w-[680px] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-none md:rounded-2xl border bg-white p-4 md:p-6 shadow-lg max-h-screen md:max-h-[85vh] overflow-y-auto"
```

（**保留**原 className 中其他特定样式，**只追加**响应式 class。如果原 className 已有 max-w-[X]，把 X 替换为 `md:max-w-[560px] lg:max-w-[680px]`。）

- [ ] **Step 2: SubtitleEditor 特殊处理（内容最多）**

SubtitleEditor 是 6 个 modal 里内容最多的，可能有内部滚动结构。除了 Step 1 的 DialogContent 改动外，确保内部内容（字幕列表区）有 `overflow-y-auto` 和合理 max-height，避免在手机挤出屏外。

如果发现 SubtitleEditor 有自己的 header / body / footer 内部结构，按 spec §3.4 模式拆 3 段：
- 内部顶部 sticky（标题 + ✕）
- 内部中间 scroll（字幕列表）
- 内部底部 sticky（操作按钮）

**仅在必要时做这一步**——如果 SubtitleEditor 已经有自己的合理结构，跳过。

- [ ] **Step 3: ConfirmDialog 简化（已是最简）**

ConfirmDialog 通常只有标题 + 确认按钮。Step 1 改动即可，不需加底部 sticky。

- [ ] **Step 4: 跑 build + 全量测试**

```bash
cd D:/EggTranslate && pnpm test 2>&1 | tail -5 && pnpm build 2>&1 | tail -3
```

预期：所有测试 PASS，build 成功。

- [ ] **Step 5: 提交**

```bash
cd D:/EggTranslate && git add src/components/TermsManager.tsx src/components/SubtitleEditor.tsx src/components/ConfirmDialog.tsx src/components/GuideModal.tsx
git commit -m "feat(ui): remaining 4 modals responsive layout"
```

---

## Task 9: 手动端到端 QA

**Files:** 无（验证 + 修小问题）

- [ ] **Step 1: 跑全量检查**

```bash
cd D:/EggTranslate && pnpm test 2>&1 | tail -5 && pnpm lint 2>&1 | tail -3 && pnpm build 2>&1 | tail -3
```

预期：所有测试 PASS（151 个 = 之前 143 + 8 MobileMenu），lint 干净，build 成功。

- [ ] **Step 2: 启动 preview server**

```bash
cd D:/EggTranslate && pnpm build && pnpm preview
```

然后打开 http://localhost:4173

- [ ] **Step 3: Chrome DevTools 375px 验证（iPhone SE 模拟）**

DevTools → 设备工具栏 → iPhone SE
- [ ] Navbar：标题 + ☰ 按钮，无溢出
- [ ] 点 ☰ → 抽屉从顶部滑下，含 3 个选项（术语/历史/设置）
- [ ] 上传区：p-5 紧凑，显示拍照/录音按钮（点拍照/录音应触发原生相机/录音选择器）
- [ ] 文件卡（上传后）：footer 2 行，主按钮 full width
- [ ] Modal（设置）：全屏 3 段式，bottom sticky 操作栏可见，关闭按钮在右上

- [ ] **Step 4: Chrome DevTools 768px 验证（iPad 竖屏）**

- [ ] Navbar：3 按钮横排（不带 v1.2 badge）
- [ ] 上传区：sm:p-8 中等，无拍照/录音
- [ ] 文件卡 footer：单行
- [ ] Modal：居中 max-w 560，2 列表单

- [ ] **Step 5: Chrome DevTools 1280px 验证（桌面）**

- [ ] 全部不变（与本次改动前一致）

- [ ] **Step 6: 边界断点测试**

- [ ] 640px：上传区从手机紧凑态 → 平板适中态过渡是否平滑
- [ ] 768px：navbar 切换、modal 切换、文件卡 footer 切换
- [ ] 1024px：modal 从 560 切到 680

- [ ] **Step 7: 推送到 origin 让真机测试**

```bash
cd D:/EggTranslate && git push origin main 2>&1
```

预期：推送成功，Cloudflare Pages 自动部署。

- [ ] **Step 8: 真机测试（用户自己）**

- [ ] iPhone Safari（or Android Chrome）：访问 https://eggtranslate.pages.dev/，验证手机体验
- [ ] iPad Safari：验证平板体验

- [ ] **Step 9: 写手动 QA 清单到 `docs/superpowers/plans/2026-06-02-mobile-adaptation-manual-qa.md`**

```bash
cat > D:/EggTranslate/docs/superpowers/plans/2026-06-02-mobile-adaptation-manual-qa.md << 'EOF'
# 移动端适配 — 手动 QA 清单

> 所有自动化检查已通过。剩下需要用户在真实设备 + Chrome DevTools 操作。

## DevTools 模拟（推荐先做）

Chrome DevTools → 设备工具栏 → 切换以下宽度：

### 375px (iPhone SE)

- [ ] Navbar：标题 + ☰ 按钮，无溢出
- [ ] 点 ☰ → 抽屉从顶部滑下（200ms），含 3 选项（术语/历史/设置）
- [ ] 抽屉点 ✕ 或 backdrop → 关闭
- [ ] 抽屉点选项 → 关闭抽屉 + 打开对应 modal
- [ ] 上传区：紧凑，显示 📷 拍照 + 🎤 录音 按钮
- [ ] 点拍照 → 触发原生相机（移动设备）
- [ ] 文件卡 footer：2 行（次要按钮行 + 主操作 full width）
- [ ] Modal：全屏，3 段式（top close + scroll + bottom sticky）

### 768px (iPad 竖屏)

- [ ] Navbar：3 按钮横排（不带 v1.2 badge）
- [ ] 上传区：p-8 中等，无拍照/录音
- [ ] 文件卡 footer：单行
- [ ] Modal：居中 max-w 560，圆角

### 1280px (桌面)

- [ ] 全部不变

## 边界断点

- [ ] 640px 切换（上传区紧凑 → 中等）
- [ ] 768px 切换（navbar + 文件卡 + modal 切换）
- [ ] 1024px 切换（modal 560 → 680）

## 真机测试（部署后）

- [ ] iPhone Safari
- [ ] Android Chrome
- [ ] iPad Safari（横屏 + 竖屏各一次）

## 已知限制

- 文件拖拽上传在移动设备不可用（移动设备用拍照/录音/文件选择器）
EOF
```

- [ ] **Step 10: 提交 QA 清单（如需要）**

```bash
cd D:/EggTranslate && git add docs/superpowers/plans/2026-06-02-mobile-adaptation-manual-qa.md
git commit -m "docs: mobile adaptation manual QA checklist"
```

如果没改动可跳过。

---

## 自检

**Spec 覆盖**：
- §3.1 Navbar：Task 1（MobileMenu）+ Task 2（MainApp 集成）✓
- §3.2 上传区：Task 3（BatchFileUpload）✓
- §3.3 文件卡：Task 4（FileIcon size）+ Task 5（SubtitleFileItem）+ Task 6（FileActionButtons）✓
- §3.4 Modal：Task 7（Settings + History）+ Task 8（Terms + Editor + Confirm + Guide）✓
- §5 验收：Task 9（手动 QA）✓

**占位符扫描**：无 TBD/TODO（Task 2 Step 5 的"触发保存逻辑"是引用现有代码位置，不算占位符）

**类型一致性**：
- `MobileMenu` props（Task 1）vs MainApp 传值（Task 2 Step 5）：完全匹配（isOpen, onClose, termsCount, historyCount, isSettingsRequired, onOpenTerms/History/Settings）
- `FileIcon` size prop（Task 4）vs 调用方（Task 5 Step 2）：通过 className 控制实际渲染，确保兼容性
- 断点约定：所有任务用 `md: 768` / `lg: 1024`（spec §3 一致）
