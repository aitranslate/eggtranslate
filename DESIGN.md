# EggTranslate 设计语言

> **浅色专业桌面客户端**  
> 灰壳三层结构 · 高密度数据网格 · 等宽数字 · 细滚动条 · 浅色为一等公民，深色同结构配套

本文档描述**当前已上线的 UI 约定**（以仓库实现为准）。新增界面时对齐本文；历史文件里少量硬编码若无碍观感，不强制一次性清扫。

---

## 设计模型：客户端，不是网页

借鉴 VS Code / Linear / Aegisub 的结构语言：

- **三层结构**：`--wb-bg` 灰壳（顶栏/侧栏/状态栏/画布）→ `--wb-panel` 内容面（编辑器/卡片/抽屉）→ `--wb-panel-2` 凹槽控件（输入/hover/chip）。浅色下壳是灰、内容是白；深色下壳更暗、内容更亮——两个主题同一层级模型。
- **窗口标题栏**：44px，三段网格（左品牌 / 正中分段导航 / 右系统钮），导航永远居中。
- **仪表状态栏**：26px，11.5px 字号，计数用等宽数字。
- **密度**：UI 正文 13px、辅助 11.5–12.5px；桌面字幕行固定 **68px**（`.se-row`）；900px 视口下可用列表区约可放 **~11 行**（顶栏 44 + 状态栏 26 + 工具栏/表头后剩余 ÷ 68）。移动端为堆叠可变高卡片，虚拟列表 `estimateSize ≈ 128`，由 `measureElement` 实测校正。
- **细滚动条**：全局 10px（视觉 6px、padding-box 内缩），Firefox `scrollbar-width: thin`——宽滚动条是「网页感」最强信号，不允许出现。
- **键盘优先**：`.workbench` 与 `.m-shell` 下 `:focus-visible` 均为 2px brand 环；`::selection` 品牌浅底；快捷键渲染为 `kbd` 键帽。
- **断点**：`<900px` 走 `MobileShell`（`useIsMobile` / `MOBILE_BREAKPOINT_PX = 900`）；`≥900px` 走桌面 workbench 双栏。与 `workbench.css` 堆叠媒体查询对齐，避免 768–900 半桌面无底栏路径。

---

## 双轨 token

| 体系 | 用途 | 定义位置 |
|------|------|----------|
| `--apple-*` | 按钮、输入、弹窗内容、通用语义色 | `src/apple-style.css` |
| `--wb-*` | 顶栏 / 侧栏 / 编辑区壳层 | `src/workbench.css` |

品牌色统一指向蓝：`--wb-brand` → `var(--apple-blue)`。  
移动端补充：`src/mobile.css`（`.m-*` 类），消费同一套 `--wb-*` token。

---

## 颜色（浅色默认）

| Token | 值 | 用途 |
|-------|-----|------|
| `--wb-bg` | `#f2f3f5` | 灰壳：顶栏/侧栏/状态栏/画布 |
| `--wb-panel` | `#ffffff` | 内容面：编辑器/卡片/抽屉 |
| `--wb-panel-2` | `#e9ebef` | 凹槽：输入底/hover/chip |
| `--wb-border` / `--wb-border-strong` | `#e3e5ea` / `#d2d5db` | 发丝线 / 强线 |
| `--wb-text` / `-2` / `-3` | `#1f2328` / `#5f6670` / `#878e99` | 文案三级 |
| `--apple-blue` | `#0071e3` | **主色 / 主 CTA** |
| `--apple-blue-hover` / `-active` | `#0077ed` / `#0062cc` | 主色态 |
| `--apple-blue-soft` | `rgba(0,113,227,.08)` | 浅强调底 |
| `--apple-success` | `#34c759` | 成功状态、完成勾（仅状态） |
| `--apple-danger` | `#ff3b30` | 危险文字/边 |
| `--apple-warning` | `#ff9500` | 警告/必填提示 |
| `--wb-scroll` / `--wb-scroll-hover` | `#c4c9d1` / `#a7aeb9` | 滚动条 thumb |

