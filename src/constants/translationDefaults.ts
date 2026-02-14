/**
 * 翻译默认配置常量
 */

import type { TranslationConfig } from '@/types';
import { OPENAI_DEFAULTS, API_CONSTANTS } from './api';

/**
 * 翻译配置默认值
 */
export const DEFAULT_TRANSLATION_CONFIG: TranslationConfig = {
  apiKey: '',
  baseURL: OPENAI_DEFAULTS.BASE_URL,
  model: OPENAI_DEFAULTS.MODEL,
  sourceLanguage: 'English',
  targetLanguage: '简体中文',
  contextBefore: 5,
  contextAfter: 3,
  batchSize: 20,
  threadCount: 4,
  rpm: 0,
};

/**
 * 翻译参数约束
 */
export const TRANSLATION_LIMITS = {
  /** 最小批次大小 */
  MIN_BATCH_SIZE: 1,

  /** 最大批次大小 */
  MAX_BATCH_SIZE: 50,

  /** 最小上下文数量 */
  MIN_CONTEXT: 0,

  /** 最大上下文数量 */
  MAX_CONTEXT: 10,

  /** 最小线程数 */
  MIN_THREAD_COUNT: 1,

  /** 最大线程数 */
  MAX_THREAD_COUNT: 10,

  /** 最大 RPM */
  MAX_RPM: 1000,
} as const;
