/**
 * API 相关常量
 */

/**
 * LLM API 调用常量
 */
export const API_CONSTANTS = {
  /** 最大重试次数 */
  MAX_RETRIES: 3,

  /** 默认温度参数 */
  DEFAULT_TEMPERATURE: 0.3,

  /** 请求超时（毫秒） */
  REQUEST_TIMEOUT_MS: 30000,

  /** 持久化延迟（毫秒） */
  PERSIST_DELAY_MS: 200,

  /** 状态更新等待延迟（毫秒） */
  STATE_UPDATE_DELAY_MS: 100,

  /** 批处理任务间隔（毫秒） */
  BATCH_TASK_GAP_MS: 1000,

  /** 历史保存延迟（毫秒） */
  HISTORY_SAVE_DELAY_MS: 500,
} as const;

/**
 * OpenAI API 默认配置
 */
export const OPENAI_DEFAULTS = {
  /** 默认 Base URL */
  BASE_URL: 'https://api.openai.com/v1',

  /** 默认模型 */
  MODEL: 'gpt-3.5-turbo',
} as const;
