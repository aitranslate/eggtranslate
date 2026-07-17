// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useIsMobile, MOBILE_BREAKPOINT_PX } from '../useIsMobile';

describe('useIsMobile', () => {
  let listeners: Array<() => void>;
  let matches: boolean;

  beforeEach(() => {
    listeners = [];
    matches = false;
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches,
        media: query,
        addEventListener: (_: string, cb: () => void) => {
          listeners.push(cb);
        },
        removeEventListener: (_: string, cb: () => void) => {
          listeners = listeners.filter((l) => l !== cb);
        },
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => true,
        onchange: null,
      }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it(`uses max-width under ${MOBILE_BREAKPOINT_PX}px`, () => {
    renderHook(() => useIsMobile());
    expect(window.matchMedia).toHaveBeenCalled();
    const q = vi.mocked(window.matchMedia).mock.calls[0][0];
    expect(q).toMatch(/max-width:\s*899\.98px/);
  });

  it('returns initial matchMedia snapshot', () => {
    matches = true;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });
});
