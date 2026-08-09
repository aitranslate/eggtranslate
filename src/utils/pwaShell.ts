/**
 * PWA 独立窗口壳高：CSS 的 100%/100dvh 在 iOS/Android standalone 里常短一截，
 * 底栏下方会露缝。用 is-pwa class + --app-height（visualViewport/innerHeight）铺满。
 */

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
    if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
  } catch {
    /* ignore */
  }
  // iOS Safari「添加到主屏幕」
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function appHeightPx(): number {
  const vv = window.visualViewport?.height;
  if (typeof vv === 'number' && vv > 0) return Math.round(vv);
  return Math.round(window.innerHeight || document.documentElement.clientHeight || 0);
}

function applyPwaShell(): void {
  const root = document.documentElement;
  const standalone = isStandaloneDisplay();
  root.classList.toggle('is-pwa', standalone);
  const h = appHeightPx();
  if (h > 0) {
    root.style.setProperty('--app-height', `${h}px`);
  }
}

/** 启动时调用一次；监听 resize / display-mode 变化。 */
export function initPwaShell(): void {
  if (typeof window === 'undefined') return;
  applyPwaShell();

  window.addEventListener('resize', applyPwaShell, { passive: true });
  window.addEventListener('orientationchange', applyPwaShell, { passive: true });
  window.visualViewport?.addEventListener('resize', applyPwaShell, { passive: true });
  window.visualViewport?.addEventListener('scroll', applyPwaShell, { passive: true });

  try {
    const mq = window.matchMedia('(display-mode: standalone)');
    mq.addEventListener?.('change', applyPwaShell);
  } catch {
    /* ignore */
  }
}
