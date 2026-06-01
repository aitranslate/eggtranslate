import { describe, it, expect } from 'vitest';
import { cleanText, getRelevantTerms, formatTermsForPrompt } from '../termsHelpers';
import type { Term } from '@/types';

describe('cleanText', () => {
  it('lowercases text', () => {
    expect(cleanText('Hello WORLD')).toBe('helloworld');
  });

  it('removes non-letter, non-number characters', () => {
    expect(cleanText('Hello, World! 123')).toBe('helloworld123');
  });

  it('preserves Unicode letters (Chinese, etc.)', () => {
    expect(cleanText('你好 World')).toBe('你好world');
  });

  it('returns empty string for empty input', () => {
    expect(cleanText('')).toBe('');
  });

  it('returns empty string for symbols-only input', () => {
    expect(cleanText('!@#$%^&*()')).toBe('');
  });
});

describe('getRelevantTerms', () => {
  const sampleTerms: Term[] = [
    { original: 'Apple', translation: '苹果' },
    { original: 'Banana', translation: '香蕉' },
    { original: 'Cherry Pie', translation: '樱桃派', notes: '甜点' },
    { original: 'Cat', translation: '猫' },
  ];

  it('returns empty array when no terms provided', () => {
    expect(getRelevantTerms([], 'I love apples')).toEqual([]);
  });

  it('returns empty array when no terms match', () => {
    expect(getRelevantTerms(sampleTerms, 'I love oranges')).toEqual([]);
  });

  it('finds terms by exact match in text', () => {
    const result = getRelevantTerms(sampleTerms, 'I love Apple and Banana');
    expect(result).toHaveLength(2);
    expect(result.map(t => t.original)).toEqual(['Apple', 'Banana']);
  });

  it('matches case-insensitively (terms are cleaned)', () => {
    const result = getRelevantTerms(sampleTerms, 'apple banana');
    expect(result).toHaveLength(2);
  });

  it('matches in context before text', () => {
    const result = getRelevantTerms(sampleTerms, 'fruit', 'I bought Apple today', '');
    expect(result.some(t => t.original === 'Apple')).toBe(true);
  });

  it('matches in context after text', () => {
    const result = getRelevantTerms(sampleTerms, 'fruit', '', 'and Apple');
    expect(result.some(t => t.original === 'Apple')).toBe(true);
  });

  it('matches multi-word terms (e.g., "Cherry Pie")', () => {
    const result = getRelevantTerms(sampleTerms, 'I love Cherry Pie');
    expect(result.some(t => t.original === 'Cherry Pie')).toBe(true);
  });

  it('preserves notes field in returned terms', () => {
    const result = getRelevantTerms(sampleTerms, 'Cherry Pie is great');
    const cherry = result.find(t => t.original === 'Cherry Pie');
    expect(cherry?.notes).toBe('甜点');
  });

  it('strips internal cleanedOriginal field from returned terms', () => {
    const result = getRelevantTerms(sampleTerms, 'Apple');
    expect(result[0]).not.toHaveProperty('cleanedOriginal');
  });

  it('ignores terms with empty cleaned original (symbols only)', () => {
    const result = getRelevantTerms(
      [{ original: '!@#', translation: 'foo' }],
      'hello world'
    );
    expect(result).toEqual([]);
  });
});

describe('formatTermsForPrompt', () => {
  it('formats basic term without notes', () => {
    expect(formatTermsForPrompt([{ original: 'Apple', translation: '苹果' }]))
      .toBe('Apple -> 苹果');
  });

  it('formats term with notes using // separator', () => {
    expect(formatTermsForPrompt([{ original: 'Apple', translation: '苹果', notes: '水果' }]))
      .toBe('Apple -> 苹果 // 水果');
  });

  it('joins multiple terms with newlines', () => {
    const result = formatTermsForPrompt([
      { original: 'Apple', translation: '苹果' },
      { original: 'Banana', translation: '香蕉' },
    ]);
    expect(result).toBe('Apple -> 苹果\nBanana -> 香蕉');
  });

  it('returns empty string for empty input', () => {
    expect(formatTermsForPrompt([])).toBe('');
  });

  it('mixes terms with and without notes', () => {
    const result = formatTermsForPrompt([
      { original: 'A', translation: '甲' },
      { original: 'B', translation: '乙', notes: 'note' },
      { original: 'C', translation: '丙' },
    ]);
    expect(result).toBe('A -> 甲\nB -> 乙 // note\nC -> 丙');
  });
});
