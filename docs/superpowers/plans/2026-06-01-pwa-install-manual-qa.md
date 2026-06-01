# PWA 安装 — 手动 QA 清单

> 所有自动化验证已通过。剩下需要你在真实 Chrome / Edge / iOS Safari 里操作的步骤。

## 准备工作

1. 启动 preview server: `cd D:/EggTranslate && pnpm preview`
2. 在 Chrome 中打开 http://localhost:4173

## 自动化验证结果（已完成）

- [x] 生产 build 成功（vite v6.2.6，2.48s）
- [x] `dist/manifest.webmanifest` 字段正确：
  - name: 蛋蛋字幕翻译
  - short_name: 蛋蛋字幕翻译
  - start_url: /?source=pwa
  - display: standalone
  - theme_color: #F3C323
  - background_color: #ffffff
  - 3 个 icons (192, 512, maskable 512)
- [x] `dist/sw.js` 存在，含 `self.skipWaiting()` + `e.clientsClaim()`
- [x] `dist/workbox-9c191d2f.js` 存在
- [x] `dist/icons/192.png` `dist/icons/512.png` `dist/icons/maskable-512.png` 都存在
- [x] 所有 PWA 端点 HTTP 200（/, /manifest.webmanifest, /sw.js, /registerSW.js, /workbox-*.js, /icons/*.png）
- [x] `index.html` 包含 `<link rel="manifest" href="/manifest.webmanifest">` 和 registerSW 脚本注入

## 验收清单

### A. Chrome DevTools 静态检查

打开 DevTools（F12）→ Application 标签：

- [ ] **Manifest 标签**：
  - Name: 蛋蛋字幕翻译
  - Short name: 蛋蛋字幕翻译
  - Start URL: /?source=pwa
  - Display: standalone
  - Theme color: #F3C323（蛋黄）
  - Background color: #ffffff
  - Icons 列出 3 个（192, 512, maskable 512）
  - 无警告/错误

- [ ] **Service Workers 标签**：
  - sw.js 状态 activated 或 activating
  - Source: /sw.js
  - 无报错

### B. 横幅触发（核心功能）

1. **清 localStorage**：DevTools → Application → Storage → Clear site data
2. **刷新页面**（Cmd/Ctrl+Shift+R 硬刷）
3. **等 5 秒**
4. 预期：页面顶部出现紫蓝渐变横幅
   - 左：蛋图标 🥚
   - 中："安装到桌面" / "获得独立窗口、桌面图标"
   - 右：白色"安装"按钮 + ✕ 关闭按钮
5. 横幅**不应该在 navbar 下方**（z-index 1100 > navbar 1000）

### C. dismiss 持久化

1. 点 ✕ 关闭横幅
2. DevTools → Application → Local Storage → 看到 `pwa-banner-dismissed` 键（值是 timestamp）
3. 刷新页面，等 5 秒
4. 预期：横幅**不再出现**（dismiss 7 天内生效）

### D. dismiss TTL 过期

1. DevTools → Console：
   ```javascript
   localStorage.setItem('pwa-banner-dismissed', String(Date.now() - 8 * 24 * 60 * 60 * 1000));
   location.reload();
   ```
2. 等 5 秒
3. 预期：横幅**重新出现**（dismiss 已过期）

### E. 真实安装流程

1. 清 localStorage + 刷新
2. 5 秒后看到横幅 → 点 "安装"
3. Chrome 显示原生安装对话框 → 点 "安装"
4. **桌面出现 🥚 蛋蛋字幕翻译 图标**
5. **双击图标** → 独立窗口打开（**无地址栏**、无标签页）
6. 窗口标题栏着色为 #F3C323
7. 独立窗口中访问同 URL → 等 5 秒 → 横幅**不出现**（standalone 模式检测）

### F. Lighthouse PWA 审计

1. DevTools → Lighthouse 标签
2. 勾选 "Progressive Web App" 分类
3. 点 "Analyze page load"
4. 预期：PWA 分类**全绿**（installable、manifest、SW、icons 全部 ✓）

### G. iOS Safari（如果手边有 iOS 设备）

1. iOS Safari 打开 http://localhost:4173（注意：localhost 在 iOS 上可能需要通过 ngrok 等工具暴露，或部署到 https URL）
2. 等 5 秒
3. 预期：横幅显示"iOS 设备安装" + "点击底部分享按钮 ⬆ 选择 添加到主屏幕"
4. 实际安装：点 Safari 底部分享按钮 → "添加到主屏幕" → 桌面出现图标

## 已知限制

- **localhost 在 iOS 上不工作**：iOS Safari 要求 https。需要 ngrok / 部署 / 局域网 IP
- **dev 模式 SW 不启用**：vite-plugin-pwa 的 devOptions.enabled = false。测试横幅 UX 用 `pnpm preview` 跑生产构建
- **banner 显示在所有页面**：本任务没有做按页面/按条件控制
- **theme-color meta 标签未注入**：vite-plugin-pwa 1.3.0 默认只在 index.html 注入 `<link rel="manifest">` 和 registerSW 脚本，没有注入 `<meta name="theme-color">`。PWA 安装后 OS 仍能从 manifest 读取 theme_color，桌面快捷方式图标正确，但 Chrome 桌面浏览器地址栏在未安装 PWA 时不会着色。如果需要地址栏着色，可在 `index.html` `<head>` 里手动加：
  ```html
  <meta name="theme-color" content="#F3C323" />
  ```
