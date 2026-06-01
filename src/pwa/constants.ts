// src/pwa/constants.ts
// 单一来源：所有与 PWA 横幅行为相关的魔法值。

export const PWA_BANNER_DELAY_MS = 5000; // 页面加载后多久才显示横幅
export const PWA_DISMISS_TTL_DAYS = 7;   // dismiss 持久化时长（天）
export const PWA_DISMISS_STORAGE_KEY = 'pwa-banner-dismissed';

export const PWA_DISMISS_TTL_MS = PWA_DISMISS_TTL_DAYS * 24 * 60 * 60 * 1000;
