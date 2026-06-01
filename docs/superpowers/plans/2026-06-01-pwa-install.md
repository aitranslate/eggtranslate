# PWA 安装支持 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户能从 Chrome / Edge 把"蛋蛋字幕翻译"作为应用安装到桌面 / 启动器，获得独立窗口体验。

**Architecture:** 用 `vite-plugin-pwa` 生成 manifest + 最小 SW（满足 PWA 安装门槛，不缓存任何资源），从现有 `favicon.svg` 一次性生成 192/512/maskable PNG 提交到版本库；自写 `usePWAInstall` hook + `PWAInstallBanner` 组件处理安装提示 UX。

**Tech Stack:** Vite 6 + React 18 + TypeScript + `vite-plugin-pwa` + `sharp`（图标生成一次性脚本）+ Framer Motion（横幅动画）+ Vitest + Testing Library

---

## 文件结构

```
public/
  icons/                                # 新增目录
    192.png                             # 现有 favicon.svg 转 192×192
    512.png                             # 现有 favicon.svg 转 512×512
    maskable-512.png                    # 512×512 + 80% safe zone 留白
scripts/
  generate-pwa-icons.mjs                # 一次性图标生成脚本（手动跑）
src/
  pwa/
    usePWAInstall.ts                    # 捕获 beforeinstallprompt + 检测 standalone
    types.ts                            # BeforeInstallPromptEvent 类型声明
    constants.ts                        # 触发延迟 / dismiss 持久化天数 / localStorage key
  components/
    PWAInstallBanner.tsx                # 横幅 UI（样式用内联 <style> 注入，避免 CSS Module 配置）
  test/
    pwa/
      usePWAInstall.test.tsx            # hook 单测
      PWAInstallBanner.test.tsx         # 组件单测
vite.config.ts                          # 注册 VitePWA 插件 + manifest 配置
src/components/MainApp.tsx              # 挂载 PWAInstallBanner
package.json                            # 新增 vite-plugin-pwa + sharp devDeps
```

每个新文件单一职责：
- `usePWAInstall.ts` — 只关心"环境状态"（可安装事件 / standalone 模式 / dismiss 持久化），不渲染
- `PWAInstallBanner.tsx` — 只渲染 + 处理用户交互，业务逻辑委托给 hook
- `generate-pwa-icons.mjs` — 只做 SVG → PNG 转换，幂等

---

## Task 1: 安装依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 dev 依赖**

```bash
cd D:/EggTranslate && pnpm add -D vite-plugin-pwa sharp
```

- [ ] **Step 2: 验证安装成功**

```bash
cd D:/EggTranslate && cat package.json | grep -E "vite-plugin-pwa|sharp"
```

预期输出（顺序可能略不同）：

```json
    "sharp": "^0.x.x",
    "vite": "^6.0.1",
    "vite-plugin-pwa": "^x.x.x",
    ...
```

- [ ] **Step 3: 验证 sharp 在 Node 中可用**

```bash
cd D:/EggTranslate && node -e "import('sharp').then(s => console.log('sharp ok, default version:', s.default.versions))"
```

预期输出包含 `sharp ok, default version: { ... }`，无错误。

- [ ] **Step 4: 提交**

```bash
cd D:/EggTranslate && git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add vite-plugin-pwa and sharp for PWA install support"
```

---

## Task 2: 创建图标生成脚本

**Files:**
- Create: `scripts/generate-pwa-icons.mjs`
- Create: `public/icons/192.png`
- Create: `public/icons/512.png`
- Create: `public/icons/maskable-512.png`

- [ ] **Step 1: 创建 scripts 目录**

```bash
mkdir -p D:/EggTranslate/scripts D:/EggTranslate/public/icons
```

- [ ] **Step 2: 编写脚本 `scripts/generate-pwa-icons.mjs`**

```javascript
// scripts/generate-pwa-icons.mjs
// 从 public/favicon.svg 生成 PWA 必需的 PNG 图标。
// 幂等：可重复运行，结果一致。

import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const svgPath = join(root, 'public', 'favicon.svg');
const iconsDir = join(root, 'public', 'icons');

const SIZES = [
  { name: '192.png', size: 192 },
  { name: '512.png', size: 512 },
  // Maskable：safe zone 是中心 80%，所以图标缩放到 80% 后居中
  { name: 'maskable-512.png', size: 512, safeZone: true },
];

async function main() {
  const svg = await readFile(svgPath);

  for (const { name, size, safeZone } of SIZES) {
    if (safeZone) {
      // 缩放到 80%，透明背景，留 10% safe zone padding on each side
      const inner = Math.floor(size * 0.8);
      const padding = Math.floor((size - inner) / 2);
      const resized = await sharp(svg).resize(inner, inner).toBuffer();
      await sharp({
        create: {
          width: size,
          height: size,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([{ input: resized, left: padding, top: padding }])
        .png()
        .toFile(join(iconsDir, name));
    } else {
      await sharp(svg).resize(size, size).png().toFile(join(iconsDir, name));
    }
    console.log(`Generated ${name} (${size}x${size}${safeZone ? ', maskable' : ''})`);
  }

  console.log('All PWA icons generated successfully.');
}

main().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
```