### 允许的局部用法（现状）

- **下拉/菜单选中行**：`bg-blue-50`、`text-blue-600` 等 Tailwind 工具色（导出菜单、模型选择等），与主 CTA 的实心蓝按钮区分层级。
- **PWA `theme_color`**：`#F3C323`（品牌黄，见 `vite.config.ts` manifest），安装栏/状态栏用黄，工具内操作仍用蓝。
- **ErrorBoundary**：全页错误降级面，可用偏警示的紫/红铺色，**不作为**日常工作台 CTA 规范。
- **历史统计紫色** `.wb-stats .val.purple`：语义化统计色，保留。

### 仍建议避免

- 工作台主操作按钮做成绿/紫大实心块（成功绿只表示「已完成」状态）
- 进度条再写一套与 `--apple-blue` / `--wb-brand` 无关的主色 hex
- 管理页再发明第三套品牌主色
- **新写主题相关 hex**：一律先找 token；暗色覆盖块里出现的 `#xxxxxx` 视为技术债

---

## 暗色主题

通过 `html.dark` 或 `.workbench[data-theme='dark']` 覆盖（见 `workbench.css`、移动端 `mobile.css`）：

| Token | 暗色值 | 说明 |
|-------|--------|------|
| `--wb-bg` | `#14171c` | 灰壳（最深） |
| `--wb-panel` | `#1b1f26` | 内容面（略亮） |
| `--wb-panel-2` | `#242a33` | 凹槽控件 |
| `--wb-border` / `-strong` | `#2a303a` / `#39414d` | 发丝线 |
| `--wb-text` / `-2` / `-3` | `#e6eaf0` / `#9aa4b2` / `#77818e` | 文案三级 |
| `--apple-blue` | `#2f81f7` | 暗色主色（hover `#4c94ff` / active `#1f6feb`） |
| `--apple-success` | `#3fb950` | 成功 |
| `--apple-danger` | `#f85149` | 危险 |
| `--apple-warning` | `#d29922` | 警告 |
| `--wb-scroll` / `-hover` | `#3d4450` / `#4d5563` | 滚动条 |

主题由 `themeStore` 管理，在 `document.documentElement` 上切换 `dark` class；**默认浅色**。

---

## 尺寸与布局

| Token | 值 | 用途 |
|-------|-----|------|
| `--wb-top-h` | `44px` | 标题栏 |
| `--wb-status-h` | `26px` | 状态栏 |
| `--wb-sidebar-w` | `288px` | 侧栏 |
| `--apple-control-h` | `36px` | 表单默认按钮/输入 |
| `--apple-control-h-sm` | `32px` | 工具条控件 |
| `--apple-control-h-lg` | `40px` | 少数强调行 |

壳层网格：`.workbench` = `grid-template-rows: var(--wb-top-h) 1fr var(--wb-status-h)`，浮层（设置抽屉、菜单、确认框）必须是 `.workbench` 的**兄弟节点**，不能当 grid 子项。

---

## 字体与数字

- UI 字体栈不变：`--apple-font-stack`（系统 SF/Segoe 系）
- **等宽数字**：`--wb-font-mono`（`ui-monospace, SF Mono, Cascadia Code, Consolas…`）+ `tabular-nums`，用于：时间码、`#` 序号、Tokens 计数、百分比、进度标签
- 字号节奏：标题栏/正文 13px，辅助 12.5px，标签/表头 10.5–11.5px（表头加大写 + 字距）

---

## 圆角

| Token | 值 | 用途 |
|-------|-----|------|
| `--wb-radius-ctl` | `6px` | 工具钮、小输入 |
| `--wb-radius-panel` | `8px` | 列表项、任务行 |
| `--apple-radius-control` / `-button` | `7px` | 表单输入 / 按钮 |
| `--apple-radius-card` | `10px` | 卡片 |
| `--apple-radius-card-large` | `12px` | 弹窗/抽屉 |
| `--apple-radius-pill` | `999px` | badge / chip / 状态点 |

