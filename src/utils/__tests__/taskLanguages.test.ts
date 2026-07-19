import { describe, it, expect } from 'vitest';
import { resolveTaskLanguages, withTaskLanguages } from '../taskLanguages';
import type { TranslationConfig } from '@/types';

const baseConfig = {
  sourceLanguage: 'English',
  targetLanguage: '简体中文',
} as Pick<TranslationConfig, 'sourceLanguage' | 'targetLanguage'>;

const fullConfig = {
  profiles: [],
  activeProfileId: '',
  sourceLanguage: 'English',
  targetLanguage: '简体中文',
  contextBefore: 1,
  contextAfter: 1,
  batchSize: 10,
  threadCount: 2,
} as TranslationConfig;

describe('resolveTaskLanguages', () => {
  it('uses task languages when present', () => {
    expect(
      resolveTaskLanguages(
        { sourceLanguage: 'Japanese', targetLanguage: 'Korean' },
        baseConfig
      )
    ).toEqual({ sourceLanguage: 'Japanese', targetLanguage: 'Korean' });
  });

  it('falls back to global when task fields missing', () => {
    expect(resolveTaskLanguages({}, baseConfig)).toEqual(baseConfig);
    expect(resolveTaskLanguages(null, baseConfig)).toEqual(baseConfig);
    expect(resolveTaskLanguages(undefined, baseConfig)).toEqual(baseConfig);
  });

  it('falls back per-field when only one side set', () => {
    expect(
      resolveTaskLanguages({ sourceLanguage: 'French' }, baseConfig)
    ).toEqual({ sourceLanguage: 'French', targetLanguage: '简体中文' });
    expect(
      resolveTaskLanguages({ targetLanguage: 'German' }, baseConfig)
    ).toEqual({ sourceLanguage: 'English', targetLanguage: 'German' });
  });

  it('treats blank task languages as missing', () => {
    expect(
      resolveTaskLanguages({ sourceLanguage: '  ', targetLanguage: '' }, baseConfig)
    ).toEqual(baseConfig);
  });
});

describe('withTaskLanguages', () => {
  it('returns same config reference when languages match', () => {
    const out = withTaskLanguages(fullConfig, {
      sourceLanguage: 'English',
      targetLanguage: '简体中文',
    });
    expect(out).toBe(fullConfig);
  });

  it('returns new config when task languages differ', () => {
    const out = withTaskLanguages(fullConfig, {
      sourceLanguage: 'Japanese',
      targetLanguage: 'Korean',
    });
    expect(out).not.toBe(fullConfig);
    expect(out.sourceLanguage).toBe('Japanese');
    expect(out.targetLanguage).toBe('Korean');
    expect(out.batchSize).toBe(fullConfig.batchSize);
  });
});
