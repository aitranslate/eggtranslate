/**
 * 翻译配置 Store
 * 替代原 TranslationContext，使用 Zustand 管理翻译配置和状态
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { TranslationConfig, TranslationProgress } from '@/types';
import translationService from '@/services/TranslationService';
import toast from 'react-hot-toast';
import { toAppError } from '@/utils/errors';

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
  ) => Promise<{ translations: Record<string, any>; tokensUsed: number }>;
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
  targetLanguage: 'zh',
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

        try {
          await translationService.updateConfig(newConfig);

          set({
            config: newConfig,
            isConfigured: (newConfig.apiKey?.length || 0) > 0
          });
        } catch (error) {
          const appError = toAppError(error, '更新配置失败');
          console.error('[translationConfigStore]', appError.message, appError);
          toast.error(`更新配置失败: ${appError.message}`);
          throw error;
        }
      },

      /**
       * 测试连接
       */
      testConnection: async () => {
        try {
          const result = await translationService.testConnection();
          if (result) {
            toast.success('连接测试成功！');
          } else {
            toast.error('连接测试失败');
          }
          return result;
        } catch (error) {
          const appError = toAppError(error, '连接测试失败');
          console.error('[translationConfigStore]', appError.message, appError);
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
          abortController: null
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
          abortController: null
        });

        try {
          await translationService.resetProgress();
        } catch (error) {
          const appError = toAppError(error, '重置进度失败');
          console.error('[translationConfigStore]', appError.message, appError);
        }
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
        // 同步配置到 TranslationService（确保单例的 config 是最新的）
        const currentConfig = get().config;
        const serviceConfig = translationService.getConfig();

        // 只在配置不同时才更新（避免不必要的写入）
        if (serviceConfig.apiKey !== currentConfig.apiKey ||
            serviceConfig.baseURL !== currentConfig.baseURL ||
            serviceConfig.model !== currentConfig.model) {
          await translationService.updateConfig(currentConfig);
        }

        return translationService.translateBatch(texts, signal, contextBefore, contextAfter, terms);
      },

      /**
       * 更新翻译进度
       */
      updateProgress: async (
        current: number,
        total: number,
        phase: 'direct' | 'completed',
        status: string,
        taskId: string,
        newTokens?: number
      ) => {
        // 更新 store 状态
        set({
          progress: { current, total, phase, status }
        });

        // 更新服务层
        await translationService.updateProgress(current, total, phase, status, taskId, newTokens);

        // 更新 tokens
        if (newTokens !== undefined) {
          set((state) => ({
            tokensUsed: state.tokensUsed + newTokens
          }));
        }
      },

      /**
       * 完成翻译
       */
      completeTranslation: async (taskId: string) => {
        await translationService.completeTranslation(taskId);
        set({
          isTranslating: false,
          currentTaskId: ''
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
