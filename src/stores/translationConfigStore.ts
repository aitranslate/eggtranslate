/**
 * 翻译配置 Store
 * 替代原 TranslationContext，使用 Zustand 管理翻译配置和状态
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { TranslationConfig, TranslationProgress } from '@/types';
import { callLLM } from '@/utils/llmApi';
import { jsonrepair } from 'jsonrepair';
import { generateSharedPrompt, generateDirectPrompt } from '@/utils/translationPrompts';
import toast from 'react-hot-toast';
import { toAppError } from '@/utils/errors';
import { logger } from '@/utils/logger';

// ============================================
// 类型定义
// ============================================

interface TranslationConfigStore {
  // State
  config: TranslationConfig;
  isConfigured: boolean;
  isTranslating: boolean;
  progress: TranslationProgress;
  tokensUsed: number;
  currentTaskId: string;
  abortController: AbortController | null;

  // Actions
  updateConfig: (updates: Partial<TranslationConfig>) => Promise<void>;
  testConnection: () => Promise<boolean>;
  startTranslation: (taskId?: string) => Promise<AbortController>;
  stopTranslation: () => void;
  resetProgress: () => Promise<void>;

  // Translation flow methods
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
    taskId: string,
    newTokens?: number
  ) => Promise<void>;
  completeTranslation: (taskId: string) => Promise<void>;
}

// ============================================
// 默认配置
// ============================================

const DEFAULT_CONFIG: TranslationConfig = {
  baseURL: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  sourceLanguage: 'en',
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
  status: '准备中...'
};

// ============================================
// Store 创建
// ============================================

export const useTranslationConfigStore = create<TranslationConfigStore>()(
  persist(
    (set, get) => ({
      // Initial State
      config: DEFAULT_CONFIG,
      isConfigured: false,
      isTranslating: false,
      progress: DEFAULT_PROGRESS,
      tokensUsed: 0,
      currentTaskId: '',
      abortController: null,

      // ========================================
      // Actions
      // ========================================

      /**
       * 更新配置
       */
      updateConfig: async (updates: Partial<TranslationConfig>) => {
        const newConfig = { ...get().config, ...updates };

        set({
          config: newConfig,
          isConfigured: (newConfig.apiKey?.length || 0) > 0
        });
      },

      /**
       * 测试连接
       */
      testConnection: async () => {
        const config = get().config;
        if (!config.apiKey) {
          toast.error('请先配置API密钥');
          return false;
        }
        try {
          await callLLM(
            { baseURL: config.baseURL, apiKey: config.apiKey, model: config.model },
            [{ role: 'user', content: 'Hello' }],
            { maxRetries: 1 }
          );
          toast.success('连接测试成功！');
          return true;
        } catch (error) {
          const appError = toAppError(error, '连接测试失败');
          logger.error(appError.message, appError);
          toast.error(`连接测试失败: ${appError.message}`);
          return false;
        }
      },

      /**
       * 开始翻译
       */
      startTranslation: async (taskId?: string) => {
        const controller = new AbortController();
        set({
          abortController: controller,
          isTranslating: true,
          currentTaskId: taskId || '',
          progress: { ...DEFAULT_PROGRESS, status: '翻译中...' }
        });
        return controller;
      },

      /**
       * 停止翻译
       */
      stopTranslation: () => {
        const controller = get().abortController;
        if (controller) {
          controller.abort();
        }
        set({
          isTranslating: false,
          currentTaskId: '',
          progress: DEFAULT_PROGRESS,
          abortController: null,
        });
      },

      /**
       * 重置进度
       */
      resetProgress: async () => {
        set({
          isTranslating: false,
          progress: DEFAULT_PROGRESS,
          tokensUsed: 0,
          currentTaskId: '',
          abortController: null,
        });
      },

      /**
       * 批量翻译
       */
      translateBatch: async (
        texts: string[],
        signal?: AbortSignal,
        contextBefore = '',
        contextAfter = '',
        terms = ''
      ) => {
        const config = get().config;
        if (!config.apiKey) {
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

        // 重试策略：逐次提高温度 + 强调格式要求
        const retryTemperatures = [0.3, 0.6, 0.9];
        const formatEmphasis = [
          '',
          '\n\nIMPORTANT: Ensure your response is valid JSON with "direct" field for EVERY entry.',
          '\n\nCRITICAL: You MUST return valid JSON with "direct" field for EVERY single line. Do NOT skip any entries.'
        ];

        for (let attempt = 1; attempt <= 3; attempt++) {
          const promptWithEmphasis = directPrompt + formatEmphasis[attempt - 1];

          const llmResult = await callLLM(
            {
              baseURL: config.baseURL,
              apiKey: config.apiKey,
              model: config.model,
              rpm: config.rpm
            },
            [{ role: 'user', content: promptWithEmphasis }],
            {
              signal,
              temperature: retryTemperatures[attempt - 1],
              maxRetries: 1
            }
          );

          const directContent = llmResult.content;
          const directTokensUsed = llmResult.tokensUsed;

          try {
            // jsonrepair + JSON.parse 也纳入重试范围，避免推理模型偶发返回空内容时直接中断
            const repairedDirectJson = jsonrepair(directContent);
            const directResult: Record<string, { direct: string }> = JSON.parse(repairedDirectJson);
            validateTranslationResult(directResult, texts);
            return { translations: directResult, tokensUsed: directTokensUsed };
          } catch (error) {
            logger.error(`批次翻译失败（第${attempt}次尝试）:`, error);
            if (attempt === 3) throw error;
          }
        }
        throw new Error('翻译失败');
      },

      /**
       * 更新翻译进度
       * 注意：tokens 只在文件级别累加，这里不累加全局 tokens
       */
      updateProgress: async (
        current: number,
        total: number,
        phase: 'direct' | 'completed',
        status: string
      ) => {
        // 只更新进度状态，tokens 由调用方在文件级别管理
        set({
          progress: { current, total, phase, status }
        });
      },

      /**
       * 完成翻译
       */
      completeTranslation: async () => {
        set({
          isTranslating: false,
          currentTaskId: '',
        });
      }
    }),
    {
      name: 'translation-config-storage',
      partialize: (state) => ({
        config: state.config,
        isConfigured: state.isConfigured
      })
    }
  )
);

// ============================================
// 导出辅助 hooks
// ============================================

/**
 * 获取翻译配置
 */
export const useTranslationConfig = () => useTranslationConfigStore((state) => state.config);

/**
 * 获取是否已配置
 */
export const useIsTranslationConfigured = () => useTranslationConfigStore((state) => state.isConfigured);

/**
 * 获取是否正在翻译
 */
export const useIsTranslating = () => useTranslationConfigStore((state) => state.isTranslating);

/**
 * 获取翻译进度
 */
export const useTranslationProgress = () => useTranslationConfigStore((state) => state.progress);

/**
 * 获取已使用 tokens
 */
export const useTranslationTokensUsed = () => useTranslationConfigStore((state) => state.tokensUsed);

/**
 * 验证 LLM 返回的翻译结果是否完整
 * @param result LLM 返回的翻译结果
 * @param originalTexts 原文数组
 * @throws Error 验证失败时抛出错误
 */
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
