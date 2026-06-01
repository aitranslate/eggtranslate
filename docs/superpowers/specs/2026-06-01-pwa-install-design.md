# PWA 安装支持 — 蛋蛋字幕翻译

> **状态**：设计已批准，待实施
> **日期**：2026-06-01
> **优先级**：2026 改版第一阶段（客户端 UI 重构暂缓，等 PWA 完成后再做）

---

## 1. 目标与范围

### 1.1 目标

让用户能够通过 Chrome / Edge 浏览器把"蛋蛋字幕翻译"网站**作为应用安装**到桌面 / 启动器。安装后：

- 浏览器 chrome（地址栏、标签页）**消失**——独立窗口体验
- 桌面 / Dock / 启动器出现应用图标
- 像 VS Code / Notion / Figma 一样从系统启动

### 1.2 范围

**包含**：
- `manifest.webmanifest` 配置文件
- 必需的 PNG 图标（192×192、512×512、maskable 512×512）
- 最小化 Service Worker（仅满足 PWA 安装门槛）
- 自定义安装横幅（B 方案：顶部彩色横幅）
- 已安装检测（standalone 模式判断）
- iOS Safari "添加到主屏幕" 分支处理

**不包含**：
- 离线功能 / 数据缓存（EggTranslate 是纯在线 App，参考 [[project-pwa-online-only]]）
- App 更新提示 / 更新策略（用浏览器默认 SW 更新机制即可）
- Push 通知 / 后台同步（不在需求内）
- 客户端 UI 重构（iOS 卡片风 + B 三栏布局，参考 [[project-pwa-priority]] 暂缓）

---

## 2. 架构

### 2.1 技术选型

| 选型 | 决策 | 理由 |
|---|---|---|
| PWA 插件 | **`vite-plugin-pwa`** | Vite 生态最成熟，自动处理 manifest 生成、SW 注册、icons 哈希、install prompt 事件。10k+ stars，活跃维护。手写 manifest + SW 没有收益。 |
| 图标生成 | **`sharp`（一次性手动脚本）** | 从现有 `favicon.svg` 生成 192/512/maskable-512 PNG。脚本作为 `scripts/generate-pwa-icons.mjs` 提交到仓库，但只手动跑一次（结果 PNG 入版本库）。不集成到 build pipeline，避免每次 `vite build` 都跑。 |
| 安装横幅 | **自写 React 组件** | 复用现有 Radix UI 体系 + Framer Motion，无第三方库。 |

### 2.2 文件结构

```
public/
  favicon.svg                    # 现有，不动
  icons/
    192.png                      # 新增
    512.png                      # 新增
    maskable-512.png             # 新增
src/
  components/
    PWAInstallBanner.tsx         # 新增
  pwa/
    usePWAInstall.ts             # 新增（hooks：捕获 beforeinstallprompt + 检测 standalone）
vite.config.ts                   # 修改：注册 vite-plugin-pwa
```

### 2.3 依赖

- `vite-plugin-pwa` (dev) —— 最新稳定版

无新增运行时依赖。

---

## 3. Manifest 配置

字段值：

| 字段 | 值 | 说明 |
|---|---|---|
| `name` | `蛋蛋字幕翻译` | 安装时 / 应用商店显示的全名 |
| `short_name` | `蛋蛋字幕翻译` | 桌面图标下显示（6 字符，在主流 OS 限额内） |
| `start_url` | `/?source=pwa` | 携带来源参数，便于未来 analytics 区分"从安装的 App 进入"与"从浏览器进入" |
| `display` | `standalone` | 关键：没有浏览器 chrome，是"客户端感"的根本 |
| `theme_color` | `#F3C323` | favicon 蛋黄色，用于状态栏 / 浏览器 chrome 着色 |
| `background_color` | `#ffffff` | 启动屏背景，匹配当前 App body 颜色 |
| `lang` | `zh-CN` | |
| `icons` | 3 个 PNG（见 2.1） | 包括一个 maskable（带 safe zone，用于系统裁切场景） |
| `orientation` | `any` | 允许旋转 |

---

## 4. Service Worker 策略

**零缓存，零预缓存**。理由：EggTranslate 所有业务功能（转录、翻译、模型下载）都需联网，任何缓存都是浪费存储 + 增加失效复杂度（参考 [[project-pwa-online-only]]）。

SW 仅做：
1. 满足 Chrome PWA 安装的最低要求（必须存在 SW）
2. 透传所有 fetch 请求到网络
3. 留出钩子，未来如需加离线能力无需返工

更新策略：
- 跟随 `vite-plugin-pwa` 的默认行为
- 启用 `skipWaiting()` + `clients.claim()` —— 新 SW 立即激活，避免用户停留在旧版本

---

## 5. 安装横幅组件

### 5.1 触发条件（**全部满足才显示**）

1. `beforeinstallprompt` 事件已捕获（即浏览器认为此站点可安装）
2. 当前不是 standalone 模式（`window.matchMedia('(display-mode: standalone)').matches === false`）
3. localStorage 中**没有** `pwa-banner-dismissed` 记录，或记录已超过 7 天
4. 页面加载完成 **5 秒**后（避免与首屏动画冲突）

### 5.2 视觉与交互

