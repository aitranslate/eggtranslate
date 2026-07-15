# EggTranslate 设计语言

> **Workbench 产品壳 + Apple 软方圆控件**  
> 主色蓝作品牌 CTA · 成功绿仅状态 · 局部菜单可用 Tailwind 浅蓝强调 · 全站优先 token

本文档描述**当前已上线的 UI 约定**（以仓库实现为准），而不是未落地的理想稿。新增界面时对齐本文；历史文件里少量硬编码若无碍观感，不强制一次性清扫。

---

## 双轨 token

| 体系 | 用途 | 定义位置 |
|------|------|----------|
| `--apple-*` | 按钮、输入、弹窗内容、通用语义色 | `src/apple-style.css` |
| `--wb-*` | 顶栏 / 侧栏 / 编辑区壳层 | `src/workbench.css` |

品牌色统一指向蓝：`--wb-brand` → `var(--apple-blue)`。  
移动端补充：`src/mobile.css`（`.m-*` 类）。

---

## 颜色（浅色默认）

| Token | 值 | 用途 |
|-------|-----|------|
| `--apple-bg-primary` | `#ffffff` | 页面/弹窗底 |
| `--apple-bg-secondary` | `#f5f5f7` | 输入底、次级面 |
| `--apple-bg-tertiary` | `#e8e8ed` | 按下/更深层 |
| `--apple-text-primary` | `#1d1d1f` | 主文案 |
| `--apple-text-secondary` | `#86868b` | 次文案 |
| `--apple-text-tertiary` | `#a1a1a6` | 占位/弱信息 |
| `--apple-blue` | `#0071e3` | **主色 / 主 CTA** |
| `--apple-blue-hover` | `#0077ed` | 主色 hover |
| `--apple-blue-active` | `#0062cc` | 主色 active |
| `--apple-blue-soft` | `rgba(0,113,227,.08)` | 浅强调底 |
| `--apple-blue-soft-strong` | `rgba(0,113,227,.14)` | 稍强浅蓝 |
| `--apple-success` | `#34c759` | 成功状态、完成勾 |
| `--apple-success-soft` | `#ecfdf5` | 成功浅底 |
| `--apple-danger` | `#ff3b30` | 危险文字/边 |
| `--apple-danger-soft` | `#fff5f5` | 危险浅底 |
| `--apple-warning` | `#ff9500` | 警告/必填提示 |
| `--apple-border-light` | `#d2d2d7` | 边框 |
| `--apple-border-lighter` | `#e8e8ed` | 弱边框 |

### 允许的局部用法（现状）

- **下拉/菜单选中行**：`bg-blue-50`、`text-blue-600` 等 Tailwind 工具色（导出菜单、模型选择等），与主 CTA 的实心蓝按钮区分层级。
- **Toast**（`App.tsx`）：浅色卡片固定 hex（白底 + 绿/红 icon），与主题联动可后续再做，不挡当前体验。
- **PWA `theme_color`**：`#F3C323`（品牌黄，见 `vite.config.ts` manifest），与壳内主 CTA 蓝并存——安装栏/状态栏用黄，工具内操作仍用蓝。
- **ErrorBoundary**：全页错误降级面，可用偏警示的紫/红铺色，**不作为**日常工作台 CTA 规范。

### 仍建议避免

- 工作台主操作按钮做成绿/紫大实心块（成功绿只表示「已完成」状态）
- 进度条再写一套与 `--apple-blue` / `--wb-brand` 无关的主色 hex
- 管理页再发明第三套品牌主色

---

## 暗色主题

通过 `html.dark` 或 `.workbench[data-theme='dark']` 覆盖（见 `workbench.css`）：

| Token | 暗色值 | 说明 |
|-------|--------|------|
| `--apple-bg-primary` | `#12141a` | 内容面 |
| `--apple-bg-secondary` | `#1a1d26` | 次级面 |
| `--apple-bg-tertiary` | `#232733` | 更深一层 |
| `--apple-text-primary` | `#eceef2` | 主文案 |
| `--apple-text-secondary` | `#a8afbb` | 次文案 |
| `--apple-text-tertiary` | `#8b929e` | 弱信息 |
| `--apple-blue` | `#0a84ff` | 暗色主色 |
| `--apple-blue-hover` | `#409cff` | hover |
| `--apple-blue-active` | `#0070e0` | active |
| `--apple-blue-soft` | `rgba(10,132,255,.12)` | 浅蓝底 |
| `--apple-success` | `#30d158` | 成功 |
| `--apple-danger` | `#ff453a` | 危险 |
| `--apple-warning` | `#ff9f0a` | 警告 |
| `--apple-border-light` | `#3d4354` | 边框 |
| `--apple-border-lighter` | `#2c303c` | 弱边框 |

主题由 `themeStore` 管理，在 `document.documentElement` 上切换 `dark` class。

---

## Workbench 壳层 token