- [ ] **Step 3: 运行脚本**

```bash
cd D:/EggTranslate && node scripts/generate-pwa-icons.mjs
```

预期输出：

```
Generated 192.png (192x192)
Generated 512.png (512x512)
Generated maskable-512.png (512x512, maskable)
All PWA icons generated successfully.
```

- [ ] **Step 4: 验证 PNG 文件元数据正确**

```bash
cd D:/EggTranslate && node -e "
import('sharp').then(async ({default: sharp}) => {
  const f = (n) => sharp('public/icons/' + n).metadata();
  for (const name of ['192.png', '512.png', 'maskable-512.png']) {
    const m = await f(name);
    console.log(name, m.format, m.width + 'x' + m.height);
  }
});
"
```

预期输出（format 必为 png，尺寸必正确）：

```
192.png png 192x192
512.png png 512x512
maskable-512.png png 512x512
```

- [ ] **Step 5: 提交**

```bash
cd D:/EggTranslate && git add scripts/generate-pwa-icons.mjs public/icons/
git commit -m "feat(pwa): generate 192/512/maskable PNG icons from favicon.svg"
```

---

## Task 3: 配置 vite-plugin-pwa

**Files:**
- Modify: `D:/EggTranslate/vite.config.ts`

- [ ] **Step 1: 在 vite.config.ts 中导入并注册 VitePWA**

修改 `D:/EggTranslate/vite.config.ts`，**在 plugins 数组中 react() 之后**添加 VitePWA：

完整文件（修改处用注释标记）：

```typescript
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import sourceIdentifierPlugin from 'vite-plugin-source-info'
import { VitePWA } from 'vite-plugin-pwa'  // <-- NEW

const isProd = process.env.BUILD_MODE === 'prod'

// 部署到 Cloudflare Pages，使用根路径
const base = '/'

export default defineConfig({
  base: base,
  plugins: [
    react(),
    sourceIdentifierPlugin({
      enabled: !isProd,
      attributePrefix: 'data-matrix',
      includeProps: true,
    }),
    VitePWA({                              // <-- NEW
      registerType: 'autoUpdate',          // 新 SW 自动激活（= skipWaiting + clients.claim）
      injectRegister: 'auto',              // 插件自动注入注册脚本
      manifest: {
        name: '蛋蛋字幕翻译',
        short_name: '蛋蛋字幕翻译',
        description: '音视频转录 + 字幕翻译，本地处理隐私安全',
        start_url: '/?source=pwa',
        display: 'standalone',
        theme_color: '#F3C323',
        background_color: '#ffffff',
        lang: 'zh-CN',
        orientation: 'any',
        icons: [
          { src: '/icons/192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 在线 App，不预缓存任何资源
        globPatterns: [],
        cleanupOutdatedCaches: false,
      },
      devOptions: {
        // dev 模式下也启用 PWA，方便手动测试安装横幅
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  optimizeDeps: {},
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('framer-motion')) return 'vendor-framer-motion';
            if (id.includes('@radix-ui')) return 'vendor-radix';
            if (id.includes('react-router')) return 'vendor-react-router';
            if (id.includes('lucide-react')) return 'vendor-lucide';
            if (id.includes('react') || id.includes('react-dom')) return 'vendor-react';
            return 'vendor';
          }
        },
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  },
  // 确保 public 目录下的文件使用相对路径
  publicDir: 'public'
})
```

- [ ] **Step 2: 跑生产构建，验证 manifest + SW 生成**

```bash
cd D:/EggTranslate && pnpm build
```

预期：构建成功，无 TypeScript / Rollup 错误。检查生成文件：

```bash
ls D:/EggTranslate/dist/manifest.webmanifest D:/EggTranslate/dist/sw.js D:/EggTranslate/dist/registerSW.js 2>&1
```

预期：3 个文件都存在。

- [ ] **Step 3: 验证 manifest 字段正确**

```bash
cd D:/EggTranslate && node -e "
const m = require('./dist/manifest.webmanifest');
console.log('name:', m.name);
console.log('short_name:', m.short_name);
console.log('display:', m.display);
console.log('theme_color:', m.theme_color);
console.log('background_color:', m.background_color);
console.log('start_url:', m.start_url);
console.log('icons count:', m.icons.length);
console.log('icon purposes:', m.icons.map(i => i.purpose || 'any').join(','));
"
```

