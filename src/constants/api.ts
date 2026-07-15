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

  /**
   * 流式 SSE 空闲超时（毫秒）：连续这么久读不到新 chunk 则中止本轮流，
   * 交给上层重试/非流式回退/部分抢救，避免 UI 卡在「处理中 31/32」。
   */
  STREAM_IDLE_TIMEOUT_MS: 90_000,
} as const;