| Token | 浅色（约） | 用途 |
|-------|------------|------|
| `--wb-bg` | `#f0f1f3` | 画布底 |
| `--wb-panel` | `#ffffff` | 侧栏、顶栏、面板 |
| `--wb-panel-2` | `#f7f7f8` | 次级面板 / 输入底 |
| `--wb-border` / `--wb-border-strong` | `#e5e5ea` / `#d2d2d7` | 分割线 |
| `--wb-text` / `--wb-text-2` / `--wb-text-3` | 主 / 次 / 弱 | 壳层文案 |
| `--wb-brand` | `var(--apple-blue)` | 强调、链接、active |
| `--wb-brand-soft` | `var(--apple-blue-soft)` | 浅强调底 |

常用 class：`.wb-tool`、`.wb-chip`、`.wb-seg`、`.wb-topbar`、字幕编辑 `.se-*` 等（`src/workbench.css`）。

新 UI：**壳层布局/工具条** 优先 `--wb-*` 与 workbench class；**表单主按钮/输入** 优先 `ui/*` + apple token。

---

## 圆角

| Token | 值 | 用途 |
|-------|-----|------|
| `--apple-radius-control` | `10px` | 输入、icon 钮、小按钮 |
| `--apple-radius-button` | `12px` | Primary / Secondary |
| `--apple-radius-card` | `16px` | 卡片 |
| `--apple-radius-card-large` | `20px` | 大卡片/弹窗 |
| `--apple-radius-pill` | `999px` | badge / chip / 导航小标签；icon 圆形点缀也可 |

**主 CTA 按钮**默认软方圆（12px），不是大药丸。药丸留给计数徽章、版本 chip、状态点。

---

## 高度节奏

| Token | 值 | 用途 |
|-------|-----|------|
| `--apple-control-h-sm` | `38px` | 工具条、密集区 |
| `--apple-control-h` | `42px` | 默认按钮/输入 |
| `--apple-control-h-lg` | `46px` | 少数强调行 |

表单行：输入与同排按钮尽量同高。  
icon-only 按钮常见 **36×36**。

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

| size | class |
|------|-------|
| `sm` | `.apple-button-sm` |
| `md` | 默认 |
| `lg` | `.apple-button-lg` |

**动效**：颜色/阴影变化为主；工作台 CTA 避免夸张 `scale`。ErrorBoundary 等特殊页可例外。

壳层工具钮也可直接用 `.wb-tool` 等，不必强行包一层 `Button`。

---

## 输入框

优先 `import { Input } from '@/components/ui'`，或 `.apple-input` / `.apple-input-sm`。

- 默认高与按钮 md 对齐  
- focus：panel 底 + brand 边 + soft ring  
- password：隐藏浏览器原生 reveal（`::-ms-reveal`）

设置表单里也常见 Tailwind + CSS 变量拼出的 `inputClass`（与 apple-input 视觉一致即可）。

---

## 组件入口

```
src/components/ui/Button.tsx
src/components/ui/Input.tsx
src/components/ui/index.ts
src/apple-style.css      // apple tokens + .apple-button / .apple-input
src/workbench.css        // --wb-* 壳层 + 暗色 + 编辑器 se-*
src/mobile.css           // 移动壳
```

当前 primitive 以 **Button / Input** 为主；Select、Modal、菜单等仍由业务组件 + token/class 组合实现。新增高频控件时再抽 `ui/*`，避免为抽而抽。

---

## 进度 / 状态

- 品牌进度色：`var(--apple-blue)` / `var(--wb-brand)`  
- 完成：`var(--apple-success)` + soft 底  
- 失败：`var(--apple-danger)`  
- 阶段 UI：`StepperProgress`（侧栏摘要 / 进度轨 / tooltip）

---

## 弹窗与抽屉

- 遮罩：`bg-black/40 backdrop-blur-sm`  
- 面板：白底（暗色 panel）、card-large 圆角、限高、头固定内容滚动  
- 设置：抽屉/全屏向（`SettingsModal`），移动端全屏优先  
- 标题 + 关闭：icon button  

---

## 动效

- 全局常用 **framer-motion**（阶段切换、菜单、弹层）  
- 尊重 `prefers-reduced-motion` 的组件：如 `CountUp`、`MobileMenu`  
- 新动画：短、淡、少位移；避免干扰编辑区阅读

---

## 与架构的关系

视觉约定见本文；**状态 / 服务分层**见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。  
改 UI 不必动 service；改翻译/队列逻辑不必改 DESIGN。

---

## 检查清单（PR 自检）

- [ ] 工作台主 CTA 是否仍是品牌蓝、软方圆？  
- [ ] 成功绿是否只用于完成态，而不是主按钮底？  
- [ ] 壳层是否优先 `--wb-*`，表单控件是否优先 apple / `ui/*`？  
- [ ] 新硬编码色是否有理由（菜单选中 / toast / PWA / 错误页）？  
- [ ] 暗色下正文、边框、主色是否可读？  
- [ ] 业务逻辑是否落在 service，而不是堆进组件或 config store？  
