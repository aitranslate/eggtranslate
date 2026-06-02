# 移动端 / 平板适配 — 设计 spec

> **状态**：设计已批准，待实施
> **日期**：2026-06-02
> **方向**：放弃客户端 UI 重构，改做手机 / 平板适配（见 [[project-mobile-adaptation]]）

---

## 1. 目标与范围

### 1.1 目标

让用户用手机（≤640px 宽）和平板（641-1024px）浏览器访问 eggtranslate.pages.dev 时，**主要交互（导航、上传、查看文件卡、打开 modal）可正常使用**，不再出现标题溢出、按钮挤垮、保存按钮看不见等问题。

### 1.2 范围

**包含**：
- A. Navbar 顶栏（手机汉堡菜单 + 抽屉）
- B. 上传区（手机紧凑 + 移动端拍照/录音入口）
- C. 文件卡 footer（手机 2 行堆叠）
- D. Modal 弹窗（手机全屏 + 底部 sticky 操作栏）
  - 主目标：SettingsModal、HistoryModal、TermsManager、SubtitleEditor
  - 次目标：ConfirmDialog、GuideModal（结构相同，可一并改）

**不包含**（本次范围外）：
- 客户端 UI 重构（iOS 卡片风、B 三栏布局等——见 [[project-mobile-adaptation]] 方向决策）
- 移动端专属功能（语音输入 / 摄像头扫码上传等深度集成）
- 平板专属布局（如 iPad 多任务分屏）
- PWA standalone 模式下的额外优化
- 历史/术语/字幕编辑 4 个 modal 之外的组件（拖拽排序、长列表虚拟化等）

---

## 2. 设计选型

| 决策 | 选择 | 理由 |
|---|---|---|
| 实现策略 | **响应式 + 断点条件 UI** | Tailwind `md:` / `lg:` 类切换布局 + `hidden md:flex` / `md:hidden` 拆结构。无需新依赖 |
| 断点系统 | 沿用 Tailwind 默认 | `sm: 640` / `md: 768` / `lg: 1024` |
| 状态管理 | 仅 navbar 加一个 useState | 其余全部 CSS-only |
| 新组件 | `MobileMenu.tsx` 一个 | Radix Dialog 抽屉 |

**未选**：
- 纯 Tailwind 响应式（无 JS）：汉堡菜单需要开关状态，绕不开 JS
- 独立 mobile/desktop 组件：代码重复、维护差

---

## 3. 详细设计

### 3.1 A. Navbar 顶栏

**断点**：`<768px` 手机 vs `≥768px` 平板+桌面

**手机 (<768px)**：
- 左：蛋图标 + "蛋蛋字幕翻译" 标题（无 v1.2 badge）
- 右：☰ 按钮（32×32，#f5f5f7 圆角 8px）
- 点 ☰：Radix Dialog 抽屉从顶部滑下（200ms slide-down + 半透明 backdrop）
- 抽屉内容：3 个选项（术语 / 历史 / 设置），保留原 badge 数字
- drawer 顶部有"蛋蛋字幕翻译"标题 + ✕ 关闭

**平板 (≥768px)**：
- 保持当前 3 按钮（术语/历史/设置）
- 标题去掉 v1.2 badge（节省横向空间）
- padding 从 `px-6` 收紧到 `px-3`
- 字号从 text-base 略小到 text-sm

**桌面 (≥1024px)**：完全不动

**修改/新增**：
- ✅ 新增 `src/components/MobileMenu.tsx`（约 60 行）
- ✏️ 修改 `src/components/MainApp.tsx`：navbar 用 `hidden md:flex` / `md:hidden` 拆成两套
- 🔧 `MainApp` 加 `isMobileMenuOpen` useState

---

### 3.2 B. 上传区

**断点**：`<640px` 手机 vs `≥640px` 平板+桌面

**手机 (<640px)**：
- 外层 padding: `p-5` (20px) 而非 `p-12` (48px)
- 圆形 icon: 40×40（原 64×64）
- 标题: `text-base` (16px) 而非 `text-2xl` (24px)
- 副标题: 砍掉"支持 .srt .mp3..."长串，合并成 1 行
- **新增**：拍照/录音 快捷按钮（2 列 grid）
  - 📷 拍照：`<input type="file" accept="image/*" capture="environment">`
  - 🎤 录音：`<input type="file" accept="audio/*" capture="microphone">`
  - 零依赖，浏览器原生调起

**平板 (≥640px)**：
- `sm:p-8` (32px)
- icon 48×48
- title `text-base` 16px
- 保留单条完整副标题
- 不显示拍照/录音

**桌面 (≥1024px)**：完全不动

**修改**：
- ✏️ `src/components/BatchFileUpload.tsx`：外层 padding、icon 尺寸、字号全部加响应式 class
- 🔧 拍照/录音的 input 元素用 `<input type="file" capture="...">` 直接触发，无需新 props

---

### 3.3 C. 文件卡

**断点**：`<768px` 手机 vs `≥768px` 平板+桌面

**手机 (<768px)**：
- 外层 padding: `p-3` (12px) 而非 `p-5` (20px)
- FileIcon: 24×24（原 32×32）
- title: `text-xs` (12px) 而非 `text-sm` (14px)
- meta info: `text-[10px]`
- stepper 节点: 10×10（原更大）
- **footer 改为 2 行**：
  - 第 1 行：热词 dropdown（占满剩余宽度）+ 3 个 28×28 icon 按钮
  - 第 2 行：主操作按钮 **full width**（不再 `margin-left: auto` 推右）

