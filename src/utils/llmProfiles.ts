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

function createProfileFromPreset(preset: LlmProviderPreset, apiKey = ''): LlmProfile {
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

/**
 * 默认启用的服务商。
 *
 * 选 index-translate：免 Key、公开 CORS，浏览器可直接调，新用户打开就能
 * 上传 SRT 直接翻，不用先去配 API Key。代价是它是公共网关、有约 10s
 * 超时，所以默认 batchSize 压到 10（见 translationConfigStore）。
 * 已存过配置的老用户不受影响——他们各自的 activeProfileId 照旧。
 */
export const DEFAULT_PROVIDER_ID: LlmProviderId = 'index-translate';

export function getActiveProfile(config: TranslationConfig): LlmProfile {
  const { profiles, activeProfileId } = config;
  if (!profiles?.length) {
    return createProfileFromPreset(getProviderById(DEFAULT_PROVIDER_ID));
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
    requiresKey: p.requiresKey,
  };
}

function isProfileConfigured(profile: LlmProfile): boolean {
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

/**
 * 已从预设中移除的服务商 id。
 *
 * 移除某个服务商时把 id 留在这里：老用户 localStorage 里那条档案会变成
 * 孤儿（选择器再也列不出来，也没法再编辑），而 profile.id 又是持久化主键，
 * 直接改 id 会让已存的用户配置认不出来。因此按 id 清理，比改主键安全。
 */
const REMOVED_PROVIDER_IDS = new Set(['zhipu']);

/** 确保档案完整且 active 有效 */
export function ensureProfiles(config: TranslationConfig): TranslationConfig {
  // 先剔除已下线的服务商，再判空——否则「只剩被移除项」的用户会被清空
  const kept = (config.profiles ?? []).filter((p) => !REMOVED_PROVIDER_IDS.has(p.id));
  const profiles = kept.length ? kept : createDefaultProfiles();

  // 补齐缺失的服务商槽位，并同步预设字段（如 requiresKey）
  for (const preset of LLM_PROVIDER_PRESETS) {
    const idx = profiles.findIndex((p) => p.id === preset.id);
    if (idx === -1) {
      profiles.push(createProfileFromPreset(preset));
    } else if (profiles[idx].requiresKey === undefined) {
      profiles[idx] = { ...profiles[idx], requiresKey: preset.requiresKey ?? true };
    }
  }

  // active 指向已移除的服务商时同样落到默认值
  const activeExists = profiles.some((p) => p.id === config.activeProfileId);
  return {
    ...config,
    profiles,
    activeProfileId: activeExists ? config.activeProfileId : DEFAULT_PROVIDER_ID,
  };
}
