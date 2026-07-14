/**
 * 翻译配置 Store
 * - 每个服务商一套 LLM（选中即用，各自记 Key/URL/模型）
 * - 语言与批次等翻译参数全局一份
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { TranslationConfig, TranslationProgress, LlmProfile } from '@/types';
import type { LlmModelInfo } from '@/utils/listLlmModels';
import { callLLM } from '@/utils/llmApi';
import { jsonrepair } from 'jsonrepair';
import { generateSharedPrompt, generateDirectPrompt } from '@/utils/translationPrompts';
import toast from 'react-hot-toast';
import { toAppError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import {
  createDefaultProfiles,
  ensureProfiles,
  getActiveLlmConfig,
  getActiveProfile,
  isTranslationLlmConfigured,
} from '@/utils/llmProfiles';
import { toastError } from '@/utils/appToast';

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
  testConnection: () => Promise<boolean>;
  startTranslation: (taskId?: string) => Promise<AbortController>;
  stopTranslation: () => void;
  resetProgress: () => Promise<void>;
  translateBatch: (
    texts: string[],
    signal?: AbortSignal,
    contextBefore?: string,
    contextAfter?: string,
    terms?: string
  ) => Promise<{ translations: Record<string, { direct: string }>; tokensUsed: number }>;
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

      testConnection: async () => {
        const llm = getActiveLlmConfig(get().config);
        const profile = getActiveProfile(get().config);
        if (profile.requiresKey !== false && !llm.apiKey?.trim()) {
          toastError('请先配置 API 密钥');
          return false;
        }
        try {
          await callLLM(
            { baseURL: llm.baseURL, apiKey: llm.apiKey, model: llm.model },
            [{ role: 'user', content: 'Hello' }],
            { maxRetries: 1 }
          );
          toast.success('连接测试成功！');
          return true;
        } catch (error) {
          const appError = toAppError(error, '连接测试失败');
          logger.error(appError.message, appError);
          toastError(`连接测试失败: ${appError.message}`);
          return false;
        }
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

      translateBatch: async (
        texts,
        signal,
        contextBefore = '',
        contextAfter = '',
        terms = ''
      ) => {
        const config = get().config;
        const llm = getActiveLlmConfig(config);
        const profile = getActiveProfile(config);
        if (profile.requiresKey !== false && !llm.apiKey?.trim()) {
          throw new Error('请先配置API密钥');
        }

        const textToTranslate = texts.join('\n');
        const sharedPrompt = generateSharedPrompt(contextBefore, contextAfter, terms);
        const directPrompt = generateDirectPrompt(
          textToTranslate,
          sharedPrompt,
          config.sourceLanguage,
          config.targetLanguage
        );

        const retryTemperatures = [0.3, 0.6, 0.9];
        const formatEmphasis = [
          '',
          '\n\nIMPORTANT: Ensure your response is valid JSON with "direct" field for EVERY entry.',
          '\n\nCRITICAL: You MUST return valid JSON with "direct" field for EVERY single line. Do NOT skip any entries.',
        ];

        for (let attempt = 1; attempt <= 3; attempt++) {
          const promptWithEmphasis = directPrompt + formatEmphasis[attempt - 1];
          const llmResult = await callLLM(
            {
              baseURL: llm.baseURL,
              apiKey: llm.apiKey,
              model: llm.model,
              rpm: config.rpm,
            },
            [{ role: 'user', content: promptWithEmphasis }],
            {
              signal,
              temperature: retryTemperatures[attempt - 1],
              maxRetries: 1,
            }
          );

          try {
            const repairedDirectJson = jsonrepair(llmResult.content);
            const directResult: Record<string, { direct: string }> = JSON.parse(repairedDirectJson);
            validateTranslationResult(directResult, texts);
            return { translations: directResult, tokensUsed: llmResult.tokensUsed };
          } catch (error) {
            logger.error(`批次翻译失败（第${attempt}次尝试）:`, error);
            if (attempt === 3) throw error;
          }
        }
        throw new Error('翻译失败');
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

function validateTranslationResult(
  result: Record<string, { direct: string }>,
  originalTexts: string[]
): void {
  const expectedKeys = originalTexts.map((_, i) => String(i + 1));
  const actualKeys = Object.keys(result);

  for (const key of expectedKeys) {
    if (!actualKeys.includes(key)) {
      throw new Error(`翻译结果缺少键 "${key}"`);
    }
    const entry = result[key];
    if (!entry || typeof entry !== 'object' || !('direct' in entry)) {
      throw new Error(`翻译结果 "${key}" 格式无效`);
    }
  }
}

// re-export type for callers that imported LlmProfile via store history
export type { LlmProfile };