**平板 (≥768px)**：
- `md:p-3.5` (14px)
- FileIcon 28×28
- title `text-sm`
- footer 保持单行（不变），但 icon 缩到 28×28，padding 略紧

**桌面 (≥1024px)**：完全不动

**修改**：
- ✏️ `src/components/SubtitleFileList/components/SubtitleFileItem.tsx`：外层 padding、FileIcon size prop、header 字号加响应式
- ✏️ `src/components/SubtitleFileList/components/FileActionButtons.tsx`：footer `<div className="flex items-center gap-3">` 改为 `<div className="flex flex-col md:flex-row gap-2 md:gap-3">`，主按钮加 `w-full md:w-auto`
- ✏️ `src/components/SubtitleFileList/components/FileIcon.tsx`：支持外部传入 `size` 而非写死 32

---

### 3.4 D. Modal 弹窗

**断点**：`<768px` 手机 vs `≥768px` 平板+桌面

**手机 (<768px)**：**全屏**，3 段式
- 顶部固定 48px：标题 + ✕ 关闭（圆角 32px 按钮）
- 中间 scroll：表单字段（正常 padding 16px）
- 底部固定：操作按钮栏
  - 取消按钮：`flex-1`（占 1/3）
  - 主操作按钮：`flex-2`（占 2/3，蓝色 #0066FF）
- 圆角 0（全屏无边角）
- backdrop **不显示**（全屏盖住无意义）

**平板 (≥768px)**：
- 居中：`md:inset-auto md:max-w-[560px]`
- 圆角 `md:rounded-2xl` (16px)
- 表单 2 列布局（grid `md:grid-cols-2`）
- 保留 backdrop
- 底部操作栏内嵌（非 sticky）

**桌面 (≥1024px)**：
- 居中：`lg:max-w-[680px]`
- 圆角 `lg:rounded-2xl` (16px)
- 表单 2 列布局（不变）
- 保留 backdrop

**修改**：
- ✏️ `src/components/SettingsModal.tsx`：DialogContent 加响应式 class
- ✏️ `src/components/HistoryModal.tsx`：同上
- ✏️ `src/components/TermsManager.tsx`：同上
- ✏️ `src/components/SubtitleEditor.tsx`：同上（最关键——内容最多）
- ✏️ `src/components/ConfirmDialog.tsx`：同上（结构简单）
- ✏️ `src/components/GuideModal.tsx`：同上（结构简单）

**统一抽象**（可选，不强求）：如果 6 个 modal 的响应式 class 完全相同，可抽 `ResponsiveModal` 包装组件减少重复。

---

## 4. 决策记录

| 决策 | 替代方案 | 选择理由 |
|---|---|---|
| 响应式 + 断点条件 UI | 纯 CSS / 独立 mobile 组件 | 平衡：CSS 优先，必要时用 `hidden md:flex` 拆结构 |
| 沿用 Tailwind 默认断点 | 自定义断点 | 主流、避免与社区组件冲突 |
| Navbar 用 Radix Dialog 抽屉 | Sheet / 自写 | 项目已有 Radix 依赖，零新依赖 |
| 上传区拍照/录音用 `<input capture>` | 调原生 API / Capacitor | 浏览器原生支持、零依赖、够用 |
| 文件卡 footer 2 行堆叠 | dropdown menu / sheet 收纳 | 最简单，无需新交互 |
| Modal 全屏用 `inset-0` | 单独做 MobileModal 组件 | Tailwind 几行 class 搞定，无需新组件 |
| 4 个 modal 各自改 | 抽 ResponsiveModal 包装 | 视重复程度决定，不强求 |
| 平板布局只微调 | 平板做单独布局 | 平板 768-1024 与桌面 1024+ 差异小，复用桌面即可 |

---

## 5. 验收

### 5.1 自动化检查

- [ ] TypeScript 编译通过
- [ ] ESLint 通过
- [ ] 现有 143 个测试全通过
- [ ] `pnpm build` 成功

### 5.2 手动验证（用 Chrome DevTools 模拟）

- [ ] **375px 宽（iPhone SE）**：
  - [ ] Navbar：标题 + ☰ 按钮，无溢出
  - [ ] 点 ☰ → 抽屉从顶部滑出，含 3 个选项
  - [ ] 上传区：紧凑、显示拍照/录音按钮
  - [ ] 文件卡 footer：2 行，主按钮 full width
  - [ ] Modal：全屏，3 段式，底部 sticky 操作栏可见
- [ ] **768px 宽（iPad 竖屏）**：
  - [ ] Navbar：3 按钮横排（不带 v1.2 badge）
  - [ ] 上传区：p-8 中等，无拍照/录音
  - [ ] 文件卡 footer：单行
  - [ ] Modal：居中 560px 宽，2 列表单
- [ ] **1280px 宽（桌面）**：
  - [ ] 全部不变
- [ ] **边界**：测试 640px、768px、1024px 切换是否平滑

### 5.3 真机测试（部署到 eggtranslate.pages.dev 后）

- [ ] iPhone Safari
- [ ] Android Chrome
- [ ] iPad Safari（横竖屏各一次）

---

## 6. 未来扩展（不在本期范围）

- 移动端手势（swipe to delete、pull to refresh）
- 移动端专属文件选择器（拍照即时转录）
- 平板多任务分屏适配
- 暗色模式（如果项目后续要做）
- 触摸优化（按钮最小 44×44 hit area，符合 Apple HIG）