预期输出（顺序可能略不同，但字段值必须正确）：

```
name: 蛋蛋字幕翻译
short_name: 蛋蛋字幕翻译
display: standalone
theme_color: #F3C323
background_color: #ffffff
start_url: /?source=pwa
icons count: 3
icon purposes: any,any,maskable
```

- [ ] **Step 4: 提交**

```bash
cd D:/EggTranslate && git add vite.config.ts
git commit -m "feat(pwa): register VitePWA with manifest and zero-cache SW"
```

---

## Task 4: 实现 usePWAInstall hook（TDD）

**Files:**
- Create: `src/pwa/constants.ts`
- Create: `src/pwa/types.ts`
- Create: `src/pwa/usePWAInstall.ts`
- Create: `src/pwa/__tests__/usePWAInstall.test.tsx`

- [ ] **Step 1: 编写 `src/pwa/constants.ts`**

```typescript
// src/pwa/constants.ts
// 单一来源：所有与 PWA 横幅行为相关的魔法值。

export const PWA_BANNER_DELAY_MS = 5000; // 页面加载后多久才显示横幅
export const PWA_DISMISS_TTL_DAYS = 7;   // dismiss 持久化时长（天）
export const PWA_DISMISS_STORAGE_KEY = 'pwa-banner-dismissed';

export const PWA_DISMISS_TTL_MS = PWA_DISMISS_TTL_DAYS * 24 * 60 * 60 * 1000;
```

- [ ] **Step 2: 编写 `src/pwa/types.ts`**

```typescript
// src/pwa/types.ts
// beforeinstallprompt 事件并非标准 TS 库类型，需要手工声明。

export interface BeforeInstallPromptEvent extends Event {
  /** Platforms (e.g., 'web', 'android', 'windows') the browser thinks the app is installable on. */
  readonly platforms: string[];
  /** Show the browser's install prompt. Resolves to the user's choice. */
  prompt(): Promise<void>;
  /** Resolves with the user's choice once prompt() resolves. */
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}
```

