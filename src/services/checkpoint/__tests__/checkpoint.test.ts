import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import localforage from 'localforage';
import {
  asrWordsFingerprint,
  clearAllTaskCheckpoints,
  fingerprintApiKey,
  findKeyByFingerprint,
  loadTaskCheckpoint,
  parseApiKeys,
  removeTaskCheckpoint,
  resetCheckpointWriteQueuesForTests,
  saveAiBreakSpan,
  saveAsrJobCheckpoint,
  saveTaskCheckpoint,
} from '@/services/checkpoint';

describe('keyFingerprint', () => {
  it('fingerprints and finds the matching key', () => {
    const a = 'sk-aaaaaaa1';
    const b = 'sk-bbbbbbb2';
    const fp = fingerprintApiKey(a);
    expect(findKeyByFingerprint([b, a], fp)).toBe(a);
    expect(findKeyByFingerprint([b], fp)).toBeUndefined();
  });

  it('parses pipe-separated keys', () => {
    expect(parseApiKeys(' a | b | ')).toEqual(['a', 'b']);
    expect(parseApiKeys('')).toEqual([]);
  });
});

describe('checkpoint storage', () => {
  const idb = new Map<string, unknown>();

  beforeEach(() => {
    idb.clear();
    resetCheckpointWriteQueuesForTests();
    vi.spyOn(localforage, 'getItem').mockImplementation(async (name) => {
      return (idb.get(String(name)) ?? null) as never;
    });
    vi.spyOn(localforage, 'setItem').mockImplementation(async (name, value) => {
      idb.set(String(name), value);
      return value as never;
    });
    vi.spyOn(localforage, 'removeItem').mockImplementation(async (name) => {
      idb.delete(String(name));
    });
    vi.spyOn(localforage, 'keys').mockImplementation(async () => [...idb.keys()]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetCheckpointWriteQueuesForTests();
  });

  it('merges asr job then words without dropping transcriptId', async () => {
    await saveAsrJobCheckpoint('t1', {
      transcriptId: 'tid-1',
      keyFingerprint: '10:abc',
      status: 'submitted',
    });
    await saveTaskCheckpoint('t1', {
      words: [{ text: 'hi', start: 0, end: 0.2 }],
      language: 'en',
      asr: { transcriptId: 'tid-1', keyFingerprint: '10:abc', status: 'completed', language: 'en' },
    });
    const loaded = await loadTaskCheckpoint('t1');
    expect(loaded?.asr?.transcriptId).toBe('tid-1');
    expect(loaded?.asr?.status).toBe('completed');
    expect(loaded?.words).toHaveLength(1);
  });

  it('serializes concurrent ai span writes', async () => {
    await Promise.all([
      saveAiBreakSpan('t1', { spanIdx: 0, spanText: 'a', content: 'a [BR] b', tokensUsed: 3 }),
      saveAiBreakSpan('t1', { spanIdx: 1, spanText: 'c', content: null, tokensUsed: 2 }),
    ]);
    const loaded = await loadTaskCheckpoint('t1');
    expect(Object.keys(loaded?.aiBreaks ?? {})).toHaveLength(2);
    expect(loaded?.aiBreaks?.['0']?.content).toContain('[BR]');
    expect(loaded?.aiBreaks?.['1']?.content).toBeNull();
  });

  it('removeTaskCheckpoint deletes the key', async () => {
    await saveAsrJobCheckpoint('t1', {
      transcriptId: 'x',
      keyFingerprint: '1:x',
      status: 'submitted',
    });
    await removeTaskCheckpoint('t1');
    expect(await loadTaskCheckpoint('t1')).toBeNull();
  });

  it('clearAllTaskCheckpoints only removes checkpoint keys', async () => {
    await saveAsrJobCheckpoint('t1', {
      transcriptId: 'x',
      keyFingerprint: '1:x',
      status: 'submitted',
    });
    idb.set('other', 1);
    await clearAllTaskCheckpoints();
    expect(await loadTaskCheckpoint('t1')).toBeNull();
    expect(idb.get('other')).toBe(1);
  });

  it('asrWordsFingerprint changes when word count changes', () => {
    const a = asrWordsFingerprint([{ text: 'a', start: 0, end: 1 }], 'en', 'standard');
    const b = asrWordsFingerprint(
      [
        { text: 'a', start: 0, end: 1 },
        { text: 'b', start: 1, end: 2 },
      ],
      'en',
      'standard'
    );
    expect(a).not.toBe(b);
  });
});
