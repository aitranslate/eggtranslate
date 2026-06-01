import { describe, it, expect } from 'vitest';
import { parseSRT, toSRT, toTXT, toBilingual, toSrcTrans } from '../srtParser';
import type { SubtitleEntry } from '@/types';

const makeEntry = (overrides: Partial<SubtitleEntry> = {}): SubtitleEntry => ({
  id: 1,
  startTime: '00:00:01,000',
  endTime: '00:00:02,000',
  text: 'Hello world',
  translatedText: '',
  translationStatus: 'pending',
  ...overrides,
});

// ============================================================
// parseSRT
// ============================================================

describe('parseSRT', () => {
  it('parses a single valid SRT entry', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000
Hello world
`;
    const result = parseSRT(srt);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 1,
      startTime: '00:00:01,000',
      endTime: '00:00:02,000',
      text: 'Hello world',
      translationStatus: 'pending',
    });
    expect(result[0].translatedText).toBeUndefined();
  });

  it('parses multiple SRT entries', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000
First line

2
00:00:03,000 --> 00:00:04,000
Second line

3
00:00:05,000 --> 00:00:06,000
Third line
`;
    const result = parseSRT(srt);
    expect(result).toHaveLength(3);
    expect(result[0].text).toBe('First line');
    expect(result[1].text).toBe('Second line');
    expect(result[2].text).toBe('Third line');
    expect(result[0].startTime).toBe('00:00:01,000');
    expect(result[2].endTime).toBe('00:00:06,000');
  });

  it('returns empty array for empty string', () => {
    expect(parseSRT('')).toEqual([]);
  });

  it('preserves newlines within a multi-line subtitle text', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000
Line one
Line two
`;
    const result = parseSRT(srt);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Line one\nLine two');
  });

  it('parses the standard SRT timestamp format 00:00:01,000 --> 00:00:02,000', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000
Some text
`;
    const result = parseSRT(srt);
    expect(result[0].startTime).toBe('00:00:01,000');
    expect(result[0].endTime).toBe('00:00:02,000');
  });

  it('normalizes timestamps with dot separator to comma format', () => {
    const srt = `1
00:00:01.500 --> 00:00:02.750
Some text
`;
    const result = parseSRT(srt);
    expect(result[0].startTime).toBe('00:00:01,500');
    expect(result[0].endTime).toBe('00:00:02,750');
  });

  it('handles out-of-order ids gracefully by preserving them in source order', () => {
    // The SRT spec sometimes has ids that are not in numeric order.
    // The wrapper should not crash and should preserve the original id values.
    const srt = `3
00:00:05,000 --> 00:00:06,000
Third

1
00:00:01,000 --> 00:00:02,000
First

2
00:00:03,000 --> 00:00:04,000
Second
`;
    const result = parseSRT(srt);
    expect(result).toHaveLength(3);
    expect(result.map(e => e.id)).toEqual([3, 1, 2]);
    // Texts should be in the order they appeared in the source
    expect(result.map(e => e.text)).toEqual(['Third', 'First', 'Second']);
  });

  it('tolerates trailing blank lines at the end of the file', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000
Hello



`;
    const result = parseSRT(srt);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Hello');
  });
});

// ============================================================
// toSRT
// ============================================================

describe('toSRT', () => {
  it('serializes a single entry to a valid SRT block', () => {
    const entries = [makeEntry()];
    const out = toSRT(entries);
    expect(out).toContain('1');
    expect(out).toContain('00:00:01,000 --> 00:00:02,000');
    expect(out).toContain('Hello world');
  });

  it('uses translatedText when useTranslation is true (default)', () => {
    const entries = [makeEntry({ translatedText: '你好世界' })];
    const out = toSRT(entries);
    expect(out).toContain('你好世界');
    expect(out).not.toContain('Hello world');
  });

  it('uses original text when useTranslation is false', () => {
    const entries = [makeEntry({ translatedText: '你好世界' })];
    const out = toSRT(entries, false);
    expect(out).toContain('Hello world');
    expect(out).not.toContain('你好世界');
  });

  it('falls back to original text when translatedText is empty even with useTranslation=true', () => {
    const entries = [makeEntry({ translatedText: '' })];
    const out = toSRT(entries, true);
    expect(out).toContain('Hello world');
  });

  it('returns empty string for empty array', () => {
    expect(toSRT([])).toBe('');
  });

  it('renumbers ids sequentially starting from 1', () => {
    const entries = [
      makeEntry({ id: 99, startTime: '00:00:01,000', endTime: '00:00:02,000' }),
      makeEntry({ id: 42, startTime: '00:00:03,000', endTime: '00:00:04,000' }),
    ];
    const out = toSRT(entries);
    // The output should start with "1\r\n" not "99\r\n" or "42\r\n"
    expect(out.startsWith('1\r\n')).toBe(true);
    // "42" must not appear as a standalone id line
    expect(out).not.toMatch(/^42\r\n/m);
  });
});

// ============================================================
// toTXT
// ============================================================

describe('toTXT', () => {
  it('emits one entry per chunk separated by blank lines', () => {
    const entries = [
      makeEntry({ id: 1, text: 'First' }),
      makeEntry({ id: 2, text: 'Second' }),
      makeEntry({ id: 3, text: 'Third' }),
    ];
    const out = toTXT(entries);
    expect(out).toBe('First\n\nSecond\n\nThird');
  });

  it('uses translatedText when useTranslation is true', () => {
    const entries = [
      makeEntry({ text: 'Hello', translatedText: '你好' }),
      makeEntry({ text: 'World', translatedText: '世界' }),
    ];
    expect(toTXT(entries, true)).toBe('你好\n\n世界');
  });

  it('uses original text when useTranslation is false', () => {
    const entries = [
      makeEntry({ text: 'Hello', translatedText: '你好' }),
      makeEntry({ text: 'World', translatedText: '世界' }),
    ];
    expect(toTXT(entries, false)).toBe('Hello\n\nWorld');
  });

  it('falls back to original text when translatedText is empty', () => {
    const entries = [makeEntry({ text: 'Original', translatedText: '' })];
    expect(toTXT(entries, true)).toBe('Original');
  });

  it('returns empty string for empty array', () => {
    expect(toTXT([])).toBe('');
  });
});

// ============================================================
// toBilingual
// ============================================================

describe('toBilingual', () => {
  it('includes both translatedText and text for entries that have a translation', () => {
    const entries = [makeEntry({ text: 'Hello', translatedText: '你好' })];
    const out = toBilingual(entries);
    // The actual implementation puts translatedText on the first line and text on the second
    expect(out).toContain('你好');
    expect(out).toContain('Hello');
    // Verify both lines appear in order: translation first, then source
    const translationIdx = out.indexOf('你好');
    const sourceIdx = out.indexOf('Hello');
    expect(translationIdx).toBeGreaterThanOrEqual(0);
    expect(sourceIdx).toBeGreaterThan(translationIdx);
  });

  it('emits the original text with an empty translation line when translatedText is empty', () => {
    const entries = [makeEntry({ text: 'Hello', translatedText: '' })];
    const out = toBilingual(entries);
    // The implementation produces "{translatedText || ''}\n{text}" = "\nHello"
    // After the toSrt round-trip, expect both the empty line and "Hello" to be present
    expect(out).toContain('Hello');
    // The empty translation line shows up as a "\r\n\r\n" pattern adjacent to "Hello"
    expect(out).toMatch(/\r\n\r\nHello\r\n\r\n/);
  });

  it('returns empty string for empty array', () => {
    expect(toBilingual([])).toBe('');
  });
});

// ============================================================
// toSrcTrans
// ============================================================

describe('toSrcTrans', () => {
  it('emits source text followed by translated text', () => {
    const entries = [makeEntry({ text: 'Hello', translatedText: '你好' })];
    const out = toSrcTrans(entries);
    expect(out).toContain('Hello');
    expect(out).toContain('你好');
    // Source should appear before translation
    const sourceIdx = out.indexOf('Hello');
    const translationIdx = out.indexOf('你好');
    expect(sourceIdx).toBeGreaterThanOrEqual(0);
    expect(translationIdx).toBeGreaterThan(sourceIdx);
  });

  it('returns empty string for empty array', () => {
    expect(toSrcTrans([])).toBe('');
  });
});
