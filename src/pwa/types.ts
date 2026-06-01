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