- [ ] **Step 3: 写 hook 测试 `src/pwa/__tests__/usePWAInstall.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { usePWAInstall } from '../usePWAInstall';
import { PWA_BANNER_DELAY_MS, PWA_DISMISS_STORAGE_KEY } from '../constants';
import type { BeforeInstallPromptEvent } from '../types';

function makeBeforeInstallPromptEvent(): BeforeInstallPromptEvent {
  const event = new Event('beforeinstallprompt') as BeforeInstallPromptEvent;
  event.platforms = ['web'];
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
  return event;
}

describe('usePWAInstall', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    // 默认非 standalone
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns shouldShow=false initially, before any event or timer fires', () => {
    const { result } = renderHook(() => usePWAInstall());
    expect(result.current.shouldShow).toBe(false);
    expect(result.current.deferredPrompt).toBeNull();
    expect(result.current.isIOS).toBe(false);
  });

  it('does not show banner before delay elapses, even if event captured', () => {
    const { result } = renderHook(() => usePWAInstall());

    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent());
    });

    act(() => {
      vi.advanceTimersByTime(PWA_BANNER_DELAY_MS - 1);
    });

    expect(result.current.shouldShow).toBe(false);
    expect(result.current.deferredPrompt).not.toBeNull();
  });

  it('shows banner after delay, when event captured and not standalone and not dismissed', async () => {
    const { result } = renderHook(() => usePWAInstall());

    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent());
    });

    act(() => {
      vi.advanceTimersByTime(PWA_BANNER_DELAY_MS);
    });

    await waitFor(() => {
      expect(result.current.shouldShow).toBe(true);
    });
  });

  it('does not show banner if currently in standalone mode (already installed)', async () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(display-mode: standalone)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { result } = renderHook(() => usePWAInstall());

    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent());
    });

    act(() => {
      vi.advanceTimersByTime(PWA_BANNER_DELAY_MS);
    });

    expect(result.current.shouldShow).toBe(false);
  });

  it('does not show banner if localStorage has a recent dismiss timestamp', async () => {
    localStorage.setItem(PWA_DISMISS_STORAGE_KEY, String(Date.now() - 1000));

    const { result } = renderHook(() => usePWAInstall());

    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent());
    });

    act(() => {
      vi.advanceTimersByTime(PWA_BANNER_DELAY_MS);
    });

    expect(result.current.shouldShow).toBe(false);
  });

  it('shows banner again if dismiss timestamp is older than 7 days', async () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem(PWA_DISMISS_STORAGE_KEY, String(eightDaysAgo));

    const { result } = renderHook(() => usePWAInstall());

    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent());
    });

    act(() => {
      vi.advanceTimersByTime(PWA_BANNER_DELAY_MS);
    });

    await waitFor(() => {
      expect(result.current.shouldShow).toBe(true);
    });
  });

  it('does not show banner if no beforeinstallprompt event ever fires (unsupported browser)', () => {
    const { result } = renderHook(() => usePWAInstall());

    act(() => {
      vi.advanceTimersByTime(PWA_BANNER_DELAY_MS);
    });

    expect(result.current.shouldShow).toBe(false);
  });

  it('dismiss() writes timestamp to localStorage and hides banner', async () => {
    const { result } = renderHook(() => usePWAInstall());

    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent());
    });

    act(() => {
      vi.advanceTimersByTime(PWA_BANNER_DELAY_MS);
    });

    await waitFor(() => {
      expect(result.current.shouldShow).toBe(true);
    });

    const before = Date.now();
    act(() => {
      result.current.dismiss();
    });
    const after = Date.now();

    expect(result.current.shouldShow).toBe(false);

    const stored = localStorage.getItem(PWA_DISMISS_STORAGE_KEY);
    expect(stored).not.toBeNull();
    const ts = Number(stored);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('install() calls deferredPrompt.prompt() and hides banner on accepted', async () => {
    const promptSpy = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePWAInstall());

    const event = makeBeforeInstallPromptEvent();
    event.prompt = promptSpy;
    event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });

    act(() => {
      window.dispatchEvent(event);
    });

    act(() => {
      vi.advanceTimersByTime(PWA_BANNER_DELAY_MS);
    });

    await waitFor(() => {
      expect(result.current.shouldShow).toBe(true);
    });

    await act(async () => {
      await result.current.install();
    });

    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(result.current.shouldShow).toBe(false);
  });

  it('install() does nothing if no deferredPrompt is set', async () => {
    const { result } = renderHook(() => usePWAInstall());

    await act(async () => {
      await result.current.install();
    });

    expect(result.current.shouldShow).toBe(false);
  });

  it('detects iOS Safari and exposes isIOS=true', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      configurable: true,
    });

    const { result } = renderHook(() => usePWAInstall());

    expect(result.current.isIOS).toBe(true);
  });

  it('detects non-iOS and exposes isIOS=false', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      configurable: true,
    });

    const { result } = renderHook(() => usePWAInstall());

    expect(result.current.isIOS).toBe(false);
  });
});
```

- [ ] **Step 4: 跑测试，确认全失败（红）**

```bash
cd D:/EggTranslate && pnpm test -- src/pwa/__tests__/usePWAInstall.test.tsx
```

预期：所有测试失败，错误类似 "Cannot find module '../usePWAInstall'"。

- [ ] **Step 5: 实现 hook `src/pwa/usePWAInstall.ts`**

```typescript
// src/pwa/usePWAInstall.ts
// 状态机：
//   - 监听 beforeinstallprompt 捕获 deferred prompt
//   - 检测 standalone 模式（已安装）
//   - 检测 iOS（UA 嗅探 + iPadOS 13+ 兜底）
//   - 检查 localStorage 中的 dismiss 时间戳
//   - 5 秒延迟后，如果以上条件都满足则显示横幅
//
// 不在此处渲染：调用方消费 usePWAInstall() 返回的状态来渲染 UI。

import { useEffect, useState, useCallback } from 'react';
import {
  PWA_BANNER_DELAY_MS,
  PWA_DISMISS_STORAGE_KEY,
  PWA_DISMISS_TTL_MS,
} from './constants';
import type { BeforeInstallPromptEvent } from './types';

export interface UsePWAInstallResult {
  /** 横幅是否应显示。已考虑：deferredPrompt / standalone / dismiss 持久化 / 5s 延迟。 */
  shouldShow: boolean;
  /** 浏览器捕获的安装事件，install() 时调用。 */
  deferredPrompt: BeforeInstallPromptEvent | null;
  /** iOS 设备——iOS Safari 不支持 beforeinstallprompt，需要不同的引导。 */
  isIOS: boolean;
  /** 用户点击 "✕"，写 localStorage 并隐藏横幅。 */
  dismiss: () => void;
  /** 用户点击 "安装"，调 deferredPrompt.prompt()。 */
  install: () => Promise<void>;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS 旧版本的 navigator.standalone
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  return false;
}

function isIOSSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ 报告为桌面 Mac，但 maxTouchPoints > 1 表示触屏
  if (
    navigator.platform === 'MacIntel' &&
    typeof navigator.maxTouchPoints === 'number' &&
    navigator.maxTouchPoints > 1
  ) {
    return true;
  }
  return false;
}

function isRecentlyDismissed(): boolean {
  if (typeof localStorage === 'undefined') return false;
  const raw = localStorage.getItem(PWA_DISMISS_STORAGE_KEY);
  if (!raw) return false;
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < PWA_DISMISS_TTL_MS;
}

export function usePWAInstall(): UsePWAInstallResult {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [elapsed, setElapsed] = useState(false);
  const [dismissed, setDismissed] = useState(() => isRecentlyDismissed());
  // standalone 状态在挂载时确定——用户不会在单次会话中"切换"安装态
  const [isStandaloneNow] = useState(() => isStandalone());
  const isIOS = isIOSSafari();

  useEffect(() => {
    const handler = (e: Event) => {
      // 阻止 Chrome 默认的迷你安装栏
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setElapsed(true), PWA_BANNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(PWA_DISMISS_STORAGE_KEY, String(Date.now()));
    } catch {
      // localStorage 不可用（隐私模式等），忽略
    }
    setDismissed(true);
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setDismissed(true); // 已安装，不再展示
    }
  }, [deferredPrompt]);

  // iOS 没有 beforeinstallprompt，但 iOS 用户仍需要引导
  // —— 他们的"安装"靠用户主动点分享按钮，没有 prompt() 可调
  const shouldShow =
    elapsed &&
    !dismissed &&
    !isStandaloneNow &&
    (deferredPrompt !== null || isIOS);

  return { shouldShow, deferredPrompt, isIOS, dismiss, install };
}
```

