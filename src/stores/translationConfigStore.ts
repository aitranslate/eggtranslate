/**
 * 翻译配置 + 会话 UI 状态 Store
 *
 * 职责边界：
 * - 持久化：多服务商 LLM 档案、语言与批次参数、模型列表缓存
 * - 会话态：是否翻译中、进度条、AbortController、token 累计展示
 *
 * 不包含 LLM 调用 / 批译逻辑 —— 见 services/llmTranslationService.ts
 * 不包含多文件队列编排 —— 见 services/translationService.ts + queueService.ts
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { TranslationConfig, TranslationProgress, LlmProfile } from '@/types';
import type { LlmModelInfo } from '@/utils/listLlmModels';
import {
  createDefaultProfiles,
  ensureProfiles,
  getActiveProfile,
  isTranslationLlmConfigured,
} from '@/utils/llmProfiles';

interface TranslationConfigStore {
  config: TranslationConfig;
  isConfigured: boolean;
  isTranslating: boolean;
  progress: TranslationProgress;
  tokensUsed: number;
  currentTaskId: string;
  abortController: AbortController | null;
  /** 按 profile id 缓存的模型列表，避免每次打开设置都重新获取 */
  cachedModelLists: Record<string, LlmModelInfo[]>;

  updateConfig: (updates: Partial<TranslationConfig>) => Promise<void>;
  cacheModelList: (profileId: string, models: LlmModelInfo[]) => void;
  /** 开始一次翻译会话：创建 AbortController 并标记 isTranslating */
  startTranslation: (taskId?: string) => Promise<AbortController>;
  stopTranslation: () => void;
  resetProgress: () => Promise<void>;
  updateProgress: (
    current: number,
    total: number,
    phase: 'direct' | 'completed',
    status: string,
    taskId?: string,
    newTokens?: number
  ) => Promise<void>;
}

const defaultProfiles = createDefaultProfiles();

const DEFAULT_CONFIG: TranslationConfig = {
  profiles: defaultProfiles,
  activeProfileId: 'agnes',
  sourceLanguage: 'English',
  targetLanguage: '简体中文',
  batchSize: 20,
  threadCount: 4,
  contextBefore: 5,
  contextAfter: 3,
};

const DEFAULT_PROGRESS: TranslationProgress = {
  current: 0,
  total: 0,
  phase: 'direct',
  status: '准备中...',
};

function withConfigured(config: TranslationConfig) {
  const normalized = ensureProfiles(config);
  return {
    config: normalized,
    isConfigured: isTranslationLlmConfigured(normalized),
  };
}

export const useTranslationConfigStore = create<TranslationConfigStore>()(
  persist(
    (set, get) => ({
      config: DEFAULT_CONFIG,
      isConfigured: false,
      isTranslating: false,
      progress: DEFAULT_PROGRESS,
      tokensUsed: 0,
      currentTaskId: '',
      abortController: null,
      cachedModelLists: {},

      updateConfig: async (updates) => {
        const newConfig = { ...get().config, ...updates };
        set(withConfigured(newConfig));
      },

      cacheModelList: (profileId, models) => {
        set({
          cachedModelLists: {
            ...get().cachedModelLists,
            [profileId]: models,
          },
        });
      },

      startTranslation: async (taskId?: string) => {
        const controller = new AbortController();
        set({
          abortController: controller,
          isTranslating: true,
          currentTaskId: taskId || '',
          progress: { ...DEFAULT_PROGRESS, status: '翻译中...' },
        });
        return controller;
      },

      stopTranslation: () => {
        const controller = get().abortController;
        if (controller) controller.abort();
        set({
          isTranslating: false,
          currentTaskId: '',
          progress: DEFAULT_PROGRESS,
          abortController: null,
        });
      },

      resetProgress: async () => {
        set({
          isTranslating: false,
          progress: DEFAULT_PROGRESS,
          tokensUsed: 0,
          currentTaskId: '',
          abortController: null,
        });
      },

      updateProgress: async (current, total, phase, status) => {
        set({ progress: { current, total, phase, status } });
      },
    }),
    {
      name: 'translation-config-v2',
      skipHydration: true,
      partialize: (state) => ({
        config: state.config,
        isConfigured: state.isConfigured,
        cachedModelLists: state.cachedModelLists,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state?.config) return;
        const normalized = ensureProfiles(state.config);
        // 历史语言 code → LANGUAGE_OPTIONS.value
        const src = (normalized.sourceLanguage || '').trim().toLowerCase();
        if (src === 'en' || src === 'eng' || src === 'english') {
          normalized.sourceLanguage = 'English';
        }
        const tgt = (normalized.targetLanguage || '').trim();
        if (tgt === 'zh' || tgt === 'zh-cn' || tgt === 'zh-hans') {
          normalized.targetLanguage = '简体中文';
        }
        state.config = normalized;
        state.isConfigured = isTranslationLlmConfigured(normalized);
      },
    }
  )
);

export const useTranslationConfig = () => useTranslationConfigStore((state) => state.config);

export const useActiveLlmProfile = () =>
  useTranslationConfigStore((state) => getActiveProfile(state.config));

export const useIsTranslationConfigured = () =>
  useTranslationConfigStore((state) => state.isConfigured);

export const useIsTranslating = () => useTranslationConfigStore((state) => state.isTranslating);

export const useTranslationTokensUsed = () =>
  useTranslationConfigStore((state) => state.tokensUsed);

// re-export type for callers that imported LlmProfile via store history
export type { LlmProfile };
