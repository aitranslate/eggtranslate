// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDebouncedValue } from '../useDebouncedValue';

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('initial', 300));
    expect(result.current).toBe('initial');
  });

  it('does not update before the delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'initial' } }
    );

    rerender({ value: 'updated' });
    expect(result.current).toBe('initial');

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe('initial');
  });

  it('updates to the new value after the delay', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'initial' } }
    );

    rerender({ value: 'updated' });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe('updated');
  });

  it('only applies the last value when changed rapidly within delay', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } }
    );

    rerender({ value: 'b' });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ value: 'c' });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ value: 'd' });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Total elapsed: 300ms since first change, but only 100ms since last
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(200);
    });
    // Now 300ms since last change
    expect(result.current).toBe('d');
  });

  it('honors a custom delay', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebouncedValue(value, delay),
      { initialProps: { value: 'initial', delay: 500 } }
    );

    rerender({ value: 'updated', delay: 500 });

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(result.current).toBe('initial');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('updated');
  });

  it('clears the pending timer on unmount and does not warn about setState on unmounted component', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender, unmount } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'initial' } }
    );

    rerender({ value: 'updated' });
    unmount();

    // Advance past the original delay; if cleanup didn't run, the setTimeout
    // would fire setState on an unmounted component and trigger a warning.
    act(() => {
      vi.advanceTimersByTime(500);
    });

    const setStateWarnings = errorSpy.mock.calls.filter((call) => {
      const message = call.map(String).join(' ');
      return /setState|state update on an (unmounted|unmounted) component/i.test(message);
    });
    expect(setStateWarnings).toEqual([]);

    errorSpy.mockRestore();
  });
});