- [ ] **Step 6: 跑测试，全部通过（绿）**

```bash
cd D:/EggTranslate && pnpm test -- src/pwa/__tests__/usePWAInstall.test.tsx
```

预期：12 个测试全部 PASS。

- [ ] **Step 7: 类型检查 + lint**

```bash
cd D:/EggTranslate && pnpm lint
```

预期：无错误。如果有 unused-vars 警告，可以忽略（项目 tsconfig 是 strict: false）。

- [ ] **Step 8: 提交**

```bash
cd D:/EggTranslate && git add src/pwa/
git commit -m "feat(pwa): add usePWAInstall hook with TDD coverage"
```

---

## Task 5: 实现 PWAInstallBanner 组件（TDD）

**Files:**
- Create: `src/components/PWAInstallBanner.module.css`
- Create: `src/components/PWAInstallBanner.tsx`
- Create: `src/components/__tests__/PWAInstallBanner.test.tsx`

- [ ] **Step 1: 写组件测试 `src/components/__tests__/PWAInstallBanner.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PWAInstallBanner } from '../PWAInstallBanner';
import type { UsePWAInstallResult } from '../../pwa/usePWAInstall';

const mockUsePWAInstall = vi.fn<() => UsePWAInstallResult>();
vi.mock('../../pwa/usePWAInstall', () => ({
  usePWAInstall: () => mockUsePWAInstall(),
}));

function setHookState(state: Partial<UsePWAInstallResult>) {
  mockUsePWAInstall.mockReturnValue({
    shouldShow: false,
    deferredPrompt: null,
    isIOS: false,
    dismiss: vi.fn(),
    install: vi.fn().mockResolvedValue(undefined),
    ...state,
  });
}

describe('PWAInstallBanner', () => {
  beforeEach(() => {
    mockUsePWAInstall.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when shouldShow=false', () => {
    setHookState({ shouldShow: false });
    const { container } = render(<PWAInstallBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the standard banner for non-iOS with deferredPrompt', () => {
    setHookState({
      shouldShow: true,
      isIOS: false,
      deferredPrompt: { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }), platforms: ['web'] } as unknown as NonNullable<UsePWAInstallResult['deferredPrompt']>,
    });

    render(<PWAInstallBanner />);

    expect(screen.getByText('安装到桌面')).toBeTruthy();
    expect(screen.getByText(/独立窗口|桌面图标/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '安装' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '✕' })).toBeTruthy();
  });

  it('renders the iOS guide when isIOS=true', () => {
    setHookState({
      shouldShow: true,
      isIOS: true,
      deferredPrompt: null,
    });

    render(<PWAInstallBanner />);

    expect(screen.getByText(/分享/)).toBeTruthy();
    expect(screen.getByText(/主屏幕/)).toBeTruthy();
    // iOS 模式不显示 "安装" 按钮（用户手动操作）
    expect(screen.queryByRole('button', { name: '安装' })).toBeNull();
  });

  it('clicking the install button calls install()', async () => {
    const installMock = vi.fn().mockResolvedValue(undefined);
    setHookState({
      shouldShow: true,
      isIOS: false,
      install: installMock,
    });

    render(<PWAInstallBanner />);
    const btn = screen.getByRole('button', { name: '安装' });

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(installMock).toHaveBeenCalledTimes(1);
  });

  it('clicking the close button calls dismiss()', () => {
    const dismissMock = vi.fn();
    setHookState({
      shouldShow: true,
      isIOS: false,
      dismiss: dismissMock,
    });

    render(<PWAInstallBanner />);
    const btn = screen.getByRole('button', { name: '✕' });

    fireEvent.click(btn);

    expect(dismissMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 跑测试，确认全失败（红）**

```bash
cd D:/EggTranslate && pnpm test -- src/components/__tests__/PWAInstallBanner.test.tsx
```

预期：所有测试失败，错误类似 "Cannot find module '../PWAInstallBanner'"。

- [ ] **Step 3: 实现组件 `src/components/PWAInstallBanner.tsx`**

```tsx
// src/components/PWAInstallBanner.tsx
// PWA 安装提示横幅。
// - 默认形态：紫蓝渐变 + 图标 + 标题 + 安装按钮 + 关闭按钮
// - iOS Safari 形态：步骤引导（分享 → 添加到主屏幕）
// 触发逻辑在 usePWAInstall hook；本组件只渲染 + 转发用户交互。

