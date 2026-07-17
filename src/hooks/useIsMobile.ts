/**
 * 移动端断点：与 workbench 堆叠断点 max-width: 900px 对齐。
 * <900px 走 MobileShell；≥900px 走桌面 workbench 双栏。
 */

import { useEffect, useState } from 'react';

export const MOBILE_BREAKPOINT_PX = 900;

const QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX - 0.02}px)`;

export function getIsMobileSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(QUERY).matches;
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(getIsMobileSnapshot);

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
