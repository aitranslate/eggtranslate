# EggTranslate 设计语言

> **Apple 工具风 + 软方圆控件**  
> 主色只蓝 · CTA 不是大圆/药丸 · 成功绿只作状态 · 全站走 token 与 `ui/*` primitive

---

## 颜色

| Token | 值 | 用途 |
|-------|-----|------|
| `--apple-bg-primary` | `#ffffff` | 页面/弹窗底 |
| `--apple-bg-secondary` | `#f5f5f7` | 输入底、次级面 |
| `--apple-bg-tertiary` | `#e8e8ed` | 按下/更深层 |
| `--apple-text-primary` | `#1d1d1f` | 主文案 |
| `--apple-text-secondary` | `#86868b` | 次文案 |
| `--apple-text-tertiary` | `#a1a1a6` | 占位/弱信息 |
| `--apple-blue` | `#0071e3` | **唯一主色 / 主 CTA** |
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

**反例**

- 绿/紫大块 CTA（`bg-emerald-500` 主按钮）
- 进度/按钮再写一套 `#0066FF`
- 管理页自定第三品牌色

---

## 圆角

| Token | 值 | 用途 |
|-------|-----|------|
| `--apple-radius-control` | `10px` | 输入、icon 钮、小按钮 |
| `--apple-radius-button` | `12px` | Primary / Secondary |
| `--apple-radius-card` | `16px` | 卡片 |
| `--apple-radius-card-large` | `20px` | 大卡片/弹窗 |
| `--apple-radius-pill` | `999px` | **仅** badge / chip / 导航小标签 |

**主按钮不是药丸。** 药丸只给计数徽章、版本号 chip。

---

## 高度节奏

| Token | 值 | 用途 |
|-------|-----|------|
| `--apple-control-h-sm` | `36px` | 工具条、密集区 |
| `--apple-control-h` | `40px` | 默认按钮/输入 |
| `--apple-control-h-lg` | `44px` | 少数强调行 |

表单行：输入与同排按钮同高。

---

## 按钮

使用 `import { Button } from '@/components/ui'`，或等价 class：

| variant | class | 用途 |
|---------|-------|------|
| `primary` | `.apple-button` | 页面/弹窗 **唯一** 主操作 |
| `secondary` | `+ .apple-button-secondary` | 测试、导入、次要 |
| `ghost` | `+ .apple-button-ghost` | 取消 |
| `danger` | `+ .apple-button-danger` | 清空、删除（红字，非大红实心） |
| icon-only | `.apple-icon-button` / `iconOnly` | 关闭等，**方圆 10px，不是大圆球** |

| size | class |
|------|-------|
| `sm` | `.apple-button-sm` |
| `md` | 默认 |
| `lg` | `.apple-button-lg` |

**动效**：颜色/阴影变化；避免 CTA 上 `scale(1.02)`。

---

## 输入框

使用 `import { Input } from '@/components/ui'`，或 `.apple-input` / `.apple-input-sm`。

- 默认高 = 按钮 md  
- focus：白底 + brand 边 + soft ring  
- password：隐藏浏览器原生 reveal（`::-ms-reveal`）

---

## 组件入口

```
src/components/ui/Button.tsx
src/components/ui/Input.tsx
src/components/ui/index.ts
src/apple-style.css   // tokens + .apple-button / .apple-input
```

新 UI **优先** `Button` / `Input`，不要再手搓 `bg-blue-600 rounded-full`。

---

## 进度 / 状态

- 品牌进度色：`var(--apple-blue)`  
- 完成：`var(--apple-success)` + soft 底  
- 失败：`var(--apple-danger)`  
- 1 步 / 2 步 / 完成态形态见 `StepperProgress`（摘要行 vs 进度轨）

---

## 弹窗

- 遮罩：`bg-black/40 backdrop-blur-sm`  
- 面板：白底、card-large 圆角、限高、头固定内容滚动（设置页参考）  
- 标题 + 关闭：icon button  

---

## 检查清单（PR 自检）

- [ ] 主 CTA 是否只有蓝、软方圆？  
- [ ] 是否出现绿/紫大按钮？  
- [ ] 输入与按钮高度是否对齐？  
- [ ] 硬编码 hex 是否可换成 token？  
- [ ] 新按钮/输入是否用了 `ui/*`？  