import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { usePWAInstall } from '@/pwa/usePWAInstall';

export const PWAInstallBanner: React.FC = () => {
  const { shouldShow, isIOS, install, dismiss } = usePWAInstall();
  const reduce = useReducedMotion();

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          className={isIOS ? undefined : 'banner-wrapper'}
          role="dialog"
          aria-label="安装应用到桌面"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: -24 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -24 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          style={isIOS ? iosStyle : undefined}
        >
          {isIOS ? (
            <IOSGuide onDismiss={dismiss} />
          ) : (
            <StandardBanner onInstall={install} onDismiss={dismiss} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const iosStyle: React.CSSProperties = {
  position: 'fixed',
  top: 12,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 1100,
  width: 'min(720px, calc(100vw - 24px))',
  borderRadius: 14,
  padding: '14px 16px',
  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  color: '#ffffff',
  boxShadow: '0 8px 32px rgba(102, 126, 234, 0.4)',
  fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
  display: 'flex',
  alignItems: 'center',
  gap: 14,
};

const StandardBanner: React.FC<{
  onInstall: () => void | Promise<void>;
  onDismiss: () => void;
}> = ({ onInstall, onDismiss }) => (
  <div className="banner-wrapper">
    <style>{standardStyles}</style>
    <div className="pwa-icon">🥚</div>
    <div className="pwa-text">
      <p className="pwa-title">安装到桌面</p>
      <p className="pwa-subtitle">获得独立窗口、桌面图标</p>
    </div>
    <div className="pwa-actions">
      <button className="pwa-install-btn" onClick={onInstall} type="button">
        安装
      </button>
      <button
        className="pwa-close-btn"
        onClick={onDismiss}
        type="button"
        aria-label="关闭"
      >
        ✕
      </button>
    </div>
  </div>
);

const IOSGuide: React.FC<{ onDismiss: () => void }> = ({ onDismiss }) => (
  <div className="pwa-ios-guide">
    <style>{standardStyles}</style>
    <div className="pwa-icon">🥚</div>
    <div className="pwa-text">
      <p className="pwa-title">添加到主屏幕</p>
      <p className="pwa-ios-steps">
        点击底部分享按钮{' '}
        <kbd>⬆</kbd>{' '}
        选择{' '}
        <kbd>添加到主屏幕</kbd>
      </p>
    </div>
    <div className="pwa-actions">
      <button
        className="pwa-close-btn"
        onClick={onDismiss}
        type="button"
        aria-label="关闭"
      >
        ✕
      </button>
    </div>
  </div>
);

// 内联 style —— 避免 CSS Modules 在测试环境下配置复杂度
const standardStyles = `
  .banner-wrapper,
  .pwa-ios-guide {
    position: fixed;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1100;
    width: min(720px, calc(100vw - 24px));
    border-radius: 14px;
    padding: 14px 16px;
    display: flex;
    align-items: center;
    gap: 14px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: #ffffff;
    box-shadow: 0 8px 32px rgba(102, 126, 234, 0.4);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    box-sizing: border-box;
  }
  .pwa-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.18);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    flex-shrink: 0;
  }
  .pwa-text {
    flex: 1;
    min-width: 0;
  }
  .pwa-title {
    font-size: 14px;
    font-weight: 600;
    line-height: 1.3;
    margin: 0;
  }
  .pwa-subtitle {
    font-size: 12px;
    opacity: 0.85;
    line-height: 1.3;
    margin: 2px 0 0 0;
  }
  .pwa-ios-steps {
    font-size: 12px;
    opacity: 0.95;
    line-height: 1.5;
    margin: 4px 0 0 0;
  }
  .pwa-ios-steps kbd {
    background: rgba(255, 255, 255, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 4px;
    padding: 1px 5px;
    font-family: inherit;
    font-size: 11px;
    margin: 0 2px;
  }
  .pwa-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .pwa-install-btn {
    border: none;
    background: #ffffff;
    color: #4a3f8a;
    font-size: 13px;
    font-weight: 600;
    padding: 7px 14px;
    border-radius: 8px;
    cursor: pointer;
    font-family: inherit;
  }
  .pwa-install-btn:hover { background: #f5f4ff; }
  .pwa-install-btn:active { transform: scale(0.96); }
  .pwa-close-btn {
    border: none;
    background: transparent;
    color: #ffffff;
    font-size: 18px;
    line-height: 1;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: inherit;
  }
  .pwa-close-btn:hover { background: rgba(255, 255, 255, 0.18); }
  @media (prefers-reduced-motion: reduce) {
    .pwa-install-btn, .pwa-close-btn { transition: none; }
  }
`;
```

注：上面用 `<style>` 内联而不是 import `.module.css`，因为 jsdom 测试环境不需要 CSS Module 解析。内联 `<style>` 一次注入到 `<head>`，浏览器自动去重。

- [ ] **Step 4: 跑组件测试，全部通过（绿）**

```bash
cd D:/EggTranslate && pnpm test -- src/components/__tests__/PWAInstallBanner.test.tsx
```

预期：5 个测试全部 PASS。

- [ ] **Step 5: 类型检查**

```bash
cd D:/EggTranslate && pnpm build
```

预期：构建成功，无 TypeScript 错误（manifest 也会被生成）。

- [ ] **Step 6: 提交**

```bash
cd D:/EggTranslate && git add src/components/PWAInstallBanner.tsx src/components/__tests__/PWAInstallBanner.test.tsx
git commit -m "feat(pwa): add PWAInstallBanner with iOS Safari branch"
```

---

## Task 6: 在 MainApp 中挂载 PWAInstallBanner

**Files:**
- Modify: `src/components/MainApp.tsx`

- [ ] **Step 1: 在 MainApp.tsx 顶部导入组件**

修改 `D:/EggTranslate/src/components/MainApp.tsx`：

在 import 区域（line 1-25 附近），**HelpButton 导入之后**添加：

```typescript
import { PWAInstallBanner } from './PWAInstallBanner';
```

- [ ] **Step 2: 在 JSX 末尾（HelpButton 之后）渲染横幅**

修改 `D:/EggTranslate/src/components/MainApp.tsx`，找到末尾的 `<HelpButton onClick={() => setIsGuideOpen(true)} />`（line 199 附近），在其**之后**添加：

```tsx
      <PWAInstallBanner />
```

确认结果（line 199-201 区域）：

```tsx
      <HelpButton onClick={() => setIsGuideOpen(true)} />
      <PWAInstallBanner />
    </div>
  );
};
```

- [ ] **Step 3: 跑全部测试，确保 hook + 组件 + 现有测试都过**

```bash
cd D:/EggTranslate && pnpm test
```

预期：所有测试 PASS（包含 usePWAInstall + PWAInstallBanner + 现有 useDebouncedValue）。

- [ ] **Step 4: 类型检查 + lint**

```bash
cd D:/EggTranslate && pnpm lint
```

预期：无错误。

- [ ] **Step 5: 提交**

```bash
cd D:/EggTranslate && git add src/components/MainApp.tsx
git commit -m "feat(pwa): mount PWAInstallBanner in MainApp"
```

---

## Task 7: 手动端到端验证

**Files:** 无（验证 + 修小问题）

- [ ] **Step 1: 启动 dev server**

```bash
cd D:/EggTranslate && pnpm dev
```

预期：Vite 启动在 http://localhost:5173

- [ ] **Step 2: 在 Chrome 中打开并验证 manifest**

在 Chrome 中访问 http://localhost:5173

打开 DevTools → Application → Manifest

预期看到：
- Name: 蛋蛋字幕翻译
- Short name: 蛋蛋字幕翻译
- Start URL: /?source=pwa
- Display: standalone
- Theme color: #F3C323
- Background color: #ffffff
- Icons: 3 个（192, 512, maskable 512）

- [ ] **Step 3: 验证 Service Worker 已注册**

DevTools → Application → Service Workers

预期：`/sw.js` 或 `/registerSW.js` 已注册，状态 activated。

> **注意**：dev 模式下 SW 不一定启用（`devOptions.enabled: false`）。如果没看到，去 step 4。

- [ ] **Step 4: 用 production build 验证完整 PWA 流程**

```bash
cd D:/EggTranslate && pnpm build
pnpm preview
```

打开 http://localhost:4173 —— 这是 PWA-enabled 的预览。

- [ ] **Step 5: 验证安装横幅在 5 秒后出现**

1. 打开 DevTools → Application → Storage → Clear site data（清 localStorage）
2. 刷新页面
3. 等 5 秒
4. 预期：顶部出现紫蓝渐变横幅，左边蛋图标 + "安装到桌面 / 获得独立窗口、桌面图标" + 安装按钮 + ✕
5. 横幅不应该在 navbar 之下（z-index 1100 vs 1000）

- [ ] **Step 6: 验证 dismiss 持久化**

1. 点 ✕ 关闭横幅
2. DevTools → Application → Local Storage → http://localhost:4173 → 看到 `pwa-banner-dismissed` 键值（时间戳）
3. 刷新页面，等 5 秒
4. 预期：横幅不再出现

- [ ] **Step 7: 验证 dismiss TTL**

DevTools → Console：

```javascript
localStorage.setItem('pwa-banner-dismissed', String(Date.now() - 8 * 24 * 60 * 60 * 1000));
location.reload();
```

等 5 秒后预期：横幅再次出现（dismiss 已过期）。

- [ ] **Step 8: 验证真实安装流程**

1. 清 localStorage + 刷新
2. 5 秒后看到横幅 → 点 "安装"
3. Chrome 显示原生安装对话框 → 点 "安装"
4. 桌面出现 🥚 蛋蛋字幕翻译 图标
5. 双击图标 → 独立窗口打开（无地址栏 / 标签页）
6. window 标题栏着色为 #F3C323

- [ ] **Step 9: 验证已安装后不显示横幅**

独立窗口中访问同一 URL → 等 5 秒 → 预期：横幅不出现（standalone 模式检测）

- [ ] **Step 10: 跑 Lighthouse PWA 审计**

DevTools → Lighthouse → 勾选 "Progressive Web App" → Analyze

预期：PWA 分类全部通过（installable, manifest, SW, icons 都有 ✓）

- [ ] **Step 11: 最终提交（如有手动调整）**

如果有在 step 5-10 期间做了任何代码调整，commit：

```bash
cd D:/EggTranslate && git status
# 如果有改动：
git add -A
git commit -m "fix(pwa): manual QA adjustments"
```

如果没改动，跳过。

---

## 自检

**Spec 覆盖**：
- §1.1 目标 → Task 3 (manifest) + 4-6 (banner UX)
- §1.2 范围 - 包含项 → 全部覆盖
- §1.2 范围 - 不包含项 → 已遵循（无离线、无更新提示、无 push）
- §2.1 技术选型 → Task 1 (deps) + 2 (sharp) + 3 (vite-plugin-pwa)
- §2.2 文件结构 → 全部按 spec 创建
- §3 Manifest 字段 → Task 3 完整配置
- §4 SW 策略（零缓存）→ Task 3 的 `workbox.globPatterns: []`
- §4 SW 更新策略（skipWaiting）→ Task 3 的 `registerType: 'autoUpdate'`
- §5.1 触发条件（4 个 AND）→ Task 4 hook 全部实现并测试
- §5.2 视觉交互（slide-down 200ms / 紫蓝渐变 / 安装/关闭）→ Task 5 组件
- §5.3 iOS 分支 → Task 4 (isIOS) + Task 5 (IOSGuide)
- §5.4 已安装不显示 → Task 4 (isStandaloneNow)
- §6 数据流 → Tasks 4-5 完整
- §7 边界情况 → Tasks 4-5 全部覆盖
- §8.1 自动化检查 → Task 3 (manifest) + Task 7 (Lighthouse)
- §8.2 手动验证 → Task 7 全部覆盖
- §10 决策记录 → 全部遵循

**占位符扫描**：无 TBD / TODO / "实现细节"

**类型一致性**：
- `BeforeInstallPromptEvent` 在 types.ts 定义，hook 引用，测试引用 ✓
- `UsePWAInstallResult` 在 hook 导出，组件引用，测试 mock ✓
- `PWA_BANNER_DELAY_MS` / `PWA_DISMISS_TTL_MS` / `PWA_DISMISS_STORAGE_KEY` 在 constants.ts 定义，hook 引用，测试引用 ✓
- `dismiss` / `install` / `shouldShow` / `isIOS` / `deferredPrompt` 在 hook 暴露的所有字段，组件和测试都使用 ✓
