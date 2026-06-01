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
