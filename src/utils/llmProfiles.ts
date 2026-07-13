/**
 * LLM 多档案：每个服务商（含自定义）一套，选中即用
 * profile.id === presetId（agnes / deepseek / custom …）
 */

import type { LLMConfig, LlmProfile, TranslationConfig } from '@/types';
import {
  LLM_PROVIDER_PRESETS,
  getProviderById,
  type LlmProviderId,
  type LlmProviderPreset,
} from '@/constants/llmProviders';

export function createProfileFromPreset(preset: LlmProviderPreset, apiKey = ''): LlmProfile {
  return {
    id: preset.id,
    name: preset.name,
    baseURL: preset.baseURL,
    model: preset.model,
    apiKey,
    presetId: preset.id,
    requiresKey: preset.requiresKey ?? true,
  };
}

/** 为全部服务商各建一套（Key 为空） */
export function createDefaultProfiles(): LlmProfile[] {
  return LLM_PROVIDER_PRESETS.map((p) => createProfileFromPreset(p));
}

export function getActiveProfile(config: TranslationConfig): LlmProfile {
  const { profiles, activeProfileId } = config;
  if (!profiles?.length) {
    return createProfileFromPreset(getProviderById('agnes'));
  }
  return profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
}

export function getActiveLlmConfig(config: TranslationConfig): LLMConfig {
  const p = getActiveProfile(config);
  return {
    baseURL: p.baseURL,
    apiKey: p.apiKey,
    model: p.model,
    rpm: config.rpm,
  };
}

export function isProfileConfigured(profile: LlmProfile): boolean {
  if (profile.requiresKey === false) return true;
  return (profile.apiKey?.trim().length ?? 0) > 0;
}

export function isTranslationLlmConfigured(config: TranslationConfig): boolean {
  if (!config.profiles?.length) return false;
  return isProfileConfigured(getActiveProfile(config));
}

/** 更新当前启用服务商的字段 */
export function updateActiveProfile(
  config: TranslationConfig,
  patch: Partial<Omit<LlmProfile, 'id' | 'presetId'>>
): TranslationConfig {
  const activeId = config.activeProfileId;
  const profiles = config.profiles.map((p) =>
    p.id === activeId ? { ...p, ...patch } : p
  );
  return { ...config, profiles };
}

/**
 * 选中服务商 = 切换到该套配置（各自 Key/URL/模型独立）
 * 若缺失则按预设补全一条
 */
export function selectProvider(
  config: TranslationConfig,
  providerId: LlmProviderId
): TranslationConfig {
  let profiles = config.profiles;
  if (!profiles.some((p) => p.id === providerId)) {
    const preset = getProviderById(providerId);
    profiles = [...profiles, createProfileFromPreset(preset)];
  }
  return { ...config, profiles, activeProfileId: providerId };
}

/** 确保档案完整且 active 有效 */
export function ensureProfiles(config: TranslationConfig): TranslationConfig {
  const profiles = config.profiles?.length ? [...config.profiles] : createDefaultProfiles();

  // 补齐缺失的服务商槽位，并同步预设字段（如 requiresKey）
  for (const preset of LLM_PROVIDER_PRESETS) {
    const idx = profiles.findIndex((p) => p.id === preset.id);
    if (idx === -1) {
      profiles.push(createProfileFromPreset(preset));
    } else if (profiles[idx].requiresKey === undefined) {
      profiles[idx] = { ...profiles[idx], requiresKey: preset.requiresKey ?? true };
    }
  }

  const activeExists = profiles.some((p) => p.id === config.activeProfileId);
  return {
    ...config,
    profiles,
    activeProfileId: activeExists ? config.activeProfileId : 'agnes',
  };
}
