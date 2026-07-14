import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractStreamingDirects,
  readJsonStringFragment,
  createThrottle,
} from '../streamingJson';

describe('readJsonStringFragment', () => {
  it('reads complete string with escapes', () => {
    const s = '你好\\"世界\\n" trailing';
    expect(readJsonStringFragment(s, 0)).toEqual({
      value: '你好"世界\n',
      complete: true,
    });
  });

  it('reads incomplete string at end of stream', () => {
    const s = '部分译文';
    expect(readJsonStringFragment(s, 0)).toEqual({
      value: '部分译文',
      complete: false,
    });
  });

  it('handles incomplete unicode escape without crashing', () => {
    const s = 'a\\u12';
    expect(readJsonStringFragment(s, 0)).toEqual({
      value: 'a',
      complete: false,
    });
  });
});

describe('extractStreamingDirects', () => {
  it('extracts complete entries', () => {
    const raw = JSON.stringify({
      '1': { origin: 'Hello', direct: '你好' },
      '2': { origin: 'World', direct: '世界' },
    });
    expect(extractStreamingDirects(raw)).toEqual({
      '1': '你好',
      '2': '世界',
    });
  });

  it('extracts partial last direct while streaming', () => {
    const raw = `{
  "1": {
    "origin": "Hello",
    "direct": "你好"
  },
  "2": {
    "origin": "World",
    "direct": "世`;
    expect(extractStreamingDirects(raw)).toEqual({
      '1': '你好',
      '2': '世',
    });
  });

  it('strips markdown fence prefix', () => {
    const raw = '```json\n{"1":{"origin":"A","direct":"甲"}}\n```';
    expect(extractStreamingDirects(raw)).toEqual({ '1': '甲' });
  });

  it('returns empty for non-json preamble', () => {
    expect(extractStreamingDirects('thinking...')).toEqual({});
    expect(extractStreamingDirects('')).toEqual({});
  });

  it('grows character by character on partial input', () => {
    const chunks = [
      '{"1":{"origin":"Hi","direct":"',
      '{"1":{"origin":"Hi","direct":"你',
      '{"1":{"origin":"Hi","direct":"你好',
      '{"1":{"origin":"Hi","direct":"你好"}',
    ];
    expect(extractStreamingDirects(chunks[0])).toEqual({});
    expect(extractStreamingDirects(chunks[1])).toEqual({ '1': '你' });
    expect(extractStreamingDirects(chunks[2])).toEqual({ '1': '你好' });
    expect(extractStreamingDirects(chunks[3])).toEqual({ '1': '你好' });
  });
});

describe('createThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs immediately then throttles', () => {
    const throttle = createThrottle(50);
    const fn = vi.fn();
    throttle.schedule(fn);
    expect(fn).toHaveBeenCalledTimes(1);

    throttle.schedule(fn);
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('flush runs pending immediately', () => {
    const throttle = createThrottle(100);
    const fn = vi.fn();
    throttle.schedule(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    throttle.schedule(fn);
    throttle.flush();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
