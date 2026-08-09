/**
 * PWA 独立窗口壳：
 * - 标记 html.is-pwa（CSS 用 inset 铺满，勿再用过小的 --app-height 当 max-height）
 * - --app-height 取 innerHeight / clientHeight / visualViewport 的较大值，仅作兜底 min 参考
 * 安卓平板上 visualViewport 常偏矮，单独用它会在底栏下压出一条缝。
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
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

/** 取较大高度，避免 visualViewport 偏矮把壳压短 */
function appHeightPx(): number {
  const vv = window.visualViewport?.height ?? 0;
  const inner = window.innerHeight || 0;
  const client = document.documentElement?.clientHeight || 0;
  // 安卓部分机型 screen.availHeight 含系统栏，作上限参考但不盲目采用
  const candidates = [vv, inner, client].filter((n) => typeof n === 'number' && n > 0);
  if (candidates.length === 0) return 0;
  return Math.round(Math.max(...candidates));
}

function applyPwaShell(): void {
  const root = document.documentElement;
  const standalone = isStandaloneDisplay();
  root.classList.toggle('is-pwa', standalone);
  // 安卓 WebView 偶发 UA 无 standalone 媒体匹配，再根据 document 全屏感兜底
  if (!standalone) {
    // 保持仅真正独立窗口加 class，避免网页误伤
  }
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
  window.addEventListener('orientationchange', () => {
    // 旋转后部分安卓机 innerHeight 滞后一帧
    window.requestAnimationFrame(applyPwaShell);
    window.setTimeout(applyPwaShell, 120);
    window.setTimeout(applyPwaShell, 400);
  });
  window.visualViewport?.addEventListener('resize', applyPwaShell, { passive: true });

  try {
    const mq = window.matchMedia('(display-mode: standalone)');
    mq.addEventListener?.('change', applyPwaShell);
  } catch {
    /* ignore */
  }
}
