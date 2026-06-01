// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
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

  it('shows banner after delay, when event captured and not standalone and not dismissed', () => {
    const { result } = renderHook(() => usePWAInstall());

    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent());
    });

    act(() => {
      vi.advanceTimersByTime(PWA_BANNER_DELAY_MS);
    });

    expect(result.current.shouldShow).toBe(true);
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

  it('shows banner again if dismiss timestamp is older than 7 days', () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem(PWA_DISMISS_STORAGE_KEY, String(eightDaysAgo));

    const { result } = renderHook(() => usePWAInstall());

    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent());
    });

    act(() => {
      vi.advanceTimersByTime(PWA_BANNER_DELAY_MS);
    });

    expect(result.current.shouldShow).toBe(true);
  });

  it('does not show banner if no beforeinstallprompt event ever fires (unsupported browser)', () => {
    const { result } = renderHook(() => usePWAInstall());

    act(() => {
      vi.advanceTimersByTime(PWA_BANNER_DELAY_MS);
    });

    expect(result.current.shouldShow).toBe(false);
  });

  it('dismiss() writes timestamp to localStorage and hides banner', () => {
    const { result } = renderHook(() => usePWAInstall());

    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent());
    });

    act(() => {
      vi.advanceTimersByTime(PWA_BANNER_DELAY_MS);
    });

    expect(result.current.shouldShow).toBe(true);

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

    expect(result.current.shouldShow).toBe(true);

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
