import { describe, it, expect } from 'vitest';
import {
  createDefaultProfiles,
  ensureProfiles,
  getActiveProfile,
  isTranslationLlmConfigured,
  selectProvider,
  updateActiveProfile,
  DEFAULT_PROVIDER_ID,
} from '../llmProfiles';
import { getProviderById } from '@/constants/llmProviders';
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
    expect(fixed.activeProfileId).toBe(DEFAULT_PROVIDER_ID);
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

  describe('ensureProfiles 清理已下线的服务商', () => {
    it('剔除老用户 localStorage 里的 zhipu 档案', () => {
      const stale = baseConfig();
      stale.profiles.push({
        id: 'zhipu',
        name: '智谱 AI',
        baseURL: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: 'old-key',
        model: 'glm-4.7-flash',
        presetId: 'zhipu',
      });

      const fixed = ensureProfiles(stale);
      expect(fixed.profiles.some((p) => p.id === 'zhipu')).toBe(false);
      // 其余档案（含用户自己的 Key）不受影响
      expect(fixed.profiles.find((p) => p.id === 'custom')?.baseURL).toBeDefined();
    });

    it('active 指向 zhipu 时回落到默认档案，不留悬空 id', () => {
      const stale = baseConfig({ activeProfileId: 'zhipu' });
      const fixed = ensureProfiles(stale);
      expect(fixed.activeProfileId).not.toBe('zhipu');
      expect(fixed.profiles.some((p) => p.id === fixed.activeProfileId)).toBe(true);
    });

    it('档案只剩被移除项时用默认档案兜底，不产出空列表', () => {
      const only = baseConfig({
        activeProfileId: 'zhipu',
        profiles: [
          {
            id: 'zhipu',
            name: '智谱 AI',
            baseURL: 'https://open.bigmodel.cn/api/paas/v4',
            apiKey: 'old-key',
            model: 'glm-4.7-flash',
            presetId: 'zhipu',
          },
        ],
      });

      const fixed = ensureProfiles(only);
      expect(fixed.profiles.length).toBeGreaterThan(0);
      expect(fixed.profiles.some((p) => p.id === 'zhipu')).toBe(false);
      expect(fixed.activeProfileId).toBe(DEFAULT_PROVIDER_ID);
    });

    it('默认服务商免 Key，新用户开箱即用', () => {
      // 默认档要满足「打开就能翻」：requiresKey 为 false 时不需要任何配置就算已就绪
      const preset = getProviderById(DEFAULT_PROVIDER_ID);
      expect(preset.requiresKey).toBe(false);
      const config = ensureProfiles({ ...baseConfig(), activeProfileId: '' });
      expect(config.activeProfileId).toBe(DEFAULT_PROVIDER_ID);
      expect(isTranslationLlmConfigured(config)).toBe(true);
    });
  });
});
