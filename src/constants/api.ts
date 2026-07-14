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

  /** 历史保存延迟（毫秒） */
  HISTORY_SAVE_DELAY_MS: 500,
} as const;
