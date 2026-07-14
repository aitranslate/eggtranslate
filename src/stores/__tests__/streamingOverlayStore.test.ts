import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  useStreamingOverlayStore,
  mergeEntriesWithOverlay,
  EMPTY_STREAMING_OVERLAY,
  countStreamingLines,
  calcDisplayTranslationProgress,
  __resetStreamingOverlayForTests,
} from '../streamingOverlayStore';
import type { SubtitleEntry } from '@/types';

describe('streamingOverlayStore', () => {
  let rafQueue: FrameRequestCallback[];

  beforeEach(() => {
    __resetStreamingOverlayForTests();
    rafQueue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      // no-op for tests
      void id;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetStreamingOverlayForTests();
  });

  function flushRaf() {
    const q = rafQueue.splice(0, rafQueue.length);
    for (const cb of q) cb(performance.now());
  }

  it('coalesces multiple applyPartials into one rAF flush', () => {
    const store = useStreamingOverlayStore.getState();
    store.applyPartials('f1', [{ id: 1, text: '你' }]);
    store.applyPartials('f1', [{ id: 1, text: '你好' }, { id: 2, text: '世' }]);

    expect(useStreamingOverlayStore.getState().overlays.f1).toBeUndefined();
    expect(rafQueue).toHaveLength(1);

    flushRaf();

    expect(useStreamingOverlayStore.getState().overlays.f1).toEqual({
      1: '你好',
      2: '世',
    });
    // 本帧最后变长的是 id 2 → 光标落在 2
    expect(useStreamingOverlayStore.getState().activeCaretByFile.f1).toBe(2);
  });

  it('moves active caret to the line that is growing', () => {
    const store = useStreamingOverlayStore.getState();
    store.applyPartials('f1', [{ id: 1, text: '甲' }]);
    flushRaf();
    expect(useStreamingOverlayStore.getState().activeCaretByFile.f1).toBe(1);

    store.applyPartials('f1', [{ id: 1, text: '甲乙' }, { id: 2, text: '丙' }]);
    flushRaf();
    expect(useStreamingOverlayStore.getState().activeCaretByFile.f1).toBe(2);
  });

  it('clearIds drops overlay and ignores stale rAF partials', () => {
    const store = useStreamingOverlayStore.getState();
    store.applyPartials('f1', [{ id: 1, text: '旧' }]);
    expect(rafQueue).toHaveLength(1);

    store.clearIds('f1', [1]);
    flushRaf();

    expect(useStreamingOverlayStore.getState().overlays.f1).toBeUndefined();
  });

  it('clearFile drops entire file overlay', () => {
    useStreamingOverlayStore.setState({
      overlays: { f1: { 1: 'a', 2: 'b' }, f2: { 3: 'c' } },
    });
    useStreamingOverlayStore.getState().clearFile('f1');
    expect(useStreamingOverlayStore.getState().overlays).toEqual({ f2: { 3: 'c' } });
  });

  it('after clear, new partials still apply on next frame', () => {
    const store = useStreamingOverlayStore.getState();
    store.applyPartials('f1', [{ id: 1, text: '旧' }]);
    store.clearIds('f1', [1]);
    flushRaf();

    store.applyPartials('f1', [{ id: 1, text: '新' }]);
    flushRaf();
    expect(useStreamingOverlayStore.getState().overlays.f1).toEqual({ 1: '新' });
  });
});

describe('calcDisplayTranslationProgress', () => {
  it('counts streaming lines as soft progress', () => {
    expect(calcDisplayTranslationProgress(2, 10, 3)).toEqual({
      translated: 5,
      total: 10,
      percentage: 50,
    });
  });

  it('does not exceed remaining slots', () => {
    expect(calcDisplayTranslationProgress(8, 10, 5).translated).toBe(10);
    expect(calcDisplayTranslationProgress(8, 10, 5).percentage).toBe(100);
  });

  it('countStreamingLines ignores empty strings', () => {
    expect(countStreamingLines({ 1: 'a', 2: '', 3: 'b' })).toBe(2);
    expect(countStreamingLines(EMPTY_STREAMING_OVERLAY)).toBe(0);
  });
});

describe('mergeEntriesWithOverlay', () => {
  const entries: SubtitleEntry[] = [
    {
      id: 1,
      startTime: '0',
      endTime: '1',
      text: 'a',
      translatedText: '',
      translationStatus: 'pending',
    },
    {
      id: 2,
      startTime: '1',
      endTime: '2',
      text: 'b',
      translatedText: 'done',
      translationStatus: 'completed',
    },
  ];

  it('returns same array ref when overlay empty', () => {
    expect(mergeEntriesWithOverlay(entries, EMPTY_STREAMING_OVERLAY)).toBe(entries);
    expect(mergeEntriesWithOverlay(entries, undefined)).toBe(entries);
  });

  it('keeps non-streaming entry identity for memo', () => {
    const merged = mergeEntriesWithOverlay(entries, { 1: '译' });
    expect(merged[0].translatedText).toBe('译');
    expect(merged[0].translationStatus).toBe('streaming');
    expect(merged[1]).toBe(entries[1]);
  });
});
