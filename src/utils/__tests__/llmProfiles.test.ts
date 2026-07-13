import { describe, it, expect } from 'vitest';
import {
  createDefaultProfiles,
  ensureProfiles,
  getActiveProfile,
  isTranslationLlmConfigured,
  selectProvider,
  updateActiveProfile,
} from '../llmProfiles';
import type { TranslationConfig } from '@/types';

function baseConfig(overrides?: Partial<TranslationConfig>): TranslationConfig {
  const profiles = createDefaultProfiles();
  return {
    profiles,
    activeProfileId: 'agnes',
    sourceLanguage: 'en',
    targetLanguage: '简体中文',
    batchSize: 20,
    threadCount: 4,
    contextBefore: 5,
    contextAfter: 3,
    ...overrides,
  };
}

describe('llmProfiles', () => {
  it('createDefaultProfiles covers every provider slot', () => {
    const profiles = createDefaultProfiles();
    expect(profiles.length).toBeGreaterThanOrEqual(10);
    expect(profiles.map((p) => p.id)).toContain('deepseek');
    expect(profiles.map((p) => p.id)).toContain('custom');
    expect(profiles.every((p) => p.id === p.presetId)).toBe(true);
  });

  it('selectProvider switches active without wiping other keys', () => {
    let config = baseConfig();
    config = updateActiveProfile(config, { apiKey: 'agnes-key' });
    config = selectProvider(config, 'deepseek');
    config = updateActiveProfile(config, { apiKey: 'ds-key', baseURL: 'https://proxy.example/v1' });

    expect(config.activeProfileId).toBe('deepseek');
    expect(getActiveProfile(config).apiKey).toBe('ds-key');
    expect(getActiveProfile(config).baseURL).toBe('https://proxy.example/v1');

    config = selectProvider(config, 'agnes');
    expect(getActiveProfile(config).apiKey).toBe('agnes-key');
  });

  it('ensureProfiles fills missing slots and repairs active id', () => {
    const incomplete: TranslationConfig = {
      profiles: [
        {
          id: 'custom',
          name: '自定义',
          baseURL: '',
          apiKey: 'k',
          model: 'm',
          presetId: 'custom',
        },
      ],
      activeProfileId: 'missing',
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      batchSize: 20,
      threadCount: 4,
      contextBefore: 1,
      contextAfter: 1,
    };

    const fixed = ensureProfiles(incomplete);
    expect(fixed.profiles.length).toBeGreaterThanOrEqual(10);
    expect(fixed.profiles.some((p) => p.id === 'agnes')).toBe(true);
    expect(fixed.profiles.find((p) => p.id === 'custom')?.apiKey).toBe('k');
    expect(fixed.activeProfileId).toBe('agnes');
  });

  it('isTranslationLlmConfigured only checks active profile key', () => {
    let config = baseConfig();
    expect(isTranslationLlmConfigured(config)).toBe(false);

    config = selectProvider(config, 'deepseek');
    config = updateActiveProfile(config, { apiKey: '  x  ' });
    expect(isTranslationLlmConfigured(config)).toBe(true);

    config = selectProvider(config, 'agnes');
    expect(isTranslationLlmConfigured(config)).toBe(false);
  });

  it('keyless provider is considered configured without API key', () => {
    const profiles = createDefaultProfiles().map((p) =>
      p.id === 'agnes' ? { ...p, requiresKey: false } : p
    );
    const config = { ...baseConfig(), profiles, activeProfileId: 'agnes' };
    expect(isTranslationLlmConfigured(config)).toBe(true);
  });
});