- **位置**：页面顶部 `fixed`，覆盖在 navbar 上方
- **样式**：圆角 14px，紫蓝渐变背景（与现有 Apple 风格 navbar 形成对比，让"提示"与"导航"有视觉区分），左 icon + 标题"安装到桌面" + 副标题"获得独立窗口、桌面图标"，右"安装"按钮 + "✕"关闭
- **入场动画**：slide-down 200ms（`framer-motion`）
- **退场动画**：slide-up 200ms
- **点击"安装"**：
  1. 调 `deferredPrompt.prompt()` 触发浏览器原生安装对话框
  2. 监听 `appinstalled` 事件
  3. 关闭横幅
- **点击"✕"关闭**：
  1. 写入 `localStorage['pwa-banner-dismissed'] = Date.now()`
  2. 关闭横幅，7 天内不重弹

### 5.3 iOS Safari 分支

iOS Safari 不支持 `beforeinstallprompt`。检测 UA 后：

- 隐藏标准安装按钮
- 改显示**引导内容**："点击底部分享按钮 ⬆ → 添加到主屏幕" + 简短图示
- 同样尊重 dismiss 持久化逻辑

### 5.4 已安装状态

- 横幅不渲染
- 已在 section 9 列为"未来扩展"——本阶段不实现 navbar 上的"PWA 模式"指示器

---

## 6. 数据流

```
用户首次访问
    ↓
页面加载 5s
    ↓
浏览器检测可安装 → 触发 beforeinstallprompt
    ↓
PWAInstallBanner 捕获事件 → setDeferredPrompt(e)
    ↓
检查所有触发条件 → 显示横幅
    ↓
用户点"安装"
    ↓
deferredPrompt.prompt() → 浏览器原生安装对话框
    ↓
用户确认 → appinstalled 事件 → 关闭横幅
用户取消 → 横幅保持显示
用户点"✕" → 写 localStorage → 关闭横幅
```

---

## 7. 错误与边界情况

| 场景 | 行为 |
|---|---|
| 浏览器不支持 PWA | `beforeinstallprompt` 不触发 → 横幅不显示，App 正常运行（降级到普通网页） |
| 用户在 incognito | 事件可能不触发或不保存安装 → 横幅不显示 |
| 用户已安装但清除了 localStorage | standalone 检测仍为 true → 横幅不显示 |
| 用户 dismiss 后立即又想装 | localStorage 7 天内持久化 → 横幅不显示（可解释为"刻意克制"） |
| HTTPS 不满足 | PWA 不工作 → 横幅不显示（eggtranslate.pages.dev 已 HTTPS，OK） |
| 用户在 iframe 中打开 | 行为正常，无须特殊处理 |

---

## 8. 验收 / 测试

### 8.1 自动化检查

- [ ] Chrome DevTools → Application → Manifest：所有字段填写，无警告
- [ ] Lighthouse → Progressive Web App 分类：全绿（installable、manifest、SW、icons 全部通过）
- [ ] TypeScript 编译通过
- [ ] ESLint 通过

### 8.2 手动验证清单

- [ ] Chrome（Windows）：地址栏右侧出现"安装"按钮 → 点击 → 安装成功 → 桌面有图标 → 双击图标以独立窗口打开 → 没有地址栏
- [ ] Edge（Windows）：同上
- [ ] Chrome（macOS）：同上
- [ ] Android Chrome：菜单 → "添加到主屏幕" → 安装 → 启动后独立窗口
- [ ] iOS Safari：分享 → 添加到主屏幕 → 启动后独立窗口（无浏览器 chrome）
- [ ] install banner 触发：清 localStorage + 5 秒后看到 → 点安装 → 安装成功 → 横幅消失
- [ ] install banner dismiss：点 ✕ → localStorage 写入 → 刷新页面后 5 秒内不重弹
- [ ] 已安装检测：装上后访问同 URL → 横幅不出现
- [ ] iOS 引导：iOS Safari 访问 → 显示"分享 → 添加到主屏幕"提示（不是空）

### 8.3 兼容性基线

- 目标：Chrome 113+、Edge 113+、Safari 17.2+（与项目 README 中"浏览器要求"一致）
- 不支持 PWA 的旧浏览器：降级到普通网页，无横幅，App 正常用

---

## 9. 未来扩展（不在本次范围）

- navbar 上的"PWA 模式"指示器（小绿点 + tooltip，确认用户已安装）
- 离线功能（如果未来业务有需要）
- 应用更新提示（"新版本可用，请刷新"）
- Push 通知
- 快捷操作（长按图标显示"快速转录"等）

---

## 10. 决策记录

| 决策 | 替代方案 | 选择理由 |
|---|---|---|
| 用 `vite-plugin-pwa` | 手写 manifest + SW | 生态成熟，节省维护成本 |
| 复用现有 favicon | 重新设计简化版图标 | 用户明确要求"保持一致"，原 favicon 在浏览器页签尺寸下已显示清晰 |
| `theme_color: #F3C323` | `#0071e3`（Apple 蓝） | 蛋黄黄与 favicon 调性一致；状态栏着色与品牌搭 |
| `background_color: #ffffff` | `#F3C323` | App body 是白色，启动屏保持一致 |
| `display: standalone` | `fullscreen` / `minimal-ui` | standalone 是 Chrome 最广泛支持 + 最贴近"App"体验 |
| 横幅 5 秒延迟触发 | 立即 / 用户主动触发 | 避免与首屏入场动画视觉冲突，给用户先理解 App 内容的时间 |
| dismiss 持久化 7 天 | 永远 / 24h | 7 天平衡"不打扰老用户"与"老用户有机会再看到" |
| 横幅样式：紫蓝渐变 | 蛋黄色 / 中性灰 | 紫蓝与品牌区分明确（"提示"，不是"内容"）；具体色值实施时定 |