---

## 关键组件语言

- **主导航**：标题栏正中 `.wb-seg.wb-seg-nav` 分段控件；active 段 = 内容面凸起 + 发丝边（灰壳上的白片）
- **侧栏任务行**：选中 = `--wb-panel` 白块凸起 + 内嵌发丝边 + 左 2px 品牌色条；hover = `--wb-panel-2`
- **字幕网格**：表头 10.5px 大写 + 底部发丝线；行间 1px 发丝分隔，无卡片、无大留白；时间码 mono 11.5px；编辑中行 = brand soft 底 + 左 2px brand 条
- **状态栏**：左 = 状态点 + `Provider · 模型` + 任务/队列；右 = `Tokens n`（mono）
- **空工作区**：居中虚线拖放面板 + brand-soft 图标方块 + 主/次 CTA + `kbd` 键帽
- **弹窗/抽屉**：`--wb-panel` 底、`--apple-radius-card-large` 圆角；遮罩 `bg-black/40 backdrop-blur-sm`

---

## 按钮

优先 `import { Button } from '@/components/ui'`，或等价 class：

| variant | class | 用途 |
|---------|-------|------|
| `primary` | `.apple-button` | 页面/弹窗 **主操作**（蓝实心） |
| `secondary` | `+ .apple-button-secondary` | 测试、导入、次要 |
| `ghost` | `+ .apple-button-ghost` | 取消 |
| `danger` | `+ .apple-button-danger` | 清空、删除（红字/描边向，非大红实心） |
| icon-only | `.apple-icon-button` / `iconOnly` | 关闭等 |

壳层工具钮用 `.wb-tool` / `.wb-nav-btn`（图标变体 `.wb-nav-btn-icon`），侧栏用 `.wb-proj-*` 族。  
**动效**：颜色/阴影变化为主；工作台 CTA 避免夸张 `scale`。

---

## 滚动条与焦点（全局，`src/index.css`）

- `*::-webkit-scrollbar`：10px 槽、thumb `var(--wb-scroll)`、2px transparent border + `padding-box` 内缩
- Firefox：`* { scrollbar-width: thin; scrollbar-color: var(--wb-scroll) transparent }`
- `::selection`：品牌 20% 浅底
- `.workbench :focus-visible`：2px brand 环；input/textarea/select 自带 ring，不叠加

---

## 组件入口

```
src/components/ui/Button.tsx
src/components/ui/Input.tsx
src/components/ui/index.ts
src/apple-style.css      // apple tokens + .apple-button / .apple-input
src/workbench.css        // --wb-* 壳层 + 暗色 + 编辑器 se-*
src/mobile.css           // 移动壳（同一套 --wb-* token）
src/index.css            // 滚动条 / 选中色 / 焦点环全局基底
```

---

## 检查清单（PR 自检）

- [ ] 新界面是否落在三层结构里（壳 `--wb-bg` / 内容 `--wb-panel` / 凹槽 `--wb-panel-2`），而不是发明新底色？
- [ ] 工作台主 CTA 是否仍是品牌蓝？成功绿是否只用于完成态？
- [ ] 数字（时间/计数/百分比）是否用了 `--wb-font-mono` + `tabular-nums`？
- [ ] 是否引入了新硬编码色（尤其暗色覆盖块）？有理由吗？
- [ ] 滚动条是否保持细条（10px / thin）？
- [ ] 暗色下正文、边框、主色是否可读？层级是否仍是「壳暗、内容亮」？
- [ ] 密度是否对齐客户端（行高/内边距不过度留白）？
- [ ] 业务逻辑是否落在 service，而不是堆进组件或 config store？
