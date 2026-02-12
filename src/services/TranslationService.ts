import { TranslationConfig } from '@/types';
import { jsonrepair } from 'jsonrepair';
import dataManager from '@/services/dataManager';
import { generateSharedPrompt, generateDirectPrompt } from '@/utils/translationPrompts';
import { callLLM } from '@/utils/llmApi';
import { DEFAULT_TRANSLATION_CONFIG } from '@/constants/translationDefaults';
import { API_CONSTANTS, OPENAI_DEFAULTS } from '@/constants/api';
import { toAppError } from '@/utils/errors';

/**
 * 翻译服务 - 纯业务逻辑层
 *
 * 职责：
 * - 翻译逻辑（信达雅一步翻译）
 * - 进度管理
 * - 任务控制
 * - 连接测试
 * - 配置管理
 */
class TranslationService {
  private config: TranslationConfig;

  constructor() {
    this.config = { ...DEFAULT_TRANSLATION_CONFIG };
  }

  /**
   * 初始化服务（加载保存的配置）
   */
  async initialize(): Promise<void> {
    try {
      const savedConfig = dataManager.getConfig();
      if (savedConfig) {
        this.config = savedConfig;
      }
    } catch (error) {
      const appError = toAppError(error, '加载翻译配置失败');
      console.error('[TranslationService]', appError.message, appError);
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): TranslationConfig {
    return this.config;
  }

  /**
   * 更新配置并保存
   */
  async updateConfig(newConfig: Partial<TranslationConfig>): Promise<void> {
    this.config = { ...this.config, ...newConfig };
    try {
      await dataManager.saveConfig(this.config);
    } catch (error) {
      const appError = toAppError(error, '保存翻译配置失败');
      console.error('[TranslationService]', appError.message, appError);
      throw appError;
    }
  }

  /**
   * 测试 API 连接
   */
  async testConnection(): Promise<boolean> {
    if (!this.config.apiKey) {
      throw new Error('请先配置API密钥');
    }

    try {
      await callLLM(
        {
          baseURL: this.config.baseURL,
          apiKey: this.config.apiKey,
          model: this.config.model
        },
        [{ role: 'user', content: 'Hello' }],
        { maxRetries: 1 }
      );
      return true;
    } catch (error) {
      const appError = toAppError(error, '连接测试失败');
      console.error('[TranslationService]', appError.message, appError);
      throw appError;
    }
  }

  /**
   * 批量翻译字幕
   */
  async translateBatch(
    texts: string[],
    signal?: AbortSignal,
    contextBefore = '',
    contextAfter = '',
    terms = ''
  ): Promise<{ translations: Record<string, any>; tokensUsed: number }> {
    if (!this.config.apiKey) {
      throw new Error('请先配置API密钥');
    }

    const textToTranslate = texts.join('\n');
    const sharedPrompt = generateSharedPrompt(contextBefore, contextAfter, terms);
    const directPrompt = generateDirectPrompt(
      textToTranslate,
      sharedPrompt,
      this.config.sourceLanguage,
      this.config.targetLanguage
    );

    // 第一步：直译（带验证重试）
    let directContent: string;
    let directTokensUsed: number;
    let directResult: any;

    // 验证失败时重试（最多3次机会）
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
          baseURL: this.config.baseURL,
          apiKey: this.config.apiKey,
          model: this.config.model,
          rpm: this.config.rpm
        },
        [{ role: 'user', content: promptWithEmphasis }],
        {
          signal,
          temperature: retryTemperatures[attempt - 1],
          maxRetries: 1
        }
      );

      directContent = llmResult.content;
      directTokensUsed = llmResult.tokensUsed;

      const repairedDirectJson = jsonrepair(directContent);
      directResult = JSON.parse(repairedDirectJson);

      try {
        // 验证直译结果
        this.validateTranslationResult(directResult, texts);
        break;  // 验证成功，跳出重试循环
      } catch (error) {
        // 只在失败时打印调试信息
        console.error(`[TranslationService] ========== 批次翻译失败（第${attempt}次尝试，温度=${retryTemperatures[attempt - 1]}） ==========`);
        console.error(`[TranslationService] 原文（${texts.length}行）:`);
        texts.forEach((text, i) => console.error(`  ${i + 1}. ${text}`));
        console.error(`[TranslationService] LLM 原始返回:\n${directContent}`);
        console.warn(`[TranslationService] 直译验证失败（第${attempt}次尝试）:`, error instanceof Error ? error.message : String(error));

        if (attempt === 3) {
          throw error;  // 最后一次尝试也失败
        }
      }
    }

    return {
      translations: directResult,
      tokensUsed: directTokensUsed
    };
  }

  /**
   * 更新翻译进度
   * @param newTokens - 新增的 tokens（此方法只传递给 Store，不自己累加）
   */
  async updateProgress(
    current: number,
    total: number,
    phase: 'direct' | 'completed',
    status: string,
    taskId?: string,
    newTokens?: number
  ): Promise<void> {
    try {
      if (taskId) {
        const task = dataManager.getTaskById(taskId);
        const currentTokens = task?.translation_progress?.tokens || 0;

        const updateObj: Parameters<typeof dataManager.updateTaskTranslationProgressInMemory>[1] = {
          completed: current,
          total: total,
          status: phase === 'completed' ? 'completed' : 'translating',
        };

        // ✅ 只在完成时设置 tokens（中间过程由 Store 管理）
        if (phase === 'completed') {
          // Store 已经累加了所有 tokens，这里只是最终确认
          updateObj.tokens = currentTokens;
        }

        dataManager.updateTaskTranslationProgressInMemory(taskId, updateObj);
      }
    } catch (error) {
      const appError = toAppError(error, '更新翻译进度失败');
      console.error('[TranslationService]', appError.message, appError);
      throw appError;
    }
  }

  /**
   * 重置翻译进度
   */
  async resetProgress(): Promise<void> {
    try {
      const currentTask = dataManager.getCurrentTask();
      if (currentTask) {
        await dataManager.updateTaskTranslationProgress(currentTask.taskId, {
          completed: 0,
          tokens: 0,
          status: 'idle'
        });
      }
    } catch (error) {
      const appError = toAppError(error, '重置翻译进度失败');
      console.error('[TranslationService]', appError.message, appError);
      throw appError;
    }
  }

  /**
   * 完成翻译任务
   */
  async completeTranslation(taskId: string): Promise<void> {
    try {
      const task = dataManager.getTaskById(taskId);
      if (task) {
        const taskTokens = task.translation_progress?.tokens || 0;

        // 先在内存中更新
        dataManager.updateTaskTranslationProgressInMemory(taskId, {
          status: 'completed',
          tokens: taskTokens
        });

        // 延迟持久化
        setTimeout(async () => {
          try {
            await dataManager.updateTaskTranslationProgress(taskId, {
              status: 'completed',
              tokens: taskTokens
            });
            console.log('翻译任务持久化完成:', taskId);
          } catch (error) {
            const appError = toAppError(error, '延迟持久化失败');
            console.warn('[TranslationService]', appError.message);
          }
        }, API_CONSTANTS.PERSIST_DELAY_MS);
      }
    } catch (error) {
      const appError = toAppError(error, '保存完成状态失败');
      console.error('[TranslationService]', appError.message, appError);
      throw appError;
    }
  }

  /**
   * 清空当前任务
   */
  async clearTask(): Promise<void> {
    try {
      await dataManager.clearCurrentTask();
    } catch (error) {
      const appError = toAppError(error, '清空任务失败');
      console.error('[TranslationService]', appError.message, appError);
      throw appError;
    }
  }

  /**
   * 验证翻译结果
   * @param result LLM 返回的翻译结果
   * @param originalTexts 原文数组
   * @throws Error 验证失败时抛出错误
   */
  private validateTranslationResult(
    result: Record<string, any>,
    originalTexts: string[]
  ): void {
    const expectedKeys = originalTexts.map((_, i) => String(i + 1));
    const actualKeys = Object.keys(result);

    for (const key of expectedKeys) {
      if (!actualKeys.includes(key)) {
        throw new Error(`翻译结果缺少键 "${key}"，期望 ${expectedKeys.length} 行，实际 ${actualKeys.length} 行`);
      }
    }

    for (const key of expectedKeys) {
      const entry = result[key];
      if (!entry || typeof entry !== 'object') {
        throw new Error(`翻译结果 "${key}" 不是有效对象`);
      }
      if (!('direct' in entry)) {
        throw new Error(`翻译结果 "${key}" 缺少 "direct" 字段`);
      }
    }
  }
}

// 创建单例实例
const translationService = new TranslationService();

export default translationService;
